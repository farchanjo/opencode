export * as EventsServer from "./events-server"

import { Schema } from "effect"
import { EnumsEvent } from "./enums-event"
import { Enums } from "./enums"
import { EnumsState } from "./enums-state"
import { Envelope } from "./envelope"
import { TextValues } from "./text-values"

// Mirrors doc/arch/schemas/mcp/events-server.cue one-to-one — the durable server- and
// catalog-plane event members (FR38, C3). Server status, capabilities change,
// tools_changed and resources_changed persist to EventV2/EventBus for reindex and
// audit correlation and never carry content (FR38, FR56, C3, C26). The canonical id is
// mcp.tools_changed — a single spelling that FR38, the schema literal, and the Feature
// 009 reindex trigger share (C3). A capabilities change is emitted only on a
// recorded-set diff after reconnect (C2). No member carries content or a path.

// ServerStatusDetail carries the additive status and the typed capability gap (FR7, C2).
export const ServerStatusDetail = Schema.Struct({
  status: EnumsState.ServerStatus,
  gap: Enums.CapabilityGap,
}).annotate({ identifier: "McpEvent.ServerStatusDetail" })
export type ServerStatusDetail = Schema.Schema.Type<typeof ServerStatusDetail>

// CapabilitiesChangedDetail carries the negotiated protocol version and a bounded reason (FR7, C2).
export const CapabilitiesChangedDetail = Schema.Struct({
  protocol_version: TextValues.ProtocolVersion,
  reason: TextValues.Reason,
}).annotate({ identifier: "McpEvent.CapabilitiesChangedDetail" })
export type CapabilitiesChangedDetail = Schema.Schema.Type<typeof CapabilitiesChangedDetail>

// CatalogChangedDetail carries the catalog kind a list_changed refresh refers to (FR11, FR22, C4).
export const CatalogChangedDetail = Schema.Struct({
  kind: EnumsEvent.CatalogKind,
}).annotate({ identifier: "McpEvent.CatalogChangedDetail" })
export type CatalogChangedDetail = Schema.Schema.Type<typeof CatalogChangedDetail>

// mcp.server.status — a server's additive status changed (FR38, C3).
export const McpServerStatusEvent = Schema.Struct({
  type: Schema.Literal("mcp.server.status"),
  envelope: Envelope.McpEventEnvelope,
  detail: ServerStatusDetail,
}).annotate({ identifier: "McpEvent.McpServerStatusEvent" })
export type McpServerStatusEvent = Schema.Schema.Type<typeof McpServerStatusEvent>

// mcp.server.capabilities_changed — the recorded capability set differed on reconnect (FR38, C2).
export const McpCapabilitiesChangedEvent = Schema.Struct({
  type: Schema.Literal("mcp.server.capabilities_changed"),
  envelope: Envelope.McpEventEnvelope,
  detail: CapabilitiesChangedDetail,
}).annotate({ identifier: "McpEvent.McpCapabilitiesChangedEvent" })
export type McpCapabilitiesChangedEvent = Schema.Schema.Type<typeof McpCapabilitiesChangedEvent>

// mcp.tools_changed — the tool catalog was refreshed; single canonical spelling (FR38, C3).
export const McpToolsChangedEvent = Schema.Struct({
  type: Schema.Literal("mcp.tools_changed"),
  envelope: Envelope.McpEventEnvelope,
  detail: CatalogChangedDetail,
}).annotate({ identifier: "McpEvent.McpToolsChangedEvent" })
export type McpToolsChangedEvent = Schema.Schema.Type<typeof McpToolsChangedEvent>

// mcp.resources_changed — the resource catalog was refreshed under the permission model (FR22, C4).
export const McpResourcesChangedEvent = Schema.Struct({
  type: Schema.Literal("mcp.resources_changed"),
  envelope: Envelope.McpEventEnvelope,
  detail: CatalogChangedDetail,
}).annotate({ identifier: "McpEvent.McpResourcesChangedEvent" })
export type McpResourcesChangedEvent = Schema.Schema.Type<typeof McpResourcesChangedEvent>
