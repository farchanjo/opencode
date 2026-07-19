export * as EventTypes from "./event-types"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/mcp/event-types.cue (package mcp.enums) one-to-one — the
// closed 15-member mcp.* event vocabulary registered through EventV2/EventBus (FR38,
// C3). The canonical id is `mcp.tools_changed`; the prior schema literal
// `mcp.tools.changed` is renamed to it at implementation so the wire id, FR38, and the
// Feature 009 reindex trigger agree — no dual spelling survives (C3). Ten durable
// members persist for reindex and audit correlation; five live members are coalesced
// and never required to persist (C3). No event carries full content, URIs, or paths
// (FR38, FR56).

// McpEventType is the closed 15-member durable-plus-live mcp.* vocabulary (FR38, C3).
export const McpEventType = Schema.Literals([
  // Ten durable members (persist for reindex and audit correlation):
  "mcp.server.status",
  "mcp.server.capabilities_changed",
  "mcp.tools_changed",
  "mcp.resources_changed",
  "mcp.resource_updated",
  "mcp.call.settled",
  "mcp.call.cancelled",
  "mcp.task.settled",
  "mcp.subscription.subscribed",
  "mcp.subscription.unsubscribed",
  // Five live members (coalesced, droppable under load):
  "mcp.call.started",
  "mcp.call.progress",
  "mcp.call.cancel_requested",
  "mcp.task.status",
  "mcp.log",
]).annotate({ identifier: "McpEnums.McpEventType" })
export type McpEventType = typeof McpEventType.Type
