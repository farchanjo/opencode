/**
 * Feature 013 / T006 — live `SmartBackend` composition for the operator stack.
 *
 * Turns the reused routing Config.Service authority into the un-audited
 * `SmartBackend` seam the `smart` command adapter consumes. `smart` is a PROJECTION
 * of `RoutingConfig.Activation` — it never opens a second store: reads project the
 * effective activation state through the reused `RoutingConfigPort`
 * (`routing/adapters/outbound/config-adapter.ts`), and `planOn`/`planOff`/`planAuto`
 * VALIDATE and return an `OperatorMutationPlan` that flips only
 * `activation.enabled`/`mode` (preserving the effective models/enforcement) over the
 * scoped `routing` / `global:routing` authority. The Feature 007 `mutateAuthority`
 * pipeline owns the single committed CAS write + audit — the backend never
 * self-commits (FR3, FR7, FR9).
 *
 * Honest degradation (FR8): every Config.Service read is guarded with
 * `Effect.tryPromise`; an unreachable store maps to the typed `unavailable` and a
 * schema-invalid transform to `invalid_argument` — never a fabricated success. Zero
 * provider/model calls, tokens, or cost.
 */
export * as SmartBackendLive from "./backend-live"

import { Effect, Exit, Schema } from "effect"
import { RoutingConfig } from "@opencode-ai/schema/routing/config"
import {
  createConfigAdapter,
  type EffectiveRoutingConfig,
  type RoutingConfigPort,
  type RoutingConfigScope,
} from "@/routing/adapters/outbound/config-adapter"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { SmartError, SmartMutationInput, SmartSummary } from "@opencode-ai/protocol/smart/commands"
import type { SmartBackend } from "./smart-port"

const decodeRouting = Schema.decodeUnknownExit(RoutingConfig.Info)

function parseRouting(payload: unknown): RoutingConfig.Info | null {
  const exit = decodeRouting(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? (exit.value as RoutingConfig.Info) : null
}

// The routing Config.Service authority keys per scope (mirrors config-adapter's
// private AUTHORITY map; the SSOT `command-authority.ts` imports as `SMART_AUTHORITY`
// for the mutation preflight, so the preflight and the committed authority read one map).
export const AUTHORITY: Record<RoutingConfigScope, string> = {
  global: "global:routing",
  project: "routing",
}

export interface LiveSmartBackendDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each summary (default `Date.now`). */
  readonly now?: () => number
}

const unavailable = (reason: string): SmartError => ({ type: "unavailable", reason })

/**
 * The scope a smart mutation WRITES: derived from the REQUEST scope, never the
 * effective-config origin. This mirrors the mutation preflight
 * (`command-authority.ts` — `SMART_AUTHORITY[norm(scope.scopeKind)]`, where `norm`
 * maps everything but "global" to "project") so the preflight CAS-token authority
 * and the committed authority never diverge — even on a fresh project whose config
 * resolves via global/default. Before this fix the write scope came from the
 * effective ORIGIN, so a first smart.on on a fresh project silently persisted to
 * `global:routing` (preflight expected project `routing`, version null) and the
 * SECOND save hard-failed `invalid_argument` ("mutations require version"). The
 * write authority now follows the request scope, so the two never diverge (Feature
 * 025, mirroring the Feature 024 routing.configure fix).
 */
function scopeForRequest(scopeKind: string): RoutingConfigScope {
  return scopeKind === "global" ? "global" : "project"
}

/** The read state a summary and a mutation share: effective config + write scope + CAS token. */
interface SmartState {
  readonly effective: EffectiveRoutingConfig
  readonly scope: RoutingConfigScope
  readonly version: string
}

export function createLiveSmartBackend(deps: LiveSmartBackendDeps): SmartBackend {
  const now = deps.now ?? Date.now
  const routing: RoutingConfigPort = createConfigAdapter({ config: deps.config, now })

  const readState = (requestScopeKind: string): Effect.Effect<SmartState, SmartError> =>
    Effect.gen(function* () {
      // Read the effective config (project > global > default) for the summary +
      // merge base only — the WRITE TARGET authority comes from the REQUEST scope.
      const effective = yield* Effect.tryPromise({
        try: () => routing.resolveEffective(),
        catch: (cause) => unavailable(String(cause)),
      })
      const scope = scopeForRequest(requestScopeKind)
      const entry = yield* Effect.tryPromise({
        try: () => routing.get(scope),
        catch: (cause) => unavailable(String(cause)),
      })
      return { effective, scope, version: entry.version ?? INITIAL_CONFIG_VERSION }
    })

  const toSummary = (state: SmartState): SmartSummary => {
    const activation = state.effective.config.activation
    return {
      enabled: activation.enabled,
      auto: activation.mode === "auto",
      configured: state.effective.origin !== "default",
      available: true,
      authority: AUTHORITY[state.scope],
      updatedAt: new Date(now()).toISOString(),
      version: state.version,
    }
  }

  const resolve = (requestScopeKind: string): Effect.Effect<SmartSummary, SmartError> =>
    readState(requestScopeKind).pipe(Effect.map(toSummary))

  /**
   * Validate the patched routing config at plan time and hand the dispatcher an
   * `OperatorMutationPlan` — `mutateAuthority` owns the one CAS write over the
   * scoped routing authority (`routing` / `global:routing`) and emits the Feature
   * 007 audit correlation. The backend never self-commits, so a rejected mutation
   * never leaves a persisted write behind.
   *
   * The commit-time `apply` folds the activation transform into the FRESH on-disk
   * payload `mutateAuthority` threads in (`current`) — never a plan-time snapshot —
   * so `models.role_pools` (pools.set), `enforcement.budget` (budget.*) and every
   * sibling activation/routing.configure field are preserved rather than clobbered.
   * When the authority is empty (create-if-absent) it falls back to the plan-validated
   * document.
   */
  const planMutate = (
    _input: SmartMutationInput,
    requestScopeKind: string,
    patch: (activation: RoutingConfig.Activation) => RoutingConfig.Activation,
  ): Effect.Effect<OperatorMutationPlan, SmartError> =>
    Effect.gen(function* () {
      const state = yield* readState(requestScopeKind)
      const nextConfig: RoutingConfig.Info = { ...state.effective.config, activation: patch(state.effective.config.activation) }
      const decoded = decodeRouting(nextConfig, { errors: "all" })
      if (Exit.isFailure(decoded)) {
        return yield* Effect.fail<SmartError>({ type: "invalid_argument", field: "activation", reason: "routing configuration failed schema validation" })
      }
      const validated = decoded.value as RoutingConfig.Info
      const apply = (current: unknown): RoutingConfig.Info => {
        const base = parseRouting(current)
        return base !== null ? { ...base, activation: patch(base.activation) } : validated
      }
      return { authority: AUTHORITY[state.scope], apply }
    })

  return {
    resolve,
    planOn: (input, requestScopeKind) => planMutate(input, requestScopeKind, (activation) => ({ ...activation, enabled: true })),
    planOff: (input, requestScopeKind) => planMutate(input, requestScopeKind, (activation) => ({ ...activation, enabled: false })),
    planAuto: (input, requestScopeKind) => planMutate(input, requestScopeKind, (activation) => ({ ...activation, mode: "auto" })),
  }
}
