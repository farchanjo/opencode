export * as EventsCall from "./events-call"

import { Schema } from "effect"
import { EnumsState } from "./enums-state"
import { Envelope } from "./envelope"
import { Ids } from "./ids"
import { Refs } from "./refs"
import { Values } from "./values"

// Mirrors doc/arch/schemas/mcp/events-call.cue one-to-one — the durable
// call-settlement event members (FR38, C3). Call settlement, call cancellation and
// task settlement persist for audit correlation and carry the OutputRef and byte
// length of the spooled result — never the body, a path, or a URI-as-content (FR38,
// FR56, C16, C26). A settlement distinguishes tool-execution isError from a protocol
// error (FR12, C5); a cancellation records local settlement vs an unacknowledged
// remote (FR17, C8); a task settlement carries the terminal task status (FR42, C18).
// No member carries content.

// CallSettledDetail carries the request id, outcome, OutputRef and byte length (FR12, C5, C16).
export const CallSettledDetail = Schema.Struct({
  request_id: Ids.RequestId,
  outcome: EnumsState.CallOutcome,
  output_ref: Refs.OutputRef,
  byte_length: Values.ByteLength,
}).annotate({ identifier: "McpEvent.CallSettledDetail" })
export type CallSettledDetail = Schema.Schema.Type<typeof CallSettledDetail>

// CallCancelledDetail carries the request id and the local/remote cancel outcome (FR17, C8).
export const CallCancelledDetail = Schema.Struct({
  request_id: Ids.RequestId,
  outcome: EnumsState.CancelOutcome,
}).annotate({ identifier: "McpEvent.CallCancelledDetail" })
export type CallCancelledDetail = Schema.Schema.Type<typeof CallCancelledDetail>

// TaskSettledDetail carries the task id, terminal status and OutputRef (FR42, C16, C18).
export const TaskSettledDetail = Schema.Struct({
  task_id: Ids.TaskId,
  status: EnumsState.TaskStatus,
  output_ref: Schema.NullOr(Refs.OutputRef),
}).annotate({ identifier: "McpEvent.TaskSettledDetail" })
export type TaskSettledDetail = Schema.Schema.Type<typeof TaskSettledDetail>

// mcp.call.settled — a tools/call settled with a spooled OutputRef (FR38, C16).
export const McpCallSettledEvent = Schema.Struct({
  type: Schema.Literal("mcp.call.settled"),
  envelope: Envelope.McpEventEnvelope,
  detail: CallSettledDetail,
}).annotate({ identifier: "McpEvent.McpCallSettledEvent" })
export type McpCallSettledEvent = Schema.Schema.Type<typeof McpCallSettledEvent>

// mcp.call.cancelled — a standard call cancelled via notifications/cancelled (FR17, C8).
export const McpCallCancelledEvent = Schema.Struct({
  type: Schema.Literal("mcp.call.cancelled"),
  envelope: Envelope.McpEventEnvelope,
  detail: CallCancelledDetail,
}).annotate({ identifier: "McpEvent.McpCallCancelledEvent" })
export type McpCallCancelledEvent = Schema.Schema.Type<typeof McpCallCancelledEvent>

// mcp.task.settled — a task-augmented execution reached a terminal status (FR42, C18).
export const McpTaskSettledEvent = Schema.Struct({
  type: Schema.Literal("mcp.task.settled"),
  envelope: Envelope.McpEventEnvelope,
  detail: TaskSettledDetail,
}).annotate({ identifier: "McpEvent.McpTaskSettledEvent" })
export type McpTaskSettledEvent = Schema.Schema.Type<typeof McpTaskSettledEvent>
