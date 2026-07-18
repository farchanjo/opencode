export * as Envelope from "./envelope"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { EventTypes } from "./event-types"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/envelope.cue and envelope-parts.cue
// one-to-one. LangLockEnvelope is the common carrier on every langlock.* event
// (C8). It is a ValueObject: the identifiable message is the langlock.* event
// member that carries it; the envelope holds only the EventV2-assigned event_id
// as a value. Content-free per ADR-0001: only bounded enums, opaque execution
// ids, and redacted key/value metadata — never file text, diff, prompt, message,
// path, snippet, reasoning, or tool payload (Security 5, Observability, AC14).

// EventKind carries the event type, schema version, class and emitting source (C8).
export const EventKind = Schema.Struct({
  event_type: EventTypes.LangLockEventType,
  schema_version: Values.SchemaVersion,
  event_class: EnumsEvent.EventClass,
  source: EnumsEvent.EventSource,
}).annotate({ identifier: "LangLockEnvelope.EventKind" })
export type EventKind = Schema.Schema.Type<typeof EventKind>

// ActorContext carries the acting principal, actor kind and scope; no LLM ever administers (FR35, AC13).
export const ActorContext = Schema.Struct({
  actor_kind: EnumsEvent.ActorKind,
  principal: Correlation.Principal,
  scope: Enums.Scope,
}).annotate({ identifier: "LangLockEnvelope.ActorContext" })
export type ActorContext = Schema.Schema.Type<typeof ActorContext>

// Ordering carries per-aggregate sequence, correlation and causation; sequence is per aggregate only (C8).
export const Ordering = Schema.Struct({
  sequence: Values.Sequence,
  correlation_id: Correlation.CorrelationId,
  causation_id: Schema.NullOr(Correlation.CausationId),
}).annotate({ identifier: "LangLockEnvelope.Ordering" })
export type Ordering = Schema.Schema.Type<typeof Ordering>

// Delivery carries the opaque execution correlation, timestamp and redacted metadata (Observability, C8).
// The metadata map holds no prompts, results, tool payloads, paths, or secrets (Security 5).
export const Delivery = Schema.Struct({
  execution_id: Ids.ExecutionId,
  timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "LangLockEnvelope.Delivery" })
export type Delivery = Schema.Schema.Type<typeof Delivery>

// LangLockEnvelope is the common context bundle carried on every langlock.* event (C8).
export const LangLockEnvelope = Schema.Struct({
  event_id: Ids.EventId,
  kind: EventKind,
  actor: ActorContext,
  ordering: Ordering,
  delivery: Delivery,
}).annotate({ identifier: "LangLockEnvelope.LangLockEnvelope" })
export type LangLockEnvelope = Schema.Schema.Type<typeof LangLockEnvelope>
