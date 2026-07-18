export * as Collections from "./collections"

import { Schema } from "effect"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { TextValues } from "./text-values"

// Mirrors doc/arch/schemas/semantic/collections.cue one-to-one. First-class
// collection ValueObjects replacing bare arrays across the projection documents,
// bindings and profiles (calisthenics). Each wraps a shared branded ValueObject
// element so a taxonomy, language set, or ref set carries one named type rather than
// an anonymous list. A ref set holds ranking pointers into live core state, never
// embedded Entities (FR20, C11); no element is a secret or a path (FR17, C4).

// TagSet is a taxonomy collection of domain/capability/trigger/tool/role tokens (FR10, FR11).
export const TagSet = Schema.Array(TextValues.Tag).annotate({ identifier: "SemanticCollections.TagSet" })
export type TagSet = typeof TagSet.Type

// LanguageSet is a first-class collection of BCP 47 provenance tags (FR14, FR16).
export const LanguageSet = Schema.Array(TextValues.LanguageTag).annotate({
  identifier: "SemanticCollections.LanguageSet",
})
export type LanguageSet = typeof LanguageSet.Type

// AgentRefSet is a first-class collection of canonical agent ranking pointers (FR20, C11).
export const AgentRefSet = Schema.Array(Refs.AgentRef).annotate({ identifier: "SemanticCollections.AgentRefSet" })
export type AgentRefSet = typeof AgentRefSet.Type

// SkillRefSet is a first-class collection of canonical skill ranking pointers (FR20, C11).
export const SkillRefSet = Schema.Array(Refs.SkillRef).annotate({ identifier: "SemanticCollections.SkillRefSet" })
export type SkillRefSet = typeof SkillRefSet.Type

// HeaderRefSet is a first-class collection of secure outbound header refs (FR35, C19).
export const HeaderRefSet = Schema.Array(Refs.HeaderRef).annotate({ identifier: "SemanticCollections.HeaderRefSet" })
export type HeaderRefSet = typeof HeaderRefSet.Type

// AliasRefSet is a first-class collection of collection-alias ids swapped together at cutover (FR12, C12).
export const AliasRefSet = Schema.Array(Ids.CollectionAliasId).annotate({
  identifier: "SemanticCollections.AliasRefSet",
})
export type AliasRefSet = typeof AliasRefSet.Type
