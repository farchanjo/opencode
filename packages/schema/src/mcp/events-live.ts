export * as EventsLive from "./events-live"

import { Schema } from "effect"
import { Enums } from "./enums"
import { Envelope } from "./envelope"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/mcp/events-live.cue one-to-one — the live call-plane event
// members (FR38, C3). Call start, call progress and a cancel request are coalesced
// UI/OTEL signals that are never required to persist and may be dropped under load
// (FR38, C3). Progress is metadata only — wire progress is monotonic per token, it
// updates the Process Table child and OTEL, and it never enters LLM turns or is
// persisted as tool output (FR14, FR15, C7). A cancel request carries the standard vs
// task wire path before settlement (FR17, FR18, C8). No member carries content or a
// path (FR38, FR56).

// CallStartedDetail carries the request id and the invoked tool (FR39, C8).
export const CallStartedDetail = Schema.Struct({
  request_id: Ids.RequestId,
  tool_ref: Ids.ToolName,
}).annotate({ identifier: "McpEvent.CallStartedDetail" })
export type CallStartedDetail = Schema.Schema.Type<typeof CallStartedDetail>

// CallProgressDetail carries the monotonic wire progress and optional total (FR14, FR15, C7).
export const CallProgressDetail = Schema.Struct({
  request_id: Ids.RequestId,
  progress: Values.Progress,
  total: Schema.NullOr(Values.Total),
}).annotate({ identifier: "McpEvent.CallProgressDetail" })
export type CallProgressDetail = Schema.Schema.Type<typeof CallProgressDetail>

// CancelRequestedDetail carries the request id and the standard vs task wire path (FR17, FR18, C8).
export const CancelRequestedDetail = Schema.Struct({
  request_id: Ids.RequestId,
  wire_path: Enums.CancelWirePath,
}).annotate({ identifier: "McpEvent.CancelRequestedDetail" })
export type CancelRequestedDetail = Schema.Schema.Type<typeof CancelRequestedDetail>

// mcp.call.started — a tools/call began; live UI/OTEL signal (FR39, C8).
export const McpCallStartedEvent = Schema.Struct({
  type: Schema.Literal("mcp.call.started"),
  envelope: Envelope.McpEventEnvelope,
  detail: CallStartedDetail,
}).annotate({ identifier: "McpEvent.McpCallStartedEvent" })
export type McpCallStartedEvent = Schema.Schema.Type<typeof McpCallStartedEvent>

// mcp.call.progress — a monotonic progress frame; never an LLM turn (FR14, C7).
export const McpCallProgressEvent = Schema.Struct({
  type: Schema.Literal("mcp.call.progress"),
  envelope: Envelope.McpEventEnvelope,
  detail: CallProgressDetail,
}).annotate({ identifier: "McpEvent.McpCallProgressEvent" })
export type McpCallProgressEvent = Schema.Schema.Type<typeof McpCallProgressEvent>

// mcp.call.cancel_requested — a cancel was requested on a chosen wire path (FR17, C8).
export const McpCallCancelRequestedEvent = Schema.Struct({
  type: Schema.Literal("mcp.call.cancel_requested"),
  envelope: Envelope.McpEventEnvelope,
  detail: CancelRequestedDetail,
}).annotate({ identifier: "McpEvent.McpCallCancelRequestedEvent" })
export type McpCallCancelRequestedEvent = Schema.Schema.Type<typeof McpCallCancelRequestedEvent>
