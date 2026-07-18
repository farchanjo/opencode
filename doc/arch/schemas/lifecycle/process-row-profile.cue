// DDD role: ValueObject
// Package: lifecycle.row
// Classification, model, usage, outcome and telemetry sub-objects (FR26).
// TaskClassName/ProfileName/EffortName mirror Feature 001 vocabularies by value.

package lifecycle.row

import (
	"lifecycle/ids"
	"lifecycle/enums"
	"lifecycle/usage"
)

// TaskClassName mirrors routing.enums.#TaskClass; re-declared, not cross-imported.
#TaskClassName: string & !~"^$"

// ProfileName mirrors routing.enums.#RoutingProfile.
#ProfileName: string & !~"^$"

// EffortName mirrors routing.enums.#TaskEffort / #ReasoningEffort.
#EffortName: string & !~"^$"

// RowClassification carries agent identity, task class, profile and effort.
#RowClassification: {
	agent_name:       ids.#AgentName
	agent_kind:       enums.#AgentKind
	task_class:       #TaskClassName
	profile:          #ProfileName
	task_effort:      #EffortName
	reasoning_effort: #EffortName
}

// RowModel carries the provider, model and variant descriptors.
#RowModel: {
	provider: ids.#ProviderName
	model:    ids.#ModelId
	variant:  ids.#VariantName | null
}

// RowUsage carries live usage plus TTFT/stream/total durations.
#RowUsage: {
	usage:     usage.#LiveUsage
	ttft_ms:   ids.#DurationMs | null
	stream_ms: ids.#DurationMs | null
	total_ms:  ids.#DurationMs | null
}

// RowOutcome carries cancellation, exit and error reasons.
#RowOutcome: {
	cancel_outcome: enums.#CancelOutcome | null
	exit_reason:    ids.#Reason | null
	error_reason:   ids.#Reason | null
}

// RowTelemetry carries trace/span ids and a bounded output reference (C18, C20).
#RowTelemetry: {
	trace_id:   ids.#TraceId | null
	span_id:    ids.#SpanId | null
	output_ref: ids.#OutputRef | null
}
