export * as Stat from "./stat"

import { Schema } from "effect"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/stat.cue one-to-one. OutputStat is the
// content-free read model for a channel returned by output.stat (FR18, FR41). It
// carries state, committed length, durability tier and content provenance, never
// a path and never content (FR12, C18, C22). Textual channels carry the Feature
// 004 language tag/provenance read from the trusted execution envelope, never
// recomputed by the content plane (FR40, C8).

// StatProvenance carries content type and Feature 004 language provenance; content-free (FR40, C8).
export const StatProvenance = Schema.Struct({
  content_type: TextValues.ContentType,
  language_tag: Schema.NullOr(TextValues.LanguageTag),
  language_provenance: EnumsEvent.LanguageProvenance,
  correlation_id: Correlation.CorrelationId,
}).annotate({ identifier: "OutputSpoolStat.StatProvenance" })
export type StatProvenance = Schema.Schema.Type<typeof StatProvenance>

// OutputStat is the content-free channel read model returned by output.stat (FR18, FR41).
export const OutputStat = Schema.Struct({
  output_ref: Ids.OutputRef,
  channel: Enums.Channel,
  state: Enums.GroupState,
  committed_bytes: Values.CommittedBytes,
  durability_tier: Enums.DurabilityTier,
  provenance: StatProvenance,
}).annotate({ identifier: "OutputSpoolStat.OutputStat" })
export type OutputStat = Schema.Schema.Type<typeof OutputStat>
