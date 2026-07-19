/**
 * Feature 013 / T007 — live `BudgetBackend` composition for the operator stack.
 *
 * Turns the reused Feature 001 `RoutingConfigPort` (`config-adapter.ts`, over the
 * canonical Feature 007 `ConfigPort` — `store.config`) into the un-audited
 * `BudgetBackend` seam the `budget` command adapter consumes. It is HONEST about
 * what it persists:
 *
 *   - **Reads (`resolve`).** Project the effective routing budget (project shadows
 *     global shadows `DEFAULT_ROUTING_BUDGET`) into the bounded, redacted
 *     `BudgetLimitsView`; `configured` reflects whether the requested scope carries
 *     an explicit document and `version` is the Config.Service CAS token.
 *   - **Mutations (`planSet`/`planReset`).** VALIDATE and return an
 *     `OperatorMutationPlan` over the FULL scoped `RoutingConfig.Info` with the
 *     budget sub-document replaced — never a second store. `planSet` merges the
 *     bounded limits view onto the current budget policy; `planReset` reverts the
 *     budget to `DEFAULT_ROUTING_BUDGET`. The hard ceiling is never silently
 *     relaxed: any limit that exceeds the default ceiling (or is not a positive
 *     integer) degrades to a typed `invalid_argument` before any plan is produced.
 *     The Feature 007 `mutateAuthority` pipeline owns the single committed CAS write
 *     + audit — the backend never self-commits.
 *   - **`validate`.** Reports validity of the effective budget without mutating.
 *
 * Every config read is guarded with `Effect.tryPromise`, so a Config.Service outage
 * degrades to the typed `unavailable` envelope — never a fabricated success (FR7,
 * FR8). Zero provider/model calls, tokens, or cost.
 */
export * as BudgetBackendLive from "./backend-live"

import { Effect, Exit, Schema } from "effect"
import {
  createConfigAdapter,
  DEFAULT_ROUTING_CONFIG,
  type RoutingConfigEntry,
  type RoutingConfigPort,
  type RoutingConfigScope,
} from "@/routing/adapters/outbound/config-adapter"
import { INITIAL_CONFIG_VERSION, type ConfigPort } from "@/operator/application/ports/config-port"
import { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  BudgetError,
  BudgetLimitsView,
  BudgetResetInput,
  BudgetScope,
  BudgetStatusInput,
  BudgetSummary,
  BudgetSetInput,
  BudgetValidateInput,
  BudgetValidateOutput,
} from "@opencode-ai/protocol/budget/commands"
import type { BudgetBackend } from "./budget-port"

export interface LiveBudgetBackendDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each summary (default `Date.now`). */
  readonly clock?: () => number
}

/** The conservative hard-maximum ceiling the operator may tighten but never relax (FR4). */
type RoutingBudget = RoutingConfig.Enforcement["budget"]
const DEFAULT_BUDGET: RoutingBudget = DEFAULT_ROUTING_CONFIG.enforcement.budget

/** The routing Config.Service authority keys per scope (mirrors config-adapter's private map). */
const AUTHORITY: Record<RoutingConfigScope, string> = {
  global: "global:routing",
  project: "routing",
}

const decodeRouting = Schema.decodeUnknownExit(RoutingConfig.Info)

const unavailable = (reason: string): BudgetError => ({ type: "unavailable", reason })

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** BudgetScope and RoutingConfigScope share the same closed set. */
const toRoutingScope = (scope: BudgetScope): RoutingConfigScope => scope

/** Project the effective routing budget onto the bounded operator limits view (FR4). */
function projectLimits(budget: RoutingBudget): BudgetLimitsView {
  return {
    maxTurns: budget.limits.max_turns,
    maxContextTokens: budget.limits.max_context_tokens,
    maxOutputTokens: budget.limits.max_output_tokens,
    maxWorkers: budget.concurrency.max_workers,
    tokenBudget: budget.cost.token_budget,
  }
}

/** Merge the bounded limits view onto the current budget policy, preserving untouched fields. */
function applyLimits(base: RoutingConfig.Info, view: BudgetLimitsView): RoutingConfig.Info {
  const budget = base.enforcement.budget
  return {
    ...base,
    enforcement: {
      ...base.enforcement,
      budget: {
        ...budget,
        limits: {
          ...budget.limits,
          max_turns: view.maxTurns,
          max_context_tokens: view.maxContextTokens,
          max_output_tokens: view.maxOutputTokens,
        },
        concurrency: { ...budget.concurrency, max_workers: view.maxWorkers },
        cost: { ...budget.cost, token_budget: view.tokenBudget },
      },
    },
  }
}

/** Revert the scoped config's budget to the default ceiling without touching other fields. */
function resetBudget(base: RoutingConfig.Info): RoutingConfig.Info {
  return { ...base, enforcement: { ...base.enforcement, budget: DEFAULT_BUDGET } }
}

type LimitCheck = { readonly valid: boolean; readonly field: string | null; readonly reason: string | null }
const VALID: LimitCheck = { valid: true, field: null, reason: null }

/** The bounded limit fields checked against the hard ceiling, in a stable order. */
const LIMIT_FIELDS = ["maxTurns", "maxContextTokens", "maxOutputTokens", "maxWorkers", "tokenBudget"] as const

/**
 * A limits view is valid when every field is a positive integer that does NOT
 * exceed the `DEFAULT_ROUTING_BUDGET` ceiling — the operator may tighten a limit
 * but never silently relax it (FR4).
 */
function validateLimits(view: BudgetLimitsView): LimitCheck {
  const ceiling = projectLimits(DEFAULT_BUDGET)
  for (const field of LIMIT_FIELDS) {
    const value = view[field]
    if (!Number.isInteger(value) || value <= 0) {
      return { valid: false, field, reason: `${field} must be a positive integer` }
    }
    if (value > ceiling[field]) {
      return { valid: false, field, reason: `${field} ${value} exceeds the hard ceiling ${ceiling[field]}` }
    }
  }
  return VALID
}

export function createLiveBudgetBackend(deps: LiveBudgetBackendDeps): BudgetBackend {
  const adapter: RoutingConfigPort = createConfigAdapter({ config: deps.config })
  const clock = deps.clock ?? Date.now

  const readEffective = (): Effect.Effect<RoutingConfig.Info, BudgetError> =>
    Effect.tryPromise({ try: () => adapter.resolveEffective(), catch: (e) => unavailable(reasonOf(e)) }).pipe(
      Effect.map((resolved) => resolved.config),
    )

  const readScoped = (scope: BudgetScope): Effect.Effect<RoutingConfigEntry, BudgetError> =>
    Effect.tryPromise({ try: () => adapter.get(toRoutingScope(scope)), catch: (e) => unavailable(reasonOf(e)) })

  /** Validate a transformed routing config and wrap it as an `OperatorMutationPlan`. */
  const planWrite = (scope: BudgetScope, next: RoutingConfig.Info): Effect.Effect<OperatorMutationPlan, BudgetError> => {
    const decoded = decodeRouting(next, { errors: "all" })
    if (Exit.isFailure(decoded)) {
      return Effect.fail<BudgetError>({ type: "invalid_argument", field: "limits", reason: "routing configuration failed schema validation" })
    }
    const payload = decoded.value as RoutingConfig.Info
    return Effect.succeed({ authority: AUTHORITY[toRoutingScope(scope)], apply: () => payload })
  }

  const resolve = (input: BudgetStatusInput): Effect.Effect<BudgetSummary, BudgetError> =>
    Effect.gen(function* () {
      const effective = yield* readEffective()
      const raw = yield* readScoped(input.scope)
      const limits = projectLimits(effective.enforcement.budget)
      return {
        configured: raw.config !== null,
        available: true,
        valid: validateLimits(limits).valid,
        limits,
        updatedAt: new Date(clock()).toISOString(),
        version: raw.version ?? INITIAL_CONFIG_VERSION,
      }
    })

  const planSet = (input: BudgetSetInput): Effect.Effect<OperatorMutationPlan, BudgetError> =>
    Effect.gen(function* () {
      const check = validateLimits(input.limits)
      if (!check.valid) {
        return yield* Effect.fail<BudgetError>({ type: "invalid_argument", field: check.field ?? "limits", reason: check.reason ?? "invalid budget limits" })
      }
      const base = yield* baseConfig(input.scope)
      return yield* planWrite(input.scope, applyLimits(base, input.limits))
    })

  const planReset = (input: BudgetResetInput): Effect.Effect<OperatorMutationPlan, BudgetError> =>
    Effect.gen(function* () {
      const base = yield* baseConfig(input.scope)
      return yield* planWrite(input.scope, resetBudget(base))
    })

  const validate = (input: BudgetValidateInput): Effect.Effect<BudgetValidateOutput, BudgetError> =>
    Effect.gen(function* () {
      const raw = yield* readScoped(input.scope)
      const budget = raw.config?.enforcement.budget ?? (yield* readEffective()).enforcement.budget
      const limits = projectLimits(budget)
      const check = validateLimits(limits)
      return { valid: check.valid, limits, reason: check.reason }
    })

  /** The scoped document to merge onto: the scope's own config, else the effective fallback. */
  const baseConfig = (scope: BudgetScope): Effect.Effect<RoutingConfig.Info, BudgetError> =>
    Effect.gen(function* () {
      const raw = yield* readScoped(scope)
      if (raw.config) return raw.config
      return yield* readEffective()
    })

  return { resolve, planSet, planReset, validate }
}
