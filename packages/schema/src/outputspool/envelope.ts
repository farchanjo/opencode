export * as Envelope from "./envelope"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { EventTypes } from "./event-types"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/envelope.cue and envelope-parts.cue
// one-to-one. OutputEnvelope is the common carrier on every output.* event (C20).
// It is a ValueObject: the identifiable message is the output.* event member that
// carries it; the envelope holds only the EventV2-assigned event_id as a value.
// Content-free per ADR-0001 — only bounded enums, opaque ids and redacted
// key/value metadata; never file text, diff, prompt, message, path, snippet,
// reasoning or tool payload (FR5, C22). Per-aggregate ordering groups by
// correlation_id — the same key EventV2 reads at publish time (C20).

// EventKind carries the event type, schema version, class, source, actor and visibility.
export const EventKind = Schema.Struct({
  event_type: EventTypes.OutputEventType,
  schema_version: Values.SchemaVersion,
  event_class: EnumsEvent.EventClass,
  source: EnumsEvent.EventSource,
  actor_kind: EnumsEvent.ActorKind,
  visibility: EnumsEvent.Visibility,
}).annotate({ identifier: "OutputSpoolEnvelope.EventKind" })
export type EventKind = Schema.Schema.Type<typeof EventKind>

// EventSubject carries group/output/channel/generation identity; no path is ever present (FR12, C18).
export const EventSubject = Schema.Struct({
  group_id: Ids.GroupId,
  output_ref: Schema.NullOr(Ids.OutputRef),
  channel: Schema.NullOr(Enums.Channel),
  generation: Values.Generation,
}).annotate({ identifier: "OutputSpoolEnvelope.EventSubject" })
export type EventSubject = Schema.Schema.Type<typeof EventSubject>

// Ordering carries per-aggregate sequence, correlation and causation (C20).
export const Ordering = Schema.Struct({
  sequence: Values.Sequence,
  correlation_id: Correlation.CorrelationId,
  causation_id: Schema.NullOr(Correlation.CausationId),
}).annotate({ identifier: "OutputSpoolEnvelope.Ordering" })
export type Ordering = Schema.Schema.Type<typeof Ordering>

// Delivery carries visibility, timestamp and redacted metadata; no secrets or payloads (FR5, C22).
export const Delivery = Schema.Struct({
  visibility: EnumsEvent.Visibility,
  timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "OutputSpoolEnvelope.Delivery" })
export type Delivery = Schema.Schema.Type<typeof Delivery>

// OutputEnvelope carries typed identity, ordering and delivery context for one output.* event (C20).
export const OutputEnvelope = Schema.Struct({
  event_id: Ids.EventId,
  kind: EventKind,
  subject: EventSubject,
  ordering: Ordering,
  delivery: Delivery,
}).annotate({ identifier: "OutputSpoolEnvelope.OutputEnvelope" })
export type OutputEnvelope = Schema.Schema.Type<typeof OutputEnvelope>
