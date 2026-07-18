export * as Usage from "./usage"

import { Schema } from "effect"
import { optional } from "../schema"
import { EnumsObservation } from "./enums-observation"
import { UsageValues } from "./usage-values"

// Mirrors doc/arch/schemas/lifecycle/usage.cue (package lifecycle.usage) —
// LiveUsage is the honest live-usage projection (C21, FR55). Missing usage is
// an explicit unavailable state — never zero, never fabricated; unknown token
// fields are never summed; tokens_per_second is valid only from monotonic
// elapsed time.
//
// TokenBreakdown deviates from the CUE's `#TokenCount | null` fields: tasks.md
// T006 and data-model.md require "an absent key is unavailable", so each field
// is an optional KEY (via the shared optional() helper) rather than a present
// null value. cost_usd follows data-model.md as an optional key; the CUE models
// it as `| null`. tokens_per_second stays null-unless-valid (Schema.NullOr).

// TokenBreakdown holds known token counts; an absent key is unavailable (C21).
export const TokenBreakdown = Schema.Struct({
  input: optional(UsageValues.TokenCount),
  output: optional(UsageValues.TokenCount),
  reasoning: optional(UsageValues.TokenCount),
  cache_read: optional(UsageValues.TokenCount),
  cache_write: optional(UsageValues.TokenCount),
}).annotate({ identifier: "LifecycleUsage.TokenBreakdown" })
export type TokenBreakdown = Schema.Schema.Type<typeof TokenBreakdown>

// UsageProvenanceMark records estimated-versus-reported provenance and source.
export const UsageProvenanceMark = Schema.Struct({
  provenance: EnumsObservation.UsageProvenance,
  source: EnumsObservation.UsageSource,
}).annotate({ identifier: "LifecycleUsage.UsageProvenanceMark" })
export type UsageProvenanceMark = Schema.Schema.Type<typeof UsageProvenanceMark>

// LiveUsage is the honest live-usage projection for a card or row. available
// false renders "tokens unavailable" (AC25); elapsed_ms is monotonic and the
// only valid tokens/s denominator (C21).
export const LiveUsage = Schema.Struct({
  available: Schema.Boolean,
  tokens: TokenBreakdown,
  cost_usd: optional(UsageValues.CostUsd),
  provenance: UsageProvenanceMark,
  elapsed_ms: UsageValues.ElapsedMs,
  tokens_per_second: Schema.NullOr(UsageValues.TokensPerSecond),
}).annotate({ identifier: "LifecycleUsage.LiveUsage" })
export type LiveUsage = Schema.Schema.Type<typeof LiveUsage>
