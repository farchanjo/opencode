// DDD role: ValueObject
// Package: operator_crud_screens.screen
// The Feature 015 domain-screen composition model: a DomainScreen opens with an
// inline StatusSection (never a toast) and a list of composed sections (status,
// toggles, settings, entities, detail). Status renders as a generic key/value
// projection for plain domains or the reused rich panel for
// jobs/output/langlock/semantic/mcp, and refreshes after every on-screen mutation
// (FR4, FR5, FR6). It is a pure TUI projection over the Feature 007 dispatch and
// the Feature 012 result signal; CUE packages are not cross-resolved by the
// structural reader, so the import paths mirror the operator-menu corpus style.

package operator_crud_screens.screen

import (
	"operator-crud-screens/enums"
	"operator-crud-screens/shared"
)

// StatusSection is the inline status rendered on screen open from a silent status read (FR4, FR5).
#StatusSection: {
	domain:   enums.#OperatorDomain
	renderer: enums.#StatusRenderer
	title:    shared.#RowTitle
}

// ScreenSection is one composed section of a domain screen, named by its kind (FR4, FR7, FR9, FR11, FR12).
#ScreenSection: {
	kind:  enums.#SectionKind
	title: shared.#RowTitle
}

// ScreenSectionList is the first-class collection of composed sections on a domain screen (FR4).
#ScreenSectionList: [...#ScreenSection]

// DomainScreen is one domain's CRUD screen: its label, its inline status section, and its composed sections (FR4, FR6).
#DomainScreen: {
	domain:   enums.#OperatorDomain
	label:    shared.#DomainLabel
	status:   #StatusSection
	sections: #ScreenSectionList
}

// ScreenModel is the active navigation node plus the domain screen backing the Dialog push/back-stack (FR4, FR9, FR11, FR12).
#ScreenModel: {
	active_node: enums.#ScreenNode
	screen:      #DomainScreen
}
