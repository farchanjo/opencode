export * as EventsLive from "./events-live"

import { Events } from "./events"

// Live-view of the output.* vocabulary — the four live signal members (C20). Live
// members omit the durable annotation — no sequence, no replay; append,
// backpressure and admission-degrade signals use the bounded live channel and MAY
// be dropped under allBounded load without affecting durable seal/read (FR8, C4,
// C20). The unknown member is envelope-only and never gates work. The member
// Structs are authored in events.ts (the authoritative module); this module
// re-exports the live subset and provides a grouping array for the EventV2 bus
// layer (event-definitions.ts).

export const OutputChunkAppendedEvent = Events.OutputChunkAppendedEvent
export const OutputBackpressureSignalledEvent = Events.OutputBackpressureSignalledEvent
export const OutputAdmissionDegradedEvent = Events.OutputAdmissionDegradedEvent
export const OutputUnknownEvent = Events.OutputUnknownEvent

// LiveMembers is the ordered set of all four live member schemas. The bus layer
// maps each to its own EventV2.define Definition with no durable annotation (C20).
export const LiveMembers = [
  OutputChunkAppendedEvent,
  OutputBackpressureSignalledEvent,
  OutputAdmissionDegradedEvent,
  OutputUnknownEvent,
] as const
