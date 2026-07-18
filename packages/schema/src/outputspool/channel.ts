export * as Channel from "./channel"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/channel.cue and channel-parts.cue
// one-to-one. OutputChannel is one typed channel within a group, identified by
// its OutputRef (FR15, FR17). It is an Entity because it has stable identity
// across appends and state transitions while its committed length grows. A
// textual channel carries Feature 004 language provenance; the reasoning channel
// is stricter by default — never emitted to OTEL, never in an unauthorized
// preview, shorter TTL (FR16, C9). Each sub-object stays within the calisthenics
// field bound.

// ChannelContent carries the media type and Feature 004 language provenance; content-free (FR16, FR40, C8).
export const ChannelContent = Schema.Struct({
  content_type: TextValues.ContentType,
  language_tag: Schema.NullOr(TextValues.LanguageTag),
  language_provenance: EnumsEvent.LanguageProvenance,
}).annotate({ identifier: "OutputSpoolChannel.ChannelContent" })
export type ChannelContent = Schema.Schema.Type<typeof ChannelContent>

// ChannelState carries the state, committed-length authority, open-stream signals and admission fault (FR10, FR21, C20).
export const ChannelState = Schema.Struct({
  group_state: Enums.GroupState,
  committed_bytes: Values.CommittedBytes,
  caught_up: TextValues.CaughtUp,
  eof: TextValues.Eof,
  admission_fault: Enums.AdmissionFault,
}).annotate({ identifier: "OutputSpoolChannel.ChannelState" })
export type ChannelState = Schema.Schema.Type<typeof ChannelState>

// ChannelProvenance carries content-free correlation and capture time only (C22).
export const ChannelProvenance = Schema.Struct({
  source: EnumsEvent.EventSource,
  captured_at: DateTimeUtcFromMillis,
  correlation_id: Correlation.CorrelationId,
}).annotate({ identifier: "OutputSpoolChannel.ChannelProvenance" })
export type ChannelProvenance = Schema.Schema.Type<typeof ChannelProvenance>

// OutputChannel is a typed channel entity; id is its bounded opaque OutputRef (FR15, FR17).
export const OutputChannel = Schema.Struct({
  id: Ids.OutputRef,
  channel: Enums.Channel,
  content: ChannelContent,
  state: ChannelState,
  provenance: ChannelProvenance,
}).annotate({ identifier: "OutputSpoolChannel.OutputChannel" })
export type OutputChannel = Schema.Schema.Type<typeof OutputChannel>
