// DDD role: ValueObject
// Package: operator_result_signal.enums
// Bounded enums for the Feature 012 structured-result projection: the TUI
// consumption of the Feature 007 typed CommandResult.effective payload. They name
// the operator outcome carried on the handled result, the read domains a panel
// projection targets, the projection outcome, and the entity-picker source and
// state. No new dispatch path is introduced; command IDs stay canonical (FR9).

package operator_result_signal.enums

// ResultOutcome mirrors the Feature 007 Operator.Outcome carried on the structured handled result (FR1, FR2).
#ResultOutcome: "success" | "idempotent_replay" | "conflict" | "unauthorized" | "forbidden_scope" | "invalid_argument" | "reserved_name" | "confirmation_required" | "unavailable" | "secret_backend" | "transport_error" | "not_implemented" | "audit_pending"

// ProjectionDomain is the closed set of five read domains whose effective payload projects into a panel signal (FR4, FR5).
#ProjectionDomain: "jobs" | "langlock" | "output" | "semantic" | "mcp"

// ProjectionOutcome records how a panel projection resolved: a valid payload, an honest empty fallback, or a rejected shape (FR4, FR8).
#ProjectionOutcome: "projected" | "empty_fallback" | "shape_mismatch"

// PickerSource is the read query an entity picker loads its options from (FR6).
#PickerSource: "jobs" | "process" | "task"

// PickerState records whether the entity read loaded options, returned none, or was unavailable (FR6, FR8).
#PickerState: "loaded" | "empty" | "unavailable"
