export * as Page from "./page"

import { Schema } from "effect"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/page.cue one-to-one. The paged read
// contract carries a mandatory server-capped `limit`; the canonical offset unit
// is uncompressed bytes; reads are UTF-8 safe and never split a codepoint (FR20,
// AC2, AC3). `eof` is true only when the channel is sealed or aborted and the
// reader has consumed through committed end; an open stream reports `caught_up`,
// never `eof`, when merely caught up (FR21, C20). No path is ever accepted.

// PageRange is the requested byte window: offset plus a mandatory server-capped limit (FR20, C3, AC1).
export const PageRange = Schema.Struct({
  offset: Values.ByteOffset,
  limit: Values.PageLimit,
  length: Values.ByteLength,
}).annotate({ identifier: "OutputSpoolPage.PageRange" })
export type PageRange = Schema.Schema.Type<typeof PageRange>

// ReadRequest is a bounded paged read against an OutputRef; no path is ever accepted (FR12, FR20).
export const ReadRequest = Schema.Struct({
  output_ref: Ids.OutputRef,
  offset: Values.ByteOffset,
  limit: Values.PageLimit,
}).annotate({ identifier: "OutputSpoolPage.ReadRequest" })
export type ReadRequest = Schema.Schema.Type<typeof ReadRequest>

// ReadPage is the UTF-8-safe page response with resume and open-stream signals (FR21, AC2, AC3).
export const ReadPage = Schema.Struct({
  range: PageRange,
  next_offset: Values.NextOffset,
  committed_bytes: Values.CommittedBytes,
  caught_up: TextValues.CaughtUp,
  eof: TextValues.Eof,
}).annotate({ identifier: "OutputSpoolPage.ReadPage" })
export type ReadPage = Schema.Schema.Type<typeof ReadPage>
