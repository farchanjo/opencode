export * as EventDefinitions from "./event-definitions"

import type { Definition } from "../event"
import { Event } from "../event"
import { Correlation } from "./correlation"
import { EventsLive } from "./events-live"
import { EventsSettlement } from "./events-settlement"

// Feature 005 / T010 — one `EventV2.define` Definition per output.* member (C20),
// mirroring the Feature 001/002/003/004 pattern (`dataFields(Member.fields)`, no
// raw tagged union wired to the bus).
//
// Defined at the SCHEMA layer (not `packages/opencode/src/event-v2-bridge.ts`)
// because the seven durable settlement members must be joinable into the
// canonical `Durable` inventory in `durable-event-manifest.ts` (T013), and the
// schema package can never depend on `packages/core`/`packages/opencode` (they
// depend on schema, never the reverse). The application-layer `publishOutputEvent`
// boundary (Phase 3) re-uses these Definitions; there is exactly one copy of the
// wire shape per member (C20).
//
// Durable-aggregate wiring (C20): `packages/core/src/event.ts` reads the aggregate
// id from a TOP-LEVEL key on the published `data` object named by
// `durable.aggregate`. The content-free output.* envelope carries the correlation
// id inside `envelope.ordering.correlation_id`, so every durable member's schema
// carries an explicit top-level `correlation_id` field in addition to the nested
// `envelope`/`detail` payload, and the publish boundary projects
// `envelope.ordering.correlation_id` onto it (no duplicated authority).

function dataFields<T extends { readonly type: unknown }>(fields: T): Omit<T, "type"> {
  const { type: _drop, ...rest } = fields
  return rest
}

const DURABLE = { version: 1, aggregate: "correlation_id" } as const

// --- Durable settlement members (seven; C20) ---------------------------------

export const ChannelSealedDefinition = Event.define({
  type: "output.channel_sealed",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsSettlement.OutputChannelSealedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const ChannelAbortedDefinition = Event.define({
  type: "output.channel_aborted",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsSettlement.OutputChannelAbortedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const SettlementRecordedDefinition = Event.define({
  type: "output.settlement_recorded",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsSettlement.OutputSettlementRecordedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const ReconciledDefinition = Event.define({
  type: "output.reconciled",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsSettlement.OutputReconciledEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const GenerationFencedDefinition = Event.define({
  type: "output.generation_fenced",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsSettlement.OutputGenerationFencedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const GroupReleasedDefinition = Event.define({
  type: "output.group_released",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsSettlement.OutputGroupReleasedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const GroupReclaimedDefinition = Event.define({
  type: "output.group_reclaimed",
  durable: DURABLE,
  schema: {
    ...dataFields(EventsSettlement.OutputGroupReclaimedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})

/** The seven durable settlement member Definitions, in vocabulary order (C20). */
export const DurableDefinitions: ReadonlyArray<Definition> = [
  ChannelSealedDefinition,
  ChannelAbortedDefinition,
  SettlementRecordedDefinition,
  ReconciledDefinition,
  GenerationFencedDefinition,
  GroupReleasedDefinition,
  GroupReclaimedDefinition,
]

// --- Live members (four; C20) ------------------------------------------------

export const ChunkAppendedDefinition = Event.define({
  type: "output.chunk_appended",
  schema: dataFields(EventsLive.OutputChunkAppendedEvent.fields),
})
export const BackpressureSignalledDefinition = Event.define({
  type: "output.backpressure_signalled",
  schema: dataFields(EventsLive.OutputBackpressureSignalledEvent.fields),
})
export const AdmissionDegradedDefinition = Event.define({
  type: "output.admission_degraded",
  schema: dataFields(EventsLive.OutputAdmissionDegradedEvent.fields),
})
export const UnknownDefinition = Event.define({
  type: "output.unknown",
  schema: dataFields(EventsLive.OutputUnknownEvent.fields),
})

/** The four live member Definitions, in vocabulary order (C20). */
export const LiveDefinitions: ReadonlyArray<Definition> = [
  ChunkAppendedDefinition,
  BackpressureSignalledDefinition,
  AdmissionDegradedDefinition,
  UnknownDefinition,
]

/** All eleven output.* member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = [...DurableDefinitions, ...LiveDefinitions]

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = new Map(
  Definitions.map((definition) => [definition.type, definition]),
)
