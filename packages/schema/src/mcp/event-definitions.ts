export * as EventDefinitions from "./event-definitions"

import type { Definition } from "../event"
import { Event } from "../event"
import { EventsCall } from "./events-call"
import { EventsLive } from "./events-live"
import { EventsLog } from "./events-log"
import { EventsResource } from "./events-resource"
import { EventsServer } from "./events-server"
import { Refs } from "./refs"

// Feature 008 / T009 — one `EventV2.define` Definition per mcp.* member (FR38, C3),
// mirroring the Feature 001/002/003/004/005/006 pattern (`dataFields(Member.fields)`,
// no raw tagged union wired to the bus).
//
// Defined at the SCHEMA layer (not `packages/opencode/src/event-v2-bridge.ts`)
// because the ten durable members must be joinable into the canonical `Durable`
// inventory in `durable-event-manifest.ts`, and the schema package can never depend on
// `packages/core`/`packages/opencode` (they depend on schema, never the reverse). The
// application-layer `publishMcpEvent` boundary (Phase 3, T037) re-uses these
// Definitions; there is exactly one copy of the wire shape per member (C3).
//
// Durable-aggregate wiring (C3): `packages/core/src/event.ts` reads the aggregate id
// from a TOP-LEVEL key on the published `data` object named by `durable.aggregate`.
// The content-free mcp.* envelope carries the correlation id inside
// `envelope.ordering.correlation_id`, so every durable member's schema carries an
// explicit top-level `correlation_id` field in addition to the nested
// `envelope`/`detail` payload, and the publish boundary projects
// `envelope.ordering.correlation_id` onto it (no duplicated authority).

function dataFields<T extends { readonly type: unknown }>(fields: T): Omit<T, "type"> {
  const { type: _drop, ...rest } = fields
  return rest
}

const DURABLE = { version: 1, aggregate: "correlation_id" } as const

// --- Durable members (ten; C3) -----------------------------------------------

export const ServerStatusDefinition = Event.define({
  type: "mcp.server.status",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsServer.McpServerStatusEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const CapabilitiesChangedDefinition = Event.define({
  type: "mcp.server.capabilities_changed",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsServer.McpCapabilitiesChangedEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const ToolsChangedDefinition = Event.define({
  type: "mcp.tools_changed",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsServer.McpToolsChangedEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const ResourcesChangedDefinition = Event.define({
  type: "mcp.resources_changed",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsServer.McpResourcesChangedEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const ResourceUpdatedDefinition = Event.define({
  type: "mcp.resource_updated",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsResource.McpResourceUpdatedEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const CallSettledDefinition = Event.define({
  type: "mcp.call.settled",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsCall.McpCallSettledEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const CallCancelledDefinition = Event.define({
  type: "mcp.call.cancelled",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsCall.McpCallCancelledEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const TaskSettledDefinition = Event.define({
  type: "mcp.task.settled",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsCall.McpTaskSettledEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const SubscriptionSubscribedDefinition = Event.define({
  type: "mcp.subscription.subscribed",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsResource.McpSubscriptionSubscribedEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})
export const SubscriptionUnsubscribedDefinition = Event.define({
  type: "mcp.subscription.unsubscribed",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsResource.McpSubscriptionUnsubscribedEvent.fields),
    correlation_id: Refs.CorrelationId,
  },
})

/** The ten durable member Definitions, in vocabulary order (FR38, C3). */
export const DurableDefinitions: ReadonlyArray<Definition> = [
  ServerStatusDefinition,
  CapabilitiesChangedDefinition,
  ToolsChangedDefinition,
  ResourcesChangedDefinition,
  ResourceUpdatedDefinition,
  CallSettledDefinition,
  CallCancelledDefinition,
  TaskSettledDefinition,
  SubscriptionSubscribedDefinition,
  SubscriptionUnsubscribedDefinition,
]

// --- Live members (five; C3) -------------------------------------------------

export const CallStartedDefinition = Event.define({
  type: "mcp.call.started",
  schema: dataFields(EventsLive.McpCallStartedEvent.fields),
})
export const CallProgressDefinition = Event.define({
  type: "mcp.call.progress",
  schema: dataFields(EventsLive.McpCallProgressEvent.fields),
})
export const CallCancelRequestedDefinition = Event.define({
  type: "mcp.call.cancel_requested",
  schema: dataFields(EventsLive.McpCallCancelRequestedEvent.fields),
})
export const TaskStatusDefinition = Event.define({
  type: "mcp.task.status",
  schema: dataFields(EventsLog.McpTaskStatusEvent.fields),
})
export const LogDefinition = Event.define({
  type: "mcp.log",
  schema: dataFields(EventsLog.McpLogEvent.fields),
})

/** The five live member Definitions, in vocabulary order (FR38, C3). */
export const LiveDefinitions: ReadonlyArray<Definition> = [
  CallStartedDefinition,
  CallProgressDefinition,
  CallCancelRequestedDefinition,
  TaskStatusDefinition,
  LogDefinition,
]

/** All fifteen mcp.* member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = [...DurableDefinitions, ...LiveDefinitions]

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = new Map(
  Definitions.map((definition) => [definition.type, definition]),
)
