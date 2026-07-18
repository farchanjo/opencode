// DDD role: ValueObject
// Package: outputspool.channel
// Cohesive sub-objects composed by the OutputChannel entity (FR15, FR16). Content
// carries the media type and the Feature 004 language tag/provenance on a textual
// channel, never recomputed content (FR40, C8). State carries the group-state,
// committed-length authority, open-stream signals and any observable admission
// fault (FR10, FR21, C4, C20). Provenance is content-free correlation only (C22).

package outputspool.channel

import (
	"outputspool/ids"
	"outputspool/values"
	"outputspool/enums"
)

// ChannelContent carries the media type and Feature 004 language provenance; content-free (FR16, FR40, C8).
#ChannelContent: {
	content_type:        ids.#ContentType
	language_tag:        ids.#LanguageTag | null
	language_provenance: enums.#LanguageProvenance
}

// ChannelState carries the state, committed-length authority, open-stream signals and admission fault (FR10, FR21, C20).
#ChannelState: {
	group_state:     enums.#GroupState
	committed_bytes: values.#CommittedBytes
	caught_up:       ids.#CaughtUp
	eof:             ids.#Eof
	admission_fault: enums.#AdmissionFault
}

// ChannelProvenance carries content-free correlation and capture time only (C22).
#ChannelProvenance: {
	source:         enums.#EventSource
	captured_at:    ids.#Timestamp
	correlation_id: ids.#CorrelationId
}
