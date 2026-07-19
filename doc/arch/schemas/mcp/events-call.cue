// DDD role: ValueObject
// Package: mcp.events
// Durable call-settlement event members (FR38, C3). Call settlement, call cancellation and
// task settlement persist for audit correlation and carry the OutputRef and byte length of
// the spooled result — never the body, a path, or a URI-as-content (FR38, FR56, C16, C26).
// A settlement distinguishes tool-execution isError from a protocol error (FR12, C5); a
// cancellation records local settlement vs an unacknowledged remote (FR17, C8); a task
// settlement carries the terminal task status (FR42, C18). No member carries content.

package mcp.events

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/values"
)

// CallSettledDetail carries the request id, outcome, OutputRef and byte length (FR12, C5, C16).
#CallSettledDetail: {
	request_id:  ids.#RequestId
	outcome:     enums.#CallOutcome
	output_ref:  ids.#OutputRef
	byte_length: values.#ByteLength
}

// CallCancelledDetail carries the request id and the local/remote cancel outcome (FR17, C8).
#CallCancelledDetail: {
	request_id: ids.#RequestId
	outcome:    enums.#CancelOutcome
}

// TaskSettledDetail carries the task id, terminal status and OutputRef (FR42, C16, C18).
#TaskSettledDetail: {
	task_id:    ids.#TaskId
	status:     enums.#TaskStatus
	output_ref: ids.#OutputRef | null
}

// mcp.call.settled — a tools/call settled with a spooled OutputRef (FR38, C16).
#McpCallSettledEvent: {
	type:     "mcp.call.settled"
	envelope: #McpEventEnvelope
	detail:   #CallSettledDetail
}

// mcp.call.cancelled — a standard call cancelled via notifications/cancelled (FR17, C8).
#McpCallCancelledEvent: {
	type:     "mcp.call.cancelled"
	envelope: #McpEventEnvelope
	detail:   #CallCancelledDetail
}

// mcp.task.settled — a task-augmented execution reached a terminal status (FR42, C18).
#McpTaskSettledEvent: {
	type:     "mcp.task.settled"
	envelope: #McpEventEnvelope
	detail:   #TaskSettledDetail
}
