// DDD role: ValueObject
// Package: mcp.runtime
// The content-free runtime control ValueObjects (FR14, FR17, FR46, FR47, C7, C8, C19,
// C20, C23). A progress report is metadata only — wire progress is monotonic per token,
// it updates the Process Table child and OTEL and never enters LLM turns (FR14, C7). A
// cancellation carries the wire path (standard vs task) and its typed outcome (FR17, C8).
// Sampling carries only the per-agent permission gate — it passes through Smart/budget/
// LangLock unchanged and never bypasses them (FR46, C19). Elicitation always surfaces to
// the operator and the model never silently answers (FR47, C20). A log record is redacted
// under rate limits (FR28, C23). No shape inlines prompt/result content (FR34, C16).

package mcp.runtime

import (
	"mcp/ids"
	"mcp/enums"
	"mcp/values"
)

// ProgressReport is progress metadata only; monotonic wire, never an LLM turn (FR14, FR15, C7).
#ProgressReport: {
	progress_token: ids.#ProgressToken
	request_ref:    ids.#RequestId
	progress:       values.#Progress
	total:          values.#Total | null
	message:        ids.#RedactedText | null
}

// CancellationRequest carries the standard vs task wire path for one request id (FR17, FR18, C8).
#CancellationRequest: {
	request_id: ids.#RequestId
	wire_path:  enums.#CancelWirePath
	reason:     ids.#Reason
}

// CancellationOutcome records local settlement vs unacknowledged remote cancel (FR17, C8).
#CancellationOutcome: {
	request_id: ids.#RequestId
	outcome:    enums.#CancelOutcome
}

// SamplingRequest carries the per-agent permission gate only; passes through Smart/budget (FR46, C19).
#SamplingRequest: {
	server_ref:     ids.#ServerId
	permission_ref: ids.#PermissionRef
	correlation_id: ids.#CorrelationId
}

// SamplingGate records the permission and the approving principal audited on the path (FR46, C19).
#SamplingGate: {
	permission_ref: ids.#PermissionRef
	approved_by:    ids.#OperatorRef
}

// ElicitationRequest always surfaces to the operator; the model never silently answers (FR47, C20).
#ElicitationRequest: {
	server_ref:        ids.#ServerId
	correlation_id:    ids.#CorrelationId
	operator_surfaced: ids.#OperatorSurfaced
}

// ElicitationGate records the operator and whether sensitive-mode blocked a model answer (FR47, C20).
#ElicitationGate: {
	operator_ref:      ids.#OperatorRef
	sensitive_blocked: ids.#SensitiveBlocked
}

// LogRecord is a redacted logging notification under rate limits; native retention (FR28, C23).
#LogRecord: {
	server_ref:   ids.#ServerId
	level:        enums.#LogLevel
	redacted:     ids.#RedactedText
	rate_limited: ids.#RateLimited
}

// LoggingPolicy carries the operator setLevel and the rate-limit window (FR28, C23).
#LoggingPolicy: {
	level:              enums.#LogLevel
	rate_window_millis: values.#DurationMillis
}
