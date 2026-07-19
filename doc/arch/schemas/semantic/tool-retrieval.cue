// DDD role: ValueObject
// Package: semantic.retrieval
// Tool-scoped retrieval result and degradation outcome for the Feature 009 tool pass
// (FR11, C2, C14). The tool pass reuses the Feature 006 RetrievalRequest with collection
// "tools" and the shared Candidate/CandidateList; it adds only the tool-specific
// degradation ladder whose floor is the full permission-visible set, unranked, so tool
// exposure is never worse than today (FR18, C14). No automatic model substitution ever
// occurs; the mode surfaces the honest rung and typed capability gap (FR19, C14). The
// result carries the task fingerprint so caches and telemetry correlate without content
// (C8, C16).

package semantic.retrieval

import (
	"semantic/ids"
	"semantic/enums"
)

// ToolDegradationOutcome carries the tool ladder rung, typed capability gap and explicit reason (FR18, C14).
#ToolDegradationOutcome: {
	mode:            enums.#ToolRetrievalMode
	gap:             enums.#DegradationGap
	degraded_reason: ids.#DegradedReason | null
}

// ToolRetrievalResult carries the ranked tool candidates, effective rung, outcome and fingerprint (FR11, FR18, C14).
#ToolRetrievalResult: {
	candidates:  #CandidateList
	mode:        enums.#ToolRetrievalMode
	outcome:     #ToolDegradationOutcome
	fingerprint: ids.#Fingerprint
}
