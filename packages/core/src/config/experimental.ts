export * as ConfigExperimental from "./experimental"

import { NarrowingConfig } from "@opencode-ai/schema/semantic/narrowing-config"
import { ToolConfig } from "@opencode-ai/schema/semantic/tool-config"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import { Schema } from "effect"
import { Catalog } from "../catalog"
import { Policy as PolicyV2 } from "../policy"

// Each core domain exports the policy actions it supports. Adding an action to
// this union makes it valid in authored config while keeping Policy generic.
export const PolicyAction = Schema.Union([Catalog.PolicyActions])

export class Policy extends Schema.Class<Policy>("ConfigV2.Experimental.Policy")({
  ...PolicyV2.Info.fields,
  action: PolicyAction,
}) {}

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  /** Feature 007: native operator control plane (default false). */
  operator_control_plane: Schema.Boolean.pipe(Schema.optional),
  /** Feature 007: treat operator connectivity as offline when true. */
  offline: Schema.Boolean.pipe(Schema.optional),
  /**
   * Feature 010/023: native Rust FFI backend for the wired tools (`glob`/`grep`),
   * default ENABLED (Feature 023 FR-A). Absent flag resolves to on; only an explicit
   * `native_tools: false` disables it. Absence/unloadable/ABI-mismatch/win32 still
   * fall back silently to the TypeScript/ripgrep path (FR19, C2, C19). The tool gates
   * read this as `!== false`. `read`/`write`/`edit`/`apply_patch` native wrappers stay
   * unwired (documented follow-up, ADR-0023).
   */
  native_tools: Schema.Boolean.pipe(Schema.optional),
  /**
   * Feature 010/023: native Rust PTY backend for `bash pty:true`, default ENABLED
   * (Feature 023 FR-A). Only an explicit `native_pty: false` disables it; win32 and an
   * unloadable backend fall back silently to the ChildProcess path. Gate reads `!== false`.
   */
  native_pty: Schema.Boolean.pipe(Schema.optional),
  /**
   * Feature 009: per-surface semantic tool-search config. Absent (or a surface
   * absent from `surfaces`) means the full-set passthrough floor — no narrowing,
   * identical to today (FR18, FR21, C9, C12, C15).
   */
  tool_search: ToolConfig.ToolSearchConfig.pipe(Schema.optional),
  /**
   * Feature 051: per-surface live per-turn semantic narrowing config for the agents
   * and skills surfaces (the tools surface reuses `tool_search`, never duplicated).
   * Absent, or every gate `false`, is the full-set passthrough floor — byte-identical
   * to pre-Feature-051 behavior (FR6, AC7).
   */
  semantic_narrowing: NarrowingConfig.SemanticNarrowingConfig.pipe(Schema.optional),
  /**
   * Feature 052 (SR-C): the fourth `skill_chunks` retrieval pass gate, a config surface
   * SEPARATE from (never nested inside) `semantic_narrowing` above. Absent, or
   * `enabled: false`, is the full Tier-1-only floor: no fourth retrieval pass, no
   * `<auto_skills>` block — byte-identical to Feature 051 behavior (FR1). The composed
   * effective gate a caller resolves via `resolveAutoSkillConfig` is
   * `skill_autoprime.enabled && semantic_narrowing.skills.enabled`.
   */
  skill_autoprime: NarrowingConfig.AutoSkillConfig.pipe(Schema.optional),
  /**
   * Feature 058: Tier-1 skill listing cap/format so large catalogs (100+) do not
   * flood the system prompt. Absent → defaults (max_listed 24, format compact,
   * hard_cap true). Independent of semantic ranking passthrough.
   */
  skill_list: NarrowingConfig.SkillListConfig.pipe(Schema.optional),
}) {}

/**
 * The three tool-search consumption surfaces gated independently by Config.Service.
 * The V1 default for every surface is the full-set passthrough floor (FR21, C9).
 */
export const TOOL_SEARCH_SURFACES = ["native", "mcp", "code_mode"] as const
export type ToolSearchSurface = (typeof TOOL_SEARCH_SURFACES)[number]

/**
 * Provisional bound defaults for the tool-search config, applied when
 * `experimental.tool_search` is absent. `retrieval_top_k` / `rerank_top_k`
 * inherit the Feature 006 `Values.TopK` bound with rerank ≤ retrieval (C5, FR13).
 */
export const TOOL_SEARCH_DEFAULTS = Object.freeze({
  retrievalTopK: 64,
  rerankTopK: 16,
  resultBound: 8,
  latencyBudgetMs: 300,
  cacheTtlMs: 60_000,
})

/** The resolved per-surface tool-search config; `enabled`/`failClosed` default off (C9, C12). */
export interface ResolvedToolSurfaceConfig {
  readonly surface: ToolSearchSurface
  readonly enabled: boolean
  readonly failClosed: boolean
  readonly retrievalTopK: number
  readonly rerankTopK: number
  readonly resultBound: number
  readonly latencyBudgetMs: number
  readonly cacheTtlMs: number
}

/**
 * Resolve one surface's tool-search config from the optional experimental block.
 * A missing block, or a surface absent from `surfaces`, resolves to the full-set
 * passthrough floor (`enabled=false`, `failClosed=false`) with the default bounds
 * — tool exposure is never worse than today (FR18, C9, C12, C15). Pure and total.
 */
export const resolveToolSurfaceConfig = (
  config: ToolConfig.ToolSearchConfig | undefined,
  surface: ToolSearchSurface,
): ResolvedToolSurfaceConfig => {
  const entry = config?.surfaces.find((s) => s.surface === surface)
  return {
    surface,
    enabled: entry?.enabled ?? false,
    failClosed: entry?.fail_closed ?? false,
    retrievalTopK: config?.retrieval_top_k ?? TOOL_SEARCH_DEFAULTS.retrievalTopK,
    rerankTopK: config?.rerank_top_k ?? TOOL_SEARCH_DEFAULTS.rerankTopK,
    resultBound: config?.result_bound ?? TOOL_SEARCH_DEFAULTS.resultBound,
    latencyBudgetMs: config?.latency_budget_ms ?? TOOL_SEARCH_DEFAULTS.latencyBudgetMs,
    cacheTtlMs: config?.cache_ttl_ms ?? TOOL_SEARCH_DEFAULTS.cacheTtlMs,
  }
}

/**
 * The two live-narrowing surfaces (Feature 051) gated independently by Config.Service.
 * The tools surface is intentionally absent — it reuses the Feature 009 `tool_search`
 * per-surface gate (`resolveToolSurfaceConfig`), never a duplicated gate (FR6, T001).
 */
export const NARROWING_SURFACES = ["agents", "skills"] as const
export type NarrowingSurface = (typeof NARROWING_SURFACES)[number]

/**
 * Provisional bound defaults for the live-narrowing config, applied when
 * `experimental.semantic_narrowing` is absent. `minPromptLength` mirrors the CUE
 * `#SemanticNarrowingConfig.min_prompt_length` default (8); `latencyBudgetMs` reuses the
 * shared Feature 009 `TOOL_SEARCH_DEFAULTS.latencyBudgetMs` knob — never a second constant.
 */
export const SEMANTIC_NARROWING_DEFAULTS = Object.freeze({
  minPromptLength: 8,
  latencyBudgetMs: TOOL_SEARCH_DEFAULTS.latencyBudgetMs,
  debugLog: false,
})

/** The resolved live-narrowing config; both surface gates and `debugLog` default off (FR6, FR8). */
export interface ResolvedNarrowingConfig {
  readonly agents: boolean
  readonly skills: boolean
  readonly minPromptLength: number
  readonly latencyBudgetMs: number
  readonly debugLog: boolean
}

/**
 * Resolve the live-narrowing config from the optional experimental block, mirroring
 * `resolveToolSurfaceConfig`. A missing block resolves every gate to `false` (the
 * full-set passthrough floor) with the default `minPromptLength`/`latencyBudgetMs`/
 * `debugLog` bounds — narrowing is never worse than today (FR6). Pure and total.
 */
export const resolveNarrowingConfig = (
  config: NarrowingConfig.SemanticNarrowingConfig | undefined,
): ResolvedNarrowingConfig => ({
  agents: config?.agents?.enabled ?? false,
  skills: config?.skills?.enabled ?? false,
  minPromptLength: config?.min_prompt_length ?? SEMANTIC_NARROWING_DEFAULTS.minPromptLength,
  latencyBudgetMs: config?.latency_budget_ms ?? SEMANTIC_NARROWING_DEFAULTS.latencyBudgetMs,
  debugLog: config?.debug_log ?? SEMANTIC_NARROWING_DEFAULTS.debugLog,
})

/** Whether one live-narrowing surface is opted into ranked consumption (the FR6 gate the seams honor). */
export const narrowingSurfaceEnabled = (
  config: NarrowingConfig.SemanticNarrowingConfig | undefined,
  surface: NarrowingSurface,
): boolean => resolveNarrowingConfig(config)[surface]

/**
 * Feature 052 (SR-C) — provisional bound defaults for the `skill_autoprime` config,
 * applied when `experimental.skill_autoprime` (or its fields) is absent. `scoreFloor`
 * mirrors the CUE `#ScoreFloor` default (0.75, FR2). `maxChunks`/`maxTokens` mirror the
 * grounded `Budget.Retrieval` defaults (`DEFAULT_ROUTING_BUDGET.retrieval`,
 * `packages/opencode/src/routing/adapters/outbound/config-adapter.ts`) — a LOCAL MIRROR
 * only, never a second budget constant; a caller holding the live-resolved
 * `Budget.Policy.retrieval` should pass it to `resolveAutoSkillConfig` to override these
 * mirrors (FR4, spent exclusively by the Tier-2 render pass, never by this resolver).
 */
export const AUTO_SKILL_DEFAULTS = Object.freeze({
  scoreFloor: 0.75,
  maxChunks: 8,
  maxTokens: 4_000,
})

/** The resolved `skill_autoprime` config; the structural seam the fourth retrieval pass
 * and the `<auto_skills>` render pass both code against (FR1, FR2, FR4). */
export interface ResolvedAutoSkillConfig {
  readonly enabled: boolean
  readonly scoreFloor: number
  readonly maxChunks: number
  readonly maxTokens: number
}

/**
 * Resolve the Feature 052 `skill_autoprime` config. The effective `enabled` gate is
 * `skill_autoprime.enabled && semantic_narrowing.skills.enabled` (FR1) — either config
 * missing, or either flag false, resolves fully off; `scoreFloor` defaults to the strict
 * CUE default (FR2). `retrieval`, when supplied, is the live-resolved `Budget.Policy.
 * retrieval` slice this feature's render pass spends `max_skill_chunks`/`max_skill_tokens`
 * from (FR4) — absent, `AUTO_SKILL_DEFAULTS`' local mirrors are used instead. Pure and
 * total, mirroring `resolveNarrowingConfig`'s shape exactly.
 */
export const resolveAutoSkillConfig = (
  narrowing: NarrowingConfig.SemanticNarrowingConfig | undefined,
  autoSkill: NarrowingConfig.AutoSkillConfig | undefined,
  retrieval?: Pick<Budget.Retrieval, "max_skill_chunks" | "max_skill_tokens">,
): ResolvedAutoSkillConfig => ({
  enabled: (autoSkill?.enabled ?? false) && resolveNarrowingConfig(narrowing).skills,
  scoreFloor: autoSkill?.score_floor ?? AUTO_SKILL_DEFAULTS.scoreFloor,
  maxChunks: retrieval?.max_skill_chunks ?? AUTO_SKILL_DEFAULTS.maxChunks,
  maxTokens: retrieval?.max_skill_tokens ?? AUTO_SKILL_DEFAULTS.maxTokens,
})

/** Feature 058 — defaults for Tier-1 skill listing cap/format. */
export const SKILL_LIST_DEFAULTS = Object.freeze({
  maxListed: 24,
  format: "compact" as const,
  hardCap: true,
  showStatus: true,
})

export type SkillListFormat = "verbose" | "compact" | "names"

export interface ResolvedSkillListConfig {
  readonly maxListed: number
  readonly format: SkillListFormat
  readonly hardCap: boolean
  readonly showStatus: boolean
}

/**
 * Resolve skill listing policy. Pure. `max_listed` clamped to [1, 256].
 * `0` or negative is treated as default (never unlimited by accident).
 */
export const resolveSkillListConfig = (
  config: NarrowingConfig.SkillListConfig | undefined,
): ResolvedSkillListConfig => {
  const raw = config?.max_listed
  const maxListed =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? Math.min(256, Math.floor(raw))
      : SKILL_LIST_DEFAULTS.maxListed
  const format = config?.format
  return {
    maxListed,
    format: format === "verbose" || format === "names" || format === "compact" ? format : SKILL_LIST_DEFAULTS.format,
    hardCap: config?.hard_cap ?? SKILL_LIST_DEFAULTS.hardCap,
    showStatus: config?.show_status ?? SKILL_LIST_DEFAULTS.showStatus,
  }
}
