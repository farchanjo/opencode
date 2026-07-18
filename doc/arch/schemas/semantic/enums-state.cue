// DDD role: ValueObject
// Package: semantic.enums
// Lifecycle, degradation and scope enums for the Feature 006 semantic stack — binding
// state, index-generation state, the typed capability-gap ladder, retrieval mode,
// residency profile, TLS policy, collection namespace, scope, visibility and role
// (FR9, FR24, FR31, FR33, C6, C12, C14, C17, C20, C21). The degradation gap and
// retrieval mode never auto-substitute a model (FR24, C20). Every enum is a ValueObject.

package semantic.enums

// BindingState is the pinned-binding lifecycle; degraded/unavailable never auto-substitute (FR31, C12, C20).
#BindingState: "draft" | "staged" | "active" | "degraded" | "unavailable"

// GenerationState is the blue/green index-generation lifecycle (FR12, C12).
#GenerationState: "building" | "validated" | "live" | "superseded" | "retired"

// DegradationGap is the typed capability-gap code at each degraded rung (FR24, C20, AC29).
#DegradationGap: "none" | "milvus_unavailable" | "embedding_unavailable" | "reranker_unavailable" | "index_stale" | "retrieval_timeout" | "no_binding" | "cold_index"

// RetrievalMode is the degradation ladder rung; catalog_lexical is the routing floor (FR24, C14, C20).
#RetrievalMode: "full_semantic" | "catalog_lexical" | "fail_closed"

// ResidencyProfile is the data-residency posture; local-offline blocks remote egress (FR37, C4).
#ResidencyProfile: "local-offline" | "local" | "remote"

// TlsPolicy is the transport security posture; local-insecure is warned-only (FR33, C17).
#TlsPolicy: "required" | "local-insecure"

// Collection is the conceptual collection namespace; tools is the Feature 009 extension point (FR9, C6, C21).
#Collection: "agents" | "skills" | "skill_chunks" | "tools"

// ScopeKind bounds an operator mutation or a document scope (FR34, C15).
#ScopeKind: "project" | "global" | "session"

// Visibility is the authorization scope filtered before search and revalidated after (FR34, C6, C11).
#Visibility: "project" | "global" | "shared"

// RoleKind is the Feature 001 role a candidate is retrieved for (FR5, FR10).
#RoleKind: "architect" | "manager" | "worker"
