// DDD role: ValueObject
// Package: operator_result_signal.picker
// The entity-picker option projection (Feature 012). A picker loader issues its
// read query (jobs.list, process.tree, task.tree) on the SAME dispatch path and
// projects the effective payload into options keyed by the entity id; an absent or
// unavailable read yields the honest empty option set (FR6, FR8). CUE packages are
// not cross-resolved by the structural reader; import paths mirror operator-menu.

package operator_result_signal.picker

import (
	"operator-result-signal/enums"
	"operator-result-signal/shared"
)

// PickerOption is one selectable entity: the payload-sourced id as value, a human label, and an optional detail line (FR6).
#PickerOption: {
	value:   shared.#EntityId
	label:   shared.#OptionLabel
	detail?: shared.#OptionDetail
}

// PickerOptionList is the first-class collection of entity options for one picker (FR6, FR8).
#PickerOptionList: [...#PickerOption]

// PickerProjection is one picker's loaded state: its read source, its load state, and the projected options (FR6, FR8).
#PickerProjection: {
	source:  enums.#PickerSource
	state:   enums.#PickerState
	options: #PickerOptionList
}
