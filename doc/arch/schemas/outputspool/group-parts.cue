// DDD role: ValueObject
// Package: outputspool.group
// Cohesive sub-objects composed by the OutputGroup aggregate root (FR14, C18). The
// OutputGroupRef composite key is scoped to project/root-session/process/attempt/
// generation so one ref maps to exactly one generation subtree and a stale
// generation never shares a file with its successor (FR14, C1, C18). Durability is
// tiered by channel class (C2); settlement carries the committed-length authority.

package outputspool.group

import (
	"outputspool/ids"
	"outputspool/values"
	"outputspool/enums"
)

// OutputGroupRef is the composite identity key scoped to process/attempt/generation (FR14, C1, C18).
#OutputGroupRef: {
	project_id:      ids.#ProjectId
	root_session_id: ids.#RootSessionId
	process_id:      ids.#ProcessId
	attempt:         values.#Attempt
	generation:      values.#Generation
}

// GroupLineage carries correlation/causation and session/root identity of the producer (C21).
#GroupLineage: {
	correlation_id:  ids.#CorrelationId
	causation_id:    ids.#CausationId | null
	session_id:      ids.#SessionId | null
	root_session_id: ids.#RootSessionId
}

// GroupDurability selects the tiered fsync posture and disposable eligibility (FR8, C2).
#GroupDurability: {
	tier:       enums.#DurabilityTier
	disposable: ids.#Disposable
}

// GroupSettlement carries the state, committed-length authority, reason and timestamps (FR23, FR25, C12, C13).
#GroupSettlement: {
	state:           enums.#GroupState
	committed_bytes: values.#CommittedBytes
	reason:          ids.#Reason
	created_at:      ids.#Timestamp
	updated_at:      ids.#Timestamp
	sealed_at:       ids.#Timestamp | null
}

// ChannelRefSet is the first-class collection of OutputRefs the group owns (FR15, FR17).
#ChannelRefSet: [...ids.#OutputRef]
