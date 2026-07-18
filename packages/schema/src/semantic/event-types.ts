export * as EventTypes from "./event-types"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/event-types.cue (package semantic.enums)
// one-to-one — the closed 12-member semantic.* event vocabulary registered through
// EventV2.define into the durable-event manifest (C22). The semantic.* event prefix
// is the Feature 006 retrieval-plane event namespace on EventV2; it is DISTINCT from
// the Feature 007 semantic.* operator command domain (semantic.provider|model|
// embedding|reranker|binding|index.*); both are reserved (C15, C22). The nine
// durable index/binding/cutover members replay; the three live degradation/probe/
// state members may be dropped under load.

// SemanticEventType is the closed 12-member durable-settlement + live-signal vocabulary (FR41, C22).
export const SemanticEventType = Schema.Literals([
  // Nine durable members (replay through readAggregate):
  "semantic.binding_selected",
  "semantic.binding_cutover",
  "semantic.binding_rolled_back",
  "semantic.index_upserted",
  "semantic.index_tombstoned",
  "semantic.index_reconciled",
  "semantic.generation_built",
  "semantic.generation_cutover",
  "semantic.generation_retired",
  // Three live members (droppable under load):
  "semantic.retrieval_degraded",
  "semantic.provider_probed",
  "semantic.binding_state_changed",
]).annotate({ identifier: "SemanticEventTypes.SemanticEventType" })
export type SemanticEventType = typeof SemanticEventType.Type
