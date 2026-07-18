export * as Effective from "./effective"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/effective.cue one-to-one. EffectiveConfig is
// the immutable read model surfaced to the LLM inside the trusted execution
// envelope (FR7, C4). It carries no content and no administrative capability; the
// LLM reads it but never invokes admin commands (FR35, AC13). It is stamped into
// the execution envelope at start and is immutable for that execution (C11).

// EffectiveLanguage carries the enabled flag, canonical tag, display name and enforcement mode (FR7).
export const EffectiveLanguage = Schema.Struct({
  enabled: TextValues.Enabled,
  tag: Ids.LanguageTag,
  display_name: TextValues.DisplayName,
  enforcement_mode: Enums.EnforcementMode,
}).annotate({ identifier: "LangLockEffective.EffectiveLanguage" })
export type EffectiveLanguage = Schema.Schema.Type<typeof EffectiveLanguage>

// EffectiveAuthority carries the resolved scope, origin, policy version and override state (FR7, C2).
export const EffectiveAuthority = Schema.Struct({
  scope: Enums.Scope,
  origin: Enums.Origin,
  policy_version: Values.PolicyVersion,
  override_authorized: TextValues.OverrideAuthorized,
}).annotate({ identifier: "LangLockEffective.EffectiveAuthority" })
export type EffectiveAuthority = Schema.Schema.Type<typeof EffectiveAuthority>

// EffectiveConfig is the immutable, content-free effective policy read model (FR7, FR35, C4).
export const EffectiveConfig = Schema.Struct({
  language: EffectiveLanguage,
  authority: EffectiveAuthority,
}).annotate({ identifier: "LangLockEffective.EffectiveConfig" })
export type EffectiveConfig = Schema.Schema.Type<typeof EffectiveConfig>
