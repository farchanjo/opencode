// DDD role: ValueObject
// Package: semantic.retrieval
// RetrievalResult and DegradationOutcome — the pipeline output and the typed
// degradation ladder rung (FR24, C20). When the binding is unavailable, no binding is
// pinned, Milvus/index is unavailable, or embedding/reranker is down/stale/timeout, the
// result degrades to catalog + lexical/rules with a typed capability-gap code and an
// explicit reason, never a silent model substitution (FR24, C14, C20, AC29). The result
// carries the task fingerprint so caches and telemetry correlate without content (FR18, C22).

package semantic.retrieval

import (
	"semantic/ids"
	"semantic/enums"
)

// DegradationOutcome carries the ladder mode, typed capability gap and an explicit reason (FR24, C20, AC29).
#DegradationOutcome: {
	mode:            enums.#RetrievalMode
	gap:             enums.#DegradationGap
	degraded_reason: ids.#DegradedReason | null
}

// RetrievalResult carries the ranked candidates, effective mode, degradation outcome and fingerprint (FR3, FR24, C20).
#RetrievalResult: {
	candidates:  #CandidateList
	mode:        enums.#RetrievalMode
	outcome:     #DegradationOutcome
	fingerprint: ids.#Fingerprint
}
