// DDD role: AggregateRoot
// Package: lifecycle.row
// ProcessRow — the read-only Process Table projection of one attempt (FR26).
// It is rebuilt by replaying the durable aggregate (C6) and never executes,
// schedules, or authorizes work (FR4). Cohesive parts live in process-row-parts.cue,
// process-row-lineage.cue and process-row-profile.cue. Prompts, results, tool
// payloads, paths and secrets stay outside the row by default (FR28).

package lifecycle.row

import "lifecycle/ids"

// ProcessRow is the aggregate root of the Process Table projection.
// id is process_id — never an OS PID and never implying kill semantics (FR7, C8).
#ProcessRow: {
	id: ids.#ProcessId

	// task_id, attempt, generation and current lease.
	identity: #RowIdentity

	// Parent/root relations, ownership and process graph.
	lineage: #RowLineage

	// State, reason, settlement and timestamps.
	status: #RowStatus

	// Agent/task classification and provider/model/variant.
	profile: #RowProfile

	// Live usage, terminal outcome and trace correlation.
	accounting: #RowAccounting

	// Hierarchy role/depth/route/fanout/validation when Smart routing is active (C15).
	hierarchy: #RowHierarchy | null
}
