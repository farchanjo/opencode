// DDD role: ValueObject
// Package: semantic_lifecycle.flags
// Named boolean ValueObjects for Feature 019 — each flag is a named type so no bare
// bool is carried inline (wrap-primitives). They record whether an activation was
// operator-confirmed, whether a staged candidate was validated before cutover,
// whether a physical Milvus generation was built before the alias swapped, whether
// the reranker path re-embedded (it never does by default), whether a Milvus/OTLP
// dependency is live, and whether a scheduled reconcile re-pinned the binding (it
// never does).

package semantic_lifecycle.flags

// OperatorConfirmed is true when the operator explicitly confirmed the cutover/rollback under CAS; a false value gates the activation as confirmation_required (Group A, Group B).
#OperatorConfirmed: bool

// CandidateValidated is true when the staged candidate passed the native deterministic validate/eval before cutover; a false value gates the activation as not_validated (Group A, Group B).
#CandidateValidated: bool

// GenerationBuilt is true when a physical Milvus generation was built and validated before the embedding alias swap; a config-only alias flip is NEVER a cutover (Group B, Feature 006 FR12/FR32).
#GenerationBuilt: bool

// ReEmbedded is true only when a cutover re-embedded the corpus; a reranker cutover leaves it false — the vector index is untouched by a reranker change (Group A, Feature 006 FR32).
#ReEmbedded: bool

// DependencyLive is true when the live Milvus/OTLP dependency is composed and reachable; false degrades the verb to the exact typed capability-gap floor (Group B, Group D).
#DependencyLive: bool

// RepinnedBinding is true only if a reconcile re-pinned the binding; a scheduled reconcile always leaves it false — it never re-pins (Group B, Feature 006 FR13).
#RepinnedBinding: bool

// RollbackResolved is true when the archive held a superseded prior the rollback can target; false is the typed no_archived_prior rejection (Group A).
#RollbackResolved: bool

// RedactionEnabled is true when a telemetry redaction category is excluded from every exported signal; it defaults true so sensitive material never leaves the process (Group D, Security).
#RedactionEnabled: bool
