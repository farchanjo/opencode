export * as ToolConfig from "./tool-config"

import { Schema } from "effect"
import { ToolSurface } from "./enums-state"
import { Enabled } from "./text-values"
import { CacheTtlMs, LatencyBudgetMs, TopK } from "./values"

// Mirrors doc/arch/schemas/semantic/tool-config.cue (package semantic.config) one-to-one
// for the Feature 009 per-surface tool-search configuration (FR13, FR21, C5, C9, C12).
// Enablement is a per-surface flag (native / MCP / code-mode); V1 defaults every surface
// to the full-set passthrough floor so no surface silently narrows the model's tool list
// before deliberate opt-in (FR18, C9, C15). Fail-closed is per-surface and defaults off —
// degrade, never hard-fail (FR18, C12). retrieval_top_k / rerank_top_k inherit the Feature
// 006 TopK bounds; every window is bounded and no result list is unbounded (FR13, C5).

// ToolSurfaceConfig is the per-surface enablement and fail-closed flag; both default off (FR21, C9, C12).
export const ToolSurfaceConfig = Schema.Struct({
  surface: ToolSurface,
  enabled: Enabled, // default false (C9)
  fail_closed: Enabled, // default false (C12)
}).annotate({ identifier: "SemanticConfig.ToolSurfaceConfig" })
export type ToolSurfaceConfig = Schema.Schema.Type<typeof ToolSurfaceConfig>

// ToolSurfaceConfigSet is the first-class collection of per-surface configs (FR21, C9).
export const ToolSurfaceConfigSet = Schema.Array(ToolSurfaceConfig)
export type ToolSurfaceConfigSet = Schema.Schema.Type<typeof ToolSurfaceConfigSet>

// ToolSearchConfig is the bounded Feature 009 tool-search config over all surfaces (FR13, FR21, C5).
export const ToolSearchConfig = Schema.Struct({
  surfaces: ToolSurfaceConfigSet,
  retrieval_top_k: TopK,
  rerank_top_k: TopK, // MUST be <= retrieval_top_k, enforced by the reused budgetError guard (C5)
  result_bound: TopK, // small bounded result list, never unbounded (C5, FR13)
  latency_budget_ms: LatencyBudgetMs, // expiry triggers the C14 ladder, never blocks exposure (NFR1)
  cache_ttl_ms: CacheTtlMs, // last-known index-metadata cache TTL; invalidates by binding_version/config_hash (C8)
}).annotate({ identifier: "SemanticConfig.ToolSearchConfig" })
export type ToolSearchConfig = Schema.Schema.Type<typeof ToolSearchConfig>
