// DDD role: ValueObject
// Package: semantic.config
// Feature 009 per-surface tool-search configuration (FR21, C5, C9, C12). Enablement is a
// per-surface flag (native / MCP / code-mode); V1 defaults every surface to the full-set
// passthrough floor so no surface silently narrows the model's tool list before deliberate
// opt-in (FR18, C9, C15). Fail-closed is per-surface and defaults off — degrade, never
// hard-fail (FR18, C12). retrieval_top_k / rerank_top_k inherit the Feature 006 TopK
// bounds; every window is bounded and no result list is unbounded (FR13, C5). Numeric
// defaults are provisional plan constants with named acceptance hooks (AC13, AC14, AC19).

package semantic.config

import (
	"semantic/ids"
	"semantic/enums"
	"semantic/values"
)

// ToolSurfaceConfig is the per-surface enablement and fail-closed flag; both default off (FR21, C9, C12).
#ToolSurfaceConfig: {
	surface:     enums.#ToolSurface
	enabled:     ids.#Enabled
	fail_closed: ids.#Enabled
}

// ToolSurfaceConfigSet is the first-class collection of per-surface configs (FR21, C9).
#ToolSurfaceConfigSet: [...#ToolSurfaceConfig]

// ToolSearchConfig is the bounded Feature 009 tool-search config over all surfaces (FR13, FR21, C5).
#ToolSearchConfig: {
	surfaces:          #ToolSurfaceConfigSet
	retrieval_top_k:   values.#TopK
	rerank_top_k:      values.#TopK
	result_bound:      values.#TopK
	latency_budget_ms: values.#LatencyBudgetMs
	cache_ttl_ms:      values.#CacheTtlMs
}
