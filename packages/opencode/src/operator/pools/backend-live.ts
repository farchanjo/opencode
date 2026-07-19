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
import { createConfigAdapter, DEFAULT_ROUTING_CONFIG } from "@/routing/adapters/outbound/config-adapter"
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

// The `project` routing Config.Service authority key (mirrors ConfigAdapter AUTHORITY.project).
const PROJECT_AUTHORITY = "routing"

export interface LivePoolsBackendDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each write/read (default `Date.now`). */
  readonly clock?: () => number
}

type RolePoolRecord = RoutingConfig.Info["models"]["role_pools"]

/** The raw project-scope routing entry: its CAS token, decoded config, and last-write time. */
interface ProjectEntry {
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

export function createLivePoolsBackend(deps: LivePoolsBackendDeps): PoolsBackend {
  const clock = deps.clock ?? Date.now
  const routing = createConfigAdapter({ config: deps.config, now: clock })

  /** Read the raw project-scope entry (CAS token + last-write time) — `unavailable` on outage. */
  const readProject = (): Effect.Effect<ProjectEntry, PoolsError> =>
    Effect.tryPromise({
      try: () => deps.config.get(PROJECT_AUTHORITY),
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

  const project = (): Effect.Effect<PoolsProjection, PoolsError> =>
    Effect.gen(function* () {
      const effective = yield* readEffective()
      const entry = yield* readProject()
      return buildProjection(effective.models.role_pools, entry.version, entry.updatedAtMs)
    })

  /**
   * Validate the principal + transformed routing config and hand the dispatcher an
   * `OperatorMutationPlan` whose `role_pools` map is `nextRolePools` (the rest of the
   * effective config preserved). `mutateAuthority` owns the one CAS write over the
   * `routing` authority — the backend never self-commits (FR5, FR7, FR8).
   */
  const planWrite = (
    input: { readonly principal: PoolsSetInput["principal"] },
    nextRolePools: RolePoolRecord,
  ): Effect.Effect<OperatorMutationPlan, PoolsError> =>
    Effect.gen(function* () {
      if (input.principal.kind !== "operator" && input.principal.kind !== "system")
        return yield* Effect.fail<PoolsError>({ type: "unauthorized", reason: `principal ${input.principal.kind} may not mutate role pools` })

      const entry = yield* readProject()
      const base = entry.config !== null ? entry.config : yield* readEffective()
      const nextConfig: RoutingConfig.Info = { ...base, models: { ...base.models, role_pools: nextRolePools } }
      const decoded = decodeRouting(nextConfig, { errors: "all" })
      if (Exit.isFailure(decoded))
        return yield* Effect.fail<PoolsError>({ type: "invalid_argument", field: "bindings", reason: "role pools failed schema validation" })
      const payload = decoded.value as RoutingConfig.Info
      return { authority: PROJECT_AUTHORITY, apply: () => payload }
    })

  const planSet = (input: PoolsSetInput): Effect.Effect<OperatorMutationPlan, PoolsError> => {
    const defect = firstBindingDefect(input.bindings)
    if (defect !== undefined) return Effect.fail(defect)
    return planWrite(input, toRolePoolRecord(input.bindings))
  }

  const planReset = (input: PoolsResetInput): Effect.Effect<OperatorMutationPlan, PoolsError> =>
    planWrite(input, DEFAULT_ROUTING_CONFIG.models.role_pools)

  return { resolve: project, planSet, planReset, validate: project }
}
