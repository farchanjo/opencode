export * as EventsLive from "./events-live"

import { Events } from "./events"

// Live-view of the lifecycle vocabulary — mirrors the fifteen live members in
// doc/arch/schemas/lifecycle/events-live.cue and events-live-control.cue (C4).
// Live members omit the durable annotation — no sequence, no replay; they are
// sampling/coalescing targets while terminal events stay durable (C5, FR36).
// The member Structs are authored in events.ts (the authoritative module); this
// module re-exports the live subset and provides a grouping array for the
// EventV2 bus layer, which registers each live member without a durable
// annotation (T014).

// Envelope-only live members (events-live.cue).
export const QueuedEvent = Events.QueuedEvent
export const WaitingEvent = Events.WaitingEvent
export const PromotedEvent = Events.PromotedEvent
export const ExtendedEvent = Events.ExtendedEvent
export const TurnStartedEvent = Events.TurnStartedEvent
export const TurnEndedEvent = Events.TurnEndedEvent
export const TurnFailedEvent = Events.TurnFailedEvent
export const UnknownEvent = Events.UnknownEvent

// Steer, cancel-intent and tool-boundary live members (events-live-control.cue).
export const SteerRequestedEvent = Events.SteerRequestedEvent
export const SteerAcceptedEvent = Events.SteerAcceptedEvent
export const SteerRejectedEvent = Events.SteerRejectedEvent
export const CancelRequestedEvent = Events.CancelRequestedEvent
export const CancellingEvent = Events.CancellingEvent
export const ToolCalledEvent = Events.ToolCalledEvent
export const ToolSettledEvent = Events.ToolSettledEvent

// LiveMembers is the ordered set of all fifteen live member schemas. The bus
// layer maps each to its own EventV2.define Definition with no durable
// annotation (C4).
export const LiveMembers = [
  QueuedEvent,
  WaitingEvent,
  PromotedEvent,
  ExtendedEvent,
  TurnStartedEvent,
  TurnEndedEvent,
  TurnFailedEvent,
  UnknownEvent,
  SteerRequestedEvent,
  SteerAcceptedEvent,
  SteerRejectedEvent,
  CancelRequestedEvent,
  CancellingEvent,
  ToolCalledEvent,
  ToolSettledEvent,
] as const
