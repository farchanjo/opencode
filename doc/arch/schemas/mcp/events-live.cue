// DDD role: ValueObject
// Package: mcp.events
// Live call-plane event members (FR38, C3). Call start, call progress and a cancel request
// are coalesced UI/OTEL signals that are never required to persist and may be dropped under
// load (FR38, C3). Progress is metadata only — wire progress is monotonic per token, it
// updates the Process Table child and OTEL, and it never enters LLM turns or is persisted as
// tool output (FR14, FR15, C7). A cancel request carries the standard vs task wire path
// before settlement (FR17, FR18, C8). No member carries content or a path (FR38, FR56).

package mcp.events

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/values"
)

// CallStartedDetail carries the request id and the invoked tool (FR39, C8).
#CallStartedDetail: {
	request_id: ids.#RequestId
	tool_ref:   ids.#ToolName
}

// CallProgressDetail carries the monotonic wire progress and optional total (FR14, FR15, C7).
#CallProgressDetail: {
	request_id: ids.#RequestId
	progress:   values.#Progress
	total:      values.#Total | null
}

// CancelRequestedDetail carries the request id and the standard vs task wire path (FR17, FR18, C8).
#CancelRequestedDetail: {
	request_id: ids.#RequestId
	wire_path:  enums.#CancelWirePath
}

// mcp.call.started — a tools/call began; live UI/OTEL signal (FR39, C8).
#McpCallStartedEvent: {
	type:     "mcp.call.started"
	envelope: #McpEventEnvelope
	detail:   #CallStartedDetail
}

// mcp.call.progress — a monotonic progress frame; never an LLM turn (FR14, C7).
#McpCallProgressEvent: {
	type:     "mcp.call.progress"
	envelope: #McpEventEnvelope
	detail:   #CallProgressDetail
}

// mcp.call.cancel_requested — a cancel was requested on a chosen wire path (FR17, C8).
#McpCallCancelRequestedEvent: {
	type:     "mcp.call.cancel_requested"
	envelope: #McpEventEnvelope
	detail:   #CancelRequestedDetail
}
