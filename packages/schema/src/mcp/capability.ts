export * as Capability from "./capability"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Policy } from "./policy"
import { TextValues } from "./text-values"

// Mirrors doc/arch/schemas/mcp/capability.cue one-to-one. NegotiatedCapabilities is
// the per-server capability set recorded at connect for operator query
// (mcp.server.capabilities) and runtime gating (FR7, FR8, C2). It is a ValueObject
// embedded in the McpConnection aggregate: a capability the server did not advertise
// is never exercised, and reconnect re-runs negotiation and emits
// mcp.server.capabilities_changed on a diff (C2). Experimental client capabilities
// stay off unless the matching per-server flag is enabled (FR8, C18). Recorded caps
// carry no content (FR56, C26). The observational `recorded_at` timestamp decodes from
// epoch millis via DateTimeUtcFromMillis (the CUE mirror carries the ISO-8601 form).

// ToolsCapability records the server tools capability and its listChanged advertisement (FR10, FR11, C4).
export const ToolsCapability = Schema.Struct({
  list_changed: Policy.Capable,
}).annotate({ identifier: "McpCapability.ToolsCapability" })
export type ToolsCapability = Schema.Schema.Type<typeof ToolsCapability>

// ResourcesCapability records the server resources subscribe and listChanged advertisements (FR21, FR22, C10).
export const ResourcesCapability = Schema.Struct({
  subscribe: Policy.Capable,
  list_changed: Policy.Capable,
}).annotate({ identifier: "McpCapability.ResourcesCapability" })
export type ResourcesCapability = Schema.Schema.Type<typeof ResourcesCapability>

// PromptsCapability records the server prompts capability and its listChanged advertisement (FR27, C24).
export const PromptsCapability = Schema.Struct({
  list_changed: Policy.Capable,
}).annotate({ identifier: "McpCapability.PromptsCapability" })
export type PromptsCapability = Schema.Schema.Type<typeof PromptsCapability>

// LoggingCapability records the server logging capability and setLevel support (FR28, C23).
export const LoggingCapability = Schema.Struct({
  set_level: Policy.Capable,
}).annotate({ identifier: "McpCapability.LoggingCapability" })
export type LoggingCapability = Schema.Schema.Type<typeof LoggingCapability>

// ExperimentalCapability records negotiated experimental caps; each off unless flag-enabled (FR8, FR41, C18).
export const ExperimentalCapability = Schema.Struct({
  tasks: Policy.Capable,
  sampling: Policy.Capable,
  elicitation: Policy.Capable,
  content_stream: Policy.Capable,
}).annotate({ identifier: "McpCapability.ExperimentalCapability" })
export type ExperimentalCapability = Schema.Schema.Type<typeof ExperimentalCapability>

// NegotiatedCapabilities is the recorded per-server capability set; unadvertised caps never run (FR7, FR8, C2).
export const NegotiatedCapabilities = Schema.Struct({
  protocol_version: TextValues.ProtocolVersion,
  tools: ToolsCapability,
  resources: ResourcesCapability,
  prompts: PromptsCapability,
  logging: LoggingCapability,
  experimental: ExperimentalCapability,
  recorded_at: DateTimeUtcFromMillis,
}).annotate({ identifier: "McpCapability.NegotiatedCapabilities" })
export type NegotiatedCapabilities = Schema.Schema.Type<typeof NegotiatedCapabilities>
