// DDD role: ValueObject
// Package: operator_result_signal.handled
// The structured half of the TUI handled result (Feature 012). Feature 007 already
// produces this on CommandResult; the inbound TUI adapter forwards the typed
// outcome, the optional effective payload, and the version alongside the human
// display, on the SAME tryHandle return (FR1, FR2, FR3). Absence of effective is
// representable and is not an error (FR2). CUE packages are not cross-resolved by
// the structural reader; the import paths mirror the operator-menu corpus style.

package operator_result_signal.handled

import (
	"operator-result-signal/enums"
	"operator-result-signal/shared"
)

// StructuredHandledResult is the typed result carried beside the human display: outcome, optional effective payload, optional version (FR1, FR2).
#StructuredHandledResult: {
	outcome:    enums.#ResultOutcome
	effective?: shared.#EffectivePayload
	version?:   shared.#Version
}
