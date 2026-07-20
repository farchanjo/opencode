// DDD role: ValueObject
// Package: executor_composition.interrupt
// The narrow interrupt-edge contract (Feature 018, G5). The live
// SessionRunCoordinator is exposed to the operator through the smallest edge — a
// process-singleton interrupt registry the execution layer registers the active
// root run into at run start and the operator lifecycle stack-wiring consults for
// the second-press forced abort — NOT a broad operator to SessionExecution
// dependency. The first-press cancel is unchanged; an absent entry degrades to a
// typed unconfirmed, never a fabricated stop (FR9, FR10). CUE packages are not
// cross-resolved by the structural reader.

package executor_composition.interrupt

import (
	"executor-composition/enums"
	"executor-composition/flags"
	"executor-composition/shared"
)

// InterruptEntry is one active root run the execution layer registered into the narrow registry, keyed by the SessionRunCoordinator interrupt key (FR9).
#InterruptEntry: {
	rootKey:       shared.#RootKey
	rootSessionId: shared.#RootSessionId
	registered:    flags.#InterruptRegistered
}

// ForcedAbortOutcome is the second-press disposition: the registered coordinator interrupted the run, or no entry so the cancel is honestly unconfirmed (FR9, FR10).
#ForcedAbortOutcome: {
	rootKey:     shared.#RootKey
	disposition: enums.#InterruptDisposition
	reason?:     shared.#ReasonText
}
