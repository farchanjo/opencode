export * as Envelope from "./envelope"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { EnumsEvent } from "./enums-event"
import { EnumsState } from "./enums-state"
import { EventTypes } from "./event-types"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/envelope.cue and envelope-parts.cue one-to-one.
// SemanticEnvelope is the common carrier on every semantic.* event (C22). It is a
// ValueObject: the identifiable message is the semantic.* event member that carries
// it; the envelope holds only the EventV2-assigned event_id as a value. It is
// content-free per ADR-0001 — bounded enums, opaque ids and redacted key/value
// metadata only, never query text, vectors, prompts, reasoning, or paths (FR42,
// C22). Per-aggregate ordering groups by correlation_id — the same key EventV2 reads
// at publish time (C22). An actor is runtime or operator; an LLM never administers
// (FR31, C15).

// EventKind carries the event type, schema version, class, source, actor and visibility (C22).
export const EventKind = Schema.Struct({
  event_type: EventTypes.SemanticEventType,
  schema_version: Values.SchemaVersion,
  event_class: EnumsEvent.EventClass,
  source: EnumsEvent.EventSource,
  actor_kind: EnumsEvent.ActorKind,
  visibility: EnumsState.Visibility,
}).annotate({ identifier: "SemanticEnvelope.EventKind" })
export type EventKind = Schema.Schema.Type<typeof EventKind>

// EventSubject carries the binding/generation/collection/project identity; no path appears (FR17, C22).
export const EventSubject = Schema.Struct({
  binding_id: Schema.NullOr(Ids.BindingId),
  generation_id: Schema.NullOr(Ids.GenerationId),
  collection: Schema.NullOr(EnumsState.Collection),
  project_id: Ids.ProjectId,
}).annotate({ identifier: "SemanticEnvelope.EventSubject" })
export type EventSubject = Schema.Schema.Type<typeof EventSubject>

// Ordering carries the per-aggregate sequence, correlation and causation (C22).
export const Ordering = Schema.Struct({
  sequence: Values.Sequence,
  correlation_id: Correlation.CorrelationId,
  causation_id: Schema.NullOr(Correlation.CausationId),
}).annotate({ identifier: "SemanticEnvelope.Ordering" })
export type Ordering = Schema.Schema.Type<typeof Ordering>

// Delivery carries the visibility, timestamp and redacted metadata; no content or secrets (FR42, C22).
export const Delivery = Schema.Struct({
  visibility: EnumsState.Visibility,
  timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "SemanticEnvelope.Delivery" })
export type Delivery = Schema.Schema.Type<typeof Delivery>

// SemanticEnvelope carries typed identity, ordering and delivery context for one semantic.* event (C22).
export const SemanticEnvelope = Schema.Struct({
  event_id: Ids.EventId,
  kind: EventKind,
  subject: EventSubject,
  ordering: Ordering,
  delivery: Delivery,
}).annotate({ identifier: "SemanticEnvelope.SemanticEnvelope" })
export type SemanticEnvelope = Schema.Schema.Type<typeof SemanticEnvelope>
