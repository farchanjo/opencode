// DDD role: ValueObject
// Package: lifecycle.row
// Relations, ownership and process-graph sub-objects for the Process Table row (FR26).

package lifecycle.row

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// ProcessRefs is the first-class collection of related process ids.
#ProcessRefs: [...ids.#ProcessId]

// ReasonList is the first-class collection of bounded pending-work labels.
#ReasonList: [...ids.#Reason]

// RoutePath is the first-class collection of selected-route session ids.
#RoutePath: [...ids.#SessionId]

// RowRelations carries parent/root process and session relations.
#RowRelations: {
	parent_process_id: ids.#ParentProcessId | null
	root_process_id:   ids.#RootProcessId
	session_id:        ids.#SessionId
	parent_session_id: ids.#ParentSessionId | null
	root_session_id:   ids.#RootSessionId
}

// RowOwnership carries the owning runtime, visibility scope and actor kind.
#RowOwnership: {
	runtime_instance_id: ids.#RuntimeInstanceId
	scope:               enums.#Visibility
	actor_kind:          enums.#ActorKind
}

// RowGraph carries dependencies, children and pending inputs/steers as labels only.
#RowGraph: {
	dependencies:   #ProcessRefs
	children:       #ProcessRefs
	pending_inputs: #ReasonList
	pending_steers: #ReasonList
}

// RowLineage composes relations, ownership and the process graph.
#RowLineage: {
	relations: #RowRelations
	ownership: #RowOwnership
	graph:     #RowGraph
}
