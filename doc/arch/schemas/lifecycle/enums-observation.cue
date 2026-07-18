// DDD role: ValueObject
// Package: lifecycle.enums
// Observation, usage-provenance, hierarchy and admission enums.

package lifecycle.enums

// UsageProvenance marks whether usage is estimated or provider-reported (C21).
#UsageProvenance: "estimated" | "reported"

// UsageSource names the origin of a usage measurement (C21).
#UsageSource: "provider" | "runtime" | "local_estimate"

// ActivityKind is the allowlisted card-activity vocabulary; no raw paths reach the renderer (FR56).
#ActivityKind: "read" | "edit" | "run_command" | "search" | "waiting" | "generating" | "settling"

// HierarchyRole is reused verbatim from Feature 001 (C15).
#HierarchyRole: "architect" | "manager" | "worker"

// ValidationOutcome is reused verbatim from Feature 001 (C15).
#ValidationOutcome: "passed" | "failed" | "low_confidence" | "escalated"

// WatchdogOutcome names lease/reconciliation results without claiming a provider stopped (C12).
#WatchdogOutcome: "owner_lost" | "zombie_detected" | "unknown" | "reconciled"

// AdmissionScope is the per-scope token-bucket budget dimension (C11, FR31).
#AdmissionScope: "global" | "root" | "session" | "child" | "provider" | "agent" | "tool" | "event_queue" | "otel_queue" | "sqlite" | "token" | "cost"

// AdmissionDecision is the projected admission outcome (C11).
#AdmissionDecision: "granted" | "partial" | "queued" | "rejected"

// ObservationKind selects the observation API surface (C14).
#ObservationKind: "session" | "process" | "tree" | "global"
