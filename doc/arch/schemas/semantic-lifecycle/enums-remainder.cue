// DDD role: ValueObject
// Package: semantic_lifecycle.enums
// Bounded enums for the remaining Feature 019 residuals: Group C completes the MCP
// delegation edges (interactive-OAuth auth delegation, resource subscription, truthful
// toggle badges) and Group D activates real OTLP telemetry export. Shares the
// semantic_lifecycle.enums package with enums.cue (splitting a package across focused
// files, the corpus precedent). Feature 007 stays the sole command-registration
// authority; every completed verb degrades to a typed capability gap rather than a
// fabricated success (FR-INV).

package semantic_lifecycle.enums

// McpAuthDelegation records the interactive-OAuth completion path a surface takes: an interactive TUI delegates to the loopback authorize/callback flow, a headless surface keeps the honest typed gap (Group C).
#McpAuthDelegation: "interactive_delegated" | "headless_gap"

// McpSubscriptionState is the resource-subscription lifecycle the operator drives over a subscribe-capable MCP client; a client without the capability is a fail-closed honest boundary (Group C).
#McpSubscriptionState: "unsubscribed" | "subscribing" | "subscribed" | "unsubscribing" | "capability_absent"

// ToggleBadge is the truthful render of an Experimental/Extension control row once the mcp status read carries the config-backed flag state; Unknown is retired for a connected server (Group C).
#ToggleBadge: "enabled" | "disabled" | "unknown"

// TelemetryPipelineState is the eager, fail-open OTLP export pipeline's arming outcome; disabled runs no fiber and touches no network (Group D).
#TelemetryPipelineState: "armed" | "disabled" | "fail_open_error"

// TelemetryTransport is the closed OTLP transport the export pipeline binds from the effective config; it matches the shipped telemetry config.cue vocabulary (Group D).
#TelemetryTransport: "http/protobuf" | "grpc"

// TelemetrySignal is the closed OTLP signal vocabulary the pipeline exports when the effective config enables it (Group D).
#TelemetrySignal: "metrics" | "logs" | "traces"

// DropPolicy is the bounded-queue overflow disposition the export pipeline honors so a slow/unreachable collector never blocks the session loop; it matches the shipped BoundedExportQueue vocabulary (Group D).
#DropPolicy: "drop" | "backpressure"

// CapabilityGap is the typed degradation a completed verb returns when a live dependency stays unreachable; never a fabricated success (FR-INV).
#CapabilityGap: "milvus_unavailable" | "embedding_unavailable" | "not_validated" | "mcp_unavailable" | "capability_absent" | "version_conflict" | "invalid_argument"

// BackendReadiness records the availability truth a verb flips to once its dependency is composed; still-gapped verbs stay honest_unavailable (FR-INV).
#BackendReadiness: "live" | "honest_unavailable"
