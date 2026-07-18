// DDD role: ValueObject
// Package: outputspool.stat
// OutputStat — the content-free read model for a channel returned by output.stat
// (FR18, FR41). It carries state, committed length, durability tier and content
// provenance, never a path and never content (FR12, C18, C22). Textual channels
// carry the Feature 004 language tag/provenance read from the trusted execution
// envelope, never recomputed by the content plane (FR40, C8).

package outputspool.stat

import (
	"outputspool/ids"
	"outputspool/values"
	"outputspool/enums"
)

// StatProvenance carries content type and Feature 004 language provenance; content-free (FR40, C8).
#StatProvenance: {
	content_type:        ids.#ContentType
	language_tag:        ids.#LanguageTag | null
	language_provenance: enums.#LanguageProvenance
	correlation_id:      ids.#CorrelationId
}

// OutputStat is the content-free channel read model returned by output.stat (FR18, FR41).
#OutputStat: {
	output_ref:      ids.#OutputRef
	channel:         enums.#Channel
	state:           enums.#GroupState
	committed_bytes: values.#CommittedBytes
	durability_tier: enums.#DurabilityTier
	provenance:      #StatProvenance
}
