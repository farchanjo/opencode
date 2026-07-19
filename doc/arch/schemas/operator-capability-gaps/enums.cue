// DDD role: ValueObject
// Package: operator_capability_gaps.enums
// Bounded enums for the Feature 017 closure of the implementable operator
// capability gaps: the closable gap domains wired now over shipped machinery,
// the deferred gaps that stay typed capability gaps by design, the typed gap
// kinds a verb degrades to, the backend readiness classes, the MCP mutation
// commit paths, the OutputSpool writer lifecycle phases, and the operator-TUI
// field-input kinds the multi-field edit modal renders. Feature 007 stays the
// sole command-registration authority; no id is added and no catalog version is
// bumped (FR17).

package operator_capability_gaps.enums

// ClosableGapDomain is the closed set of gap domains this feature wires now over machinery that already exists (FR1, FR6, FR11, FR13).
#ClosableGapDomain: "mcp" | "output" | "jobs" | "semantic"

// DeferredGapDomain is the closed set of edges that stay typed capability gaps by design — an unreachable live dependency (FR16).
#DeferredGapDomain: "jobs_run_now" | "lifecycle_cancel" | "smart_routing"

// ServiceGap is the typed capability gap a verb degrades to when its live dependency is unreachable; never fabricated (FR2, FR14, FR18).
#ServiceGap: "unavailable" | "mcp_unavailable" | "milvus_unavailable" | "executor_unavailable"

// BackendReadiness records how far a gap domain's backend is wired: live, mixed, or a deferred typed gap (FR13, FR15, FR16).
#BackendReadiness: "live" | "mixed" | "capability_gap"

// McpCommitPath distinguishes the config-backed mutation_plan commit, the live-service action plan, and the retired self_commit_query trap (FR3, FR4, FR5).
#McpCommitPath: "mutation_plan_config" | "live_action_plan" | "self_commit_query"

// McpAuthVerdict records the headless verdict for an MCP auth verb: the interactive OAuth flow stays gapped, a local clear converts (FR5).
#McpAuthVerdict: "headless_convertible" | "interactive_gap"

// WriterPhase is one step of the OutputSpool production writer lifecycle from subscribe through seal/abort; fenced is the stale-generation reject (FR6, FR10).
#WriterPhase: "subscribed" | "generation_open" | "appending" | "sealed" | "aborted" | "fenced"

// MutationOutcome is the typed envelope a mutation resolves to; never a fabricated success (FR3, FR18).
#MutationOutcome: "success" | "version_conflict" | "invalid_argument" | "unauthorized" | "unavailable"
