export * as Ids from "./ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/ids.cue (package semantic.shared) one-to-one
// for the Feature 006 semantic-retrieval projection identity ValueObjects (FR10,
// FR11, FR12, FR28, C6, C9, C12, C19).
//
// Name parity with routing.shared / lifecycle.shared / outputspool.shared is
// intentional — this feature does not cross-import those modules, so the
// identifier concepts are re-declared locally (FR1, FR2, C21). No identity axis is
// a filesystem path (FR17, C4).
//
// ANNOTATION ORDER: every exported schema is annotated with its root identifier
// BEFORE any `.check(...)` is applied, and branded only after the check.
// Annotating an already-checked schema drops the root identifier from
// `.ast.annotations` in favor of annotating the last check instead, so
// base-then-check-then-brand is load-bearing for contract hygiene (see
// test/contract-hygiene.test.ts).

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const modelIdPattern = /^[A-Za-z0-9_-]{1,160}$/
const chunkIdPattern = /^[A-Za-z0-9_-]{1,192}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/

// ProviderProfileId identifies one SemanticProviderProfile aggregate (FR28, C19).
export const ProviderProfileId = Schema.String.annotate({ identifier: "SemanticIds.ProviderProfileId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Semantic.ProviderProfileId"))
export type ProviderProfileId = typeof ProviderProfileId.Type

// ModelDescriptorId is the canonical model ref identifying one SemanticModelDescriptor (FR28, C3).
export const ModelDescriptorId = Schema.String.annotate({ identifier: "SemanticIds.ModelDescriptorId" })
  .check(Schema.isPattern(modelIdPattern))
  .pipe(Schema.brand("Semantic.ModelDescriptorId"))
export type ModelDescriptorId = typeof ModelDescriptorId.Type

// BindingId identifies one SemanticModelBinding aggregate for a slot (FR28, C12).
export const BindingId = Schema.String.annotate({ identifier: "SemanticIds.BindingId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Semantic.BindingId"))
export type BindingId = typeof BindingId.Type

// AgentDocId is the canonical agent id keying one AgentDoc projection (FR10, C6).
export const AgentDocId = Schema.String.annotate({ identifier: "SemanticIds.AgentDocId" })
  .check(Schema.isPattern(modelIdPattern))
  .pipe(Schema.brand("Semantic.AgentDocId"))
export type AgentDocId = typeof AgentDocId.Type

// SkillDocId is the canonical skill id keying one SkillDoc projection (FR11, C9).
export const SkillDocId = Schema.String.annotate({ identifier: "SemanticIds.SkillDocId" })
  .check(Schema.isPattern(modelIdPattern))
  .pipe(Schema.brand("Semantic.SkillDocId"))
export type SkillDocId = typeof SkillDocId.Type

// SkillChunkId is the canonical chunk id keying one SkillChunkDoc projection (FR11, C9).
export const SkillChunkId = Schema.String.annotate({ identifier: "SemanticIds.SkillChunkId" })
  .check(Schema.isPattern(chunkIdPattern))
  .pipe(Schema.brand("Semantic.SkillChunkId"))
export type SkillChunkId = typeof SkillChunkId.Type

// GenerationId identifies one blue/green IndexGeneration under a binding generation (FR12, C12).
export const GenerationId = Schema.String.annotate({ identifier: "SemanticIds.GenerationId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Semantic.GenerationId"))
export type GenerationId = typeof GenerationId.Type

// CollectionAliasId identifies one CollectionAlias entity swapped at cutover (FR12, C12).
export const CollectionAliasId = Schema.String.annotate({ identifier: "SemanticIds.CollectionAliasId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Semantic.CollectionAliasId"))
export type CollectionAliasId = typeof CollectionAliasId.Type

// ProjectId is the scalar project partition key filtered on every search (FR9, FR34, C6).
export const ProjectId = Schema.String.annotate({ identifier: "SemanticIds.ProjectId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Semantic.ProjectId"))
export type ProjectId = typeof ProjectId.Type

// EventId is the EventV2 evt_ identifier assigned per published semantic.* event (C22).
export const EventId = Schema.String.annotate({ identifier: "SemanticIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("Semantic.EventId"))
export type EventId = typeof EventId.Type
