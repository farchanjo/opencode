// DDD role: ValueObject
// Package: semantic.dataplane
// Feature 050 — new config/data shapes for activating ADR-0008's dormant
// Milvus semantic-index DATA PLANE (production pipeline runner, model-driven
// dimension/capability discovery, chunk spooling, reconcile locking, and
// data-plane retries). Zero live-turn behavior change: none of these shapes
// are consumed by the query/narrowing path — that lands in Feature 051.

package semantic.dataplane

// #ProbeTimestamp wraps a probe/lock RFC3339 timestamp as a named ValueObject
// rather than a bare `string` (Object Calisthenics, wrap-primitives).
#ProbeTimestamp: string & !=""

// #NormalizedFlag wraps the "probed vector is L2-normalized" predicate as a
// named ValueObject rather than a bare `bool` (Object Calisthenics,
// wrap-primitives).
#NormalizedFlag: bool

// #RerankModes is the first-class collection of reranker request/response
// modes a probed model supports (Object Calisthenics, first-class-collection).
// A mode absent here is not eligible for that reranker slot.
#RerankModes: [...("native-rerank" | "structured-chat")]

// #LockHolder wraps the reconcile-lock holder identifier as a named
// ValueObject rather than a bare `string` (Object Calisthenics,
// wrap-primitives).
#LockHolder: string & !=""

// #ProbedVectorSpace is stamped on a model descriptor and on the generation it
// produces (Feature 050 decision 2). It replaces the hardcoded
// `defaultDimension ?? 1024` fallback in `generationVectorSpace`
// (registry-backend.ts:696-702): there is NO default dimension value here —
// dimension is always the ACTUAL probed vector length of the bound model. A
// probe failure with no prior probed value REFUSES generation build (typed
// gap); it never falls back to a guessed or hardcoded number.
#ProbedVectorSpace: {
	dimension:  int & >0
	metric:     "cosine" | "ip"
	normalized: #NormalizedFlag
	probed_at:  #ProbeTimestamp
	source:     "live-probe" | "metadata-crosscheck"
}

// #RerankCapabilities captures what the bound reranker model actually supports,
// probed via the extended rerank-probe.ts validate probe (Feature 050 decision
// 2). Never inferred from a model name; a mode absent from `modes` is not
// eligible for that reranker slot.
#RerankCapabilities: {
	modes: #RerankModes
	max_documents?:  int & >0
	context_window?: int & >0
	score_range?: {
		min: number
		max: number
	}
	probed_at: #ProbeTimestamp
}

// #DataPlaneRetryPolicy bounds retry behavior for the index/data plane only
// (embed batches, Milvus upsert/tombstone/enumerate/buildGeneration, reconcile
// steps) — Feature 050 decision 6. Extends the existing
// `withTransientReadRetry` shape rather than adding a fourth inline copy;
// classification is typed and transient-only — domain errors
// (dimension_mismatch, invalid_filters, reranker_not_eligible, schema rejects)
// are never retried under this policy. The LIVE QUERY plane (Feature 051) uses
// zero retries by design and does NOT consume this shape.
#DataPlaneRetryPolicy: {
	max_attempts:   int & >=1 & <=3 | *3
	base_delay_ms:  int & >0 | *500
	max_delay_ms:   int & >0 | *5000
	jitter:         bool | *true
	classification: "typed-transient-only"
}

// #ReconcileLock enforces the per-profile single-writer contract (Feature 050
// decision 5): an incremental reconcile and a full blue/green rebuild are
// mutually exclusive for a given profile, so a reconcile upsert into the
// live-alias generation can never race a rebuild's alias-swap and orphan
// those upserts. One opencode instance per profile owns index maintenance.
#ReconcileLock: {
	scope:        "profile"
	holder?:      #LockHolder
	acquired_at?: #ProbeTimestamp
}

// #SpoolEntry is a sanitized-body Feature 005 OutputSpool entry written by the
// skill chunker (Feature 050 decision 4). `ref` is the OutputRef handle
// returned by the spool write — the chunk doc's `body_ref` MUST equal this
// value. The body itself is NEVER carried inline here and NEVER a filesystem
// path; entries are content-hash-keyed alongside their chunk docs so reconcile
// supersedes/deletes them together.
#SpoolEntry: {
	ref:              string & !=""
	content_hash:     string & !=""
	parent_skill_id:  string & !=""
	chunk_index:      int & >=0
	byte_length:      int & >=0
}
