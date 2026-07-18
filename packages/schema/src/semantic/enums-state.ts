export * as EnumsState from "./enums-state"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/enums-state.cue (package semantic.enums)
// one-to-one for the lifecycle, degradation and scope enums — binding state,
// index-generation state, the typed capability-gap ladder, retrieval mode,
// residency profile, TLS policy, collection namespace, scope, visibility and role
// (FR9, FR24, FR31, FR33, C6, C12, C14, C17, C20, C21). The degradation gap and
// retrieval mode never auto-substitute a model (FR24, C20). Every enum is a
// ValueObject (calisthenics).

// BindingState is the pinned-binding lifecycle; degraded/unavailable never auto-substitute (FR31, C12, C20).
export const BindingState = Schema.Literals(["draft", "staged", "active", "degraded", "unavailable"]).annotate({
  identifier: "SemanticEnumsState.BindingState",
})
export type BindingState = typeof BindingState.Type

// GenerationState is the blue/green index-generation lifecycle (FR12, C12).
export const GenerationState = Schema.Literals([
  "building",
  "validated",
  "live",
  "superseded",
  "retired",
]).annotate({ identifier: "SemanticEnumsState.GenerationState" })
export type GenerationState = typeof GenerationState.Type

// DegradationGap is the typed 8-member capability-gap code at each degraded rung (FR24, C20, AC29).
export const DegradationGap = Schema.Literals([
  "none",
  "milvus_unavailable",
  "embedding_unavailable",
  "reranker_unavailable",
  "index_stale",
  "retrieval_timeout",
  "no_binding",
  "cold_index",
]).annotate({ identifier: "SemanticEnumsState.DegradationGap" })
export type DegradationGap = typeof DegradationGap.Type

// RetrievalMode is the degradation ladder rung; catalog_lexical is the routing floor (FR24, C14, C20).
export const RetrievalMode = Schema.Literals(["full_semantic", "catalog_lexical", "fail_closed"]).annotate({
  identifier: "SemanticEnumsState.RetrievalMode",
})
export type RetrievalMode = typeof RetrievalMode.Type

// ResidencyProfile is the data-residency posture; local-offline blocks remote egress (FR37, C4).
export const ResidencyProfile = Schema.Literals(["local-offline", "local", "remote"]).annotate({
  identifier: "SemanticEnumsState.ResidencyProfile",
})
export type ResidencyProfile = typeof ResidencyProfile.Type

// TlsPolicy is the transport security posture; local-insecure is warned-only (FR33, C17).
export const TlsPolicy = Schema.Literals(["required", "local-insecure"]).annotate({
  identifier: "SemanticEnumsState.TlsPolicy",
})
export type TlsPolicy = typeof TlsPolicy.Type

// Collection is the conceptual collection namespace; tools is the Feature 009 extension point (FR9, C6, C21).
export const Collection = Schema.Literals(["agents", "skills", "skill_chunks", "tools"]).annotate({
  identifier: "SemanticEnumsState.Collection",
})
export type Collection = typeof Collection.Type

// ScopeKind bounds an operator mutation or a document scope (FR34, C15).
export const ScopeKind = Schema.Literals(["project", "global", "session"]).annotate({
  identifier: "SemanticEnumsState.ScopeKind",
})
export type ScopeKind = typeof ScopeKind.Type

// Visibility is the authorization scope filtered before search and revalidated after (FR34, C6, C11).
export const Visibility = Schema.Literals(["project", "global", "shared"]).annotate({
  identifier: "SemanticEnumsState.Visibility",
})
export type Visibility = typeof Visibility.Type

// RoleKind is the Feature 001 role a candidate is retrieved for (FR5, FR10).
export const RoleKind = Schema.Literals(["architect", "manager", "worker"]).annotate({
  identifier: "SemanticEnumsState.RoleKind",
})
export type RoleKind = typeof RoleKind.Type
