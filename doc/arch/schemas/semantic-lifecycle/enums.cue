// DDD role: ValueObject
// Package: semantic_lifecycle.enums
// Bounded enums for Feature 019, which COMPLETES the semantic binding lifecycle
// (Feature 006 FR32, reused verbatim by Feature 009) and finishes the remaining
// operator residuals. Group A activates the config-backed reranker cutover/rollback
// over a per-slot binding version archive (no Milvus); Group B physically builds and
// validates a Milvus generation before an embedding alias swap and wires the
// reindex/reconcile live-doc source; Group C completes the MCP delegation edges; and
// Group D activates real OTLP telemetry export. The pure engines already exist
// (cutover-executor.ts, binding-lifecycle.ts); Feature 007 stays the sole
// command-registration authority and no catalog id or version is added (FR-INV).

package semantic_lifecycle.enums

// BindingState is the closed Feature 006 binding machine every slot walks; Feature 019 never adds a state, it activates the existing edges (Group A, Group B).
#BindingState: "draft" | "staged" | "active" | "degraded" | "unavailable"

// LifecycleTrigger is the closed trigger vocabulary of the binding machine; select/validate/reindex never activate the live alias, only cutover does (Group A, Group B).
#LifecycleTrigger: "select" | "validate" | "reindex" | "cutover" | "outage" | "outage_persists" | "recover" | "rollback"

// ArchiveEntryKind records whether an archived binding version is the currently-active version or a superseded prior a rollback can target; a rollback with no superseded prior is a typed rejection (Group A).
#ArchiveEntryKind: "current" | "superseded"

// CutoverGate is the honest gating verdict for an activation: a validated staged candidate proceeds, an unvalidated one is refused, and a missing prior blocks rollback — never a fabricated swap (Group A, Group B).
#CutoverGate: "activated" | "not_validated" | "no_archived_prior" | "confirmation_required" | "cas_conflict"

// GenerationState is the Feature 006 blue/green index-generation lifecycle a physical embedding build walks before the alias swaps; select/reindex alone never reach live (Group B).
#GenerationState: "building" | "validated" | "live" | "superseded" | "retired"

// MilvusReadiness records how far the operator runtime is composed against a live Milvus endpoint; unconfigured degrades to the exact same typed milvus_unavailable floor as today (Group B).
#MilvusReadiness: "live" | "milvus_unavailable"

// ReconcileSource is the live-doc projection origin the reconcile plan diffs against the indexed state; the agent/skill builders join the shipped tool builder (Group B).
#ReconcileSource: "agents" | "skills" | "skill_chunks" | "tools"
