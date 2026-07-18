// DDD role: ValueObject
// Package: semantic.enums
// SemanticEventType — the closed semantic.* event vocabulary registered through
// EventV2.define into the durable-event manifest (C22). The semantic.* event prefix
// is the Feature 006 retrieval-plane event namespace on EventV2; it is DISTINCT from
// the Feature 007 semantic.* operator command domain (semantic.provider|model|
// embedding|reranker|binding|index.*); both are reserved (C15, C22). Durable index/
// binding/cutover members replay; live degradation/probe/state members may be dropped.

package semantic.enums

// SemanticEventType is the closed durable-settlement + live-signal vocabulary (FR41, C22).
#SemanticEventType: "semantic.binding_selected" | "semantic.binding_cutover" | "semantic.binding_rolled_back" | "semantic.index_upserted" | "semantic.index_tombstoned" | "semantic.index_reconciled" | "semantic.generation_built" | "semantic.generation_cutover" | "semantic.generation_retired" | "semantic.retrieval_degraded" | "semantic.provider_probed" | "semantic.binding_state_changed"
