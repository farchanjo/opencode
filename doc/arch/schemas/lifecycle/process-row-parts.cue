// DDD role: ValueObject
// Package: lifecycle.row
// Top-level cohesive sub-objects composed by the ProcessRow aggregate root (FR26).

package lifecycle.row

import (
	"lifecycle/ids"
	"lifecycle/enums"
)

// RowIdentity carries the logical Task, attempt, generation and current lease.
#RowIdentity: {
	task_id:    ids.#TaskId
	attempt:    ids.#Attempt
	generation: ids.#Generation
	lease_id:   ids.#LeaseId | null
}

// RowStatus carries the current state, terminal reason, settlement and timestamps.
#RowStatus: {
	state:       enums.#ProcessState
	reason:      enums.#TerminalReason | null
	settlement:  enums.#SettlementState | null // terminal-not-settled until Feature 005 (C20)
	created_at:  ids.#Timestamp
	updated_at:  ids.#Timestamp
	terminal_at: ids.#Timestamp | null
}

// RowProfile composes agent/task classification and provider/model descriptors.
#RowProfile: {
	classification: #RowClassification
	model:          #RowModel
}

// RowAccounting composes live usage, terminal outcome and trace correlation.
#RowAccounting: {
	usage:     #RowUsage
	outcome:   #RowOutcome
	telemetry: #RowTelemetry
}

// RowHierarchy projects the hierarchy node without high-cardinality metric labels (C15).
#RowHierarchy: {
	role:               enums.#HierarchyRole
	delegation_depth:   ids.#DelegationDepth
	route_path:         #RoutePath
	fanout:             ids.#Fanout
	validation_outcome: enums.#ValidationOutcome | null
}
