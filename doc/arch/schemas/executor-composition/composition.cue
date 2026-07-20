// DDD role: ValueObject
// Package: executor_composition.composition
// The eager executor-composition binding (Feature 018, G1). A process-singleton
// arms the scheduler engine + Bun cron adapter + trigger service at server start
// (mirroring the Feature 017 ensureProcessSpoolWriter eager seam), wiring the
// DueDispatcher to onDue and the reconcileSource to the persisted rehydration. The
// arming is fail-open (a fault leaves it disarmed, never a crash) and bounded by
// the existing overlap/misfire policies (FR1, FR2, FR3). CUE packages are not
// cross-resolved by the structural reader; import paths mirror the corpus style.

package executor_composition.composition

import (
	"executor-composition/enums"
	"executor-composition/flags"
	"executor-composition/shared"
)

// ExecutorComposition is the process-singleton arming outcome at server start; disarmed is the fail-open state and keeps the schedule verbs at their typed gap (FR1, FR2).
#ExecutorComposition: {
	state:  enums.#ArmState
	armed:  flags.#EagerArmed
	reason?: shared.#ReasonText
}

// DueDispatch is the fire-and-forget seam the cron callback hands the trigger service; it carries only identity, no business decision (FR1).
#DueDispatch: {
	jobDefinitionId: shared.#JobDefinitionId
	cronExpression:  shared.#CronExpression
	timezone:        shared.#Timezone
}

// ConcurrencyBound records the overlap/misfire policies the executor honors so concurrent due occurrences stay bounded; never an unbounded fan-out (FR3).
#ConcurrencyBound: {
	overlap: enums.#OverlapPolicy
	misfire: enums.#MisfireDisposition
}
