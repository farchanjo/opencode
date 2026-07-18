// DDD role: ValueObject
// Package: jobs.reconciliation
// Registration state and reconciliation records (FR6, FR14, C5, C7). Persistent
// definition/intent/state transitions are atomic within their authority; the
// Bun/OS registration is an idempotent external effect paired with compensation,
// and no cross-system transaction is promised. Reconciliation never re-executes
// an ambiguous mutation (FR14, AC19, AC23).

package jobs.reconciliation

import (
	"jobs/ids"
	"jobs/enums"
)

// AutoRetryDisabled is pinned false: reconciliation never re-executes effects (FR14, C11).
#AutoRetryDisabled: false

// ScheduleRegistration is the durable intent plus registration state for one schedule (FR6, C5).
#ScheduleRegistration: {
	job_definition_id:  ids.#JobDefinitionId
	schedule_id:        ids.#ScheduleId
	state:              enums.#RegistrationState
	intent:             enums.#RegistrationIntent
	capability_surface: enums.#CapabilitySurface
	updated_at:         ids.#Timestamp
}

// OccurrenceReconcile records a versioned occurrence reconciliation with no auto-retry (FR14, AC19).
#OccurrenceReconcile: {
	occurrence_id: ids.#OccurrenceId
	outcome:       enums.#ReconcileOutcome
	from_version:  ids.#SchemaVersion
	auto_retry:    #AutoRetryDisabled
}

// RegistrationReconcile records a startup registration reconciliation without a cross-system commit (AC23).
#RegistrationReconcile: {
	job_definition_id: ids.#JobDefinitionId
	schedule_id:       ids.#ScheduleId
	outcome:           enums.#ReconcileOutcome
	from_state:        enums.#RegistrationState
	auto_retry:        #AutoRetryDisabled
}
