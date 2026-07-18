// DDD role: AggregateRoot
// Package: jobs.definition
// JobDefinition — the durable scheduled-job aggregate persisted in the Feature 007
// Config.Service authority and rehydrated at startup (FR2, FR3, C5). An in-process
// Bun registration is never the durable authority (FR3). Cohesive parts live in
// definition-parts.cue. Secrets are secure references only (Security 3, C10).

package jobs.definition

import "jobs/ids"

// JobDefinition is the aggregate root of a scheduled job; id is job_definition_id (FR1, FR2).
#JobDefinition: {
	id: ids.#JobDefinitionId

	// Name, description, owner, version and timestamps.
	identity: #DefinitionIdentity

	// Schedule id, cron/timezone, minimum interval and enabled state.
	schedule: #DefinitionSchedule

	// Misfire, overlap and capability-surface policy.
	policy: #DefinitionPolicy

	// Action type, target, deadline/timeout, retry budget and priority.
	execution: #DefinitionExecution

	// Scope, project, principal, permissions, secret references and payload ref.
	authorization: #DefinitionAuthorization
}
