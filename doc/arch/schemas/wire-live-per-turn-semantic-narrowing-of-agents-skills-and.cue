// DDD role: ValueObject
// Package: semantic.livequery
// Feature 051 — new config/data shapes for wiring Feature 050's semantic
// index DATA PLANE into the LIVE per-turn query path (narrowForTurn, the
// three narrowing seams, the essential-tool floor, and the per-turn memo).
// Mirrors the #DataPlaneRetryPolicy / gate conventions of
// wire-the-semantic-index-data-plane-production-pipeline.cue (Feature 050)
// but scopes strictly to the query plane: zero retries here by design (FR7)
// — this package does NOT reuse #DataPlaneRetryPolicy, and none of these
// shapes are consumed by reindex/reconcile.

package semantic.livequery

// #MinPromptLength wraps the degenerate-input length threshold as a named
// ValueObject rather than a bare `int` (Object Calisthenics, wrap-primitives).
#MinPromptLength: int & >0

// #LatencyBudgetMs wraps the shared per-turn narrowing deadline as a named
// ValueObject rather than a bare `int` (Object Calisthenics,
// wrap-primitives). Reuses the SAME knob Feature 050's runner already
// consumes (`config/experimental.ts:62`, default 300) — this schema does not
// mint a second deadline constant.
#LatencyBudgetMs: int & >0 | *300

// #NarrowingSurfaceGate is the per-surface enable flag for one of the three
// live-narrowing seams (agents, skills, tools). Mirrors the existing
// `resolveToolSurfaceConfig` convention (`config/experimental.ts:84`):
// default `false` is the full-set passthrough floor — a disabled surface
// short-circuits before any embedding/Milvus I/O (FR6).
#NarrowingSurfaceGate: {
	enabled: bool | *false
}

// #EssentialToolFloor is the CLOSED list of tool ids that are always kept in
// the narrowed tool set regardless of ranking (Feature 051 decision 4). The
// reranker may reorder these relative to the rest of the ranked set; it may
// never cause one to be dropped. Reordering the list is allowed; removing an
// id from it is a breaking change to this schema, not a config toggle.
#EssentialToolFloor: [...("task" | "skill" | "todowrite" | "question" | "read" | "edit" | "write" | "bash" | "grep" | "glob")] & [
	"task", "skill", "todowrite", "question", "read", "edit", "write", "bash", "grep", "glob",
]

// #SemanticNarrowingConfig is the top-level Feature 051 config surface,
// mirroring the shape of Feature 009's `ToolSearchConfig`
// (`schema/semantic/tool-config.ts`) but scoped to the three live-narrowing
// surfaces. Absent, or every surface gate `false`, resolves to the full-set
// passthrough floor — byte-identical to pre-Feature-051 behavior (FR6, AC7).
#SemanticNarrowingConfig: {
	agents: #NarrowingSurfaceGate
	skills: #NarrowingSurfaceGate
	tools:  #NarrowingSurfaceGate

	// Below this length, "narrowForTurn" reuses the previous NarrowedSets
	// memo instead of embedding a degenerate prompt (FR2).
	min_prompt_length: #MinPromptLength | *8

	// The shared per-turn deadline every surface's retrieval pass runs
	// under (FR1, FR7). Not a per-surface knob — one deadline for the
	// turn's entire concurrent fan-out.
	latency_budget_ms: #LatencyBudgetMs

	// Opt-in, content-free debug log of kept/dropped canonical ids per
	// surface per turn (FR8). Default off.
	debug_log: bool | *false
}

// #NarrowedSets is the per-turn memo shape stored in RoutingState, keyed by
// the turn's "lastUser.id" (Feature 051 decision 1). Every field is an
// OPTIONAL ranked id list: absent means passthrough for that surface (the
// full permission-visible catalog, unchanged); present-and-non-empty means
// "narrow to exactly this ranked subset." A present-but-empty list is never
// a valid state for this shape — "live-narrowing.ts" normalizes every
// degenerate/empty retrieval outcome to "absent" before this memo is
// written (FR3), so the schema itself forbids the ambiguous empty-list case.
#NarrowedSets: {
	agents?: [...string & !=""] & [_, ...]
	skills?: [...string & !=""] & [_, ...]
	tools?:  [...string & !=""] & [_, ...]
}
