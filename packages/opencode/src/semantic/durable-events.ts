/**
 * Feature 006 / T033 (S19) — the durable/live `semantic.*` event projection.
 *
 * Projects one member of the closed 12-member `semantic.*` vocabulary onto its
 * EventV2 wire `Definition` and publish payload for the `publishSemanticEvent`
 * boundary added to `packages/opencode/src/event-v2-bridge.ts` (mirroring
 * `publishOutputEvent`: location attach, single publish boundary). The nine
 * durable settlement members carry a top-level `correlation_id` projected from
 * `envelope.ordering.correlation_id` — the durable aggregate key EventV2 commits
 * on — and replay through `readAggregate`; the three live signals
 * (`retrieval_degraded`/`provider_probed`/`binding_state_changed`) omit it, ride
 * the bounded live channel, and MAY be dropped under `allBounded` load without
 * affecting durable binding/index state (C22). Every payload is content-free —
 * opaque ids, bounded enums, and redacted metadata only, never query text,
 * vectors, or a path (FR12, FR13, FR41, FR42, C22).
 *
 * The wire `Definition`s are the single copies authored at the schema layer
 * (`@opencode-ai/schema/semantic/event-definitions`, T011/T013); this module
 * never redefines them and no second event channel is introduced.
 */
export * as DurableEvents from "./durable-events"

import { EventDefinitions as SemanticEventDefinitions } from "@opencode-ai/schema/semantic/event-definitions"
import type { Events as SemanticEvents } from "@opencode-ai/schema/semantic/events"
import type { Definition } from "@opencode-ai/schema/event"

/** The nine durable settlement member types (carry `correlation_id`, replay). */
export const DURABLE_SEMANTIC_TYPES: ReadonlySet<string> = new Set([
  "semantic.binding_selected",
  "semantic.binding_cutover",
  "semantic.binding_rolled_back",
  "semantic.index_upserted",
  "semantic.index_tombstoned",
  "semantic.index_reconciled",
  "semantic.generation_built",
  "semantic.generation_cutover",
  "semantic.generation_retired",
])

/** The three live signal member types (omit `correlation_id`, droppable under load). */
export const LIVE_SEMANTIC_TYPES: ReadonlySet<string> = new Set([
  "semantic.retrieval_degraded",
  "semantic.provider_probed",
  "semantic.binding_state_changed",
])

/** True for a durable settlement member — it commits a sequence and replays (C22). */
export const isDurableSemanticEvent = (type: string): boolean => DURABLE_SEMANTIC_TYPES.has(type)

/** True for a live signal member — it MAY be dropped under `allBounded` load (C22). */
export const isDroppableUnderLoad = (type: string): boolean => LIVE_SEMANTIC_TYPES.has(type)

/** One projected publish: the wire Definition, the content-free data payload, and whether it is durable. */
export interface SemanticPublishProjection {
  readonly definition: Definition
  readonly data: Record<string, unknown>
  readonly durable: boolean
}

/**
 * Project a `SemanticEvent` member onto its wire Definition and publish payload.
 * The durable members carry the top-level `correlation_id` (the aggregate key);
 * live members omit it. The `type` discriminant is dropped from the payload
 * (the Definition owns it), mirroring the Feature 005 `publishOutputEvent` shape.
 */
export const projectForPublish = (event: SemanticEvents.SemanticEvent): SemanticPublishProjection => {
  const definition = SemanticEventDefinitions.ByType.get(event.type)
  if (!definition) throw new Error(`unknown semantic event type: ${event.type}`)
  const { type: _drop, ...rest } = event
  const durable = isDurableSemanticEvent(event.type)
  const data = durable ? { ...rest, correlation_id: event.envelope.ordering.correlation_id } : { ...rest }
  return { definition, data, durable }
}
