// DDD role: ValueObject
// Package: semantic_lifecycle.reconcile
// The reindex/reconcile live-doc source and its diff plan (Feature 019, Group B).
// runReconcile (index-jobs.ts) already diffs a live LiveDoc[] against an indexed
// IndexedDoc[] and applies upserts/tombstones through the MilvusPort, but three seams
// are missing: the agent/skill live-doc builders (only the tool builder toolLiveDoc
// is bound), an enumerate-indexed-docs {canonicalId, contentHash} MilvusPort method,
// and the embedding client bound from the operator runtime. Feature 019 supplies the
// live-doc projection source and the enumerate seam so reconcile diffs real state; a
// scheduled reconcile reports the pinned binding version UNCHANGED and never re-pins
// (Feature 006 FR13). CUE packages are not cross-resolved by the structural reader.

package semantic_lifecycle.reconcile

import (
	"semantic-lifecycle/enums"
	"semantic-lifecycle/shared"
	"semantic-lifecycle/flags"
)

// LiveDocProjection is one canonical doc the live-doc source projects for a collection, keyed by canonicalId + contentHash; the dense/sparse vectors are injected upstream, never carried here (Group B).
#LiveDocProjection: {
	source:      enums.#ReconcileSource
	canonicalId: shared.#ContentHash
	contentHash: shared.#ContentHash
	scopeId:     shared.#ScopeId
}

// EnumeratedIndexedDoc is one {canonicalId, contentHash} the new MilvusPort enumerate-indexed-docs seam returns per collection so reconcile can diff against prior indexed state (Group B).
#EnumeratedIndexedDoc: {
	collection:  shared.#CollectionKind
	canonicalId: shared.#ContentHash
	contentHash: shared.#ContentHash
}

// EnumeratedIndexedDocs is the first-class collection the enumerate seam returns for one collection; empty when the endpoint is unreachable, which degrades to the typed milvus_unavailable gap (Group B).
#EnumeratedIndexedDocs: [...#EnumeratedIndexedDoc]

// ReconcilePlan is the bounded, content-free diff outcome of one collection's reconcile: counts only, plus the pinned binding version carried unchanged — never a document body (Group B, Feature 006 FR13).
#ReconcilePlan: {
	collection:       shared.#CollectionKind
	upsertedCount:    int & >=0
	tombstonedCount:  int & >=0
	unchangedCount:   int & >=0
	bindingVersion:   shared.#BindingVersion
	repinned:         flags.#RepinnedBinding
}
