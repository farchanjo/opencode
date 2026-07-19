/**
 * Feature 004 / T025 (S10) — Lang Lock policy/config persistence.
 *
 * The application-layer persistence adapter that stores the `langlock.*`
 * `LangLockConfig` document under the canonical Feature 007 Config.Service
 * authority through the REUSED `ConfigPort` (`@/operator/application/ports`),
 * never a parallel product store (FR5, FR7, C2, C15). It mirrors how
 * `packages/opencode/src/jobs/persistence.ts` (Feature 003 T022) reaches
 * Config.Service, so this module is unit-testable against an in-memory
 * `ConfigPort` and the live composition passes the real Config.Service-backed
 * store.
 *
 * Single-authority discipline:
 *   - **Global base + permission-gated project override (FR5, C2).** The global
 *     document is the base authority; a project document is the override. Both
 *     ride the same Config.Service authority; the hard-policy-floor guard is
 *     enforced by `resolveEffective` over the framework-free
 *     `PolicyResolution` domain (never a silent relax).
 *   - **Atomic version/CAS + idempotency (FR5, AC5).** Every mutation is an
 *     optimistic `compareAndSet` (the Config.Service string CAS token) that also
 *     bumps the numeric domain `policy_version` inside the document. A version
 *     mismatch surfaces a typed `version_conflict`, never a false write.
 *   - **Unconfigured resolves to the enabled `en-US` default (FR1, C15, AC16).**
 *     An unconfigured project (and an unconfigured global base) resolves to the
 *     enabled English (United States) default without translating any untouched
 *     content — the default is a pure value, never a stored side effect.
 *   - **Content-free (Security 5).** The persisted document carries only bounded
 *     enums/flags/tags/versions — never file text, diff, prompt, path, or secret.
 */
export * as LangLockPersistence from "./persistence"

import { Effect, Schema } from "effect"
import { Config } from "@opencode-ai/schema/langlock/config"
import { Effective } from "@opencode-ai/schema/langlock/effective"
import { Allowlist } from "@opencode-ai/schema/langlock/allowlist"
import { PolicyResolution } from "@opencode-ai/core/langlock/policy-resolution"
import type { ConfigPort, ConfigVersion } from "@/operator/application/ports"

// =============================================================================
// Result & error shapes
// =============================================================================

/** A durably persisted `LangLockConfig` plus its Config.Service CAS token (FR5, C2). */
export interface PersistedConfig {
  readonly config: Config.LangLockConfig
  /** Opaque Config.Service CAS version token — the concurrency guard for the next write. */
  readonly casVersion: ConfigVersion
  readonly updatedAtMs: number
}

/** The resolved effective policy plus the domain resolution outcome (FR5, FR7, C2). */
export interface EffectiveResolution {
  readonly effective: Effective.EffectiveConfig
  readonly outcome: PolicyResolution.ResolutionOutcome
}

/**
 * The typed persistence error union. `version_conflict` guards optimistic CAS;
 * `decode_failed` guards a corrupt/tampered durable document; `unavailable`
 * surfaces a Config.Service outage without a false success (AC5).
 */
export type LangLockPersistenceError =
  | { readonly type: "version_conflict"; readonly currentVersion: ConfigVersion }
  | { readonly type: "decode_failed"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }

/** The persistence scope — the global base authority or a project override. */
export type PersistenceScope = "global" | "project"

export interface LangLockPersistenceDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each write (default `Date.now`). */
  readonly clock?: () => number
  /** Authority-key namespace prefix for the durable langlock table (default `"langlock"`). */
  readonly authorityPrefix?: string
}

/** The persistence surface consumed by the operator domain (T033) and authorization (T029). */
export interface LangLockPersistence {
  /**
   * The canonical Config.Service authority key a scope/scopeId maps to. Exposed so a
   * Feature 014 `OperatorMutationPlan` can name the same authority the reads use, letting
   * `mutateAuthority` own the single committed CAS write instead of the backend self-committing.
   */
  readonly authorityFor: (scope: PersistenceScope, scopeId: string) => string
  readonly readConfig: (
    scope: PersistenceScope,
    scopeId: string,
  ) => Effect.Effect<PersistedConfig | null, LangLockPersistenceError>
  readonly saveConfig: (input: {
    readonly scope: PersistenceScope
    readonly scopeId: string
    readonly config: Config.LangLockConfig
    readonly expectedVersion: ConfigVersion | null
  }) => Effect.Effect<PersistedConfig, LangLockPersistenceError>
  readonly resolveEffective: (
    projectRef: string | null,
  ) => Effect.Effect<EffectiveResolution, LangLockPersistenceError>
}

// =============================================================================
// Codecs & the enabled en-US default
// =============================================================================

const decodeConfig = Schema.decodeUnknownEffect(Config.LangLockConfig)
const encodeConfig = Schema.encodeEffect(Config.LangLockConfig)

const asDecodeFailed = (error: unknown): LangLockPersistenceError => ({
  type: "decode_failed",
  reason: error instanceof Error ? error.message : String(error),
})

/** The enabled English (United States) default document (FR1, C15, AC16); a pure value, never stored implicitly. */
export const defaultConfig: Config.LangLockConfig = Schema.decodeUnknownSync(Config.LangLockConfig)({
  language: { enabled: true, tag: "en-US", enforcement_mode: "advisory" },
  authority: { scope: "project", hard_floor: false, override_authorized: false, manifest_ref: null },
  version: 1,
})

const DEFAULT_DISPLAY_NAME =
  Allowlist.INITIAL_ALLOWLIST.find((entry) => entry.tag === "en-US")?.display_name ?? "English (United States)"

// =============================================================================
// Factory
// =============================================================================

export function createLangLockPersistence(deps: LangLockPersistenceDeps): LangLockPersistence {
  const clock = deps.clock ?? Date.now
  const prefix = deps.authorityPrefix ?? "langlock"
  const config = deps.config

  const authorityFor = (scope: PersistenceScope, scopeId: string): string =>
    scope === "global" ? `${prefix}/global` : `${prefix}/project/${scopeId}`

  const readConfig = (
    scope: PersistenceScope,
    scopeId: string,
  ): Effect.Effect<PersistedConfig | null, LangLockPersistenceError> =>
    Effect.gen(function* () {
      const entry = yield* Effect.tryPromise({
        try: () => config.get(authorityFor(scope, scopeId)),
        catch: (cause): LangLockPersistenceError => ({ type: "unavailable", reason: String(cause) }),
      })
      if (entry === null || entry.payload === null) return null
      const decoded = yield* decodeConfig(entry.payload).pipe(Effect.mapError(asDecodeFailed))
      return { config: decoded, casVersion: entry.version, updatedAtMs: entry.updatedAtMs }
    })

  const saveConfig = (input: {
    readonly scope: PersistenceScope
    readonly scopeId: string
    readonly config: Config.LangLockConfig
    readonly expectedVersion: ConfigVersion | null
  }): Effect.Effect<PersistedConfig, LangLockPersistenceError> =>
    Effect.gen(function* () {
      const encoded = yield* encodeConfig(input.config).pipe(Effect.mapError(asDecodeFailed))
      const nowMs = clock()
      const result = yield* Effect.tryPromise({
        try: () =>
          config.compareAndSet({
            authority: authorityFor(input.scope, input.scopeId),
            expectedVersion: input.expectedVersion,
            payload: encoded,
            nowMs,
          }),
        catch: (cause): LangLockPersistenceError => ({ type: "unavailable", reason: String(cause) }),
      })
      if (!result.ok) {
        if (result.code === "conflict")
          return yield* Effect.fail<LangLockPersistenceError>({ type: "version_conflict", currentVersion: result.currentVersion })
        return yield* Effect.fail<LangLockPersistenceError>({ type: "unavailable", reason: result.reason })
      }
      return { config: input.config, casVersion: result.version, updatedAtMs: nowMs }
    })

  const resolveEffective = (
    projectRef: string | null,
  ): Effect.Effect<EffectiveResolution, LangLockPersistenceError> =>
    Effect.gen(function* () {
      const globalPersisted = yield* readConfig("global", "")
      const globalConfig = globalPersisted?.config ?? defaultConfig
      const projectPersisted = projectRef === null ? null : yield* readConfig("project", projectRef)

      const outcome = PolicyResolution.resolve({
        global: toPolicyView(globalConfig),
        override: projectPersisted === null ? undefined : toProjectOverride(projectPersisted.config),
      })
      return { effective: toEffective(globalConfig, outcome.resolved), outcome }
    })

  return { authorityFor, readConfig, saveConfig, resolveEffective }
}

// =============================================================================
// Domain projections (content-free)
// =============================================================================

/** Project a stored `LangLockConfig` onto the framework-free `PolicyView` (FR5, C2). */
function toPolicyView(config: Config.LangLockConfig): PolicyResolution.PolicyView {
  return {
    enabled: config.language.enabled,
    tag: config.language.tag,
    enforcement_mode: config.language.enforcement_mode,
    policy_version: config.version,
    hard_floor: config.authority.hard_floor,
  }
}

/** Project a stored project `LangLockConfig` onto the framework-free `ProjectOverride` (FR5, Security 1). */
function toProjectOverride(config: Config.LangLockConfig): PolicyResolution.ProjectOverride {
  return {
    enabled: config.language.enabled,
    tag: config.language.tag,
    enforcement_mode: config.language.enforcement_mode,
    policy_version: config.version,
    override_authorized: config.authority.override_authorized,
  }
}

/** Build the immutable, content-free `EffectiveConfig` read model from the resolution (FR7, C4). */
function toEffective(
  globalConfig: Config.LangLockConfig,
  resolved: PolicyResolution.ResolvedLanguage,
): Effective.EffectiveConfig {
  return Schema.decodeUnknownSync(Effective.EffectiveConfig)({
    language: {
      enabled: resolved.enabled,
      tag: resolved.tag,
      display_name: displayNameFor(resolved.tag),
      enforcement_mode: resolved.enforcement_mode,
    },
    authority: {
      scope: globalConfig.authority.scope,
      origin: resolved.origin,
      policy_version: resolved.policy_version,
      override_authorized: globalConfig.authority.override_authorized,
    },
  })
}

/** Human display name for a tag; defaults to the en-US label for an unmapped tag (FR4, C13). */
function displayNameFor(tag: string): string {
  return Allowlist.INITIAL_ALLOWLIST.find((entry) => entry.tag === tag)?.display_name ?? DEFAULT_DISPLAY_NAME
}
