/**
 * Routing config outbound adapter (Feature 001 — T027).
 *
 * Reads and writes `RoutingConfig.Info` (packages/schema/src/routing/config.ts)
 * through the Feature 007 `ConfigPort` (the sole config persistence boundary —
 * ADR-0003), the same pattern `telemetry-service.ts` (T013) uses for
 * `TelemetryConfig`: project scope shadows global scope, global shadows the
 * safe built-in default, and every write is an optimistic CAS through
 * `ConfigPort.compareAndSet`. No parallel product config store.
 *
 * Routing stays disabled (`mode: "never"`) until an operator explicitly
 * configures and enables it — CLAUDE.md: "Do not implement Smart Routing
 * while alternatives remain open or without explicit authorization" mirrors
 * `DEFAULT_TELEMETRY_CONFIG.enabled === false`.
 */
export * as ConfigAdapter from "./config-adapter"

import { Exit, Schema } from "effect"
import { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { ConfigPort } from "@/operator/application/ports/config-port"
import { contentHash } from "@/operator/adapters/outbound/config-service"
import type { RoutingConfigSource } from "@/routing/application/ports"

export type RoutingConfigScope = "global" | "project"
export type RoutingConfigOrigin = RoutingConfigScope | "default"

// Config.Service authority keys per scope (mirrors telemetry-service.ts AUTHORITY).
// Exported as the single routing-module SSOT: `smart`/`budget`/`pools` and the
// `routing.configure` mutation backend all commit to these same per-scope routing
// documents, so the shared-authority merge (Feature 024) reads one source of truth.
export const AUTHORITY: Record<RoutingConfigScope, string> = {
  global: "global:routing",
  project: "routing",
}

// Sensible, conservative hard-maximum defaults applied ONLY when the effective
// config origin is `default` (no operator budget at `routing` or `global:routing`)
// — Feature 043 / ADR-0043 "sensible defaults" decision, so budget enforcement is
// ACTIVE out-of-box rather than dormant until an operator configures every limit.
// An explicit operator budget always wins verbatim (resolveEffective shadows the
// default). The grounded dimensions (`max_turns` 8, `max_context_tokens` 200000,
// `max_output_tokens` 8000, `max_workers` 3, `max_delegation_depth` 2,
// `token_budget` 800000) match the values persisted in the `global:routing`
// operator authority; the remaining leaves keep their conservative defaults until
// an operator supplies its own. Never silently relaxed, never a hidden ceiling.
const DEFAULT_ROUTING_BUDGET: RoutingConfig.Enforcement["budget"] = {
  limits: {
    max_turns: 8,
    max_context_tokens: 200_000,
    max_context_bytes: 800_000,
    max_output_tokens: 8_000,
    max_output_bytes: 32_000,
  },
  concurrency: { max_workers: 3, max_delegation_depth: 2 },
  retrieval: { retrieval_top_k: 8, rerank_top_k: 4, max_skill_chunks: 8, max_skill_tokens: 4_000 },
  cost: { time_budget_ms: 60_000, cost_budget_usd: 10, token_budget: 800_000 },
  resilience: { retry_depth: 2, validation_depth: 1, escalation_threshold: "manual_review" },
}

/** The grounded default budget, exported so the live session response loop and the
 * fan-out admission seam (Feature 043) can enforce it out-of-box when the effective
 * config origin is `default`. An explicit operator budget always overrides it. */
export { DEFAULT_ROUTING_BUDGET }

// Safe, disabled-by-default RoutingConfig (origin "default") — mirrors
// telemetry-service.ts DEFAULT_TELEMETRY_CONFIG. `role_pools` starts empty:
// no hardcoded model IDs, an operator must populate real catalog-resolved
// model IDs before Smart Routing can select anything.
export const DEFAULT_ROUTING_CONFIG: RoutingConfig.Info = {
  activation: { enabled: false, mode: "never", strict_gates: true },
  models: {
    decision_model: { pool: ["architect"] },
    role_pools: {},
    fallback: { floor_role: "architect" },
  },
  enforcement: {
    capability: { metadata_source: "catalog", unknown_policy: "deny", probing_enabled: false },
    budget: DEFAULT_ROUTING_BUDGET,
    hierarchy: { max_depth: 2, orchestration_only: true },
  },
}

export interface RoutingConfigEntry {
  readonly version: string | null
  readonly config: RoutingConfig.Info | null
}

export interface EffectiveRoutingConfig {
  readonly config: RoutingConfig.Info
  readonly origin: RoutingConfigOrigin
  /** Deterministic content hash of `config` (RoutingIds.PolicyVersion). */
  readonly policyVersion: string
}

export type RoutingConfigSetResult =
  | { readonly ok: true; readonly version: string; readonly config: RoutingConfig.Info }
  | { readonly ok: false; readonly code: "validation_failed"; readonly reason: string }
  | { readonly ok: false; readonly code: "conflict"; readonly currentVersion: string }
  | { readonly ok: false; readonly code: "unavailable"; readonly reason: string }

export interface RoutingConfigPort {
  /** Read the raw scoped entry (no default fallback). */
  readonly get: (scope: RoutingConfigScope) => Promise<RoutingConfigEntry>
  /** project shadows global shadows the built-in default. */
  readonly resolveEffective: () => Promise<EffectiveRoutingConfig>
  /** Optimistic CAS write; expectedVersion null means create-if-absent. */
  readonly set: (
    scope: RoutingConfigScope,
    config: RoutingConfig.Info,
    expectedVersion: string | null,
  ) => Promise<RoutingConfigSetResult>
}

const decodeConfig = Schema.decodeUnknownExit(RoutingConfig.Info)

function parseConfig(payload: unknown): RoutingConfig.Info | null {
  const exit = decodeConfig(payload, { errors: "all" })
  return Exit.isSuccess(exit) ? (exit.value as RoutingConfig.Info) : null
}

/** Deterministic content hash of a RoutingConfig — the RoutingIds.PolicyVersion pinned on decisions. */
export function policyVersionOf(config: RoutingConfig.Info): string {
  return contentHash(config)
}

export function createConfigAdapter(deps: { readonly config: ConfigPort; readonly now?: () => number }): RoutingConfigPort {
  const now = deps.now ?? Date.now

  async function readScoped(scope: RoutingConfigScope): Promise<RoutingConfigEntry> {
    const entry = await deps.config.get(AUTHORITY[scope])
    if (!entry) return { version: null, config: null }
    return { version: entry.version, config: parseConfig(entry.payload) }
  }

  return {
    get: readScoped,

    async resolveEffective() {
      const project = await readScoped("project")
      if (project.config) return { config: project.config, origin: "project", policyVersion: policyVersionOf(project.config) }
      const global = await readScoped("global")
      if (global.config) return { config: global.config, origin: "global", policyVersion: policyVersionOf(global.config) }
      return { config: DEFAULT_ROUTING_CONFIG, origin: "default", policyVersion: policyVersionOf(DEFAULT_ROUTING_CONFIG) }
    },

    async set(scope, config, expectedVersion) {
      const decoded = parseConfig(config)
      if (!decoded) return { ok: false, code: "validation_failed", reason: "routing configuration failed schema validation" }

      const cas = await deps.config.compareAndSet({
        authority: AUTHORITY[scope],
        expectedVersion,
        payload: decoded,
        nowMs: now(),
      })
      if (!cas.ok) {
        if (cas.code === "conflict") return { ok: false, code: "conflict", currentVersion: cas.currentVersion }
        return { ok: false, code: "unavailable", reason: cas.reason }
      }
      return { ok: true, version: cas.version, config: decoded }
    },
  }
}

/**
 * Adapts the richer `RoutingConfigPort` (get/resolveEffective/set — used by
 * the future `routing configure` CLI, T032/T033) to the thin outbound seam
 * `routing-service.ts` (T026) actually depends on
 * (`application/ports.ts#RoutingConfigSource`).
 */
export function toRoutingConfigSource(port: RoutingConfigPort): RoutingConfigSource {
  return { resolve: () => port.resolveEffective() }
}
