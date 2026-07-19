// DDD role: ValueObject
// Package: mcp.tasks
// Cohesive sub-objects composed by the McpTask entity (FR41, FR42, C18). The binding
// carries the augmented tool and its execution.taskSupport mode — a forbidden tool rejects
// a task-augmented call even when mcp.tasks is enabled (FR42, C18). The lifecycle carries
// the task status including the input_required prompt, which always surfaces to the
// operator and is never treated as partial tool content (FR42, FR47, C18, C20). Tasks are
// disabled by default and map to Feature 002 children and Feature 005 spool only (FR43,
// C18). No sub-object inlines content.

package mcp.tasks

import (
	"mcp/ids"
	"mcp/enums"
)

// TaskBinding carries the augmented tool and its execution.taskSupport mode (FR42, C18).
#TaskBinding: {
	tool_ref:     ids.#ToolName
	task_support: enums.#TaskSupport
}

// TaskLifecycle carries the task status; input_required always surfaces to the operator (FR42, FR47, C20).
#TaskLifecycle: {
	status:         enums.#TaskStatus
	input_required: ids.#OperatorSurfaced
}
