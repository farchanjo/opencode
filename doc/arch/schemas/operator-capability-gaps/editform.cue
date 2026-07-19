// DDD role: ValueObject
// Package: operator_capability_gaps.editform
// The operator-TUI editing contracts (Feature 017, Group 7). A payload-carrying
// Configure verb opens a multi-field form modal — an ordered list of labeled
// fields, each pre-filled from the current effective value, enum properties as
// pickers, pools.set as a bindings-list editor, routing.configure as structured
// common fields plus an advanced-JSON fallback. Save composes the byte-exact port
// payload and dispatches once; a payload the form cannot compose surfaces an
// in-modal error, never a global toast (FR19-FR22). The view modal renders a
// detail tree bounded in depth and rows — a contract DISTINCT from the compact
// status strip (FR23). CUE packages are not cross-resolved by the structural
// reader; import paths mirror the operator-persistence corpus style.

package operator_capability_gaps.editform

import (
	"operator-capability-gaps/enums"
	"operator-capability-gaps/shared"
	"operator-capability-gaps/flags"
)

// EditField is one labeled field in the multi-field modal: its payload key, label, input kind, and whether it is a re-entered secret (FR19, FR21).
#EditField: {
	key:      shared.#DisplayLabel
	label:    shared.#DisplayLabel
	kind:     enums.#FieldInputKind
	secret?:  shared.#SecretRef
	required: flags.#FieldRequired
}

// EditFieldList is the ordered collection of fields a Configure verb's modal renders; extends the Feature 015 single-field descriptor to a list (FR19).
#EditFieldList: [...#EditField]

// EditModalDescriptor maps a Configure verb to its ordered field list and the read that pre-fills them; a byte-exact payload is composed on Save (FR19, FR20).
#EditModalDescriptor: {
	commandId: shared.#CommandId
	readId:    shared.#CommandId
	fields:    #EditFieldList
}

// DetailTree is the bounded view-modal renderer: records/arrays expand to maxDepth and maxRows with an honest truncation marker, never a {n} placeholder within the bound (FR23).
#DetailTree: {
	renderer: enums.#ViewRenderer & "detail_tree"
	maxDepth: shared.#TreeDepth
	maxRows:  shared.#TreeRowBudget
}
