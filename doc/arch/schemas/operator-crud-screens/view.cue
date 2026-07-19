// DDD role: ValueObject
// Package: operator_crud_screens.view
// The Feature 015 view-modal contract. A detail/visualization verb
// (show/explain/capabilities/history/plain-domain status) opens a read-only
// ViewModal that renders the effective payload as a structural key/value tree and
// closes on Esc — inside the interface, never a toast (FR5, FR11, FR18). The tree
// projects bounded, redacted summaries only; an absent payload renders the honest
// empty tree, never a synthesized value. CUE packages are not cross-resolved by
// the structural reader; import paths mirror the corpus style.

package operator_crud_screens.view

import (
	"operator-crud-screens/shared"
)

// ViewValue is the bounded, redacted string value of one key/value node; empty is an honest absence (FR11).
#ViewValue: string

// ViewNode is one key/value leaf of the structural view tree (FR11).
#ViewNode: {
	key:   shared.#FieldLabel
	value: #ViewValue
}

// ViewTree is the first-class collection of key/value nodes projected from the effective payload (FR11).
#ViewTree: [...#ViewNode]

// ViewModal is the read-only detail surface for one command: its id, title, and structural tree (FR11, FR18).
#ViewModal: {
	id:    shared.#CommandId
	title: shared.#RowTitle
	tree:  #ViewTree
}
