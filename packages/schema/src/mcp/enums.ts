export * as Enums from "./enums"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/enums.cue (package mcp.enums) one-to-one for the core
// bounded enums — transport kind, trust profile, outputSchema-validation mode,
// content kind, cancellation wire path, typed capability gap, task-support mode, log
// level and provenance class (FR12, FR13a, FR17, FR36, C5, C6, C8, C17, C24). The
// capability gap never hard-fails a session (FR7, C2); tool annotations are untrusted
// unless the trust profile elevates them (FR13a, C6). State, event and event-type
// enums live in ./enums-state, ./enums-event and ./event-types. Every enum is a
// ValueObject (calisthenics).

// TransportKind is the closed transport set; Streamable HTTP is preferred, SSE deprecated (FR29, FR31, C14).
export const TransportKind = Schema.Literals(["stdio", "streamable-http", "sse"]).annotate({
  identifier: "McpEnums.TransportKind",
})
export type TransportKind = typeof TransportKind.Type

// TrustProfile gates whether tool annotations inform hints/policy; untrusted default (FR13a, C6).
export const TrustProfile = Schema.Literals(["untrusted", "elevated"]).annotate({
  identifier: "McpEnums.TrustProfile",
})
export type TrustProfile = typeof TrustProfile.Type

// OutputSchemaMode is the structuredContent validation posture; tolerant default (FR12, C5).
export const OutputSchemaMode = Schema.Literals(["tolerant", "strict"]).annotate({
  identifier: "McpEnums.OutputSchemaMode",
})
export type OutputSchemaMode = typeof OutputSchemaMode.Type

// ContentKind is the closed tools/call content-item type set (FR12, C17).
export const ContentKind = Schema.Literals([
  "text",
  "image",
  "audio",
  "resource",
  "resource_link",
  "structured",
]).annotate({ identifier: "McpEnums.ContentKind" })
export type ContentKind = typeof ContentKind.Type

// CancelWirePath selects the standard vs task cancellation wire path per child (FR17, FR18, C8).
export const CancelWirePath = Schema.Literals(["notifications_cancelled", "tasks_cancel"]).annotate({
  identifier: "McpEnums.CancelWirePath",
})
export type CancelWirePath = typeof CancelWirePath.Type

// CapabilityGap is the typed degradation code; mcp_unavailable never hard-fails (FR7, C1, C2).
export const CapabilityGap = Schema.Literals([
  "none",
  "mcp_unavailable",
  "feature_unsupported",
  "needs_auth",
  "needs_client_registration",
]).annotate({ identifier: "McpEnums.CapabilityGap" })
export type CapabilityGap = typeof CapabilityGap.Type

// TaskSupport is a tool's execution.taskSupport mode under the Tasks experiment (FR42, C18).
export const TaskSupport = Schema.Literals(["required", "optional", "forbidden"]).annotate({
  identifier: "McpEnums.TaskSupport",
})
export type TaskSupport = typeof TaskSupport.Type

// LogLevel is the MCP syslog-derived logging-notification level (FR28, C23).
export const LogLevel = Schema.Literals([
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
]).annotate({ identifier: "McpEnums.LogLevel" })
export type LogLevel = typeof LogLevel.Type

// ProvenanceClass classifies content trust at the context boundary; external is untrusted (FR27, C24).
export const ProvenanceClass = Schema.Literals(["trusted", "external", "untrusted"]).annotate({
  identifier: "McpEnums.ProvenanceClass",
})
export type ProvenanceClass = typeof ProvenanceClass.Type
