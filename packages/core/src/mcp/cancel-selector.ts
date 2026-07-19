/**
 * Feature 008 / T019 (S11) — the cancellation wire-path selector.
 *
 * Encodes the C8 split drawn in `plan.md` and `enums.cue`/`enums-state.cue` (FR17,
 * FR18, C8). Pure and deterministic, no I/O. A standard (non-task-augmented)
 * in-flight `tools/call` cancels via `notifications/cancelled`; a task-augmented
 * call cancels via `tasks/cancel`. The Feature 002 root tree covers both classes,
 * selecting the correct wire path per child. An unacknowledged remote is recorded
 * as the typed `cancel_requested`/`unknown_remote` `CancelOutcome` — the durable
 * `mcp.call.cancelled` audit — while the pre-settlement `mcp.call.cancel_requested`
 * stays a LIVE signal, never persisted as the audit (FR17, C8).
 */
export * as CancelSelector from "./cancel-selector"

import type { CancelWirePath } from "@opencode-ai/schema/mcp/enums"
import type { CancelOutcome } from "@opencode-ai/schema/mcp/enums-state"

export type { CancelWirePath, CancelOutcome }

/** One in-flight call targeted for cancellation; `taskAugmented` selects the wire path (FR17, C8). */
export interface CancelTarget {
  readonly requestId: string
  /** True when the call was augmented with an MCP Task; it cancels via `tasks/cancel` (FR18, C8). */
  readonly taskAugmented: boolean
}

/**
 * Select the cancellation wire path for one call: a task-augmented call uses
 * `tasks_cancel`, a standard call uses `notifications_cancelled` (FR17, FR18, C8).
 */
export const selectWirePath = (target: CancelTarget): CancelWirePath =>
  target.taskAugmented ? "tasks_cancel" : "notifications_cancelled"

/** One resolved cancellation instruction: the request id and its selected wire path (C8). */
export interface CancelInstruction {
  readonly requestId: string
  readonly wirePath: CancelWirePath
}

/**
 * Select the wire path for every child of a Feature 002 root cancellation tree,
 * covering both call classes with the correct path per child. Pure over the child
 * list; the caller issues the resolved instructions on the transport (FR18, C8).
 */
export const selectTree = (children: ReadonlyArray<CancelTarget>): ReadonlyArray<CancelInstruction> =>
  Object.freeze(children.map((child) => Object.freeze({ requestId: child.requestId, wirePath: selectWirePath(child) })))

/** The remote's response to a cancellation request, feeding the durable audit outcome (FR17, C8). */
export interface RemoteAck {
  /** True once the remote acknowledged the cancel (e.g. a settled `CancelledNotification`). */
  readonly acknowledged: boolean
  /** True when the remote request id is known/addressable; false is an `unknown_remote` (C8). */
  readonly remoteKnown: boolean
}

/**
 * Record the durable `CancelOutcome` from the remote acknowledgement: an
 * acknowledged cancel settles `acknowledged`; an addressable-but-silent remote is
 * `cancel_requested`; an unknown/unaddressable remote is `unknown_remote`. This is
 * the durable `mcp.call.cancelled` audit outcome (FR17, C8).
 */
export const recordOutcome = (ack: RemoteAck): CancelOutcome => {
  if (ack.acknowledged) return "acknowledged"
  return ack.remoteKnown ? "cancel_requested" : "unknown_remote"
}

/** The two mcp.* event classes a cancellation touches (C8). */
export type CancelEventClass = "live" | "durable"

/**
 * The event class for a cancellation signal: the pre-settlement
 * `mcp.call.cancel_requested` is a LIVE signal; the settled `mcp.call.cancelled`
 * carrying the `CancelOutcome` is the DURABLE audit. They are never collapsed (C8).
 */
export const eventClassFor = (type: "mcp.call.cancel_requested" | "mcp.call.cancelled"): CancelEventClass =>
  type === "mcp.call.cancelled" ? "durable" : "live"
