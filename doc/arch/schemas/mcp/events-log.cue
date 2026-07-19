// DDD role: ValueObject
// Package: mcp.events
// Live task-status and logging event members (FR38, C3). Task status and log are coalesced
// UI/OTEL signals that are never required to persist and may be dropped under load (FR38,
// C3). A task status including input_required surfaces to the operator and is never partial
// tool content (FR42, FR47, C18, C20). A log member carries a redacted level-tagged line
// under rate limits and native retention — secrets, tokens and path-shaped fields stripped
// (FR28, C23). No member carries content or a path (FR38, FR56).

package mcp.events

import (
	"mcp/ids"
	"mcp/enums"
)

// TaskStatusDetail carries the task id and its status including input_required (FR42, C18, C20).
#TaskStatusDetail: {
	task_id: ids.#TaskId
	status:  enums.#TaskStatus
}

// LogDetail carries the redacted level-tagged log line under rate limits (FR28, C23).
#LogDetail: {
	level:    enums.#LogLevel
	redacted: ids.#RedactedText
}

// mcp.task.status — a task status frame including input_required; operator-surfaced (FR42, C20).
#McpTaskStatusEvent: {
	type:     "mcp.task.status"
	envelope: #McpEventEnvelope
	detail:   #TaskStatusDetail
}

// mcp.log — a redacted logging notification under rate limits (FR28, C23).
#McpLogEvent: {
	type:     "mcp.log"
	envelope: #McpEventEnvelope
	detail:   #LogDetail
}
