export * as Allowlist from "./allowlist"

import { Schema } from "effect"
import { Ids } from "./ids"
import { TextValues } from "./text-values"

// Mirrors doc/arch/schemas/langlock/allowlist.cue one-to-one. The eight initial
// allowlisted tags, each paired with a human and native display name (FR3, FR4,
// C13). UI pickers show the human/native names only; the canonical BCP 47 tag is
// stored and validated but never surfaced as the primary label (FR4, AC3).
// English (United States) is the enabled-by-default artifact language (FR1).

// AllowlistEntry pairs a canonical tag with its human and native display names (FR3, C13).
export const AllowlistEntry = Schema.Struct({
  tag: Ids.LanguageTag,
  display_name: TextValues.DisplayName, // human name, e.g. "English (United States)"
  native_name: TextValues.DisplayName, // native name, e.g. "Português (Brasil)"
}).annotate({ identifier: "LangLockAllowlist.AllowlistEntry" })
export type AllowlistEntry = Schema.Schema.Type<typeof AllowlistEntry>

// AllowlistArray is the first-class collection of the eight initial allowlisted
// entries (FR3). Named distinctly from the module self-export namespace
// `Allowlist`, mirroring the `Policy.LangLockPolicy` / `Events.LangLockEvent`
// convention where the primary export is not named after its module.
export const AllowlistArray = Schema.Array(AllowlistEntry)
export type AllowlistArray = Schema.Schema.Type<typeof AllowlistArray>

// DefaultTag is the enabled-by-default artifact language, English (United States) (FR1).
export const DefaultTag = Schema.Literal("en-US")
export type DefaultTag = typeof DefaultTag.Type

// The eight initial allowlisted tags (FR3); each stored tag is re-validated
// against Intl.getCanonicalLocales and this allowlist before use (FR4, Security 2).
export const INITIAL_ALLOWLIST: ReadonlyArray<{
  readonly tag: string
  readonly display_name: string
  readonly native_name: string
}> = [
  { tag: "en-US", display_name: "English (United States)", native_name: "English (United States)" },
  { tag: "en-CA", display_name: "English (Canada)", native_name: "English (Canada)" },
  { tag: "en-GB", display_name: "English (United Kingdom)", native_name: "English (United Kingdom)" },
  { tag: "en-AU", display_name: "English (Australia)", native_name: "English (Australia)" },
  { tag: "pt-BR", display_name: "Portuguese (Brazil)", native_name: "Português (Brasil)" },
  { tag: "es-ES", display_name: "Spanish (Spain)", native_name: "Español (España)" },
  { tag: "es-MX", display_name: "Spanish (Mexico)", native_name: "Español (México)" },
  { tag: "es-AR", display_name: "Spanish (Argentina)", native_name: "Español (Argentina)" },
]
