// DDD role: ValueObject
// Package: operator_crud_screens.controls
// The Feature 015 toggle and tri-state controls. An enable/disable verb pair
// renders as ONE ToggleRow with a current-state badge whose action dispatches the
// opposite verb; a smart-routing on/off/auto setting renders as a TriStateRow with
// a pre-selected picker, because a binary toggle cannot honestly represent three
// states (FR7, FR8). An unavailable backend renders the row inert (ToggleState
// unavailable), never a fabricated success (FR15). CUE packages are not
// cross-resolved by the structural reader; import paths mirror the corpus style.

package operator_crud_screens.controls

import (
	"operator-crud-screens/enums"
	"operator-crud-screens/shared"
)

// ToggleRow collapses an enable/disable verb pair into one row: the current-state action id, its paired opposite verb, a badge, and the state (FR7, FR15).
#ToggleRow: {
	id:       shared.#CommandId
	pairedId: shared.#CommandId
	label:    shared.#RowTitle
	state:    enums.#ToggleState
	badge:    shared.#BadgeText
}

// ToggleRowList is the first-class collection of toggle rows on a domain screen (FR7).
#ToggleRowList: [...#ToggleRow]

// TriStateOptionList is the named collection of modes a tri-state picker offers, pre-selected to the current mode (FR8).
#TriStateOptionList: [...enums.#TriState]

// TriStateRow is a smart-routing mode control: the mutating verb id, the current mode, a badge, and the picker options (FR8).
#TriStateRow: {
	id:      shared.#CommandId
	label:   shared.#RowTitle
	state:   enums.#TriState
	badge:   shared.#BadgeText
	options: #TriStateOptionList
}
