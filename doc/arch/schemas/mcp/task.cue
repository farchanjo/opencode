// DDD role: Entity
// Package: mcp.tasks
// McpTask — one experimental task-augmented execution under the off-by-default mcp.tasks
// flag (FR41, FR42, C18). Its identity is the task_id; a task-augmented call returns a
// CreateTaskResult (never a final CallToolResult body as partial content), appears as a
// Feature 002 Process Table child, and spills its final content to a Feature 005 OutputRef
// (FR42, FR43, C16, C18). Cancellation uses tasks/cancel, distinct from the standard
// notifications/cancelled path (FR18, C8). Sub-objects in task-parts.cue.

package mcp.tasks

import (
	"mcp/ids"
)

// McpTask is one task-augmented execution; identity is its task id (FR42, C18).
#McpTask: {
	id: ids.#TaskId

	// The server running the task (FR42, C18).
	server_ref: ids.#ServerId

	// The augmented tool and its task-support mode (FR42, C18).
	binding: #TaskBinding

	// The task status and input_required prompt (FR42, FR47, C18, C20).
	lifecycle: #TaskLifecycle

	// The Feature 002 Process Table child of the task (FR43, C8).
	process_ref: ids.#ProcessId

	// The Feature 005 OutputRef of the final task content (FR43, C16).
	output_ref: ids.#OutputRef | null

	// The task creation timestamp (FR42, C18).
	created_at: ids.#Timestamp
}
