// DDD role: ValueObject
// Package: semantic_lifecycle.shared
// Bounded identity ValueObjects for Feature 019 — the binding version, index
// generation, slot, and collection keys the reranker archive, the embedding
// generation build, the reconcile plan, and the availability flip target. Each id is
// a named type so no primitive is carried inline (wrap-primitives); none holds
// content. Shares the semantic_lifecycle.shared package with shared.cue (the
// executor-composition precedent of splitting a package across focused files).

package semantic_lifecycle.shared

// BindingVersion is the operator-authored monotonic version of a slot binding the archive keys entries by; the lifecycle machine never re-authors it (Group A, Feature 006 C12).
#BindingVersion: int & >0

// GenerationId is the blue/green Milvus collection generation a physical embedding build writes into before an alias swap; select/reindex alone never activate it (Group B).
#GenerationId: string & !~"^$"

// Slot is the closed pair of binding slots the lifecycle governs; the tools collection cuts over atomically with agents/skills/skill_chunks (Feature 006 C6, Feature 009 C7).
#Slot: "embedding" | "reranker"

// CollectionKind is the closed set of Milvus collections a generation spans; every collection swaps under one CAS, never split across generations (Group B, Feature 006 C12).
#CollectionKind: "agents" | "skills" | "skill_chunks" | "tools"

// ContentHash is the canonical per-doc identity the reconcile plan diffs live against indexed by; it is a digest, never the document body (Group B).
#ContentHash: string & !~"^$"

// ScopeId is the project/global partition ref every read and mutation carries so a binding or index never crosses a project (Feature 006 FR9, C13).
#ScopeId: string
