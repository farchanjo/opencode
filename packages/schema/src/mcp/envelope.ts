export * as Envelope from "./envelope"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { EnumsEvent } from "./enums-event"
import { EventTypes } from "./event-types"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { Uri } from "./uri"
import { Values } from "./values"

// Mirrors doc/arch/schemas/mcp/envelope.cue one-to-one. McpEventEnvelope is the common
// content-free context bundle carried on every mcp.* event (FR38, C3, C26). It is a
// ValueObject: the identifiable message is the mcp.* event member that carries it. It
// is content-free per ADR-0001 — bounded enums, opaque ids and redacted key/value
// metadata only, never a tool/resource body, URI-as-content, prompt, or filesystem
// path (FR38, FR56, C26). Per-aggregate ordering groups by correlation_id — the same
// key EventV2 reads at publish time (C3). No actor is the LLM (FR48, C25). The
// observational timestamp decodes from epoch millis via DateTimeUtcFromMillis (the CUE
// mirror carries the ISO-8601 form). Members live in ./events-server, ./events-resource,
// ./events-call, ./events-live and ./events-log; the closed union in ./events.

// EventKind carries the event type, schema version, class, source, actor and visibility (FR38, C3).
export const EventKind = Schema.Struct({
  event_type: EventTypes.McpEventType,
  schema_version: Values.SchemaVersion,
  event_class: EnumsEvent.EventClass,
  source: EnumsEvent.EventSource,
  actor_kind: EnumsEvent.ActorKind,
  visibility: EnumsEvent.Visibility,
}).annotate({ identifier: "McpEnvelope.EventKind" })
export type EventKind = Schema.Schema.Type<typeof EventKind>

// EventSubject carries server/connection/request/resource identity; no path is ever present (FR38, FR56).
export const EventSubject = Schema.Struct({
  server_id: Ids.ServerId,
  connection_id: Schema.NullOr(Ids.ConnectionId),
  request_id: Schema.NullOr(Ids.RequestId),
  resource_uri: Schema.NullOr(Uri.ResourceUri),
}).annotate({ identifier: "McpEnvelope.EventSubject" })
export type EventSubject = Schema.Schema.Type<typeof EventSubject>

// Ordering carries per-aggregate sequence, correlation and causation (FR38, C3).
export const Ordering = Schema.Struct({
  sequence: Values.Sequence,
  correlation_id: Refs.CorrelationId,
  causation_id: Schema.NullOr(Refs.CausationId),
}).annotate({ identifier: "McpEnvelope.Ordering" })
export type Ordering = Schema.Schema.Type<typeof Ordering>

// Delivery carries visibility, timestamp and redacted metadata; no content or secrets (FR56, C26).
export const Delivery = Schema.Struct({
  visibility: EnumsEvent.Visibility,
  timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "McpEnvelope.Delivery" })
export type Delivery = Schema.Schema.Type<typeof Delivery>

// McpEventEnvelope carries typed identity, ordering and delivery context for one mcp.* event (FR38, C3).
export const McpEventEnvelope = Schema.Struct({
  event_id: Ids.EventId,
  kind: EventKind,
  subject: EventSubject,
  ordering: Ordering,
  delivery: Delivery,
}).annotate({ identifier: "McpEnvelope.McpEventEnvelope" })
export type McpEventEnvelope = Schema.Schema.Type<typeof McpEventEnvelope>
