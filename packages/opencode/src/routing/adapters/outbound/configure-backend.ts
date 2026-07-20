/**
 * Feature 024 / T-configure — live `routing.configure` mutation backend.
 *
 * `routing.configure` is the operator verb that persists the routing activation +
 * advanced policy an operator edits on the TUI "Routing configure" form (the
 * Enabled toggle, the Auto/Always/Never mode, and an advanced-JSON policy override
 * such as `{"budgetPolicy":{…}}`). Before Feature 024 the inbound adapter answered
 * `not_implemented`, so a Save surfaced a RED warning and routing could never be
 * activated. This backend closes that gap by mirroring the `smart`/`pools` backends
 * EXACTLY (`operator/smart/backend-live.ts`, `operator/pools/backend-live.ts`):
 *
 *   - It NEVER opens a parallel store: it reads the effective routing config
 *     (project shadows global shadows the built-in default) through the reused
 *     `RoutingConfigPort` (`config-adapter.ts`), the SAME Config.Service authority
 *     `smart`/`pools` project.
 *   - It NEVER self-commits: `planConfigure` VALIDATES the patched config at plan
 *     time and hands the dispatcher an `OperatorMutationPlan`. The Feature 007
 *     `mutateAuthority` pipeline owns the single committed CAS write + audit, so a
 *     rejected mutation (invalid policy JSON, schema violation, stale CAS token)
 *     leaves NO persisted write behind (ADR-0017).
 *
 * SHARED-AUTHORITY MERGE (the load-bearing Feature 024 invariant): `routing.configure`,
 * `pools.set` and `smart.*` all write the SAME per-scope routing document. `apply`
 * therefore merges ONLY the configure-owned fields (`activation.enabled`/`mode` and
 * `enforcement.budget`) into the FRESH on-disk payload `mutateAuthority` threads to
 * it — never a plan-time snapshot — so `models.role_pools` (owned by `pools.set`) and
 * any sibling activation field (owned by `smart.*`) are preserved rather than
 * clobbered. Honest degradation (FR8): a Config.Service outage maps to the typed
 * `unavailable`; a schema-invalid transform to `invalid_argument`. Zero provider/model
 * calls, tokens, or cost.
 */
export * as RoutingConfigureBackend from "./configure-backend"

import { Effect, Exit, Schema } from "effect"
import { RoutingConfig } from "@opencode-ai/schema/routing/config"
import { AUTHORITY, createConfigAdapter, type RoutingConfigScope } from "./config-adapter"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { RoutingError } from "@opencode-ai/protocol/routing/index"

/**
 * The parsed, content-free `routing.configure` payload. Every field is optional:
 * the operator may toggle activation, change the mode, override the advanced budget
 * policy, or any combination. The inbound adapter rejects an all-empty payload
 * before it reaches the backend.
 */
export interface RoutingConfigureInput {
  /** The Enabled toggle — flips `activation.enabled`. */
  readonly enabled?: boolean
  /** The Auto/Always/Never picker — sets `activation.mode`. */
  readonly mode?: RoutingConfig.RoutingMode
  /** The advanced `{"budgetPolicy":{…}}` override — replaces `enforcement.budget`. */
  readonly budgetPolicy?: unknown
}

export interface RoutingConfigureBackend {
  /**
   * VALIDATE the patched routing config and hand back an `OperatorMutationPlan`
   * whose `apply` merges the configure fields into the fresh persisted document
   * under CAS. `mutateAuthority` owns the one committed write.
   *
   * `requestScopeKind` is the dispatcher-resolved request scope
   * (`ctx.request.scope.kind` — "global" / "project" / "session"). The write
   * authority is derived from THIS scope — the SAME resolution the mutation
   * preflight uses (`command-authority.ts`) — so the preflight CAS token and the
   * committed authority can never diverge (Feature 024 fix-round).
   */
  readonly planConfigure: (
    input: RoutingConfigureInput,
    requestScopeKind: string,
  ) => Effect.Effect<OperatorMutationPlan, RoutingError>
}

export interface LiveRoutingConfigureBackendDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock threaded to the reused config adapter (default `Date.now`). */
  readonly now?: () => number
}

const decodeRouting = Schema.decodeUnknownExit(RoutingConfig.Info)

function parseRouting(payload: unknown): RoutingConfig.Info | null {
  const exit = decodeRouting(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? (exit.value as RoutingConfig.Info) : null
}

const unavailable = (reason: string): RoutingError => ({ type: "unavailable", reason })

/**
 * The scope a `routing.configure` mutation WRITES: derived from the REQUEST scope,
 * never the effective-config origin. This mirrors the mutation preflight
 * (`command-authority.ts` — `SMART_AUTHORITY[norm(scope.scopeKind)]`, where `norm`
 * maps everything but "global" to "project") and the `pools.set` backend (which
 * always writes the PROJECT `routing` authority for a project-scoped op). Deriving
 * from the request scope — not `origin` — keeps the preflight CAS-token authority
 * and the committed authority ALWAYS in lockstep, even on a fresh project whose
 * config resolves via global/default. A project-scoped configure therefore
 * creates/writes the project `routing` override; a global-scoped one writes
 * `global:routing`.
 */
function scopeForRequest(scopeKind: string): RoutingConfigScope {
  return scopeKind === "global" ? "global" : "project"
}

/**
 * PARTIAL-MERGE the configure-owned fields into `base`, preserving every sibling
 * key (`models.role_pools`, unrelated activation/enforcement fields). This is the
 * ONE place the routing document is mutated for a configure — used both at plan
 * time (over the effective snapshot, to validate) and at commit time (over the
 * fresh on-disk payload, to persist), so the two never diverge.
 */
function applyConfigure(base: RoutingConfig.Info, input: RoutingConfigureInput): RoutingConfig.Info {
  const activation: RoutingConfig.Activation = {
    ...base.activation,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
  }
  const enforcement =
    input.budgetPolicy !== undefined
      ? { ...base.enforcement, budget: input.budgetPolicy as RoutingConfig.Enforcement["budget"] }
      : base.enforcement
  return { ...base, activation, enforcement }
}

export function createRoutingConfigureBackend(deps: LiveRoutingConfigureBackendDeps): RoutingConfigureBackend {
  const now = deps.now ?? Date.now
  const routing = createConfigAdapter({ config: deps.config, now })

  const planConfigure = (
    input: RoutingConfigureInput,
    requestScopeKind: string,
  ): Effect.Effect<OperatorMutationPlan, RoutingError> =>
    Effect.gen(function* () {
      // Read the effective config (project > global > default) for the merge BASE
      // and defaults only — the SAME resolution smart/pools use. The WRITE TARGET
      // authority, however, comes from the REQUEST scope (below), not this origin.
      const effective = yield* Effect.tryPromise({
        try: () => routing.resolveEffective(),
        catch: (cause): RoutingError => unavailable(String(cause)),
      })
      // Write authority = request scope (matches the preflight), NOT effective origin.
      const scope = scopeForRequest(requestScopeKind)

      // VALIDATE the patched config at plan time. An invalid advanced policy (bad
      // budget shape) or an out-of-range mode fails BEFORE any plan is produced, so
      // the operator sees a typed validation error, not a silent no-op or a crash.
      const patched = applyConfigure(effective.config, input)
      const decoded = decodeRouting(patched, { errors: "all" })
      if (Exit.isFailure(decoded)) {
        return yield* Effect.fail<RoutingError>({
          type: "invalid_argument",
          field: "policy",
          reason: "routing configuration failed schema validation",
        })
      }
      const validated = decoded.value as RoutingConfig.Info

      // Commit-time merge: fold the configure fields into the FRESH persisted payload
      // `mutateAuthority` threads in (`current`), preserving role_pools written by
      // pools.set and activation written by smart.*. When the authority is empty
      // (create-if-absent) fall back to the plan-validated document.
      const apply = (current: unknown): RoutingConfig.Info => {
        const base = parseRouting(current)
        return base !== null ? applyConfigure(base, input) : validated
      }
      return { authority: AUTHORITY[scope], apply }
    })

  return { planConfigure }
}
