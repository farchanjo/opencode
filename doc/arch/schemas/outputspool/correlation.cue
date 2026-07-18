// DDD role: ValueObject
// Package: outputspool.shared
// Correlation, principal and reference-edge ValueObjects. All reference axes carry
// opaque handles only; secrets are never raw values and no field is a filesystem
// path (FR12, FR28, Security 5, C5, C22). The reference edges gate ref-aware
// retention: a group is reclaimable only when it holds no inbound edge (C5).

package outputspool.shared

// CorrelationId groups related output.* events across a logical settlement (C20).
#CorrelationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CausationId references the event that directly caused this one (C20).
#CausationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// Principal is the operator/system/manager principal re-evaluated per action (FR47, FR48, C7).
#Principal: string & !~"^$"

// SecretRef is a Feature 007 SecretPort secure reference — never raw secret material (FR5, C22).
#SecretRef: string & !~"^$"

// TranscriptRef is an inbound retention edge from a durable transcript reference (FR33, C5).
#TranscriptRef: string & !~"^$"

// TodoRef is an inbound retention edge from Feature 002 Todo evidence (FR32, C5).
#TodoRef: string & !~"^$"

// HandoffRef is an inbound retention edge from a handoff envelope (FR32, FR34, C5).
#HandoffRef: string & !~"^$"

// NotificationRef is an inbound retention edge from a Feature 003 NotificationEnvelope output_ref (FR39, C5).
#NotificationRef: string & !~"^$"

// RowTelemetryRef is an inbound retention edge from a Feature 002 RowTelemetry.output_ref (FR38, C5).
#RowTelemetryRef: string & !~"^$"

// DecisionId references a Feature 001 routing.decision — parity id (Observability).
#DecisionId: string & =~"^[0-9A-HJKMNP-TV-Z]{26}$"
