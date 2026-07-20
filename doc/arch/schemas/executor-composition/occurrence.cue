// DDD role: ValueObject
// Package: executor_composition.occurrence
// The definition-keyed occurrence read (Feature 018, G4). The executor emits its
// job.* occurrence events through the EventV2Bridge under a definition-keyed
// durable aggregate so the Feature 017 occurrence projection resolves them by
// jobDefinitionId and history/show/watch reflect real executions instead of an
// honest-empty list. The read model is bounded and content-free — never a prompt,
// transcript, or spool page body (FR8, Security). CUE packages are not
// cross-resolved by the structural reader.

package executor_composition.occurrence

import (
	"executor-composition/enums"
	"executor-composition/shared"
)

// OccurrenceRead is the bounded, content-free read model the definition-keyed projection returns for history/show/watch; keyed by definition, never by session (FR8).
#OccurrenceRead: {
	jobDefinitionId: shared.#JobDefinitionId
	occurrenceId:    shared.#OccurrenceId
	rootSessionId:   shared.#RootSessionId
	readiness:       enums.#BackendReadiness
	reason?:         shared.#ReasonText
}

// DefinitionKeyedAggregate records that the durable aggregate the occurrence events are written under is the job definition, so the projection reads by definition directly (FR8).
#DefinitionKeyedAggregate: {
	jobDefinitionId: shared.#JobDefinitionId
	rootSessionId:   shared.#RootSessionId
}
