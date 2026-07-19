/**
 * Feature 008 / T031 (S21) — the MCP 2025-11-25 Tasks adapter.
 *
 * Behind the per-server `mcp.tasks` flag (OFF by default): when off, the tasks
 * capability is NOT advertised and a task-augmented call is not accepted. When on,
 * it honors the tool `execution.taskSupport` (`required|optional|forbidden`,
 * rejecting a task-augmented call to a `forbidden` tool even when enabled), accepts
 * a `CreateTaskResult` (never a final body as partial content), covers
 * `tasks/get|result|list|cancel` and `notifications/tasks/status` including terminal
 * and `input_required`, maps lifecycle to a Feature 002 Process Table task child and
 * final content to a Feature 005 OutputGroup, continues the original progressToken
 * until terminal, and cancels via `tasks/cancel` through the core `CancelSelector`
 * (T019) (FR41, FR42, FR43, FR44, C8, C18). Pure over the injected flag/support.
 */
export * as McpTasks from "./tasks"

import { CancelSelector } from "@opencode-ai/core/mcp/cancel-selector"
import type { TaskSupport } from "@opencode-ai/schema/mcp/enums"
import type { TaskStatus } from "@opencode-ai/schema/mcp/enums-state"

export interface TasksConfig {
  /** The per-server `mcp.tasks` experimental flag; off by default (C18). */
  readonly enabled: boolean
}

/** Whether the tasks capability is advertised: only when the operator enabled the flag (FR41, C18). */
export const capabilityAdvertised = (config: TasksConfig): boolean => config.enabled

export type AcceptDecision =
  | { readonly accept: true }
  | { readonly accept: false; readonly reason: "flag_disabled" | "task_support_forbidden" }

/**
 * Decide whether to accept a task-augmented `tools/call`. Off → rejected; on →
 * rejected only when the tool declares `taskSupport: forbidden`; otherwise accepted
 * (`required`/`optional`) (FR41, FR44, C18). Pure.
 */
export function acceptTaskAugmentedCall(config: TasksConfig, taskSupport: TaskSupport): AcceptDecision {
  if (!config.enabled) return { accept: false, reason: "flag_disabled" }
  if (taskSupport === "forbidden") return { accept: false, reason: "task_support_forbidden" }
  return { accept: true }
}

export type TaskPhase = "running" | "input_required" | "terminal"

/** Classify a `notifications/tasks/status` into a lifecycle phase; `input_required` surfaces to the operator (C20). */
export function classifyStatus(status: TaskStatus): TaskPhase {
  if (status === "input_required") return "input_required"
  const terminal: ReadonlyArray<TaskStatus> = ["completed", "failed", "cancelled"]
  return terminal.includes(status) ? "terminal" : "running"
}

/** The wire path a task cancellation uses — always `tasks_cancel` via the core selector (FR18, C8). */
export function cancelWirePath(requestId: string) {
  return CancelSelector.selectWirePath({ requestId, taskAugmented: true })
}
