export * as Observation from "./observation"

import { Schema } from "effect"
import { Enums } from "./enums"
import { EnumsObservation } from "./enums-observation"
import { Events } from "./events"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/observation.cue — read-only observation
// payloads over Effect Stream/PubSub with scoped finalizers (C14). Authorization
// and redaction run before delivery; an Observable never controls lifecycle
// state and never mutates a row (FR16, FR17, FR18).

// ObservationScope selects the authorized surface; global requires the
// global_privileged visibility (C14).
export const ObservationScope = Schema.Struct({
  kind: EnumsObservation.ObservationKind,
  session_id: Schema.NullOr(Ids.SessionId),
  process_id: Schema.NullOr(Ids.ProcessId),
  root_session_id: Schema.NullOr(Ids.RootSessionId),
  visibility: Enums.Visibility,
}).annotate({ identifier: "LifecycleObservation.ObservationScope" })
export type ObservationScope = Schema.Schema.Type<typeof ObservationScope>

// ObservationFilter bounds a subscription by scope and event types; an empty
// event_types list means all authorized types.
export const ObservationFilter = Schema.Struct({
  scope: ObservationScope,
  event_types: Schema.Array(Enums.LifecycleEventType),
  include_terminal: Schema.Boolean,
}).annotate({ identifier: "LifecycleObservation.ObservationFilter" })
export type ObservationFilter = Schema.Schema.Type<typeof ObservationFilter>

// AnomalyRecord surfaces a projection anomaly; terminal state is never invented
// (C9, FR29).
export const AnomalyRecord = Schema.Struct({
  kind: EnumsObservation.AnomalyKind,
  process_id: Ids.ProcessId,
  reason: Values.Reason,
}).annotate({ identifier: "LifecycleObservation.AnomalyRecord" })
export type AnomalyRecord = Schema.Schema.Type<typeof AnomalyRecord>

// ObservationResult is one delivered, already-authorized and redacted event
// plus a nullable projection anomaly (C14, C9).
export const ObservationResult = Schema.Struct({
  scope: ObservationScope,
  event: Events.LifecycleEvent,
  anomaly: Schema.NullOr(AnomalyRecord),
}).annotate({ identifier: "LifecycleObservation.ObservationResult" })
export type ObservationResult = Schema.Schema.Type<typeof ObservationResult>
