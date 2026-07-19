// DDD role: ValueObject
// Package: operator_result_signal.shared
// Bounded text, id, and payload ValueObjects for the Feature 012 structured-result
// projection. The effective payload is the already-bounded, redacted, versioned
// operator-surface projection each domain emits; this feature never widens or
// de-redacts it (Security). No field here carries a secret or free-form command id.

package operator_result_signal.shared

// Version is the opaque Feature 007 CAS version token carried on the handled result; never parsed by the TUI (FR1, FR2, FR3).
#Version: string & !~"^$"

// CommandId is the canonical dotted domain.operation catalog id; unchanged by this feature (FR9).
#CommandId: string & =~"^[a-z][a-z0-9]*(\\.[a-z0-9-]+)+$"

// EntityId is a picker option value taken from a read payload — a jobDefinitionId, processId, or taskId, never a command id (FR6).
#EntityId: string & !~"^$"

// OptionLabel is the human label shown for one picker option; never the raw id alone (FR6).
#OptionLabel: string & !~"^$"

// OptionDetail is the optional secondary line on a picker option row (FR6).
#OptionDetail: string & !~"^$"

// EffectivePayload is the opaque typed domain payload from CommandResult.effective, kept structurally closed at this boundary (FR1, FR4).
#EffectivePayload: {...}
