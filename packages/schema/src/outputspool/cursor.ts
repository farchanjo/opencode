export * as Cursor from "./cursor"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/cursor.cue one-to-one. OutputCursor is the
// opaque follow token bound to a group generation and byte offset with an
// integrity tag (FR17, FR22, C14, C18). It exposes no client-visible internals
// beyond the opaque contract; a reconnect with a stale or superseded cursor
// returns a stable expired/invalid_cursor code rather than rewinding or leaking a
// later generation (C14). No path field exists.

// OutputCursor is the opaque resume token: group, generation, channel, offset and integrity tag (FR17, C14, C18).
export const OutputCursor = Schema.Struct({
  group_id: Ids.GroupId,
  generation: Values.Generation,
  channel: Enums.Channel,
  offset: Values.ByteOffset,
  integrity_tag: TextValues.IntegrityTag,
}).annotate({ identifier: "OutputSpoolCursor.OutputCursor" })
export type OutputCursor = Schema.Schema.Type<typeof OutputCursor>

// CursorStatus carries the cursor lifecycle state and a stable error code on rejection (FR22, C14, AC4).
export const CursorStatus = Schema.Struct({
  state: Enums.CursorState,
  error_code: Schema.NullOr(Enums.ErrorCode),
}).annotate({ identifier: "OutputSpoolCursor.CursorStatus" })
export type CursorStatus = Schema.Schema.Type<typeof CursorStatus>
