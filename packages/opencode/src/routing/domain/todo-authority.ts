/**
 * Feature 001 / T024 — Todo Authority domain aggregate.
 *
 * Pure, deterministic rules for the session-owned Todo aggregate
 * (hierarchy-flow.md "Todo Lifecycle (per Session)"): exactly one Todo
 * aggregate per goal-bearing Session, a non-empty snapshot gate before
 * dispatch, a completion gate over required items + CAS version + a
 * validation step, and rehydration after compaction/restart.
 *
 * Zero framework deps (plan.md "Domain ... zero framework deps"): no I/O, no
 * Effect runtime import, no storage. Durable persistence, the
 * "exactly one Todo per Session" uniqueness invariant across storage, and
 * the "outside message prose" durability property are enforced by the
 * application/adapter layer (T030, `packages/opencode/src/session/todo.ts`)
 * that wraps these pure functions.
 *
 * KNOWN GAP (report to spec corpus): data-model.md lists the exact
 * TodoRef/TodoVersion field structure and CAS conflict-resolution rules as
 * open clarification parameters. This module makes the following concrete,
 * testable choices pending that clarification:
 *   - `status` is one of "pending" | "in_progress" | "completed" | "cancelled"
 *     (matches the existing `SessionTodo.Info.status` vocabulary).
 *   - a `required` item satisfies the completion gate only in status
 *     "completed" — "cancelled" does NOT satisfy a required item.
 *   - CAS conflicts are resolved by simple version-token equality (no
 *     merge); the caller must re-read and retry.
 */
export * as TodoAuthority from "./todo-authority"

import type { Ids } from "@opencode-ai/schema/routing/ids"

// =============================================================================
// Value objects
// =============================================================================

export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]

export const TODO_PRIORITIES = ["high", "medium", "low"] as const
export type TodoPriority = (typeof TODO_PRIORITIES)[number]

export interface TodoItem {
  readonly id: string
  readonly content: string
  readonly status: TodoStatus
  readonly priority: TodoPriority
  /** Required items gate Session/Task completion; optional items never block. */
  readonly required: boolean
}

/** The session-owned Todo aggregate root — exactly one per goal-bearing Session. */
export interface TodoAggregate {
  readonly sessionId: Ids.SessionId
  readonly ref: Ids.TodoRef
  readonly version: Ids.TodoVersion
  readonly items: ReadonlyArray<TodoItem>
}

// =============================================================================
// Construction
// =============================================================================

/**
 * Builds the aggregate for a newly-created goal-bearing Session. Items may be
 * empty at this point (`todo.initialized` records item_count 0) — the
 * non-empty requirement is enforced at `dispatchGate`, not at construction.
 */
export function initializeTodo(input: {
  readonly sessionId: Ids.SessionId
  readonly ref: Ids.TodoRef
  readonly version: Ids.TodoVersion
  readonly items: ReadonlyArray<TodoItem>
}): TodoAggregate {
  return { sessionId: input.sessionId, ref: input.ref, version: input.version, items: input.items }
}

// =============================================================================
// Gate vocabulary
// =============================================================================

export type GateOutcome = "ok" | "blocked"

export interface GateResult {
  readonly outcome: GateOutcome
  readonly reason: string | null
}

// =============================================================================
// Dispatch gate — non-empty snapshot required before dispatch
// =============================================================================

/** At least one bounded item is required before dispatch; an empty list can never bypass this gate. */
export function dispatchGate(todo: TodoAggregate): GateResult {
  if (todo.items.length === 0) {
    return { outcome: "blocked", reason: "todo snapshot is empty; at least one bounded item is required before dispatch" }
  }
  return { outcome: "ok", reason: null }
}

// =============================================================================
// In-progress invariant — exactly one item in_progress while work remains
// =============================================================================

export function checkSingleInProgress(todo: TodoAggregate): GateResult {
  const inProgress = todo.items.filter((item) => item.status === "in_progress")
  const remains = todo.items.some((item) => item.status === "pending" || item.status === "in_progress")
  if (remains && inProgress.length !== 1) {
    return {
      outcome: "blocked",
      reason: `expected exactly one in_progress item while work remains, found ${inProgress.length}`,
    }
  }
  return { outcome: "ok", reason: null }
}

// =============================================================================
// Completion gate — required items + version (CAS) + validation step
// =============================================================================

export interface CompletionCheck {
  readonly expectedVersion: Ids.TodoVersion
  readonly validationPerformed: boolean
}

export interface CompletionGateResult extends GateResult {
  readonly pendingItems: number
}

/**
 * Session/Task cannot terminate as completed unless: every required item is
 * "completed", the caller's expected version matches the aggregate's current
 * version (CAS), and a validation step was performed. Any failing condition
 * short-circuits to "blocked" (`todo.completion_blocked`) — never a silent pass.
 */
export function completionGate(todo: TodoAggregate, check: CompletionCheck): CompletionGateResult {
  const pending = todo.items.filter((item) => item.required && item.status !== "completed")
  if (pending.length > 0) {
    return { outcome: "blocked", reason: "required items are not all completed", pendingItems: pending.length }
  }
  if (todo.version !== check.expectedVersion) {
    return { outcome: "blocked", reason: "todo version mismatch (CAS)", pendingItems: 0 }
  }
  if (!check.validationPerformed) {
    return { outcome: "blocked", reason: "validation step missing", pendingItems: 0 }
  }
  return { outcome: "ok", reason: null, pendingItems: 0 }
}

// =============================================================================
// CAS update
// =============================================================================

export interface CasUpdate {
  readonly expectedVersion: Ids.TodoVersion
  readonly nextVersion: Ids.TodoVersion
  readonly items: ReadonlyArray<TodoItem>
}

export type CasResult =
  | { readonly ok: true; readonly todo: TodoAggregate }
  | { readonly ok: false; readonly reason: "version_conflict"; readonly currentVersion: Ids.TodoVersion }

/** Compare-and-set update: rejects on version mismatch instead of merging or overwriting silently. */
export function applyCas(todo: TodoAggregate, update: CasUpdate): CasResult {
  if (todo.version !== update.expectedVersion) {
    return { ok: false, reason: "version_conflict", currentVersion: todo.version }
  }
  return { ok: true, todo: { ...todo, version: update.nextVersion, items: update.items } }
}

// =============================================================================
// Ownership — parent cannot edit child Todo
// =============================================================================

/** Only the owning Session may mutate its own Todo aggregate; parent Sessions can never edit a child's Todo. */
export function assertOwner(todo: TodoAggregate, actingSessionId: Ids.SessionId): GateResult {
  if (todo.sessionId !== actingSessionId) {
    return { outcome: "blocked", reason: "only the owning session may mutate its Todo aggregate" }
  }
  return { outcome: "ok", reason: null }
}

// =============================================================================
// Dispatch envelope projection — bounded summary, never full content
// =============================================================================

export interface TodoSummary {
  readonly ref: Ids.TodoRef
  readonly version: Ids.TodoVersion
  readonly itemCount: number
  readonly statusCounts: Readonly<Record<TodoStatus, number>>
}

/** Bounded read-only projection for dispatch envelopes: TodoRef/TodoVersion + counts, never full item content. */
export function summarize(todo: TodoAggregate): TodoSummary {
  const statusCounts: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 }
  for (const item of todo.items) statusCounts[item.status]++
  return { ref: todo.ref, version: todo.version, itemCount: todo.items.length, statusCounts }
}

// =============================================================================
// Rehydration — after compaction or restart
// =============================================================================

export type RehydrateResult =
  | { readonly ok: true; readonly todo: TodoAggregate }
  | { readonly ok: false; readonly reason: "ref_mismatch" }

/**
 * Reconciles an in-memory reference against the durable snapshot loaded from
 * outside message prose. The durable snapshot is always authoritative; this
 * only guards against rehydrating the wrong aggregate.
 */
export function rehydrate(expectedRef: Ids.TodoRef, durable: TodoAggregate): RehydrateResult {
  if (durable.ref !== expectedRef) return { ok: false, reason: "ref_mismatch" }
  return { ok: true, todo: durable }
}
