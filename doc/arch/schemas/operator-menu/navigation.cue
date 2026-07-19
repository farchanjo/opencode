// DDD role: ValueObject
// Package: operator_menu.navigation
// The Feature 011 navigation model: Home (domain-group list) -> DomainPanel (View
// section + Configure section) -> { ResultToast | ConfirmDialog->dispatch |
// InputForm->dispatch }. It is a pure TUI projection over the Feature 007 reserved
// catalog; every leaf dispatches the SAME canonical command id through the SAME
// OperatorClient loopback as slash/CLI, preserving the parity invariant (FR1, FR3,
// FR5, FR6, FR8). CUE packages are not cross-resolved by the structural reader; the
// import paths mirror the langlock corpus style for readability only.

package operator_menu.navigation

import (
	"operator-menu/enums"
	"operator-menu/shared"
)

// VerbItem is one catalog verb projected as a row under a domain panel section (FR3, FR4, FR5, FR7).
#VerbItem: {
	id:           shared.#CommandId
	label:        shared.#VerbLabel
	subtitle:     shared.#Subtitle
	section:      enums.#VerbSection
	availability: enums.#VerbAvailability
	input_mode:   enums.#InputMode
	persistence:  enums.#PersistenceClass
}

// VerbList is a first-class collection of verb rows for one panel section (FR3).
#VerbList: [...#VerbItem]

// DomainGroup is one row of the Home group list: label, availability badge, and section counts (FR2, FR4).
#DomainGroup: {
	domain:          enums.#OperatorDomain
	label:           shared.#DomainLabel
	badge:           shared.#Badge
	availability:    enums.#VerbAvailability
	view_count:      shared.#VerbCount
	configure_count: shared.#VerbCount
}

// GroupList is the first-class collection of all 12 domain rows on the Home node (FR2).
#GroupList: [...#DomainGroup]

// DomainPanel is the pushed submenu for one domain: its View section and its Configure section (FR3, FR6).
#DomainPanel: {
	domain:    enums.#OperatorDomain
	label:     shared.#DomainLabel
	view:      #VerbList
	configure: #VerbList
}

// OperatorMenuModel is the active navigation node plus the Home group list backing the stack (FR1, FR2).
#OperatorMenuModel: {
	active_node: enums.#NavNode
	groups:      #GroupList
}
