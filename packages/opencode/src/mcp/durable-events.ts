/**
 * Feature 008 / T037 (S23) — the durable/live `mcp.*` event projection.
 *
 * Projects one member of the closed 15-member `mcp.*` vocabulary onto its EventV2
 * wire `Definition` and publish payload for the `publishMcpEvent` boundary added to
 * `packages/opencode/src/event-v2-bridge.ts` (mirroring `publishSemanticEvent`:
 * location attach, single publish boundary). The TEN durable members carry a
 * top-level `correlation_id` projected from `envelope.ordering.correlation_id` — the
 * durable aggregate key EventV2 commits on — and replay through `readAggregate`; the
 * FIVE live signals (`mcp.call.started`/`mcp.call.progress`/
 * `mcp.call.cancel_requested`/`mcp.task.status`/`mcp.log`) omit it, ride the bounded
 * live channel, and MAY be dropped under `allBounded` load without affecting durable
 * connection/catalog/subscription state (C3, C26). Every payload is content-free —
 * opaque ids and redacted metadata only, never a body, URI-as-content, secret, or
 * path (FR38, FR56, C3, C26).
 *
 * The wire `Definition`s are the single copies authored at the schema layer
 * (`@opencode-ai/schema/mcp/event-definitions`, T009); this module never redefines
 * them and no second event channel is introduced.
 */
export * as McpDurableEvents from "./durable-events"

import { EventDefinitions as McpEventDefinitions } from "@opencode-ai/schema/mcp/event-definitions"
import type { Events as McpEvents } from "@opencode-ai/schema/mcp/events"
import type { Definition } from "@opencode-ai/schema/event"

/** The ten durable member types (carry `correlation_id`, replay). */
export const DURABLE_MCP_TYPES: ReadonlySet<string> = new Set([
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
])

/** The five live signal member types (omit `correlation_id`, droppable under load). */
export const LIVE_MCP_TYPES: ReadonlySet<string> = new Set([
  "mcp.call.started",
  "mcp.call.progress",
  "mcp.call.cancel_requested",
  "mcp.task.status",
  "mcp.log",
])

/** True for a durable member — it commits a sequence and replays (C3). */
export const isDurableMcpEvent = (type: string): boolean => DURABLE_MCP_TYPES.has(type)

/** True for a live signal member — it MAY be dropped under `allBounded` load (C26). */
export const isDroppableUnderLoad = (type: string): boolean => LIVE_MCP_TYPES.has(type)

/** One projected publish: the wire Definition, the content-free data payload, and whether it is durable. */
export interface McpPublishProjection {
  readonly definition: Definition
  readonly data: Record<string, unknown>
  readonly durable: boolean
}

/**
 * Project an `McpEvent` member onto its wire Definition and publish payload. The
 * durable members carry the top-level `correlation_id` (the aggregate key); live
 * members omit it. The `type` discriminant is dropped from the payload (the
 * Definition owns it), mirroring the Feature 006 `publishSemanticEvent` shape.
 */
export const projectForPublish = (event: McpEvents.McpEvent): McpPublishProjection => {
  const definition = McpEventDefinitions.ByType.get(event.type)
  if (!definition) throw new Error(`unknown mcp event type: ${event.type}`)
  const { type: _drop, ...rest } = event
  const durable = isDurableMcpEvent(event.type)
  const data = durable ? { ...rest, correlation_id: event.envelope.ordering.correlation_id } : { ...rest }
  return { definition, data, durable }
}
