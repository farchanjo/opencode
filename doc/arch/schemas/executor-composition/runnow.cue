// DDD role: ValueObject
// Package: executor_composition.runnow
// The jobs.run-now conversion (Feature 018, G3). run-now converts from a typed
// unavailable gap to an OperatorMutationPlan whose effectful apply (the Feature
// 017 fix-round effect seam) enqueues an immediate occurrence AFTER mutateAuthority
// runs the contract/idempotency/CAS checks and BEFORE the committed write. The
// outcome is honest: enqueued, overlap-rejected, or executor-unavailable; an
// idempotent replay returns the stored result without re-enqueuing (FR7). CUE
// packages are not cross-resolved by the structural reader.

package executor_composition.runnow

import (
	"executor-composition/enums"
	"executor-composition/shared"
)

// RunNowPlan is the mutation plan run-now dispatches; its effect enqueues the immediate occurrence under the store-scoped authority via mutateAuthority (FR7).
#RunNowPlan: {
	commandId: shared.#CommandId
	authority: shared.#AuthorityKey
	jobDefinitionId: shared.#JobDefinitionId
}

// RunNowResult is the honest outcome of the run-now enqueue; the occurrence identity is present only on a successful enqueue (FR7).
#RunNowResult: {
	outcome:       enums.#RunNowOutcome
	occurrenceId?: shared.#OccurrenceId
	version?:      shared.#Version
	reason?:       shared.#ReasonText
}
