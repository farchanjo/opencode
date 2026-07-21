/**
 * Feature 046 — the generic enforcement-leaf backend serving the
 * hierarchy/capability/budget config surfaces over the SAME routing
 * Config.Service authority the smart/budget/pools domains bind (FR6, FR8). It is
 * a PROJECTION of `RoutingConfig.Enforcement` — never a second store:
 *
 *   - `showLeaves` projects every leaf of a domain from the EFFECTIVE config
 *     (project shadows global shadows the built-in default) into the bounded
 *     operator map, with the scope's CAS token + configured flag (FR5).
 *   - `planConfigure` VALIDATES a partial `{ leafKey: value }` payload through the
 *     shared registry and returns an `OperatorMutationPlan` that applies ONLY the
 *     set leaves onto the FRESH on-disk config at commit time — sibling routing
 *     fields (`activation`, `role_pools`, untouched leaves) preserved (FR7). An
 *     invalid value degrades to typed `invalid_argument` naming the leaf, and a
 *     non-mutating principal to `unauthorized`, BEFORE any plan is produced (FR9).
 *
 * The Feature 007 `mutateAuthority` pipeline owns the single committed CAS write +
 * audit — the backend never self-commits. Every config read is guarded, so a
 * Config.Service outage degrades to typed `unavailable` (FR8). Zero model calls.
 */
export * as EnforcementLeafBackend from "./leaf-backend"

import { Effect, Exit, Schema } from "effect"
import { RoutingConfig } from "@opencode-ai/schema/routing/config"
import {
  createConfigAdapter,
  DEFAULT_ROUTING_BUDGET,
  type RoutingConfigPort,
  type RoutingConfigScope,
} from "@/routing/adapters/outbound/config-adapter"
import { INITIAL_CONFIG_VERSION, type ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import {
  EnforcementLeaves,
  type EnforcementDomain,
  type LeafValue,
} from "@opencode-ai/protocol/enforcement/leaves"

/** The routing Config.Service authority keys per scope (shared with smart/budget/pools). */
export const AUTHORITY: Record<RoutingConfigScope, string> = {
  global: "global:routing",
  project: "routing",
}

/** Operator principal permitted to mutate the enforcement config (mirrors pools/budget). */
export interface EnforcementPrincipal {
  readonly kind: string
  readonly id: string
}

/** The typed enforcement error union — every failure degrades to one of these (FR8). */
export type EnforcementError =
  | { readonly type: "version_conflict"; readonly expectedVersion: string; readonly actualVersion: string }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }

/** The bounded read model surfaced by `<domain>.show` (FR5). */
export interface EnforcementLeafView {
  readonly configured: boolean
  readonly available: boolean
  readonly leaves: Readonly<Record<string, LeafValue>>
  readonly updatedAt: string
  readonly version: string
}

export interface EnforcementConfigureInput {
  readonly domain: EnforcementDomain
  readonly values: Readonly<Record<string, unknown>>
  readonly expectedVersion: string
  readonly principal: EnforcementPrincipal
}

export interface EnforcementLeafBackendApi {
  readonly showLeaves: (domain: EnforcementDomain, requestScopeKind: string) => Effect.Effect<EnforcementLeafView, EnforcementError>
  readonly planConfigure: (input: EnforcementConfigureInput, requestScopeKind: string) => Effect.Effect<OperatorMutationPlan, EnforcementError>
}

export interface LiveEnforcementBackendDeps {
  readonly config: ConfigPort
  readonly clock?: () => number
}

const decodeRouting = Schema.decodeUnknownExit(RoutingConfig.Info)

function parseRouting(payload: unknown): RoutingConfig.Info | null {
  const exit = decodeRouting(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? (exit.value as RoutingConfig.Info) : null
}

const unavailable = (reason: string): EnforcementError => ({ type: "unavailable", reason })
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The write scope derived from the REQUEST scope (mirrors smart/budget) — keeps preflight + commit in lockstep. */
function scopeForRequest(scopeKind: string): RoutingConfigScope {
  return scopeKind === "global" ? "global" : "project"
}

/**
 * Feature 046 / FR4 — the SAME hard ceiling `budget.set`'s `validateLimits`
 * enforces (`budget/backend-live.ts`), sourced from the ONE `DEFAULT_ROUTING_BUDGET`
 * constant so the two budget write surfaces (`budget.set` and `budget.configure`)
 * can NEVER disagree on the safety ceiling. These five budget leaves may be
 * TIGHTENED but never raised above the ceiling; a value that exceeds it is rejected
 * `invalid_argument` before any plan is produced. The other twelve
 * budget/hierarchy/capability leaves keep their min-only registry bounds.
 */
const BUDGET_CEILINGS: Readonly<Record<string, number>> = {
  maxTurns: DEFAULT_ROUTING_BUDGET.limits.max_turns,
  maxContextTokens: DEFAULT_ROUTING_BUDGET.limits.max_context_tokens,
  maxOutputTokens: DEFAULT_ROUTING_BUDGET.limits.max_output_tokens,
  maxWorkers: DEFAULT_ROUTING_BUDGET.concurrency.max_workers,
  tokenBudget: DEFAULT_ROUTING_BUDGET.cost.token_budget,
}

/** The first ceiling-guarded budget leaf whose value exceeds the hard maximum, or null (FR4). */
function ceilingViolation(domain: EnforcementDomain, values: Readonly<Record<string, LeafValue>>): EnforcementError | null {
  if (domain !== "budget") return null
  for (const key of Object.keys(values)) {
    const ceiling = BUDGET_CEILINGS[key]
    if (ceiling === undefined) continue
    const value = values[key]
    if (typeof value === "number" && value > ceiling)
      return { type: "invalid_argument", field: key, reason: `${key} ${value} exceeds the hard ceiling ${ceiling}` }
  }
  return null
}

/** Apply the validated leaf values onto a config's enforcement, cloning only touched paths (FR7). */
function applyValues(base: RoutingConfig.Info, domain: EnforcementDomain, values: Readonly<Record<string, LeafValue>>): RoutingConfig.Info {
  let enforcement: Record<string, unknown> = base.enforcement as unknown as Record<string, unknown>
  for (const key of Object.keys(values)) {
    const leaf = EnforcementLeaves.leafFor(domain, key)
    if (leaf === undefined) continue
    enforcement = EnforcementLeaves.setLeaf(enforcement, leaf, values[key])
  }
  return { ...base, enforcement: enforcement as unknown as RoutingConfig.Info["enforcement"] }
}

export function createLiveEnforcementBackend(deps: LiveEnforcementBackendDeps): EnforcementLeafBackendApi {
  const clock = deps.clock ?? Date.now
  const routing: RoutingConfigPort = createConfigAdapter({ config: deps.config, now: clock })

  const readEffective = (): Effect.Effect<RoutingConfig.Info, EnforcementError> =>
    Effect.tryPromise({ try: () => routing.resolveEffective(), catch: (e) => unavailable(reasonOf(e)) }).pipe(
      Effect.map((resolved) => resolved.config),
    )

  const readScoped = (scope: RoutingConfigScope): Effect.Effect<{ version: string; config: RoutingConfig.Info | null }, EnforcementError> =>
    Effect.tryPromise({ try: () => routing.get(scope), catch: (e) => unavailable(reasonOf(e)) }).pipe(
      Effect.map((entry) => ({ version: entry.version ?? INITIAL_CONFIG_VERSION, config: entry.config })),
    )

  const showLeaves = (domain: EnforcementDomain, requestScopeKind: string): Effect.Effect<EnforcementLeafView, EnforcementError> =>
    Effect.gen(function* () {
      const effective = yield* readEffective()
      const scoped = yield* readScoped(scopeForRequest(requestScopeKind))
      const enforcement = effective.enforcement as unknown as Record<string, unknown>
      return {
        configured: scoped.config !== null,
        available: true,
        leaves: EnforcementLeaves.projectDomainLeaves(enforcement, domain),
        updatedAt: new Date(clock()).toISOString(),
        version: scoped.version,
      }
    })

  const planConfigure = (input: EnforcementConfigureInput, requestScopeKind: string): Effect.Effect<OperatorMutationPlan, EnforcementError> =>
    Effect.gen(function* () {
      if (input.principal.kind !== "operator" && input.principal.kind !== "system")
        return yield* Effect.fail<EnforcementError>({ type: "unauthorized", reason: `principal ${input.principal.kind} may not mutate enforcement config` })

      const parsed = EnforcementLeaves.parseConfigureValues(input.domain, input.values)
      if (!parsed.ok) return yield* Effect.fail<EnforcementError>({ type: "invalid_argument", field: parsed.key, reason: parsed.reason })
      if (Object.keys(parsed.values).length === 0)
        return yield* Effect.fail<EnforcementError>({ type: "invalid_argument", field: "values", reason: `${input.domain}.set requires at least one leaf value` })

      // FR4 — the budget ceiling is never silently relaxed: reject any over-ceiling
      // leaf before producing a plan, exactly as budget.set's validateLimits does.
      const violation = ceilingViolation(input.domain, parsed.values)
      if (violation !== null) return yield* Effect.fail<EnforcementError>(violation)

      const scope = scopeForRequest(requestScopeKind)
      const scoped = yield* readScoped(scope)
      const planBase = scoped.config !== null ? scoped.config : yield* readEffective()
      const transform = (base: RoutingConfig.Info): RoutingConfig.Info => applyValues(base, input.domain, parsed.values)

      const decoded = decodeRouting(transform(planBase), { errors: "all" })
      if (Exit.isFailure(decoded))
        return yield* Effect.fail<EnforcementError>({ type: "invalid_argument", field: "values", reason: "routing configuration failed schema validation" })
      const validated = decoded.value as RoutingConfig.Info

      const apply = (current: unknown): RoutingConfig.Info => {
        const base = parseRouting(current)
        return base !== null ? transform(base) : validated
      }
      return { authority: AUTHORITY[scope], apply }
    })

  return { showLeaves, planConfigure }
}
