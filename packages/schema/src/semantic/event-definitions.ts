export * as EventDefinitions from "./event-definitions"

import type { Definition } from "../event"
import { Event } from "../event"
import { Correlation } from "./correlation"
import { Events } from "./events"

// Feature 006 / T011 — one `EventV2.define` Definition per semantic.* member (C22),
// mirroring the Feature 001/002/003/004/005 pattern (`dataFields(Member.fields)`, no
// raw tagged union wired to the bus).
//
// Defined at the SCHEMA layer (not `packages/opencode/src/event-v2-bridge.ts`)
// because the nine durable settlement members must be joinable into the canonical
// `Durable` inventory in `durable-event-manifest.ts` (T013), and the schema package
// can never depend on `packages/core`/`packages/opencode` (they depend on schema,
// never the reverse). The application-layer `publishSemanticEvent` boundary (Phase 3,
// T033) re-uses these Definitions; there is exactly one copy of the wire shape per
// member (C22).
//
// Durable-aggregate wiring (C22): `packages/core/src/event.ts` reads the aggregate id
// from a TOP-LEVEL key on the published `data` object named by `durable.aggregate`.
// The content-free semantic.* envelope carries the correlation id inside
// `envelope.ordering.correlation_id`, so every durable member's schema carries an
// explicit top-level `correlation_id` field in addition to the nested
// `envelope`/`detail` payload, and the publish boundary projects
// `envelope.ordering.correlation_id` onto it (no duplicated authority).

function dataFields<T extends { readonly type: unknown }>(fields: T): Omit<T, "type"> {
  const { type: _drop, ...rest } = fields
  return rest
}

const DURABLE = { version: 1, aggregate: "correlation_id" } as const

// --- Durable settlement members (nine; C22) ----------------------------------

export const BindingSelectedDefinition = Event.define({
  type: "semantic.binding_selected",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticBindingSelectedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const BindingCutoverDefinition = Event.define({
  type: "semantic.binding_cutover",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticBindingCutoverEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const BindingRolledBackDefinition = Event.define({
  type: "semantic.binding_rolled_back",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticBindingRolledBackEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const IndexUpsertedDefinition = Event.define({
  type: "semantic.index_upserted",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticIndexUpsertedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const IndexTombstonedDefinition = Event.define({
  type: "semantic.index_tombstoned",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticIndexTombstonedEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const IndexReconciledDefinition = Event.define({
  type: "semantic.index_reconciled",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticIndexReconciledEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const GenerationBuiltDefinition = Event.define({
  type: "semantic.generation_built",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticGenerationBuiltEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const GenerationCutoverDefinition = Event.define({
  type: "semantic.generation_cutover",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticGenerationCutoverEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})
export const GenerationRetiredDefinition = Event.define({
  type: "semantic.generation_retired",
  durable: DURABLE,
  schema: {
    ...dataFields(Events.SemanticGenerationRetiredEvent.fields),
    correlation_id: Correlation.CorrelationId,
  },
})

/** The nine durable settlement member Definitions, in vocabulary order (C22). */
export const DurableDefinitions: ReadonlyArray<Definition> = [
  BindingSelectedDefinition,
  BindingCutoverDefinition,
  BindingRolledBackDefinition,
  IndexUpsertedDefinition,
  IndexTombstonedDefinition,
  IndexReconciledDefinition,
  GenerationBuiltDefinition,
  GenerationCutoverDefinition,
  GenerationRetiredDefinition,
]

// --- Live members (three; C22) -----------------------------------------------

export const RetrievalDegradedDefinition = Event.define({
  type: "semantic.retrieval_degraded",
  schema: dataFields(Events.SemanticRetrievalDegradedEvent.fields),
})
export const ProviderProbedDefinition = Event.define({
  type: "semantic.provider_probed",
  schema: dataFields(Events.SemanticProviderProbedEvent.fields),
})
export const BindingStateChangedDefinition = Event.define({
  type: "semantic.binding_state_changed",
  schema: dataFields(Events.SemanticBindingStateChangedEvent.fields),
})

/** The three live member Definitions, in vocabulary order (C22). */
export const LiveDefinitions: ReadonlyArray<Definition> = [
  RetrievalDegradedDefinition,
  ProviderProbedDefinition,
  BindingStateChangedDefinition,
]

/** All twelve semantic.* member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = [...DurableDefinitions, ...LiveDefinitions]

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = new Map(
  Definitions.map((definition) => [definition.type, definition]),
)
