export * as ProviderProfile from "./provider-profile"

import { Schema } from "effect"
import { Collections } from "./collections"
import { Enums } from "./enums"
import { EnumsState } from "./enums-state"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { TextValues } from "./text-values"

// Mirrors doc/arch/schemas/semantic/provider-parts.cue and provider-profile.cue
// one-to-one. SemanticProviderProfile is a Feature 006 SSOT aggregate for one
// OpenAI-compatible provider endpoint (FR28); Feature 007 references this schema
// and exposes operator commands without redefining the field set. A profile embeds
// NO secret: credentials are Feature 007 SecretPort refs only (FR35, C19). Its base
// URL is parsed under the SSRF-safe policy (FR33, C17). The version counter changes
// on any endpoint/compatibility change, never on a secret rotation (FR31).

// ProviderVersion is the immutable version counter of a provider profile (FR31).
export const ProviderVersion = Schema.Number.annotate({ identifier: "SemanticProvider.ProviderVersion" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type ProviderVersion = typeof ProviderVersion.Type

// ProviderIdentity carries the name, base URL and transport compatibility profile (FR28, FR29).
export const ProviderIdentity = Schema.Struct({
  name: TextValues.Name,
  base_url: TextValues.BaseUrl,
  transport: Enums.TransportProfile,
}).annotate({ identifier: "SemanticProvider.ProviderIdentity" })
export type ProviderIdentity = Schema.Schema.Type<typeof ProviderIdentity>

// ProviderTransport carries the TLS policy, residency profile and local-insecure allowance (FR33, FR37, C4, C17).
export const ProviderTransport = Schema.Struct({
  tls_policy: EnumsState.TlsPolicy,
  residency: EnumsState.ResidencyProfile,
  insecure_allowed: TextValues.InsecureAllowed,
}).annotate({ identifier: "SemanticProvider.ProviderTransport" })
export type ProviderTransport = Schema.Schema.Type<typeof ProviderTransport>

// ProviderCredentials carries an optional secret ref and secure header refs; never raw (FR35, C19).
export const ProviderCredentials = Schema.Struct({
  secret_ref: Schema.NullOr(Refs.SecretRef),
  headers: Collections.HeaderRefSet,
}).annotate({ identifier: "SemanticProvider.ProviderCredentials" })
export type ProviderCredentials = Schema.Schema.Type<typeof ProviderCredentials>

// ProviderAudit carries the enabled flag and created/updated/selected-by metadata (FR29, FR35).
export const ProviderAudit = Schema.Struct({
  enabled: TextValues.Enabled,
  created_at: TextValues.Timestamp,
  updated_at: TextValues.Timestamp,
  selected_by: Refs.OperatorRef,
}).annotate({ identifier: "SemanticProvider.ProviderAudit" })
export type ProviderAudit = Schema.Schema.Type<typeof ProviderAudit>

// SemanticProviderProfile is the SSOT aggregate root of a provider endpoint; id is its profile id (FR28, C5).
export const SemanticProviderProfile = Schema.Struct({
  id: Ids.ProviderProfileId,
  version: ProviderVersion,
  identity: ProviderIdentity,
  transport: ProviderTransport,
  credentials: ProviderCredentials,
  audit: ProviderAudit,
}).annotate({ identifier: "SemanticProvider.SemanticProviderProfile" })
export type SemanticProviderProfile = Schema.Schema.Type<typeof SemanticProviderProfile>
