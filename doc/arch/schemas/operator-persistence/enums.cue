// DDD role: ValueObject
// Package: operator_persistence.enums
// Bounded enums for the Feature 014 completion of the operator control plane:
// the config-backed domains whose mutations must round-trip persist, the
// service-backed domains whose real backends are wired (or stay typed gaps),
// the config round-trip phases, the backend readiness classes, the typed
// capability gaps, the mutation commit path, and the per-verb persistence class.
// Feature 007 stays the sole command-registration authority; no id is added and
// no catalog version is bumped (FR13).

package operator_persistence.enums

// ConfigBackedDomain is the closed set of domains whose mutations must durably round-trip persist (FR1, FR4).
#ConfigBackedDomain: "langlock" | "telemetry" | "smart" | "budget" | "pools" | "jobs"

// ServiceBackedDomain is the closed set of domains backed by a live service host rather than raw config (FR6, FR7, FR8, FR9, FR10).
#ServiceBackedDomain: "output" | "mcp" | "semantic" | "jobs" | "lifecycle"

// RoundTripPhase is one step of the config write->invalidate->reload->read lifecycle; orphaned/rejected are the honest negatives (FR2, FR3).
#RoundTripPhase: "requested" | "validated" | "written" | "invalidated" | "reloaded" | "persisted" | "orphaned" | "rejected"

// BackendReadiness records how far a domain's backend is wired: live, config-backed, mixed, or a typed capability gap (FR6, FR8, FR12).
#BackendReadiness: "live" | "config_backed" | "mixed" | "capability_gap"

// ServiceGap is the typed capability gap a verb degrades to when its live dependency is unreachable; never fabricated (FR8, FR10, FR14).
#ServiceGap: "unavailable" | "milvus_unavailable" | "mcp_unavailable" | "executor_unavailable"

// MutationCommitPath distinguishes the shared mutation_plan commit from the retired self-committing query pattern (FR5).
#MutationCommitPath: "mutation_plan" | "self_commit_query"

// MutationOutcome is the typed envelope a mutation resolves to; never a fabricated success (FR5, FR14).
#MutationOutcome: "success" | "version_conflict" | "invalid_argument" | "unauthorized" | "unavailable"

// PersistenceClass is the per-verb availability class the grouped TUI derives; partial marks a mixed domain honestly (FR12).
#PersistenceClass: "persists_today" | "partial" | "honest_unavailable"
</content>
