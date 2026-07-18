export * as EventDefinitions from "./event-definitions"

import type { Definition } from "../event"
import { Event } from "../event"
import { EventsDurable } from "./events-durable"
import { EventsLive } from "./events-live"
import { Ids } from "./ids"

// Feature 002 / T014-T015 — one `EventV2.define` Definition per lifecycle
// member (FR20), mirroring the Feature 001 routing pattern
// (`dataFields(Member.fields)`, no raw tagged union wired to the bus; C2).
//
// Defined at the SCHEMA layer (not `packages/core/src/lifecycle/event-bus.ts`)
// because the eleven durable members must join the canonical `Durable`
// inventory in `durable-event-manifest.ts`, and the schema package can never
// depend on `packages/core` (core depends on schema, never the reverse — see
// `packages/core/package.json` workspace dependency). `event-bus.ts`
// re-exports these Definitions for the domain engine; there is exactly one
// copy of the wire shape per member (C2, C4).
//
// Durable-aggregate wiring (C8): `packages/core/src/event.ts`
// `commitDurableEvent` reads the aggregate id from a TOP-LEVEL key on the
// published `data` object named by `durable.aggregate` — mirroring the
// existing `sessionID` top-level aggregate field convention in
// `session-event.ts`. Every durable member's schema therefore carries an
// explicit top-level `root_process_id` field in addition to the nested
// `envelope`/`detail` payload; `envelope.process.root_process_id` stays the
// single source of truth and `toDurableData` below projects it onto the
// top-level key at publish time (no duplicated authority).

function dataFields<T extends { readonly type: unknown }>(fields: T): Omit<T, "type"> {
  const { type: _drop, ...rest } = fields
  return rest
}

const DURABLE = { version: 1, aggregate: "root_process_id" } as const

// --- Durable members (eleven; C4, C5) -------------------------------------

export const AdmittedDefinition = Event.define({
  type: "lifecycle.admitted",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.AdmittedEvent.fields), root_process_id: Ids.RootProcessId },
})
export const ParentAttachedDefinition = Event.define({
  type: "lifecycle.parent_attached",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.ParentAttachedEvent.fields), root_process_id: Ids.RootProcessId },
})
export const ProcessCreatedDefinition = Event.define({
  type: "lifecycle.process_created",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.ProcessCreatedEvent.fields), root_process_id: Ids.RootProcessId },
})
export const StartedDefinition = Event.define({
  type: "lifecycle.started",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.StartedEvent.fields), root_process_id: Ids.RootProcessId },
})
export const HandoffDefinition = Event.define({
  type: "lifecycle.handoff",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.HandoffEvent.fields), root_process_id: Ids.RootProcessId },
})
export const ReconciledDefinition = Event.define({
  type: "lifecycle.reconciled",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.ReconciledEvent.fields), root_process_id: Ids.RootProcessId },
})
export const CompletedDefinition = Event.define({
  type: "lifecycle.completed",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.CompletedEvent.fields), root_process_id: Ids.RootProcessId },
})
export const FailedDefinition = Event.define({
  type: "lifecycle.failed",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.FailedEvent.fields), root_process_id: Ids.RootProcessId },
})
export const CancelledDefinition = Event.define({
  type: "lifecycle.cancelled",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.CancelledEvent.fields), root_process_id: Ids.RootProcessId },
})
export const ZombieDetectedDefinition = Event.define({
  type: "lifecycle.zombie_detected",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.ZombieDetectedEvent.fields), root_process_id: Ids.RootProcessId },
})
export const OwnerLostDefinition = Event.define({
  type: "lifecycle.owner_lost",
  durable: DURABLE,
  schema: { ...dataFields(EventsDurable.OwnerLostEvent.fields), root_process_id: Ids.RootProcessId },
})

/** The eleven durable member Definitions, in vocabulary order (C4, C5). */
export const DurableDefinitions: ReadonlyArray<Definition> = [
  AdmittedDefinition,
  ParentAttachedDefinition,
  ProcessCreatedDefinition,
  StartedDefinition,
  HandoffDefinition,
  ReconciledDefinition,
  CompletedDefinition,
  FailedDefinition,
  CancelledDefinition,
  ZombieDetectedDefinition,
  OwnerLostDefinition,
]

// --- Live members (fifteen; C4) -------------------------------------------

export const QueuedDefinition = Event.define({
  type: "lifecycle.queued",
  schema: dataFields(EventsLive.QueuedEvent.fields),
})
export const WaitingDefinition = Event.define({
  type: "lifecycle.waiting",
  schema: dataFields(EventsLive.WaitingEvent.fields),
})
export const PromotedDefinition = Event.define({
  type: "lifecycle.promoted",
  schema: dataFields(EventsLive.PromotedEvent.fields),
})
export const ExtendedDefinition = Event.define({
  type: "lifecycle.extended",
  schema: dataFields(EventsLive.ExtendedEvent.fields),
})
export const TurnStartedDefinition = Event.define({
  type: "lifecycle.turn_started",
  schema: dataFields(EventsLive.TurnStartedEvent.fields),
})
export const TurnEndedDefinition = Event.define({
  type: "lifecycle.turn_ended",
  schema: dataFields(EventsLive.TurnEndedEvent.fields),
})
export const TurnFailedDefinition = Event.define({
  type: "lifecycle.turn_failed",
  schema: dataFields(EventsLive.TurnFailedEvent.fields),
})
export const UnknownDefinition = Event.define({
  type: "lifecycle.unknown",
  schema: dataFields(EventsLive.UnknownEvent.fields),
})
export const SteerRequestedDefinition = Event.define({
  type: "lifecycle.steer_requested",
  schema: dataFields(EventsLive.SteerRequestedEvent.fields),
})
export const SteerAcceptedDefinition = Event.define({
  type: "lifecycle.steer_accepted",
  schema: dataFields(EventsLive.SteerAcceptedEvent.fields),
})
export const SteerRejectedDefinition = Event.define({
  type: "lifecycle.steer_rejected",
  schema: dataFields(EventsLive.SteerRejectedEvent.fields),
})
export const CancelRequestedDefinition = Event.define({
  type: "lifecycle.cancel_requested",
  schema: dataFields(EventsLive.CancelRequestedEvent.fields),
})
export const CancellingDefinition = Event.define({
  type: "lifecycle.cancelling",
  schema: dataFields(EventsLive.CancellingEvent.fields),
})
export const ToolCalledDefinition = Event.define({
  type: "lifecycle.tool_called",
  schema: dataFields(EventsLive.ToolCalledEvent.fields),
})
export const ToolSettledDefinition = Event.define({
  type: "lifecycle.tool_settled",
  schema: dataFields(EventsLive.ToolSettledEvent.fields),
})

/** The fifteen live member Definitions, in vocabulary order (C4). */
export const LiveDefinitions: ReadonlyArray<Definition> = [
  QueuedDefinition,
  WaitingDefinition,
  PromotedDefinition,
  ExtendedDefinition,
  TurnStartedDefinition,
  TurnEndedDefinition,
  TurnFailedDefinition,
  UnknownDefinition,
  SteerRequestedDefinition,
  SteerAcceptedDefinition,
  SteerRejectedDefinition,
  CancelRequestedDefinition,
  CancellingDefinition,
  ToolCalledDefinition,
  ToolSettledDefinition,
]

/** All twenty-six lifecycle member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = [...DurableDefinitions, ...LiveDefinitions]

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = new Map(Definitions.map((definition) => [definition.type, definition]))
