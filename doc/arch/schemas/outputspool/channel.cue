// DDD role: Entity
// Package: outputspool.channel
// OutputChannel — one typed channel within a group, identified by its OutputRef
// (FR15, FR17). It is an Entity because it has stable identity across appends and
// state transitions while its committed length grows. A textual channel carries
// Feature 004 language provenance; the reasoning channel is stricter by default —
// never emitted to OTEL, never in an unauthorized preview, shorter TTL (FR16, C9).
// Cohesive parts live in channel-parts.cue.

package outputspool.channel

import (
	"outputspool/ids"
	"outputspool/enums"
)

// OutputChannel is a typed channel entity; id is its bounded opaque OutputRef (FR15, FR17).
#OutputChannel: {
	id:         ids.#OutputRef
	channel:    enums.#Channel
	content:    #ChannelContent
	state:      #ChannelState
	provenance: #ChannelProvenance
}
