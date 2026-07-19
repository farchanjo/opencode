export * as EventsLog from "./events-log"

import { Schema } from "effect"
import { Enums } from "./enums"
import { EnumsState } from "./enums-state"
import { Envelope } from "./envelope"
import { Ids } from "./ids"
import { TextValues } from "./text-values"

// Mirrors doc/arch/schemas/mcp/events-log.cue one-to-one — the live task-status and
// logging event members (FR38, C3). Task status and log are coalesced UI/OTEL signals
// that are never required to persist and may be dropped under load (FR38, C3). A task
// status including input_required surfaces to the operator and is never partial tool
// content (FR42, FR47, C18, C20). A log member carries a redacted level-tagged line
// under rate limits and native retention — secrets, tokens and path-shaped fields
// stripped (FR28, C23). No member carries content or a path (FR38, FR56).

// TaskStatusDetail carries the task id and its status including input_required (FR42, C18, C20).
export const TaskStatusDetail = Schema.Struct({
  task_id: Ids.TaskId,
  status: EnumsState.TaskStatus,
}).annotate({ identifier: "McpEvent.TaskStatusDetail" })
export type TaskStatusDetail = Schema.Schema.Type<typeof TaskStatusDetail>

// LogDetail carries the redacted level-tagged log line under rate limits (FR28, C23).
export const LogDetail = Schema.Struct({
  level: Enums.LogLevel,
  redacted: TextValues.RedactedText,
}).annotate({ identifier: "McpEvent.LogDetail" })
export type LogDetail = Schema.Schema.Type<typeof LogDetail>

// mcp.task.status — a task status frame including input_required; operator-surfaced (FR42, C20).
export const McpTaskStatusEvent = Schema.Struct({
  type: Schema.Literal("mcp.task.status"),
  envelope: Envelope.McpEventEnvelope,
  detail: TaskStatusDetail,
}).annotate({ identifier: "McpEvent.McpTaskStatusEvent" })
export type McpTaskStatusEvent = Schema.Schema.Type<typeof McpTaskStatusEvent>

// mcp.log — a redacted logging notification under rate limits (FR28, C23).
export const McpLogEvent = Schema.Struct({
  type: Schema.Literal("mcp.log"),
  envelope: Envelope.McpEventEnvelope,
  detail: LogDetail,
}).annotate({ identifier: "McpEvent.McpLogEvent" })
export type McpLogEvent = Schema.Schema.Type<typeof McpLogEvent>
