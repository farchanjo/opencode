// DDD role: ValueObject
// Package: operator_crud_screens.modal
// The Feature 015 edit-modal contract. An editable setting opens an EditModal
// pre-filled from a silent read of the current effective value; each field
// validates before dispatch, Save rides the existing OperatorClient loopback, the
// modal closes on success, and a typed error surfaces in-modal (never a toast)
// (FR9, FR10, FR16, FR18). The modal is a small operator-scoped component over the
// existing Dialog push/back-stack, not a new dialog primitive. A FieldValue may be
// empty for an honest absence; a ReasonText carries only a bounded, secret-free
// reason.

package operator_crud_screens.modal

import (
	"operator-crud-screens/shared"
)

// ModalStatus is the edit-modal lifecycle affordance: idle, busy while dispatching, error on typed failure, or saved on success (FR9, FR16).
#ModalStatus: "idle" | "busy" | "error" | "saved"

// ModalAction is a footer action of the edit modal (FR16).
#ModalAction: "save" | "cancel"

// FieldInput selects the input a field collects: a bounded value picker or a free text input (FR9, FR10).
#FieldInput: "value_picker" | "text_input"

// FieldKey is the canonical port-level payload key an edit field maps to on dispatch (FR9).
#FieldKey: string & !~"^$"

// FieldValue is the pre-filled current effective value of a field; empty is an honest absence, never a fabricated default (FR10).
#FieldValue: string

// Prefilled records whether a field was seeded from a current-value read; a wrapped bool so no bare primitive is carried inline (FR10).
#Prefilled: bool

// ReasonText is the bounded, secret-free typed reason surfaced in-modal on a failed save (FR9, FR18).
#ReasonText: string & !~"^$"

// EditField is one editable field: its payload key, human label, input kind, whether it was pre-filled, and its current value (FR9, FR10).
#EditField: {
	key:       #FieldKey
	label:     shared.#FieldLabel
	input:     #FieldInput
	prefilled: #Prefilled
	value:     #FieldValue
}

// EditFieldList is the first-class collection of fields an edit modal presents (FR9, FR16).
#EditFieldList: [...#EditField]

// EditModal is the pre-filled, validated editing surface for one command: its id, title, fields, lifecycle status, and optional error reason (FR9, FR16, FR18).
#EditModal: {
	id:     shared.#CommandId
	title:  shared.#RowTitle
	fields: #EditFieldList
	status: #ModalStatus
	error?: #ReasonText
}
