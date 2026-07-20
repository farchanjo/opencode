// DDD role: ValueObject
// Package: executor_composition.coordinator
// The TaskProcessCoordinator implementation contract (Feature 018, G2). A due
// occurrence is admitted under the Feature 002 admission + Feature 001 routing
// gates, creates the canonical Feature 002 Task Process (owner_kind scheduled-job),
// provisions the occurrence-owned Todo + OutputGroup, and runs headless under the
// SAME permission/config surface as a normal session — no privilege bypass; output
// is captured through the SHARED Feature 017 spool writer (FR4, FR5, FR6). CUE
// packages are not cross-resolved by the structural reader.

package executor_composition.coordinator

import (
	"executor-composition/enums"
	"executor-composition/flags"
	"executor-composition/shared"
)

// AdmissionOutcome is the honest admission verdict for a due occurrence; a denial carries a bounded reason, never a fake admitted (FR4).
#AdmissionOutcome: {
	decision: enums.#AdmissionDecision
	reason?:  shared.#ReasonText
}

// ScheduledProcess is the Feature 002 Task Process the coordinator creates for an admitted occurrence, tagged with the fixed scheduled-job provenance (FR4).
#ScheduledProcess: {
	occurrenceId: shared.#OccurrenceId
	processId:    shared.#ProcessId
	rootSessionId: shared.#RootSessionId
	ownerKind:    enums.#OwnerKind
}

// CoordinatorStep is one phase of the coordinator lifecycle a due occurrence walks; a headless-incapable capability degrades to a typed terminal outcome (FR4, FR5, FR6).
#CoordinatorStep: {
	occurrenceId:  shared.#OccurrenceId
	phase:         enums.#CoordinatorPhase
	samePermission: flags.#SamePermissionSurface
	sharedWriter:  flags.#SharedSpoolWriter
	reason?:       shared.#ReasonText
}
