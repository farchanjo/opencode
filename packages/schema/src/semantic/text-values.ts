export * as TextValues from "./text-values"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/semantic/text-values.cue and hash-values.cue one-to-one.
// Every axis is bounded, content-classified metadata — never a secret, full prompt,
// reasoning trace, private payload, or filesystem path (FR17, C4). A language tag is
// a BCP 47 provenance tag preserving the original query language for embedding
// without a mandatory translation LLM call (FR14, FR15, FR16). A degraded reason is
// a bounded typed explanation, never free-form content (FR24, C20). Content hashes
// drive incremental upsert/tombstone and the query fingerprint keys the once-per-Task
// embedding cache (FR13, FR18, C10, AC10). Flags carry no content (FR20, C7, C11).
//
// Same base-then-annotate-then-check discipline as ./ids: the root identifier is
// annotated on the plain base BEFORE any check (contract hygiene).

const bcp47Pattern = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/

// --- text-values.cue ---------------------------------------------------------

// Name is a bounded human-facing provider/model/skill name; classification, not content (FR28).
export const Name = Schema.String.annotate({ identifier: "SemanticTextValues.Name" }).check(Schema.isNonEmpty())
export type Name = typeof Name.Type

// DisplayName is a bounded human-facing label shown in the operator panel (FR29).
export const DisplayName = Schema.String.annotate({ identifier: "SemanticTextValues.DisplayName" }).check(
  Schema.isNonEmpty(),
)
export type DisplayName = typeof DisplayName.Type

// Description is a bounded sanitized description; a ranking signal only, never authority (FR10, FR36).
export const Description = Schema.String.annotate({ identifier: "SemanticTextValues.Description" })
export type Description = typeof Description.Type

// BaseUrl is a bounded provider endpoint URL parsed under the SSRF-safe policy (FR33, C17).
export const BaseUrl = Schema.String.annotate({ identifier: "SemanticTextValues.BaseUrl" }).check(Schema.isNonEmpty())
export type BaseUrl = typeof BaseUrl.Type

// LanguageTag is a canonical BCP 47 provenance tag (pt-BR/es/en initial locales) (FR14, FR16).
export const LanguageTag = Schema.String.annotate({ identifier: "SemanticTextValues.LanguageTag" }).check(
  Schema.isPattern(bcp47Pattern),
)
export type LanguageTag = typeof LanguageTag.Type

// Tag is a bounded taxonomy token for a domain, capability, trigger, tool, or role (FR10, FR11).
export const Tag = Schema.String.annotate({ identifier: "SemanticTextValues.Tag" }).check(Schema.isNonEmpty())
export type Tag = typeof Tag.Type

// ModeTag is the bounded agent mode carried on an AgentDoc projection (FR10).
export const ModeTag = Schema.String.annotate({ identifier: "SemanticTextValues.ModeTag" }).check(Schema.isNonEmpty())
export type ModeTag = typeof ModeTag.Type

// DegradedReason is the bounded typed reason recorded when retrieval degrades (FR24, C20, AC29).
export const DegradedReason = Schema.String.annotate({ identifier: "SemanticTextValues.DegradedReason" }).check(
  Schema.isNonEmpty(),
)
export type DegradedReason = typeof DegradedReason.Type

// Timestamp is an ISO 8601 instant on a record; observational timestamps decode via DateTimeUtcFromMillis.
export const Timestamp = Schema.String.annotate({ identifier: "SemanticTextValues.Timestamp" }).check(
  Schema.isNonEmpty(),
)
export type Timestamp = typeof Timestamp.Type

// Reason is a bounded human-readable explanation on a record or event; no content (FR22).
export const Reason = Schema.String.annotate({ identifier: "SemanticTextValues.Reason" })
export type Reason = typeof Reason.Type

// --- hash-values.cue ---------------------------------------------------------

// ContentHash is the canonical content hash driving incremental upsert/tombstone (FR13, AC10).
export const ContentHash = Schema.String.annotate({ identifier: "SemanticTextValues.ContentHash" }).check(
  Schema.isNonEmpty(),
)
export type ContentHash = typeof ContentHash.Type

// ConfigHash invalidates caches by config generation alongside the binding version (FR25, C10).
export const ConfigHash = Schema.String.annotate({ identifier: "SemanticTextValues.ConfigHash" }).check(
  Schema.isNonEmpty(),
)
export type ConfigHash = typeof ConfigHash.Type

// Fingerprint keys the query-embedding cache derived once per logical Task (FR18, C10, AC16).
export const Fingerprint = Schema.String.annotate({ identifier: "SemanticTextValues.Fingerprint" }).check(
  Schema.isNonEmpty(),
)
export type Fingerprint = typeof Fingerprint.Type

// Enabled marks a profile/model/document enabled in the operator panel (FR29, FR31).
export const Enabled = Schema.Boolean.annotate({ identifier: "SemanticTextValues.Enabled" })
export type Enabled = typeof Enabled.Type

// Available mirrors live availability revalidated against core before injection (FR20, C11).
export const Available = Schema.Boolean.annotate({ identifier: "SemanticTextValues.Available" })
export type Available = typeof Available.Type

// Normalized flags whether a collection generation stores normalized vectors (FR12, C7).
export const Normalized = Schema.Boolean.annotate({ identifier: "SemanticTextValues.Normalized" })
export type Normalized = typeof Normalized.Type

// InsecureAllowed permits non-TLS only for an explicit local profile with a warning (FR33, C17).
export const InsecureAllowed = Schema.Boolean.annotate({ identifier: "SemanticTextValues.InsecureAllowed" })
export type InsecureAllowed = typeof InsecureAllowed.Type
