export * as IndexGeneration from "./index-generation"

import { Schema } from "effect"
import { Collections } from "./collections"
import { Enums } from "./enums"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/index-generation.cue and collection-alias.cue
// one-to-one. IndexGeneration is one blue/green collection generation under a binding
// generation (FR12, C12); its id is the generation_id. The embedding dimension,
// normalization and metric are stored WITH the generation so incompatible vectors
// are never mixed in one search space (FR12). select and reindex never activate the
// live alias; only the atomic cutover under CAS swaps all collection aliases together
// (FR12, FR32, C12). CollectionAlias maps a conceptual collection (agents/skills/
// skill_chunks or the Feature 009 tools extension) to a physical generation so the
// tools collection never splits from the others (FR9, FR12, C6, C21).

// SemanticIndexGeneration is the aggregate root of a blue/green generation; id is the generation id (FR12, C12).
export const SemanticIndexGeneration = Schema.Struct({
  id: Ids.GenerationId,
  binding_version: Values.BindingVersion,
  state: EnumsState.GenerationState,
  metric: Enums.Metric,
  dimension: Values.Dimension,
  aliases: Collections.AliasRefSet,
  created_at: TextValues.Timestamp,
}).annotate({ identifier: "SemanticIndex.SemanticIndexGeneration" })
export type SemanticIndexGeneration = Schema.Schema.Type<typeof SemanticIndexGeneration>

// CollectionAlias is the alias entity binding one collection to a generation; id is its alias id (FR12, C12).
export const CollectionAlias = Schema.Struct({
  id: Ids.CollectionAliasId,
  collection: EnumsState.Collection,
  generation_id: Ids.GenerationId,
  active: TextValues.Available,
}).annotate({ identifier: "SemanticIndex.CollectionAlias" })
export type CollectionAlias = Schema.Schema.Type<typeof CollectionAlias>
