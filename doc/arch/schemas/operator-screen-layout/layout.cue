// DDD role: ValueObject
// Package: operator_screen_layout.layout
// The Feature 016 screen-layout model: a ScreenLayout reads through its ordered
// regions (header → status → search → actions) so the panel reads top to bottom
// (FR1); a StatusSummary renders populated groups in full and collapses the empty
// ones to a single summary line, keeping Loading/unavailable explicit (FR2); an
// ActionSection's header alone carries the kind and its rows carry the action,
// with the command id secondary only when it fits and an availability marker only
// when the verb is not fully available (FR3); Configure orders before View for
// editable domains (FR4) and an entity domain leads with its create + list
// affordances (FR5). Pure TUI projection over the Feature 015 dispatch; CUE
// packages are not cross-resolved by the structural reader, so import paths mirror
// the operator-crud-screens corpus style.

package operator_screen_layout.layout

import (
	"operator-screen-layout/enums"
	"operator-screen-layout/shared"
)

// ScreenRegionList is the ordered collection of regions the panel reads through: header, status, search, actions (FR1).
#ScreenRegionList: [...enums.#ScreenRegion]

// StatusGroup is one status group and its render state; empty groups collapse into the summary line (FR2).
#StatusGroup: {
	name:  shared.#GroupName
	state: enums.#StatusGroupState
}

// StatusGroupList is the first-class collection of status groups on a domain screen (FR2).
#StatusGroupList: [...#StatusGroup]

// StatusSummary is the compact inline status: its groups plus the optional single line summarising the empty ones (FR2).
#StatusSummary: {
	groups:   #StatusGroupList
	summary?: shared.#SummaryText
}

// ActionRow is one action row: its action title, the command id shown only when it fits without truncation, and a marker only when the verb is not fully available (FR3).
#ActionRow: {
	title:      shared.#RowTitle
	commandId?: shared.#CommandId
	marker?:    enums.#AvailabilityMarker
}

// ActionRowList is the first-class collection of action rows within a section (FR3).
#ActionRowList: [...#ActionRow]

// ActionSection is one section whose header alone carries the kind; Configure orders before View for editable domains (FR3, FR4).
#ActionSection: {
	kind:  enums.#SectionKind
	label: shared.#SectionLabel
	rows:  #ActionRowList
}

// ConfigureAffordance is an entity domain's leading Configure row: a create action or its collection list (FR5).
#ConfigureAffordance: {
	affordance: enums.#AffordanceKind
	title:      shared.#RowTitle
	commandId:  shared.#CommandId
}

// ScreenLayout is one domain screen's polished layout: its header label, ordered regions, and compact status summary (FR1, FR2).
#ScreenLayout: {
	label:   shared.#DomainLabel
	regions: #ScreenRegionList
	status:  #StatusSummary
}
