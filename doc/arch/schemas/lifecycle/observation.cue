// DDD role: ValueObject
// Package: lifecycle.observation
// Read-only observation payloads over Effect Stream/PubSub with scoped finalizers
// (C14). Authorization and redaction run before delivery; an Observable never
// controls lifecycle state and never mutates a row (FR16, FR17, FR18).

package lifecycle.observation

import (
	"lifecycle/ids"
	"lifecycle/enums"
	"lifecycle/events"
)

// IncludeTerminal selects whether terminal cards/events are included in a stream.
#IncludeTerminal: bool

// EventTypeList is the first-class collection of authorized event-type filters.
#EventTypeList: [...enums.#LifecycleEventType]

// ObservationScope selects the authorized surface; global requires privilege (C14).
#ObservationScope: {
	kind:            enums.#ObservationKind
	session_id:      ids.#SessionId | null
	process_id:      ids.#ProcessId | null
	root_session_id: ids.#RootSessionId | null
	visibility:      enums.#Visibility
}

// ObservationFilter bounds a subscription by scope and event types.
#ObservationFilter: {
	scope:            #ObservationScope
	event_types:      #EventTypeList
	include_terminal: #IncludeTerminal
}

// AnomalyRecord surfaces a projection anomaly; terminal state is never invented (C9).
#AnomalyRecord: {
	kind:       enums.#AnomalyKind
	process_id: ids.#ProcessId
	reason:     ids.#Reason
}

// ObservationResult is one delivered, already-authorized and redacted event (C14).
#ObservationResult: {
	scope:   #ObservationScope
	event:   events.#LifecycleEvent
	anomaly: #AnomalyRecord | null
}
