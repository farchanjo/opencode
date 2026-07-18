export * as EventsDurable from "./events-durable"

import { Events } from "./events"

// Durable-view of the lifecycle vocabulary — mirrors the eleven durable members
// in doc/arch/schemas/lifecycle/events-durable.cue and
// events-durable-terminal.cue (C4, C5). The member Structs are authored in
// events.ts (the authoritative module: details + members + union) to avoid an
// ESM circular initialization; this module re-exports the durable subset and
// provides a grouping array for the EventV2 bus layer, which registers each
// durable member with `durable {version, aggregate: "root_process_id"}` (T014).

// Semantic-checkpoint durable members (events-durable.cue).
export const AdmittedEvent = Events.AdmittedEvent
export const ParentAttachedEvent = Events.ParentAttachedEvent
export const ProcessCreatedEvent = Events.ProcessCreatedEvent
export const StartedEvent = Events.StartedEvent
export const HandoffEvent = Events.HandoffEvent
export const ReconciledEvent = Events.ReconciledEvent

// Terminal and owner-loss durable members (events-durable-terminal.cue).
export const CompletedEvent = Events.CompletedEvent
export const FailedEvent = Events.FailedEvent
export const CancelledEvent = Events.CancelledEvent
export const ZombieDetectedEvent = Events.ZombieDetectedEvent
export const OwnerLostEvent = Events.OwnerLostEvent

// DurableMembers is the ordered set of all eleven durable member schemas. The
// bus layer maps each to its own EventV2.define Definition carrying the durable
// annotation (C4).
export const DurableMembers = [
  AdmittedEvent,
  ParentAttachedEvent,
  ProcessCreatedEvent,
  StartedEvent,
  HandoffEvent,
  ReconciledEvent,
  CompletedEvent,
  FailedEvent,
  CancelledEvent,
  ZombieDetectedEvent,
  OwnerLostEvent,
] as const
