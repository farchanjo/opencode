// DDD role: ValueObject
// Package: operator_crud_screens.entity_crud
// The Feature 015 entity-CRUD projection for the collection domains: jobs,
// semantic providers/models, and MCP servers render as lists whose rows drill into
// per-entity actions — create, edit, delete, enable/disable, reschedule,
// rotate-secret, connect/disconnect (FR12, FR13, FR14). Each action rides the same
// OperatorClient loopback and canonical command id as slash/CLI (FR17); an action
// whose backend is a typed capability gap renders unavailable and inert (FR15).
// CUE packages are not cross-resolved by the structural reader; import paths mirror
// the corpus style.

package operator_crud_screens.entity_crud

import (
	"operator-crud-screens/shared"
)

// EntityVerb is the closed set of CRUD actions a collection-domain entity exposes (FR12, FR13, FR14).
#EntityVerb: "create" | "edit" | "delete" | "enable" | "disable" | "reschedule" | "rotate_secret" | "connect" | "disconnect"

// EntityKind names the managed collection an entity list projects (FR12, FR13, FR14).
#EntityKind: "job" | "provider" | "model" | "mcp_server"

// Available records whether an entity action's backend is reachable; a wrapped bool so no bare primitive is carried inline (FR15).
#Available: bool

// EntityAction is one action row under an entity: its verb, canonical command id, human title, and availability (FR12, FR15).
#EntityAction: {
	verb:      #EntityVerb
	id:        shared.#CommandId
	label:     shared.#RowTitle
	available: #Available
}

// EntityActionList is the first-class collection of actions offered on one entity item (FR12, FR13, FR14).
#EntityActionList: [...#EntityAction]

// EntityRow is one row of an entity list: the entity id, its human label, and its available actions (FR12, FR13, FR14).
#EntityRow: {
	entityId: shared.#EntityId
	label:    shared.#RowTitle
	actions:  #EntityActionList
}

// EntityRowList is the first-class collection of entity rows on a list screen (FR12, FR13, FR14).
#EntityRowList: [...#EntityRow]

// EntityListScreen is one collection domain's list surface: the entity kind, the create command id, and the rows (FR12, FR13, FR14).
#EntityListScreen: {
	kind:     #EntityKind
	createId: shared.#CommandId
	rows:     #EntityRowList
}
