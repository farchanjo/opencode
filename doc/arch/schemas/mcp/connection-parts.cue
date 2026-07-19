// DDD role: ValueObject
// Package: mcp.connection
// Cohesive sub-objects composed by the McpConnection aggregate (FR7, FR29, C2, C14). The
// reconnect posture carries the bounded exponential backoff with jitter and a capped max
// delay under the attempt count; session resume carries the Last-Event-ID and resume
// support honored where the SDK/spec support them (FR29, C14). A stdio connection has no
// reconnect and restarts under lifecycle control (FR30, C14). No sub-object carries
// content; backoff bounds are provisional plan constants (C14).

package mcp.connection

import (
	"mcp/ids"
	"mcp/values"
)

// ReconnectPosture carries the bounded backoff attempt, delay and cap for Streamable HTTP (FR29, C14).
#ReconnectPosture: {
	attempt:       values.#AttemptCount
	backoff_millis: values.#DurationMillis
	max_attempts:  values.#AttemptCount
}

// SessionResume carries the Last-Event-ID and resume support honored on reconnect (FR29, C14).
#SessionResume: {
	last_event_id:    ids.#Cursor | null
	resume_supported: ids.#Supported
	session_id:       ids.#SessionId | null
}
