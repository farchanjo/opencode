export * as EventsSettlement from "./events-settlement"

import { Events } from "./events"

// Durable-view of the output.* vocabulary — the seven durable settlement members
// (C20). Durable settlement members carry the EventV2 durable {version, aggregate}
// annotation and replay through readAggregate; seal, abort, settlement,
// reconciliation, generation-fencing and retention release/reclaim are never
// coalesced or dropped (FR4, FR23, FR24, FR25, C12, C20). The member Structs are
// authored in events.ts (the authoritative module) to avoid an ESM circular
// initialization; this module re-exports the durable subset and provides a
// grouping array for the EventV2 bus layer (event-definitions.ts).

export const OutputChannelSealedEvent = Events.OutputChannelSealedEvent
export const OutputChannelAbortedEvent = Events.OutputChannelAbortedEvent
export const OutputSettlementRecordedEvent = Events.OutputSettlementRecordedEvent
export const OutputReconciledEvent = Events.OutputReconciledEvent
export const OutputGenerationFencedEvent = Events.OutputGenerationFencedEvent
export const OutputGroupReleasedEvent = Events.OutputGroupReleasedEvent
export const OutputGroupReclaimedEvent = Events.OutputGroupReclaimedEvent

// DurableMembers is the ordered set of all seven durable settlement member schemas.
// The bus layer maps each to its own EventV2.define Definition carrying the durable
// annotation (C20).
export const DurableMembers = [
  OutputChannelSealedEvent,
  OutputChannelAbortedEvent,
  OutputSettlementRecordedEvent,
  OutputReconciledEvent,
  OutputGenerationFencedEvent,
  OutputGroupReleasedEvent,
  OutputGroupReclaimedEvent,
] as const
