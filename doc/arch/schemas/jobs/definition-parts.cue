// DDD role: ValueObject
// Package: jobs.definition
// Cohesive sub-objects composed by the JobDefinition aggregate root (FR2). Each
// stays within the calisthenics field bound; mutations are atomic and idempotent
// within the Config.Service authority with version/CAS (FR6, C5).

package jobs.definition

import (
	"jobs/ids"
	"jobs/enums"
	"jobs/schedule"
)

// SecretRefList is the first-class collection of secure secret references (Security 3, C10).
#SecretRefList: [...ids.#SecretRef]

// DefinitionIdentity carries the label, description, owner, CAS version and timestamps.
#DefinitionIdentity: {
	name:        ids.#JobName
	description: ids.#JobDescription
	owner:       ids.#Principal
	version:     ids.#Version
	created_at:  ids.#Timestamp
	updated_at:  ids.#Timestamp
}

// DefinitionSchedule carries the schedule id, cron/timezone, minimum interval and enabled flag.
#DefinitionSchedule: {
	schedule_id:         ids.#ScheduleId
	schedule:            schedule.#CronSchedule
	minimum_interval_ms: schedule.#MinimumIntervalMs
	enabled:             ids.#Enabled
}

// DefinitionPolicy carries misfire, overlap and capability-surface policy (FR15, FR16, C1, C3, C19).
#DefinitionPolicy: {
	misfire:            enums.#MisfirePolicy
	overlap:            enums.#OverlapPolicy
	capability_surface: enums.#CapabilitySurface
}

// DefinitionExecution carries action type, target, deadline/timeout, retry budget and priority.
#DefinitionExecution: {
	action_type:  enums.#ActionType
	target:       ids.#ActionTarget
	deadline_ms:  ids.#DeadlineMs
	timeout_ms:   ids.#TimeoutMs
	retry_budget: ids.#RetryBudget
	priority:     ids.#Priority
}

// DefinitionAuthorization carries scope, project, principal, permissions and secure references (C10, C12).
#DefinitionAuthorization: {
	scope:           enums.#Scope
	project_ref:     ids.#ProjectRef
	root_session_id: ids.#RootSessionId | null
	principal:       ids.#Principal
	permissions:     ids.#PermissionSet
	secret_refs:     #SecretRefList
	payload_ref:     ids.#PayloadRef | null
}
