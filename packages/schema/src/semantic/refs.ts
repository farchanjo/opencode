export * as Refs from "./refs"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/refs.cue (package semantic.shared) one-to-one.
// Cross-reference, secret and principal ValueObjects carry an opaque handle only:
// a credential is a Feature 007 SecretPort secret ref, never raw material (FR35,
// C19); a candidate ref is a ranking pointer into live core state, never an
// embedded Entity (FR20, FR34, C11); a skill body is reached only through a
// Feature 005 OutputRef (FR40, C9). No axis is a filesystem path (FR17, C4).
//
// Same base-then-annotate-then-check-then-brand discipline as ./ids so the root
// identifier is retained for contract hygiene (see test/contract-hygiene.test.ts).

const refPattern = /^[A-Za-z0-9_-]{1,128}$/
const longRefPattern = /^[A-Za-z0-9_-]{1,160}$/

// ProviderRef references a SemanticProviderProfile from a descriptor or binding (FR28).
export const ProviderRef = Schema.String.annotate({ identifier: "SemanticRefs.ProviderRef" })
  .check(Schema.isPattern(refPattern))
  .pipe(Schema.brand("Semantic.ProviderRef"))
export type ProviderRef = typeof ProviderRef.Type

// ModelRef references a SemanticModelDescriptor from a binding or candidate (FR28, C3).
export const ModelRef = Schema.String.annotate({ identifier: "SemanticRefs.ModelRef" })
  .check(Schema.isPattern(longRefPattern))
  .pipe(Schema.brand("Semantic.ModelRef"))
export type ModelRef = typeof ModelRef.Type

// ParentSkillId references the SkillDoc a SkillChunkDoc was chunked from (FR11, C9).
export const ParentSkillId = Schema.String.annotate({ identifier: "SemanticRefs.ParentSkillId" })
  .check(Schema.isPattern(longRefPattern))
  .pipe(Schema.brand("Semantic.ParentSkillId"))
export type ParentSkillId = typeof ParentSkillId.Type

// AgentRef is a ranking pointer to a canonical agent revalidated against AgentV2 (FR20, C11).
export const AgentRef = Schema.String.annotate({ identifier: "SemanticRefs.AgentRef" })
  .check(Schema.isPattern(longRefPattern))
  .pipe(Schema.brand("Semantic.AgentRef"))
export type AgentRef = typeof AgentRef.Type

// SkillRef is a ranking pointer to a canonical skill revalidated against SkillV2 (FR20, C11).
export const SkillRef = Schema.String.annotate({ identifier: "SemanticRefs.SkillRef" })
  .check(Schema.isPattern(longRefPattern))
  .pipe(Schema.brand("Semantic.SkillRef"))
export type SkillRef = typeof SkillRef.Type

// PermissionRef references the PermissionV2 profile evaluated before and after search (FR34, C11).
export const PermissionRef = Schema.String.annotate({ identifier: "SemanticRefs.PermissionRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.PermissionRef"))
export type PermissionRef = typeof PermissionRef.Type

// SecretRef is a Feature 007 SecretPort secure reference — never raw secret material (FR35, C19).
export const SecretRef = Schema.String.annotate({ identifier: "SemanticRefs.SecretRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.SecretRef"))
export type SecretRef = typeof SecretRef.Type

// HeaderRef is a secure reference to an outbound auth header value — never inline (FR35, C19).
export const HeaderRef = Schema.String.annotate({ identifier: "SemanticRefs.HeaderRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.HeaderRef"))
export type HeaderRef = typeof HeaderRef.Type

// OperatorRef is the operator principal that pinned a binding; re-evaluated per action (FR35, C15).
export const OperatorRef = Schema.String.annotate({ identifier: "SemanticRefs.OperatorRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.OperatorRef"))
export type OperatorRef = typeof OperatorRef.Type

// OutputRef is a Feature 005 OutputSpool content handle for a sanitized chunk body (FR40, C9).
export const OutputRef = Schema.String.annotate({ identifier: "SemanticRefs.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Semantic.OutputRef"))
export type OutputRef = typeof OutputRef.Type
