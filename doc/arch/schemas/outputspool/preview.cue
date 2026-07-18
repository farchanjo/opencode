// DDD role: ValueObject
// Package: outputspool.preview
// BoundedPreview — the byte-and-line-capped, redacted head slice attached to
// EventV2 payloads, UI cards and NotificationEnvelope summaries alongside the
// opaque OutputRef only (FR4, FR33, C8). It is never a path and never a full
// channel; secret material is represented as a Feature 007 SecretRef, never inline
// plaintext (FR5, C22). Exact caps and the redaction ruleset are plan constants
// with hooks AC12/AC19.

package outputspool.preview

import (
	"outputspool/ids"
	"outputspool/values"
)

// PreviewText is the bounded redacted head slice text; empty is valid, never full content (FR4, C8).
#PreviewText: string

// SecretRefList is the first-class collection of SecretRefs redacted out of a preview (FR5, C22).
#SecretRefList: [...ids.#SecretRef]

// BoundedPreview is the redacted head slice plus its caps and redacted secret refs (FR4, C8, C22).
#BoundedPreview: {
	content_type: ids.#ContentType
	byte_cap:     values.#ByteLength
	line_cap:     values.#ByteLength
	head:         #PreviewText
	secrets:      #SecretRefList
}
