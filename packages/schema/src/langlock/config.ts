export * as Config from "./config"

import { Schema } from "effect"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/langlock/config.cue one-to-one. The langlock.*
// Config.Service keys (FR5, FR7, C2). Lang Lock policy/config rides the canonical
// Feature 007 Config.Service authority that already merges global and project
// sources; no parallel store is introduced (C2). Global is the base authority; a
// project override applies only under langlock.override and never relaxes the
// global hard-policy floor (FR5, Security 1).

// ConfigLanguage carries the langlock.enabled / langlock.tag / langlock.enforcementMode keys (FR1, FR7, FR16).
export const ConfigLanguage = Schema.Struct({
  enabled: TextValues.Enabled,
  tag: Ids.LanguageTag,
  enforcement_mode: Enums.EnforcementMode,
}).annotate({ identifier: "LangLockConfig.ConfigLanguage" })
export type ConfigLanguage = Schema.Schema.Type<typeof ConfigLanguage>

// ConfigAuthority carries the langlock.scope / langlock.hardFloor / langlock.override / manifest keys (FR5, C2, C16).
export const ConfigAuthority = Schema.Struct({
  scope: Enums.Scope, // default project (C2)
  hard_floor: TextValues.HardFloor,
  override_authorized: TextValues.OverrideAuthorized,
  manifest_ref: Schema.NullOr(Correlation.ManifestRef),
}).annotate({ identifier: "LangLockConfig.ConfigAuthority" })
export type ConfigAuthority = Schema.Schema.Type<typeof ConfigAuthority>

// LangLockConfig is the merged langlock.* config document persisted in Config.Service (FR5, FR7, C2).
export const LangLockConfig = Schema.Struct({
  language: ConfigLanguage,
  authority: ConfigAuthority,
  version: Values.ConfigVersion,
}).annotate({ identifier: "LangLockConfig.LangLockConfig" })
export type LangLockConfig = Schema.Schema.Type<typeof LangLockConfig>
