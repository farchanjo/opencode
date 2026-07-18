/**
 * Feature 002 / T034 — bounded-polling `watch` degrade path.
 *
 * `ProcessPort.observe` (`contracts/ports.ts`) is a live `Stream`, but the CLI
 * operator transport (`../operator/dispatch.ts`, `createOperatorClient`) is
 * request/response only — no push/SSE transport exists yet. Until one lands,
 * `opencode process|task watch` polls the `process.watch`/`task.watch`
 * reserved command on a bounded interval and stops at the first terminal
 * state, honestly reflecting what the transport can do today rather than
 * faking a live stream. See
 * doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/plan.md
 * (S16 "CLI + TUI surfaces") and data-model.md `live_coalesce_interval_ms`
 * for the panel-side coalescing constant this mirrors. Revisit once T026's
 * observation service grows a CLI-reachable push transport.
 */

/** The five absorbing `ProcessState` members (contracts/ports.ts `ProcessState`). */
export const TERMINAL_PROCESS_STATES = ["completed", "failed", "cancelled", "zombie", "unknown"] as const

export type TerminalProcessState = (typeof TERMINAL_PROCESS_STATES)[number]

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_PROCESS_STATES)

export function isTerminalStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_SET.has(status)
}

/** Default poll cadence and bound; both are overridable via CLI flags. */
export const DEFAULT_POLL_INTERVAL_MS = 500
export const DEFAULT_MAX_POLLS = 120

export interface PollPlan {
  readonly intervalMs: number
  readonly maxPolls: number
}

/** Clamp caller-supplied poll flags to a sane, always-bounded plan. */
export function resolvePollPlan(intervalMs: number | undefined, maxPolls: number | undefined): PollPlan {
  const interval = intervalMs !== undefined && intervalMs > 0 ? Math.floor(intervalMs) : DEFAULT_POLL_INTERVAL_MS
  const max = maxPolls !== undefined && maxPolls > 0 ? Math.floor(maxPolls) : DEFAULT_MAX_POLLS
  return { intervalMs: interval, maxPolls: max }
}

/** Extract the row-like status field a poll frame carries, tolerating `{ row: { status } }` or `{ status }`. */
export function statusOf(frame: unknown): unknown {
  if (typeof frame !== "object" || frame === null) return undefined
  const record = frame as Record<string, unknown>
  const row = typeof record.row === "object" && record.row !== null ? (record.row as Record<string, unknown>) : record
  return row.status
}

export type PollOutcome = "terminal" | "exhausted"

/** Decide whether polling should stop after observing one frame. */
export function pollOutcome(frame: unknown, pollsRemaining: number): PollOutcome | null {
  if (isTerminalStatus(statusOf(frame))) return "terminal"
  if (pollsRemaining <= 0) return "exhausted"
  return null
}

export * as ProcessPoll from "./poll"
