/**
 * Feature 004 / T033 (S16) — live `LangLockBackend` composition for the operator stack.
 *
 * Turns the committed Feature 004 application adapters into the un-audited
 * `LangLockBackend` seam that `createLangLockPort` (T033) consumes, following the
 * `createLiveJobsBackend` precedent in `operator/jobs/backend-live.ts`. It is
 * HONEST about what the operator `AppRuntime` reaches:
 *
 *   - **Reachable and wired for real:** `resolve`, `set`, and `reset`. Lang Lock
 *     policy is a simple content-free document (no external assembler), so all
 *     three ride the real Config.Service durable authority through the reused
 *     `LangLockPersistence` (T025). `resolve` projects the redacted effective
 *     summary; `set`/`reset` are optimistic CAS writes that also run the domain
 *     tag validation (T016) and, for a project scope, the `langlock.override`
 *     authorization gate (T029). Nothing is fabricated.
 *
 *   - **Fail-closed override authorization (Security 1).** The injected
 *     `OverridePermissionPort` defaults to DENY when a real Feature 007
 *     Permission/Policy gate is not bound, so an unconfigured project override is
 *     rejected as `unauthorized` — never a fabricated grant. The global
 *     hard-policy floor is never relaxed (the gate reuses the domain resolver).
 *
 * Every method returns the port's typed `LangLockPolicyError` on failure, so a
 * caller always sees an honest capability gap and never a false success. Zero
 * provider/model calls, tokens, or cost (FR33, AC13).
 */
export * as LangLockBackendLive from "./backend-live"

import { Effect } from "effect"
import { TagValidation } from "@opencode-ai/core/langlock/tag-validation"
import { LangLockPersistence } from "@/langlock/persistence"
import { LangLockAuthorization } from "@/langlock/authorization"
import { Config as ConfigSchema } from "@opencode-ai/schema/langlock/config"
import { Schema } from "effect"
import type {
  LangLockPolicyError,
  LangLockPolicySummary,
  PolicyResetInput,
  PolicyResolveInput,
  PolicySetInput,
} from "@opencode-ai/protocol/langlock/commands"
import type { LangLockBackend } from "./langlock-port"

export interface LiveLangLockBackendDeps {
  readonly persistence: LangLockPersistence.LangLockPersistence
  /** The `langlock.override` gate; defaults to fail-closed DENY (Security 1). */
  readonly permission?: LangLockAuthorization.OverridePermissionPort
}

/** Fail-closed default: no project override is granted unless a real gate is bound (Security 1). */
const DENY_ALL: LangLockAuthorization.OverridePermissionPort = { overrideGranted: () => false }

const unavailable = (reason: string): LangLockPolicyError => ({ type: "unavailable", reason })

/** Map a persistence error onto the typed policy error union — never a false success. */
function persistenceError(error: LangLockPersistence.LangLockPersistenceError): LangLockPolicyError {
  if (error.type === "version_conflict") {
    return { type: "version_conflict", expectedVersion: 0, actualVersion: 0 }
  }
  return unavailable(error.type === "decode_failed" ? error.reason : error.reason)
}

const DISPLAY_NAME_FALLBACK = "English (United States)"

/** Project the resolved effective config plus the global base onto the operator summary (FR7, C4). */
function toSummary(
  resolution: LangLockPersistence.EffectiveResolution,
  globalConfig: ConfigSchema.LangLockConfig,
  updatedAtMs: number,
): LangLockPolicySummary {
  const eff = resolution.effective
  return {
    enabled: eff.language.enabled,
    tag: String(eff.language.tag),
    displayName: String(eff.language.display_name) || DISPLAY_NAME_FALLBACK,
    scope: eff.authority.scope,
    origin: eff.authority.origin,
    policyVersion: eff.authority.policy_version,
    enforcementMode: eff.language.enforcement_mode,
    // A hard floor pins the global tag; otherwise the floor tag is the effective tag.
    hardPolicyFloorTag: globalConfig.authority.hard_floor ? String(globalConfig.language.tag) : String(eff.language.tag),
    overrideAuthorized: eff.authority.override_authorized,
    updatedAt: new Date(updatedAtMs).toISOString(),
  }
}

/** Build a fresh project-ref filter from a resolve/set/reset input. */
const projectRefOf = (input: { readonly scope: string; readonly scopeId: string }): string | null =>
  input.scope === "project" ? input.scopeId : null

export function createLiveLangLockBackend(deps: LiveLangLockBackendDeps): LangLockBackend {
  const persistence = deps.persistence
  const permission = deps.permission ?? DENY_ALL
  const allowlist = TagValidation.createAllowlistPort()

  const summaryFor = (
    input: { readonly scope: string; readonly scopeId: string },
    updatedAtMs: number,
  ): Effect.Effect<LangLockPolicySummary, LangLockPolicyError> =>
    Effect.gen(function* () {
      const globalPersisted = yield* persistence.readConfig("global", "").pipe(Effect.mapError(persistenceError))
      const globalConfig = globalPersisted?.config ?? LangLockPersistence.defaultConfig
      const resolution = yield* persistence.resolveEffective(projectRefOf(input)).pipe(Effect.mapError(persistenceError))
      return toSummary(resolution, globalConfig, globalPersisted?.updatedAtMs ?? updatedAtMs)
    })

  const resolve = (input: PolicyResolveInput): Effect.Effect<LangLockPolicySummary, LangLockPolicyError> =>
    summaryFor(input, Date.now())

  const set = (input: PolicySetInput): Effect.Effect<LangLockPolicySummary, LangLockPolicyError> =>
    Effect.gen(function* () {
      const validation = TagValidation.validateTag(input.tag, allowlist)
      if (!validation.ok) return yield* Effect.fail<LangLockPolicyError>({ type: "invalid_tag", tag: input.tag })

      const scope = input.scope === "project" ? "project" : "global"
      const current = yield* persistence
        .readConfig(scope, input.scopeId)
        .pipe(Effect.mapError(persistenceError))
      const currentVersion = current?.config.version ?? 0
      if (input.expectedVersion !== currentVersion) {
        return yield* Effect.fail<LangLockPolicyError>({
          type: "version_conflict",
          expectedVersion: input.expectedVersion,
          actualVersion: currentVersion,
        })
      }

      const globalPersisted = yield* persistence.readConfig("global", "").pipe(Effect.mapError(persistenceError))
      const globalConfig = globalPersisted?.config ?? LangLockPersistence.defaultConfig
      const overrideAuthorized = yield* authorizeSet(input, scope, globalConfig)

      const nextConfig = buildConfig({ tag: validation.tag, scope, currentVersion, overrideAuthorized, base: current?.config ?? globalConfig })
      yield* persistence
        .saveConfig({ scope, scopeId: input.scopeId, config: nextConfig, expectedVersion: current?.casVersion ?? null })
        .pipe(Effect.mapError(persistenceError))
      return yield* summaryFor(input, Date.now())
    })

  const reset = (input: PolicyResetInput): Effect.Effect<LangLockPolicySummary, LangLockPolicyError> =>
    Effect.gen(function* () {
      const scope = input.scope === "project" ? "project" : "global"
      const current = yield* persistence.readConfig(scope, input.scopeId).pipe(Effect.mapError(persistenceError))
      const currentVersion = current?.config.version ?? 0
      if (input.expectedVersion !== currentVersion) {
        return yield* Effect.fail<LangLockPolicyError>({
          type: "version_conflict",
          expectedVersion: input.expectedVersion,
          actualVersion: currentVersion,
        })
      }
      const nextConfig = resetConfig(scope, currentVersion)
      yield* persistence
        .saveConfig({ scope, scopeId: input.scopeId, config: nextConfig, expectedVersion: current?.casVersion ?? null })
        .pipe(Effect.mapError(persistenceError))
      return yield* summaryFor(input, Date.now())
    })

  /** Run the T029 override gate for a project set; a global set needs only a trusted principal. */
  const authorizeSet = (
    input: PolicySetInput,
    scope: "global" | "project",
    globalConfig: ConfigSchema.LangLockConfig,
  ): Effect.Effect<boolean, LangLockPolicyError> =>
    Effect.gen(function* () {
      const decision = LangLockAuthorization.authorizePolicyMutation(
        {
          principal: input.principal,
          scope: input.scope,
          scopeId: input.scopeId,
          global: {
            enabled: globalConfig.language.enabled,
            tag: String(globalConfig.language.tag),
            enforcement_mode: globalConfig.language.enforcement_mode,
            policy_version: globalConfig.version,
            hard_floor: globalConfig.authority.hard_floor,
          },
          override:
            scope === "project"
              ? {
                  enabled: true,
                  tag: input.tag,
                  enforcement_mode: globalConfig.language.enforcement_mode,
                  policy_version: globalConfig.version,
                }
              : undefined,
        },
        permission,
      )
      if (!decision.authorized) return yield* Effect.fail(decision.error)
      return scope === "project"
    })

  return { resolve, set, reset }
}

/** Build the next `LangLockConfig` document for a `set` (content-free, version bumped). */
function buildConfig(input: {
  readonly tag: string
  readonly scope: "global" | "project"
  readonly currentVersion: number
  readonly overrideAuthorized: boolean
  readonly base: ConfigSchema.LangLockConfig
}): ConfigSchema.LangLockConfig {
  return Schema.decodeUnknownSync(ConfigSchema.LangLockConfig)({
    language: {
      enabled: true,
      tag: input.tag,
      enforcement_mode: input.base.language.enforcement_mode,
    },
    authority: {
      scope: input.scope,
      hard_floor: input.scope === "global" ? input.base.authority.hard_floor : false,
      override_authorized: input.overrideAuthorized,
      manifest_ref: input.base.authority.manifest_ref,
    },
    version: input.currentVersion + 1,
  })
}

/** Build the reset-to-default `LangLockConfig` document (reverts to the global/default policy, FR34). */
function resetConfig(scope: "global" | "project", currentVersion: number): ConfigSchema.LangLockConfig {
  return Schema.decodeUnknownSync(ConfigSchema.LangLockConfig)({
    language: { enabled: true, tag: "en-US", enforcement_mode: "advisory" },
    authority: { scope, hard_floor: false, override_authorized: false, manifest_ref: null },
    version: currentVersion + 1,
  })
}
