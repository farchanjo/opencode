// DDD role: ValueObject
// Package: mcp.enums
// Core bounded enums for the Feature 008 MCP client — transport kind, trust profile,
// outputSchema-validation mode, content kind, cancellation wire path, typed capability
// gap, task-support mode, log level and provenance class (FR12, FR13a, FR17, FR36,
// C5, C6, C8, C17, C24). The capability gap never hard-fails a session (FR7, C2); tool
// annotations are untrusted unless the trust profile elevates them (FR13a, C6). State,
// event and event-type enums live in enums-state.cue, enums-event.cue and
// event-types.cue. Every enum is a ValueObject.

package mcp.enums

// TransportKind is the closed transport set; Streamable HTTP is preferred, SSE deprecated (FR29, FR31, C14).
#TransportKind: "stdio" | "streamable-http" | "sse"

// TrustProfile gates whether tool annotations inform hints/policy; untrusted default (FR13a, C6).
#TrustProfile: "untrusted" | "elevated"

// OutputSchemaMode is the structuredContent validation posture; tolerant default (FR12, C5).
#OutputSchemaMode: "tolerant" | "strict"

// ContentKind is the closed tools/call content-item type set (FR12, C17).
#ContentKind: "text" | "image" | "audio" | "resource" | "resource_link" | "structured"

// CancelWirePath selects the standard vs task cancellation wire path per child (FR17, FR18, C8).
#CancelWirePath: "notifications_cancelled" | "tasks_cancel"

// CapabilityGap is the typed degradation code; mcp_unavailable never hard-fails (FR7, C1, C2).
#CapabilityGap: "none" | "mcp_unavailable" | "feature_unsupported" | "needs_auth" | "needs_client_registration"

// TaskSupport is a tool's execution.taskSupport mode under the Tasks experiment (FR42, C18).
#TaskSupport: "required" | "optional" | "forbidden"

// LogLevel is the MCP syslog-derived logging-notification level (FR28, C23).
#LogLevel: "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"

// ProvenanceClass classifies content trust at the context boundary; external is untrusted (FR27, C24).
#ProvenanceClass: "trusted" | "external" | "untrusted"
