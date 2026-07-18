export * as Policy from "./policy"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/policy.cue and policy-parts.cue one-to-one.
// LangLockPolicy is the durable policy aggregate root persisted in the Feature
// 007 Config.Service authority (FR5, FR7, C2). Global configuration is the base
// authority; a project override applies only when langlock.override is authorized
// and never relaxes the global hard-policy floor (FR5, Security 1). Sub-objects
// each stay within the calisthenics field bound.

// PolicyIdentity carries the owning principal, CAS version and lifecycle timestamps (FR5, FR7).
export const PolicyIdentity = Schema.Struct({
  principal: Correlation.Principal,
  version: Values.PolicyVersion,
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
}).annotate({ identifier: "LangLockPolicy.PolicyIdentity" })
export type PolicyIdentity = Schema.Schema.Type<typeof PolicyIdentity>

// PolicyLanguage carries the enabled flag, canonical tag, display name and enforcement mode (FR1, FR7, FR16).
export const PolicyLanguage = Schema.Struct({
  enabled: TextValues.Enabled,
  tag: Ids.LanguageTag,
  display_name: TextValues.DisplayName,
  enforcement_mode: Enums.EnforcementMode,
}).annotate({ identifier: "LangLockPolicy.PolicyLanguage" })
export type PolicyLanguage = Schema.Schema.Type<typeof PolicyLanguage>

// PolicyAuthority carries scope, origin, floor, override and the bound project/manifest refs (FR5, C2, C16).
export const PolicyAuthority = Schema.Struct({
  scope: Enums.Scope,
  origin: Enums.Origin,
  hard_floor: TextValues.HardFloor,
  override_authorized: TextValues.OverrideAuthorized,
  project_ref: Schema.NullOr(Correlation.ProjectRef),
  manifest_ref: Schema.NullOr(Correlation.ManifestRef),
}).annotate({ identifier: "LangLockPolicy.PolicyAuthority" })
export type PolicyAuthority = Schema.Schema.Type<typeof PolicyAuthority>

// LangLockPolicy is the aggregate root of a Lang Lock policy; id is the policy_id (FR5, C2).
export const LangLockPolicy = Schema.Struct({
  id: Ids.PolicyId,
  identity: PolicyIdentity,
  language: PolicyLanguage,
  authority: PolicyAuthority,
}).annotate({ identifier: "LangLockPolicy.LangLockPolicy" })
export type LangLockPolicy = Schema.Schema.Type<typeof LangLockPolicy>
