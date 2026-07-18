// DDD role: ValueObject
// Package: routing.capability
// Tool capability dimensions, hard-gate resolution, and capability records.

package routing.capability

import "routing/ids"

// ToolCapabilityValue represents the value of a capability dimension.
// Uses a closed union — no bare unconstrained value.
#ToolCapabilityValue: bool | uint | null

// ToolCallDimensions captures all seven capability dimensions.
// null = unknown; the schema constrains each to its real type.
#ToolCallDimensions: {
	// Does the model support tool calls at all?
	tool_call_present: bool | null

	// Maximum tool calls allowed in a single turn (null = unknown).
	max_calls_per_turn: uint | null

	// Can the model call multiple tools in the same turn?
	same_turn_multiple_calls: bool | null

	// Does the runner execute tools serially (one at a time)?
	serial_runner_execution: bool | null

	// Can multiple tools be called in parallel?
	parallel_calls: bool | null

	// After a tool result, can the model continue without a new user turn?
	continuation_after_tool_result: bool | null

	// Can the model handle multi-turn tool cycles?
	multi_turn_cycles: bool | null
}

// CapabilitySource distinguishes declared vs observed metadata.
#CapabilitySource: "catalog" | "override" | "observed"

// CapabilityIdentity locates a capability record by provider coordinates.
#CapabilityIdentity: {
	provider: ids.#ProviderName
	model:    ids.#ModelId
	variant:  ids.#VariantName
	api:      ids.#ApiFamily // normalised API family
}

// CapabilityAssessment holds the resolved dimensions and their trust.
#CapabilityAssessment: {
	dimensions: #ToolCallDimensions
	source:     #CapabilitySource
	// 0.0–1.0 confidence that this capability record is accurate.
	confidence: float & >=0.0 & <=1.0
}

// CapabilityFreshness records recency and granularity of a capability record.
#CapabilityFreshness: {
	timestamp: ids.#Timestamp // ISO 8601
	ttl_ms:    uint & >0
	// Granularity scope (e.g. "provider/model" or "provider/model/variant").
	scope: ids.#Scope
}

// CapabilityRecord holds resolved tool capability for a provider/model/variant.
#CapabilityRecord: {
	identity:   #CapabilityIdentity
	assessment: #CapabilityAssessment
	freshness:  #CapabilityFreshness
}

// CapabilityMismatch records a hard-gate failure for a single dimension.
#CapabilityMismatch: {
	dimension:       ids.#CapabilityDimension
	requirement:     ids.#Requirement
	candidate_value: #ToolCapabilityValue
	reason:          ids.#Reason
	scope:           ids.#Scope
	outcome:         "hard_gate_reject" | "serialization" | "fallback"
}
