// DDD role: ValueObject
// Package: outputspool.cursor
// OutputCursor — the opaque follow token bound to a group generation and byte
// offset with an integrity tag (FR17, FR22, C14, C18). It exposes no client-visible
// internals beyond the opaque contract; a reconnect with a stale or superseded
// cursor returns a stable expired/invalid_cursor code rather than rewinding or
// leaking a later generation (C14). The token codec is a plan constant (AC4).

package outputspool.cursor

import (
	"outputspool/ids"
	"outputspool/values"
	"outputspool/enums"
)

// OutputCursor is the opaque resume token: group, generation, channel, offset and integrity tag (FR17, C14, C18).
#OutputCursor: {
	group_id:      ids.#GroupId
	generation:    values.#Generation
	channel:       enums.#Channel
	offset:        values.#ByteOffset
	integrity_tag: ids.#IntegrityTag
}

// CursorStatus carries the cursor lifecycle state and a stable error code on rejection (FR22, C14, AC4).
#CursorStatus: {
	state:      enums.#CursorState
	error_code: enums.#ErrorCode | null
}
