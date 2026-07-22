/**
 * Feature 004 / T026 live wire — resolve EffectiveConfig for session system
 * prompts from the durable operator authorities already loaded into Config.Info.
 *
 * Fail-open: any missing operator namespace, corrupt payload, or resolve error
 * falls back to the enabled en-US default (FR1, C15) so the prompt path never
 * blocks. Never writes; never opens a parallel store.
 */
export * as LangLockSessionEffective from "./session-effective"

import { Effect, Schema } from "effect"
import { Config as LangLockConfigNs } from "@opencode-ai/schema/langlock/config"
import { Effective } from "@opencode-ai/schema/langlock/effective"
import { Allowlist } from "@opencode-ai/schema/langlock/allowlist"
import { PolicyResolution } from "@opencode-ai/core/langlock/policy-resolution"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import { createLangLockPersistence } from "./persistence"

const DEFAULT_DISPLAY =
  Allowlist.INITIAL_ALLOWLIST.find((entry) => entry.tag === "en-US")?.display_name ?? "English (United States)"

/** Pure default EffectiveConfig matching persistence.defaultConfig (enabled en-US). */
export function defaultEffectiveConfig(): Effective.EffectiveConfig {
  return Schema.decodeUnknownSync(Effective.EffectiveConfig)({
    language: {
      enabled: true,
      tag: "en-US",
      display_name: DEFAULT_DISPLAY,
      enforcement_mode: "advisory",
    },
    authority: {
      scope: "project",
      origin: "default",
      policy_version: 1,
      override_authorized: false,
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Read-only ConfigPort over `config.operator.authorities` (Feature 007/014 shape).
 * Mutation methods are unavailable — session inject never mutates policy.
 */
export function configPortFromOperatorAuthorities(
  authorities: Record<string, unknown> | undefined,
): ConfigPort {
  const unavailable = async () =>
    ({ ok: false, code: "unavailable" as const, reason: "langlock session inject is read-only" }) as const

  return {
    async get(authority: string) {
      const rec = authorities?.[authority]
      if (!isRecord(rec) || rec.payload === undefined) return null
      const version = typeof rec.version === "string" ? rec.version : "cas_v0"
      const updatedAtMs = typeof rec.updatedAtMs === "number" ? rec.updatedAtMs : 0
      return { version, payload: rec.payload, updatedAtMs }
    },
    async compareAndSet() {
      return unavailable()
    },
    async snapshot() {
      return unavailable()
    },
    async listSnapshots() {
      return []
    },
    async pruneSnapshots() {
      return unavailable()
    },
    async restoreSnapshot() {
      return unavailable()
    },
  } as unknown as ConfigPort
}

/**
 * Resolve effective Lang Lock for the live session prompt path.
 * @param config - already-loaded product Config.Info (or a partial with operator)
 * @param projectRef - optional project profile key; null = global only
 */
export async function resolveSessionLangLockEffective(input: {
  readonly config: { readonly operator?: unknown }
  readonly projectRef?: string | null
}): Promise<Effective.EffectiveConfig> {
  try {
    const operator = isRecord(input.config.operator) ? input.config.operator : undefined
    const authorities = isRecord(operator?.authorities)
      ? (operator.authorities as Record<string, unknown>)
      : undefined
    const persistence = createLangLockPersistence({
      config: configPortFromOperatorAuthorities(authorities),
    })
    const resolution = await Effect.runPromise(
      persistence.resolveEffective(input.projectRef ?? null).pipe(
        Effect.catchCause(() => Effect.succeed(null as null)),
      ),
    )
    if (!resolution) return defaultEffectiveConfig()
    return Schema.decodeUnknownSync(Effective.EffectiveConfig)(resolution.effective)
  } catch {
    return defaultEffectiveConfig()
  }
}

/** Sync helper for unit tests: build EffectiveConfig from a raw LangLockConfig payload. */
export function effectiveFromLangLockConfig(payload: unknown): Effective.EffectiveConfig | null {
  try {
    const config = Schema.decodeUnknownSync(LangLockConfigNs.LangLockConfig)(payload)
    const outcome = PolicyResolution.resolve({
      global: {
        enabled: config.language.enabled,
        tag: config.language.tag,
        enforcement_mode: config.language.enforcement_mode,
        policy_version: config.version,
        hard_floor: config.authority.hard_floor,
      },
    })
    return Schema.decodeUnknownSync(Effective.EffectiveConfig)({
      language: {
        enabled: outcome.resolved.enabled,
        tag: outcome.resolved.tag,
        display_name:
          Allowlist.INITIAL_ALLOWLIST.find((e) => e.tag === outcome.resolved.tag)?.display_name ??
          DEFAULT_DISPLAY,
        enforcement_mode: outcome.resolved.enforcement_mode,
      },
      authority: {
        scope: config.authority.scope,
        origin: outcome.resolved.origin,
        policy_version: outcome.resolved.policy_version,
        override_authorized: config.authority.override_authorized,
      },
    })
  } catch {
    return null
  }
}
