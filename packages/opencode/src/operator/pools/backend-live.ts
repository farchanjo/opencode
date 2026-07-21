/**
 * Feature 013 / T008 — live `PoolsBackend` composition for the operator stack.
 *
 * Turns the reused routing Config.Service authority into the un-audited
 * `PoolsBackend` seam the `pools` command adapter consumes. `pools` is a PROJECTION
 * of `RoutingConfig.Models.role_pools` — this backend reuses the Feature 001 routing
 * config adapter (`routing/adapters/outbound/config-adapter.ts`) over the SAME
 * `store.config` seam langlock uses, never a parallel store (FR5, FR9):
 *
 *   - **`resolve`/`validate`** project the effective `role_pools` map
 *     (project shadows global shadows the built-in default) onto the bounded
 *     `PoolsProjection`; `valid` is computed over the effective bindings and never
 *     asserted blindly (FR5, FR8).
 *   - **`planSet`/`planReset`** VALIDATE and return an `OperatorMutationPlan` over
 *     the `project` routing authority that replaces / clears the `role_pools` map
 *     while preserving the rest of the effective config. A malformed binding
 *     degrades to `invalid_argument` and a non-mutating principal to `unauthorized`
 *     BEFORE any plan is produced; the Feature 007 `mutateAuthority` pipeline owns
 *     the single committed CAS write + audit — the backend never self-commits, so a
 *     rejected mutation leaves no persisted write (FR7, FR8).
 *
 * Config reads are guarded with `Effect.tryPromise` and mapped to the typed
 * `PoolsError` union — never a crash, never a false write. Zero provider/model
 * calls, tokens, or cost.
 */
export * as PoolsBackendLive from "./backend-live"

import { Effect, Exit, Schema } from "effect"
import { RoutingConfig } from "@opencode-ai/schema/routing/config"
import {
  createConfigAdapter,
  DEFAULT_ROUTING_CONFIG,
  type RoutingConfigScope,
} from "@/routing/adapters/outbound/config-adapter"
import type { CatalogModelValidator } from "@/routing/adapters/outbound/catalog-adapter"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { ConfigPort, ConfigVersion } from "@/operator/application/ports/config-port"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type {
  PoolsError,
  PoolsProjection,
  PoolsResetInput,
  PoolsSetInput,
  RolePoolBindingList,
} from "@opencode-ai/protocol/pools/commands"
import type { PoolsBackend } from "./pools-port"

// The routing Config.Service authority keys per scope (mirrors config-adapter's map and
// SmartBackendLive.AUTHORITY). `pools` is a PROJECTION of the SAME per-scope routing
// document, so role_pools follow the REQUEST scope (project `routing` / `global:routing`
// — Feature 033), never a hardwired project binding.
export const AUTHORITY: Record<RoutingConfigScope, string> = {
  global: "global:routing",
  project: "routing",
}

// The `project` routing authority key — retained as the PROJECT default for the degraded
// preflight fallback (`staticAuthorityForCommandId`, imported as `POOLS_AUTHORITY`).
export const PROJECT_AUTHORITY = AUTHORITY.project

/**
 * The scope a pools mutation WRITES: derived from the REQUEST scope, never the
 * effective-config origin — mirrors `SmartBackendLive.scopeForRequest` so the mutation
 * preflight CAS-token authority and the committed authority never diverge on a fresh
 * project whose config resolves via global/default (Feature 025/033). Defaults to
 * `project` for back-compat when no scope is threaded.
 */
function scopeForRequest(scopeKind: string | undefined): RoutingConfigScope {
  return scopeKind === "global" ? "global" : "project"
}

export interface LivePoolsBackendDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each write/read (default `Date.now`). */
  readonly clock?: () => number
  /**
   * Feature 038 — the live catalog validator. When present, `pools.set` REJECTS
   * any role-pool model id that resolves to no known catalog model (bare or the
   * standard `provider/model` provider-qualified form). OPTIONAL and omitted by
   * default so a catalog-less construction keeps the pre-038 write behavior.
   */
  readonly catalog?: CatalogModelValidator
}

type RolePoolRecord = RoutingConfig.Info["models"]["role_pools"]

/** The raw scoped routing entry: its CAS token, decoded config, and last-write time. */
interface ScopedEntry {
  readonly version: ConfigVersion
  readonly config: RoutingConfig.Info | null
  readonly updatedAtMs: number
}

const unavailable = (reason: string): PoolsError => ({ type: "unavailable", reason })

const decodeRouting = Schema.decodeUnknownExit(RoutingConfig.Info)

function parseRouting(payload: unknown): RoutingConfig.Info | null {
  const exit = decodeRouting(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? (exit.value as RoutingConfig.Info) : null
}

/** Project the `role_pools` map onto the ordered, content-free operator binding list (FR5). */
function toBindings(rolePools: RolePoolRecord): RolePoolBindingList {
  return Object.keys(rolePools)
    .sort()
    .map((role) => ({ role, models: [...rolePools[role]] }))
}

/** Materialise the operator binding list back into a `role_pools` map for persistence. */
function toRolePoolRecord(bindings: RolePoolBindingList): RolePoolRecord {
  const record: Record<string, readonly string[]> = {}
  for (const binding of bindings) record[binding.role] = [...binding.models]
  return record
}

/** True when every role names a non-empty pool of non-empty model ids (FR5, FR8). */
function rolePoolsValid(rolePools: RolePoolRecord): boolean {
  const roles = Object.keys(rolePools)
  return roles.every((role) => {
    const models = rolePools[role]
    return role.length > 0 && models.length > 0 && models.every((model) => model.length > 0)
  })
}

/** The first structural defect in a mutation's bindings, or `undefined` when well-formed (FR8). */
function firstBindingDefect(bindings: RolePoolBindingList): PoolsError | undefined {
  const seen = new Set<string>()
  for (const binding of bindings) {
    if (binding.role.length === 0) return { type: "invalid_argument", field: "role", reason: "role-pool name must be non-empty" }
    if (seen.has(binding.role)) return { type: "invalid_argument", field: "role", reason: `duplicate role-pool ${binding.role}` }
    seen.add(binding.role)
    if (binding.models.length === 0)
      return { type: "invalid_argument", field: "models", reason: `role-pool ${binding.role} has no candidate models` }
    if (binding.models.some((model) => model.length === 0))
      return { type: "invalid_argument", field: "models", reason: `role-pool ${binding.role} has an empty model id` }
  }
  return undefined
}

/** Deduped model ids across every binding — the set validated against the catalog (FR, Feature 038). */
function distinctModelIds(bindings: RolePoolBindingList): string[] {
  const seen = new Set<string>()
  for (const binding of bindings) for (const model of binding.models) seen.add(model)
  return [...seen]
}

export function createLivePoolsBackend(deps: LivePoolsBackendDeps): PoolsBackend {
  const clock = deps.clock ?? Date.now
  const routing = createConfigAdapter({ config: deps.config, now: clock })

  /** Read the raw scoped entry (CAS token + last-write time) — `unavailable` on outage. */
  const readScoped = (scope: RoutingConfigScope): Effect.Effect<ScopedEntry, PoolsError> =>
    Effect.tryPromise({
      try: () => deps.config.get(AUTHORITY[scope]),
      catch: (cause): PoolsError => unavailable(String(cause)),
    }).pipe(
      Effect.map((entry) =>
        entry === null
          ? { version: INITIAL_CONFIG_VERSION, config: null, updatedAtMs: clock() }
          : { version: entry.version, config: parseRouting(entry.payload), updatedAtMs: entry.updatedAtMs },
      ),
    )

  /** Resolve the effective routing config (project > global > default) — `unavailable` on outage. */
  const readEffective = (): Effect.Effect<RoutingConfig.Info, PoolsError> =>
    Effect.tryPromise({
      try: () => routing.resolveEffective(),
      catch: (cause): PoolsError => unavailable(String(cause)),
    }).pipe(Effect.map((resolved) => resolved.config))

  const buildProjection = (rolePools: RolePoolRecord, version: ConfigVersion, updatedAtMs: number): PoolsProjection => ({
    configured: Object.keys(rolePools).length > 0,
    available: true,
    valid: rolePoolsValid(rolePools),
    bindings: toBindings(rolePools),
    updatedAt: new Date(updatedAtMs).toISOString(),
    version,
  })

  const project = (requestScopeKind?: string): Effect.Effect<PoolsProjection, PoolsError> =>
    Effect.gen(function* () {
      // Bindings project the EFFECTIVE map (project > global > default) so a read always
      // reflects the merged view; the CAS token + timestamp follow the REQUEST scope.
      const effective = yield* readEffective()
      const entry = yield* readScoped(scopeForRequest(requestScopeKind))
      return buildProjection(effective.models.role_pools, entry.version, entry.updatedAtMs)
    })

  /**
   * Validate the principal + transformed routing config and hand the dispatcher an
   * `OperatorMutationPlan` whose `role_pools` map is `nextRolePools` (the rest of the
   * effective config preserved). `mutateAuthority` owns the one CAS write over the
   * SCOPED routing authority (`routing` / `global:routing`) — the backend never
   * self-commits (FR5, FR7, FR8). The commit-time `apply` folds the role_pools
   * transform into the FRESH on-disk payload `mutateAuthority` threads in (`current`)
   * — never a plan-time snapshot — so sibling activation/budget/routing.configure
   * fields on the shared document are preserved rather than clobbered (Feature 025).
   */
  const planWrite = (
    input: { readonly principal: PoolsSetInput["principal"] },
    nextRolePools: RolePoolRecord,
    scope: RoutingConfigScope,
  ): Effect.Effect<OperatorMutationPlan, PoolsError> =>
    Effect.gen(function* () {
      if (input.principal.kind !== "operator" && input.principal.kind !== "system")
        return yield* Effect.fail<PoolsError>({ type: "unauthorized", reason: `principal ${input.principal.kind} may not mutate role pools` })

      const entry = yield* readScoped(scope)
      const planBase = entry.config !== null ? entry.config : yield* readEffective()
      const withPools = (base: RoutingConfig.Info): RoutingConfig.Info => ({
        ...base,
        models: { ...base.models, role_pools: nextRolePools },
      })
      const decoded = decodeRouting(withPools(planBase), { errors: "all" })
      if (Exit.isFailure(decoded))
        return yield* Effect.fail<PoolsError>({ type: "invalid_argument", field: "bindings", reason: "role pools failed schema validation" })
      const validated = decoded.value as RoutingConfig.Info
      const apply = (current: unknown): RoutingConfig.Info => {
        const base = parseRouting(current)
        return base !== null ? withPools(base) : validated
      }
      return { authority: AUTHORITY[scope], apply }
    })

  /**
   * Feature 038 — reject any role-pool model id that resolves to no known catalog
   * model (a mistyped or unresolvable id), naming the offender, so an
   * unresolvable pool never persists to silently degrade a live session. A
   * provider-qualified id that DOES resolve passes. A no-op when no catalog
   * validator is injected (pre-038 behavior).
   *
   * A catalog outage OR a transiently-empty catalog (a SUCCESSFUL but empty
   * provider read — `unknownModelIds` throws for the empty case) degrades to
   * `unavailable`, NEVER `invalid_argument`: we cannot validate, so we do not
   * false-reject a valid write while the catalog is cold.
   */
  const validateAgainstCatalog = (bindings: RolePoolBindingList): Effect.Effect<void, PoolsError> =>
    Effect.gen(function* () {
      if (deps.catalog === undefined) return
      const unknown = yield* Effect.tryPromise({
        try: () => deps.catalog!.unknownModelIds(distinctModelIds(bindings)),
        catch: (cause): PoolsError => unavailable(`catalog validation unavailable: ${String(cause)}`),
      })
      if (unknown.length > 0)
        return yield* Effect.fail<PoolsError>({
          type: "invalid_argument",
          field: "models",
          reason: `role-pool model(s) ${unknown.join(", ")} resolve to no known catalog model`,
        })
    })

  const planSet = (input: PoolsSetInput, requestScopeKind?: string): Effect.Effect<OperatorMutationPlan, PoolsError> =>
    Effect.gen(function* () {
      const defect = firstBindingDefect(input.bindings)
      if (defect !== undefined) return yield* Effect.fail(defect)
      yield* validateAgainstCatalog(input.bindings)
      return yield* planWrite(input, toRolePoolRecord(input.bindings), scopeForRequest(requestScopeKind))
    })

  const planReset = (input: PoolsResetInput, requestScopeKind?: string): Effect.Effect<OperatorMutationPlan, PoolsError> =>
    planWrite(input, DEFAULT_ROUTING_CONFIG.models.role_pools, scopeForRequest(requestScopeKind))

  return { resolve: project, planSet, planReset, validate: project }
}
