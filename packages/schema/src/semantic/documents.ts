export * as Documents from "./documents"

import { Schema } from "effect"
import { Collections } from "./collections"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/document-shared.cue, document-parts.cue,
// agent-doc.cue, skill-doc.cue and chunk-doc.cue one-to-one. A document is a
// derived, rebuildable projection — never a second store of record beside
// AgentV2/SkillV2/Catalog/Permission (FR1, FR2, C21). Identity carries the canonical
// version/content-hash/source driving incremental upsert/tombstone (FR13, AC10).
// Availability mirrors live core state and every candidate is revalidated before
// injection (FR20, C11). Taxonomy fields are ranking signals only, never authority,
// so a malicious description never alters router policy or hard gates (FR36, AC11).
// A chunk body is reached only through a Feature 005 OutputRef with offset/limit —
// never stored inline, never a path or secret (FR17, FR40, C4, C9).

// --- document-shared.cue -----------------------------------------------------

// DocIdentity carries the canonical version, content hash and source of a projection (FR10, FR11, FR13).
export const DocIdentity = Schema.Struct({
  version: Values.ConfigVersion,
  content_hash: TextValues.ContentHash,
  source: TextValues.Tag,
}).annotate({ identifier: "SemanticDocuments.DocIdentity" })
export type DocIdentity = Schema.Schema.Type<typeof DocIdentity>

// DocScope carries the scalar project key, scope, visibility and permission ref filtered on every search (FR9, FR34, C6).
export const DocScope = Schema.Struct({
  project_id: Ids.ProjectId,
  scope: EnumsState.ScopeKind,
  visibility: EnumsState.Visibility,
  permission_ref: Refs.PermissionRef,
}).annotate({ identifier: "SemanticDocuments.DocScope" })
export type DocScope = Schema.Schema.Type<typeof DocScope>

// DocAvailability mirrors live enabled/available core state revalidated before injection (FR20, C11).
export const DocAvailability = Schema.Struct({
  enabled: TextValues.Enabled,
  available: TextValues.Available,
}).annotate({ identifier: "SemanticDocuments.DocAvailability" })
export type DocAvailability = Schema.Schema.Type<typeof DocAvailability>

// --- document-parts.cue: agent parts -----------------------------------------

// AgentClassification carries the role, mode and sanitized description (FR10, FR36).
export const AgentClassification = Schema.Struct({
  role: EnumsState.RoleKind,
  mode: TextValues.ModeTag,
  description: TextValues.Description,
}).annotate({ identifier: "SemanticDocuments.AgentClassification" })
export type AgentClassification = Schema.Schema.Type<typeof AgentClassification>

// AgentTaxonomy carries the first-class domain, capability and tool tag collections (FR10).
export const AgentTaxonomy = Schema.Struct({
  domains: Collections.TagSet,
  capabilities: Collections.TagSet,
  tools: Collections.TagSet,
}).annotate({ identifier: "SemanticDocuments.AgentTaxonomy" })
export type AgentTaxonomy = Schema.Schema.Type<typeof AgentTaxonomy>

// --- document-parts.cue: skill parts -----------------------------------------

// SkillDescriptor carries the sanitized name and description (FR11, FR36).
export const SkillDescriptor = Schema.Struct({
  name: TextValues.Name,
  description: TextValues.Description,
}).annotate({ identifier: "SemanticDocuments.SkillDescriptor" })
export type SkillDescriptor = Schema.Schema.Type<typeof SkillDescriptor>

// SkillTaxonomy carries the first-class trigger, domain and capability tag collections (FR11).
export const SkillTaxonomy = Schema.Struct({
  triggers: Collections.TagSet,
  domains: Collections.TagSet,
  capabilities: Collections.TagSet,
}).annotate({ identifier: "SemanticDocuments.SkillTaxonomy" })
export type SkillTaxonomy = Schema.Schema.Type<typeof SkillTaxonomy>

// SkillCompat carries compatible role tags, agent refs and the permission ref (FR11, FR36, C11).
export const SkillCompat = Schema.Struct({
  roles: Collections.TagSet,
  agents: Collections.AgentRefSet,
  permission_ref: Refs.PermissionRef,
}).annotate({ identifier: "SemanticDocuments.SkillCompat" })
export type SkillCompat = Schema.Schema.Type<typeof SkillCompat>

// SkillCost carries the token/context cost estimate and language tags (FR11, FR38).
export const SkillCost = Schema.Struct({
  token_estimate: Values.TokenBudget,
  languages: Collections.LanguageSet,
}).annotate({ identifier: "SemanticDocuments.SkillCost" })
export type SkillCost = Schema.Schema.Type<typeof SkillCost>

// --- document-parts.cue: chunk parts -----------------------------------------

// ChunkPosition carries the zero-based chunk index and fixed overlap (FR11, C9).
export const ChunkPosition = Schema.Struct({
  chunk_index: Values.ChunkIndex,
  overlap: Values.ChunkOverlap,
}).annotate({ identifier: "SemanticDocuments.ChunkPosition" })
export type ChunkPosition = Schema.Schema.Type<typeof ChunkPosition>

// ChunkBodyRef carries the Feature 005 OutputSpool ref and its bounded read window (FR40, C9).
export const ChunkBodyRef = Schema.Struct({
  output_ref: Refs.OutputRef,
  offset: Values.ByteOffset,
  limit: Values.ByteLimit,
}).annotate({ identifier: "SemanticDocuments.ChunkBodyRef" })
export type ChunkBodyRef = Schema.Schema.Type<typeof ChunkBodyRef>

// --- agent-doc.cue -----------------------------------------------------------

// AgentDoc is the `agents` collection projection entity; id is the canonical agent id (FR10, C6).
export const AgentDoc = Schema.Struct({
  id: Ids.AgentDocId,
  identity: DocIdentity,
  classification: AgentClassification,
  taxonomy: AgentTaxonomy,
  scope: DocScope,
  languages: Collections.LanguageSet,
  availability: DocAvailability,
}).annotate({ identifier: "SemanticDocuments.AgentDoc" })
export type AgentDoc = Schema.Schema.Type<typeof AgentDoc>

// --- skill-doc.cue -----------------------------------------------------------

// SkillDoc is the `skills` collection summary projection entity; id is the canonical skill id (FR11, C9).
export const SkillDoc = Schema.Struct({
  id: Ids.SkillDocId,
  identity: DocIdentity,
  descriptor: SkillDescriptor,
  taxonomy: SkillTaxonomy,
  compat: SkillCompat,
  cost: SkillCost,
  availability: DocAvailability,
}).annotate({ identifier: "SemanticDocuments.SkillDoc" })
export type SkillDoc = Schema.Schema.Type<typeof SkillDoc>

// --- chunk-doc.cue -----------------------------------------------------------

// SkillChunkDoc is the `skill_chunks` projection entity; id is the canonical chunk id (FR11, C9).
export const SkillChunkDoc = Schema.Struct({
  id: Ids.SkillChunkId,
  parent_skill_id: Refs.ParentSkillId,
  position: ChunkPosition,
  identity: DocIdentity,
  language_tag: TextValues.LanguageTag,
  body_ref: ChunkBodyRef,
  token_estimate: Values.TokenBudget,
}).annotate({ identifier: "SemanticDocuments.SkillChunkDoc" })
export type SkillChunkDoc = Schema.Schema.Type<typeof SkillChunkDoc>
