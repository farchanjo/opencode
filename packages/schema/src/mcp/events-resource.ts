export * as EventsResource from "./events-resource"

import { Schema } from "effect"
import { EnumsState } from "./enums-state"
import { Envelope } from "./envelope"
import { Ids } from "./ids"
import { Uri } from "./uri"
import { Values } from "./values"

// Mirrors doc/arch/schemas/mcp/events-resource.cue one-to-one — the durable
// resource-plane event members (FR38, C3). A resource update and a subscription
// grant/revoke persist for reindex and audit correlation (FR38, C3). resources/updated
// is coalesced/deduped/debounced into a bounded queue and emits mcp.resource_updated
// with a per-aggregate sequence — notify and cache only, with no automatic re-read,
// reindex, or wake (FR23, FR24, C9). Subscribe/unsubscribe require the server
// capability plus an operator grant; the LLM never subscribes (FR21, C10). No member
// carries content or a path (FR38, FR56).

// ResourceUpdatedDetail carries the updated resource URI and the coalesced sequence (FR23, C9).
export const ResourceUpdatedDetail = Schema.Struct({
  resource_uri: Uri.ResourceUri,
  sequence: Values.Sequence,
}).annotate({ identifier: "McpEvent.ResourceUpdatedDetail" })
export type ResourceUpdatedDetail = Schema.Schema.Type<typeof ResourceUpdatedDetail>

// SubscriptionDetail carries the subscription id and its machine state (FR21, C10).
export const SubscriptionDetail = Schema.Struct({
  subscription_id: Ids.SubscriptionId,
  state: EnumsState.SubscriptionState,
}).annotate({ identifier: "McpEvent.SubscriptionDetail" })
export type SubscriptionDetail = Schema.Schema.Type<typeof SubscriptionDetail>

// mcp.resource_updated — a subscribed resource signalled an update under the notify-cache policy (FR23, C9).
export const McpResourceUpdatedEvent = Schema.Struct({
  type: Schema.Literal("mcp.resource_updated"),
  envelope: Envelope.McpEventEnvelope,
  detail: ResourceUpdatedDetail,
}).annotate({ identifier: "McpEvent.McpResourceUpdatedEvent" })
export type McpResourceUpdatedEvent = Schema.Schema.Type<typeof McpResourceUpdatedEvent>

// mcp.subscription.subscribed — an operator grant activated a subscription (FR21, C10).
export const McpSubscriptionSubscribedEvent = Schema.Struct({
  type: Schema.Literal("mcp.subscription.subscribed"),
  envelope: Envelope.McpEventEnvelope,
  detail: SubscriptionDetail,
}).annotate({ identifier: "McpEvent.McpSubscriptionSubscribedEvent" })
export type McpSubscriptionSubscribedEvent = Schema.Schema.Type<typeof McpSubscriptionSubscribedEvent>

// mcp.subscription.unsubscribed — an operator unsubscribe released a subscription (FR21, C10).
export const McpSubscriptionUnsubscribedEvent = Schema.Struct({
  type: Schema.Literal("mcp.subscription.unsubscribed"),
  envelope: Envelope.McpEventEnvelope,
  detail: SubscriptionDetail,
}).annotate({ identifier: "McpEvent.McpSubscriptionUnsubscribedEvent" })
export type McpSubscriptionUnsubscribedEvent = Schema.Schema.Type<typeof McpSubscriptionUnsubscribedEvent>
