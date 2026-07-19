export * as ConfigExperimental from "./experimental"

import { ToolConfig } from "@opencode-ai/schema/semantic/tool-config"
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
   * Feature 009: per-surface semantic tool-search config. Absent (or a surface
   * absent from `surfaces`) means the full-set passthrough floor — no narrowing,
   * identical to today (FR18, FR21, C9, C12, C15).
   */
  tool_search: ToolConfig.ToolSearchConfig.pipe(Schema.optional),
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
