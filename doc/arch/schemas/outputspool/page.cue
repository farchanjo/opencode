// DDD role: ValueObject
// Package: outputspool.page
// ReadPage and the read contract (FR20, FR21, C15). The canonical offset unit is
// uncompressed bytes; limit is mandatory and server-capped; reads are UTF-8 safe
// and never split a codepoint (AC2, AC3). eof is true only when the channel is
// sealed or aborted and consumed through committed end; an open stream reports
// caught_up, never eof, when merely caught up (FR21, C20).

package outputspool.page

import (
	"outputspool/ids"
	"outputspool/values"
)

// PageRange is the requested byte window: offset plus a mandatory server-capped limit (FR20, C3, AC1).
#PageRange: {
	offset: values.#ByteOffset
	limit:  values.#PageLimit
	length: values.#ByteLength
}

// ReadRequest is a bounded paged read against an OutputRef; no path is ever accepted (FR12, FR20).
#ReadRequest: {
	output_ref: ids.#OutputRef
	offset:     values.#ByteOffset
	limit:      values.#PageLimit
}

// ReadPage is the UTF-8-safe page response with resume and open-stream signals (FR21, AC2, AC3).
#ReadPage: {
	range:           #PageRange
	next_offset:     values.#NextOffset
	committed_bytes: values.#CommittedBytes
	caught_up:       ids.#CaughtUp
	eof:             ids.#Eof
}
