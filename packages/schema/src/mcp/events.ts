export * as Events from "./events"

import { Schema } from "effect"
import { EventsCall } from "./events-call"
import { EventsLive } from "./events-live"
import { EventsLog } from "./events-log"
import { EventsResource } from "./events-resource"
import { EventsServer } from "./events-server"

// Mirrors doc/arch/schemas/mcp/envelope.cue (the `#McpEvent` union) one-to-one — the
// closed 15-member tagged union over the mcp.* vocabulary (FR38, C3). Each member and
// its cohesive detail sub-object live in ./events-server, ./events-resource,
// ./events-call, ./events-live and ./events-log (ten durable, five live); the
// per-member EventV2.define Definitions (durable/live split) live in
// ./event-definitions and re-use these member fields, so there is exactly one copy of
// each wire shape (C3). Mirroring Feature 002/003/004/005/006, no raw tagged union is
// wired to the bus. Call settlement carries OutputRef + byte length never a body,
// progress is monotonic metadata only, and no member carries content, URI-as-content,
// a secret, or a path (FR38, FR56, C7, C16, C26).

// McpEvent is the closed 15-member tagged union discriminated on `type` (FR38, C3).
export const McpEvent = Schema.Union([
  // Ten durable members:
  EventsServer.McpServerStatusEvent,
  EventsServer.McpCapabilitiesChangedEvent,
  EventsServer.McpToolsChangedEvent,
  EventsServer.McpResourcesChangedEvent,
  EventsResource.McpResourceUpdatedEvent,
  EventsResource.McpSubscriptionSubscribedEvent,
  EventsResource.McpSubscriptionUnsubscribedEvent,
  EventsCall.McpCallSettledEvent,
  EventsCall.McpCallCancelledEvent,
  EventsCall.McpTaskSettledEvent,
  // Five live members:
  EventsLive.McpCallStartedEvent,
  EventsLive.McpCallProgressEvent,
  EventsLive.McpCallCancelRequestedEvent,
  EventsLog.McpTaskStatusEvent,
  EventsLog.McpLogEvent,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "McpEvent.McpEvent" })
export type McpEvent = Schema.Schema.Type<typeof McpEvent>
