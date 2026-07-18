// DDD role: AggregateRoot
// Package: outputspool.group
// OutputGroup — the aggregate root of the content plane, keyed to one process/
// attempt/generation subtree (FR14, C1, C18, C21). Its id is the group_id; the
// composite OutputGroupRef is the fencing key so a new attempt/generation never
// overwrites a predecessor's committed content (FR27). The producer that owns the
// Feature 002 Process owns its group; Feature 005 introduces no second executor or
// store authority (FR3, C21). Cohesive parts live in group-parts.cue.

package outputspool.group

import "outputspool/ids"

// OutputGroup is the aggregate root of a producer's output; id is the group_id (FR14, C18).
#OutputGroup: {
	id: ids.#GroupId

	// The project/root-session/process/attempt/generation fencing key (FR14, C1, C18).
	key: #OutputGroupRef

	// Correlation/causation and session/root identity of the producer (C21).
	lineage: #GroupLineage

	// Tiered fsync posture and disposable eligibility (FR8, C2).
	durability: #GroupDurability

	// State machine state, committed-length authority, reason and timestamps (FR23, FR25, C12).
	settlement: #GroupSettlement

	// The OutputRefs of the channels this group owns (FR15, FR17).
	channels: #ChannelRefSet
}
