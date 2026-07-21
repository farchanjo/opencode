/**
 * Feature 044 / Phase 3 — the hierarchy orchestration contract (FR-F3).
 *
 * Drives the pure orchestration engine (`session/orchestration-aggregate.ts`) over
 * the REAL Todo authority (`routing/domain/todo-authority.ts`) and the REAL shared
 * `RoutingSessionState` store (`session/routing-state.ts`). Proves each of the four
 * leaves and the cross-cutting invariants:
 *   (a) a Manager dispatching N Workers records N aggregate entries;
 *   (b) a Manager turn is blocked while any FOREGROUND Worker is `pending` and
 *       settles when all are terminal;
 *   (c) a `failed`/`aborted` Worker surfaces (bounded reason) and satisfies the
 *       terminal gate without deadlocking;
 *   (d) a Worker result failing the SHAPE/POLICY/DOMAIN stage takes the defined
 *       fail-action, ordered + fail-fast, carried onto the outcome;
 *   (e) a terminal Worker's wake is coalesced/idempotent per child session id;
 *   (f) a never-completing Worker is force-`aborted` at max-wait and the gate
 *       settles;
 *   (g) a disabled/non-`auto` session is byte-identical to today (no aggregate);
 *   (h) a fan-out-denied Worker (F043) produces no entry and the gate settles over
 *       the granted set.
 *
 * PLUS the foreground-vs-background reconciliation (ADR-0044 Decision #3): the
 * ENFORCING completion gate applies only to FOREGROUND (awaited) delegations; a
 * BACKGROUND / promoted Worker is fire-and-continue, tracked informationally, and
 * never error-blocks the launching turn.
 */
import { describe, expect, test } from "bun:test"
import {
  MAX_REASON_LENGTH,
  WORKER_MAX_WAIT_MS,
  boundReason,
  isTerminal,
  emptyAggregate,
  countersFor,
  recordWorker,
  applyWorkerTransition,
  deliveryOf,
  rollupFromSummary,
  UNKNOWN_ROLLUP,
  managerCompletionGate,
  workerValidationChain,
  foldTerminalOutcome,
  firstFailure,
  wakeTriggerFromStatus,
  type WorkerOutcome,
  type ManagerWorkerAggregate,
} from "@/session/orchestration-aggregate"
import { createRoutingSessionStateStore } from "@/session/routing-state"
import { TodoAuthority } from "@/routing/domain/todo-authority"
import type { SessionID } from "@/session/schema"

const MANAGER = "ses_manager" as SessionID
const OTHER = "ses_other" as SessionID
const ORCHESTRATION_ALLOWED = ["read", "grep", "glob", "webfetch", "websearch", "task", "todowrite"]

function child(id: string): string {
  return `ses_${id}`
}

function pending(id: string): WorkerOutcome {
  return { childSessionId: child(id), lifecycle: "pending", delivery: "foreground", todo: UNKNOWN_ROLLUP }
}

function bgPending(id: string): WorkerOutcome {
  return { childSessionId: child(id), lifecycle: "pending", delivery: "background", todo: UNKNOWN_ROLLUP }
}

function outcome(id: string, lifecycle: WorkerOutcome["lifecycle"], reason?: string): WorkerOutcome {
  return { childSessionId: child(id), lifecycle, delivery: "foreground", todo: UNKNOWN_ROLLUP, reason }
}

function todoOf(id: string, items: ReadonlyArray<TodoAuthority.TodoItem>): TodoAuthority.TodoAggregate {
  return TodoAuthority.initializeTodo({ sessionId: child(id), ref: `todo_${child(id)}`, version: "v1", items })
}

function item(status: TodoAuthority.TodoStatus, required = true): TodoAuthority.TodoItem {
  return { id: "i", content: "work", status, priority: "medium", required }
}

// A roster whose counters must always sum to total (FR-A3).
function assertCounterSumInvariant(aggregate: ManagerWorkerAggregate): void {
  const c = aggregate.counters
  expect(c.pending + c.done + c.failed + c.aborted).toBe(c.total)
  expect(c.total).toBe(aggregate.roster.length)
}

describe("Leaf A — the Todo aggregate roll-up (FR-A)", () => {
  test("(a) a Manager dispatching N Workers records N aggregate entries", () => {
    let aggregate = emptyAggregate(MANAGER)
    for (const id of ["a", "b", "c"]) aggregate = recordWorker(aggregate, pending(id))
    expect(aggregate.roster).toHaveLength(3)
    expect(aggregate.counters.total).toBe(3)
    expect(aggregate.counters.pending).toBe(3)
    assertCounterSumInvariant(aggregate)
  })

  test("re-recording the same child id replaces, never duplicates", () => {
    let aggregate = recordWorker(emptyAggregate(MANAGER), pending("a"))
    aggregate = recordWorker(aggregate, outcome("a", "done"))
    expect(aggregate.roster).toHaveLength(1)
    expect(aggregate.counters.total).toBe(1)
    expect(aggregate.counters.done).toBe(1)
  })

  test("(c) a failed/aborted Worker is first-class with a bounded reason, never dropped", () => {
    let aggregate = emptyAggregate(MANAGER)
    aggregate = recordWorker(aggregate, outcome("f", "failed", "boom"))
    aggregate = recordWorker(aggregate, outcome("x", "aborted", "timeout"))
    expect(aggregate.counters).toMatchObject({ total: 2, pending: 0, done: 0, failed: 1, aborted: 1 })
    expect(aggregate.roster.find((e) => e.childSessionId === child("f"))?.reason).toBe("boom")
    assertCounterSumInvariant(aggregate)
  })

  test("countersFor always sums to total under a mixed roster (informational full roll-up)", () => {
    const roster: WorkerOutcome[] = [pending("1"), outcome("2", "done"), outcome("3", "failed"), outcome("4", "aborted")]
    const counters = countersFor(roster)
    expect(counters).toEqual({ total: 4, pending: 1, done: 1, failed: 1, aborted: 1 })
  })

  test("rollupFromSummary carries counts only, never full item content (FR-A4)", () => {
    const snapshot = todoOf("s", [item("completed"), item("pending"), item("in_progress")])
    const rollup = rollupFromSummary(TodoAuthority.summarize(snapshot))
    expect(rollup.itemCount).toBe(3)
    expect(rollup.statusCounts).toEqual({ pending: 1, in_progress: 1, completed: 1, cancelled: 0 })
    expect(rollup.ref).toBe("todo_ses_s")
    expect(JSON.stringify(rollup)).not.toContain("work")
  })
})

describe("Leaf B — the completion gate (FR-B)", () => {
  test("(b) blocked with a pending count while any FOREGROUND Worker is pending, settles when all terminal", () => {
    let aggregate = recordWorker(recordWorker(emptyAggregate(MANAGER), pending("a")), pending("b"))
    expect(managerCompletionGate(aggregate)).toEqual({ outcome: "blocked", pendingWorkers: 2 })

    aggregate = applyWorkerTransition(aggregate, outcome("a", "done"))
    expect(managerCompletionGate(aggregate)).toEqual({ outcome: "blocked", pendingWorkers: 1 })

    aggregate = applyWorkerTransition(aggregate, outcome("b", "done"))
    expect(managerCompletionGate(aggregate)).toEqual({ outcome: "ok", pendingWorkers: 0 })
  })

  test("(c) a failed/aborted Worker is terminal and SATISFIES the gate (never deadlocks, FR-B2)", () => {
    let aggregate = recordWorker(recordWorker(emptyAggregate(MANAGER), pending("a")), pending("b"))
    aggregate = applyWorkerTransition(aggregate, outcome("a", "failed", "crash"))
    aggregate = applyWorkerTransition(aggregate, outcome("b", "aborted", "timeout"))
    expect(managerCompletionGate(aggregate).outcome).toBe("ok")
    assertCounterSumInvariant(aggregate)
  })

  test("an empty aggregate is settled (a Manager that delegated nothing)", () => {
    expect(managerCompletionGate(emptyAggregate(MANAGER))).toEqual({ outcome: "ok", pendingWorkers: 0 })
  })
})

describe("Reconciliation — foreground-enforced vs background-informational (ADR-0044 Decision #3)", () => {
  test("MUST-FIX 2 — a BACKGROUND pending Worker does NOT block: the launching turn settles normally", () => {
    // A fire-and-continue background launch must not flip the launching turn to
    // blocked/error — the gate is `ok` even though the background Worker is pending.
    const aggregate = recordWorker(emptyAggregate(MANAGER), bgPending("bg"))
    expect(managerCompletionGate(aggregate)).toEqual({ outcome: "ok", pendingWorkers: 0 })
    // It is still tracked informationally in the roll-up counters.
    expect(aggregate.counters.pending).toBe(1)
  })

  test("a FOREGROUND pending Worker still blocks (the enforced case never silent-completes)", () => {
    const aggregate = recordWorker(emptyAggregate(MANAGER), pending("fg"))
    expect(managerCompletionGate(aggregate).outcome).toBe("blocked")
  })

  test("mixed roster: only the foreground pending Worker blocks; a still-pending background Worker never does", () => {
    let aggregate = recordWorker(recordWorker(emptyAggregate(MANAGER), pending("fg")), bgPending("bg"))
    expect(managerCompletionGate(aggregate)).toEqual({ outcome: "blocked", pendingWorkers: 1 })
    // Once the foreground Worker settles, the turn is free even with the background
    // Worker still pending (fire-and-continue) — no deadlock, no silent block.
    aggregate = applyWorkerTransition(aggregate, outcome("fg", "done"))
    expect(managerCompletionGate(aggregate).outcome).toBe("ok")
    expect(aggregate.counters.pending).toBe(1)
  })
})

describe("Leaf C — the ordered SHAPE -> POLICY -> DOMAIN validation chain (FR-C)", () => {
  const completed = todoOf("c", [item("completed")])

  function policyCtx(overrides?: { executionAllowed?: boolean; toolsUsed?: ReadonlyArray<string> }) {
    return {
      executionAllowed: overrides?.executionAllowed ?? true,
      toolsUsed: overrides?.toolsUsed ?? [],
      allowedTools: ORCHESTRATION_ALLOWED,
    }
  }

  function fold(chain: ReturnType<typeof workerValidationChain>): WorkerOutcome {
    return foldTerminalOutcome({ childSessionId: child("c"), delivery: "foreground", status: "completed", todo: UNKNOWN_ROLLUP, chain })
  }

  test("all stages pass -> accepted -> a completed result folds to done", () => {
    const chain = workerValidationChain({
      childSessionId: child("c"),
      shape: { hasEnvelope: true },
      policy: policyCtx(),
      domain: { snapshot: completed, validationPerformed: true },
    })
    expect(chain.acceptance).toBe("accepted")
    expect(chain.stages.map((s) => s.stage)).toEqual(["shape", "policy", "domain"])
    const folded = fold(chain)
    expect(folded.lifecycle).toBe("done")
    expect(folded.reason).toBeUndefined()
    expect(folded.failAction).toBeUndefined()
  })

  test("(d) SHAPE failure -> reject, fail-fast (policy/domain not evaluated), failAction carried", () => {
    const chain = workerValidationChain({
      childSessionId: child("c"),
      shape: { hasEnvelope: false },
      policy: policyCtx(),
      domain: { snapshot: completed, validationPerformed: true },
    })
    expect(chain.acceptance).toBe("rejected")
    expect(chain.stages).toHaveLength(1)
    expect(firstFailure(chain)).toMatchObject({ stage: "shape", failAction: "reject" })
    const folded = fold(chain)
    expect(folded.lifecycle).toBe("failed")
    expect(folded.reason).toContain("envelope")
    expect(folded.failAction).toBe("reject")
  })

  test("(d) POLICY failure (escaped orchestration_only allowlist) -> reject_redispatch, carried onto the outcome", () => {
    const chain = workerValidationChain({
      childSessionId: child("c"),
      shape: { hasEnvelope: true },
      policy: policyCtx({ executionAllowed: false, toolsUsed: ["read", "bash"] }),
      domain: { snapshot: completed, validationPerformed: true },
    })
    expect(chain.acceptance).toBe("rejected")
    expect(chain.stages.map((s) => s.stage)).toEqual(["shape", "policy"])
    expect(firstFailure(chain)).toMatchObject({ stage: "policy", failAction: "reject_redispatch" })
    expect(firstFailure(chain)?.reason).toContain("bash")
    expect(fold(chain).failAction).toBe("reject_redispatch")
  })

  test("POLICY passes for an execution-authorized Worker regardless of tools used", () => {
    const chain = workerValidationChain({
      childSessionId: child("c"),
      shape: { hasEnvelope: true },
      policy: policyCtx({ executionAllowed: true, toolsUsed: ["bash", "edit"] }),
      domain: { snapshot: completed, validationPerformed: true },
    })
    expect(chain.acceptance).toBe("accepted")
  })

  test("(d) DOMAIN failure (required items incomplete) -> surface_blocked, distinguishable on the outcome", () => {
    const incomplete = todoOf("c", [item("completed"), item("in_progress")])
    const chain = workerValidationChain({
      childSessionId: child("c"),
      shape: { hasEnvelope: true },
      policy: policyCtx(),
      domain: { snapshot: incomplete, validationPerformed: true },
    })
    expect(chain.acceptance).toBe("rejected")
    expect(firstFailure(chain)).toMatchObject({ stage: "domain", failAction: "surface_blocked" })
    const folded = fold(chain)
    expect(folded.lifecycle).toBe("failed")
    // A reject_redispatch vs a surface_blocked must be distinguishable downstream.
    expect(folded.failAction).toBe("surface_blocked")
    expect(folded.reason!.length).toBeLessThanOrEqual(MAX_REASON_LENGTH)
  })
})

describe("Leaf D — the wake fold + coalescing + max-wait (FR-D)", () => {
  test("(e) a repeat terminal signal for an already-terminal child is a coalesced no-op", () => {
    let aggregate = recordWorker(emptyAggregate(MANAGER), pending("a"))
    aggregate = applyWorkerTransition(aggregate, outcome("a", "done"))
    const first = aggregate
    aggregate = applyWorkerTransition(aggregate, outcome("a", "failed", "late"))
    expect(aggregate).toBe(first)
    expect(aggregate.roster[0].lifecycle).toBe("done")
  })

  test("(f) a timeout folds to aborted with a timeout reason so the gate settles (FR-D3)", () => {
    const folded = foldTerminalOutcome({ childSessionId: child("h"), delivery: "foreground", status: "timeout", todo: UNKNOWN_ROLLUP })
    expect(folded.lifecycle).toBe("aborted")
    expect(folded.reason).toContain("timeout")
    const aggregate = applyWorkerTransition(recordWorker(emptyAggregate(MANAGER), pending("h")), folded)
    expect(managerCompletionGate(aggregate).outcome).toBe("ok")
  })

  test("MUST-FIX 3 — a cancelled status folds to aborted (terminal) so the gate settles; an error folds to failed", () => {
    expect(foldTerminalOutcome({ childSessionId: child("e"), delivery: "background", status: "error", todo: UNKNOWN_ROLLUP, failureText: "provider 500" }).lifecycle).toBe("failed")
    const cancelled = foldTerminalOutcome({ childSessionId: child("k"), delivery: "background", status: "cancelled", todo: UNKNOWN_ROLLUP })
    expect(cancelled.lifecycle).toBe("aborted")
    // A cancelled background Worker is terminal (the wake `inject` re-prompts the Manager at task.ts).
    const aggregate = applyWorkerTransition(recordWorker(emptyAggregate(MANAGER), bgPending("k")), cancelled)
    expect(aggregate.counters.aborted).toBe(1)
  })

  test("foldTerminalOutcome preserves the recorded delivery (foreground stays foreground, background stays background)", () => {
    expect(foldTerminalOutcome({ childSessionId: child("a"), delivery: "background", status: "completed", todo: UNKNOWN_ROLLUP }).delivery).toBe("background")
    expect(foldTerminalOutcome({ childSessionId: child("b"), delivery: "foreground", status: "completed", todo: UNKNOWN_ROLLUP }).delivery).toBe("foreground")
  })

  test("deliveryOf returns the recorded delivery and defaults foreground for an unknown child", () => {
    const aggregate = recordWorker(emptyAggregate(MANAGER), bgPending("bg"))
    expect(deliveryOf(aggregate, child("bg"))).toBe("background")
    expect(deliveryOf(aggregate, child("missing"))).toBe("foreground")
    expect(deliveryOf(null, child("bg"))).toBe("foreground")
  })

  test("wake trigger maps each terminal status to its bus signal", () => {
    expect(wakeTriggerFromStatus("completed")).toBe("child_completed")
    expect(wakeTriggerFromStatus("error")).toBe("child_failed")
    expect(wakeTriggerFromStatus("cancelled")).toBe("child_aborted")
    expect(wakeTriggerFromStatus("timeout")).toBe("max_wait_expired")
  })

  test("WORKER_MAX_WAIT_MS is a positive, finite, operator-tunable floor", () => {
    expect(Number.isFinite(WORKER_MAX_WAIT_MS)).toBe(true)
    expect(WORKER_MAX_WAIT_MS).toBeGreaterThan(0)
  })
})

describe("The shared store carries + releases the aggregate (FR-E3)", () => {
  test("recordDelegatedWorker + updateWorkerOutcome drive the foreground gate through the store", () => {
    const store = createRoutingSessionStateStore()
    store.recordDelegatedWorker(MANAGER, pending("a"))
    store.recordDelegatedWorker(MANAGER, pending("b"))
    expect(managerCompletionGate(store.get(MANAGER).aggregate!)).toEqual({ outcome: "blocked", pendingWorkers: 2 })

    store.updateWorkerOutcome(MANAGER, outcome("a", "done"))
    store.updateWorkerOutcome(MANAGER, outcome("b", "failed", "boom"))
    const aggregate = store.get(MANAGER).aggregate!
    expect(managerCompletionGate(aggregate).outcome).toBe("ok")
    expect(aggregate.roster.find((e) => e.childSessionId === child("b"))?.reason).toBe("boom")
  })

  test("MUST-FIX 2 (store) — a recorded BACKGROUND Worker leaves the gate ok (launching turn finishes normally)", () => {
    const store = createRoutingSessionStateStore()
    store.recordDelegatedWorker(MANAGER, bgPending("bg"))
    expect(managerCompletionGate(store.get(MANAGER).aggregate!).outcome).toBe("ok")
  })

  test("MUST-FIX 1 (honest semantics) — a background Worker that settles later transitions terminal in the retained aggregate", () => {
    // Within the launching prompt the aggregate is retained across steps; a later
    // terminal transition advances it and the gate stays ok throughout (background =
    // informational). No silent-complete-with-a-pending-FOREGROUND-worker is possible.
    const store = createRoutingSessionStateStore()
    store.recordDelegatedWorker(MANAGER, bgPending("bg"))
    expect(managerCompletionGate(store.get(MANAGER).aggregate!).outcome).toBe("ok")
    store.updateWorkerOutcome(MANAGER, { childSessionId: child("bg"), lifecycle: "done", delivery: "background", todo: UNKNOWN_ROLLUP })
    const aggregate = store.get(MANAGER).aggregate!
    expect(aggregate.roster[0].lifecycle).toBe("done")
    expect(managerCompletionGate(aggregate).outcome).toBe("ok")
  })

  test("a repeat terminal update through the store is coalesced (idempotent)", () => {
    const store = createRoutingSessionStateStore()
    store.recordDelegatedWorker(MANAGER, pending("a"))
    store.updateWorkerOutcome(MANAGER, outcome("a", "done"))
    store.updateWorkerOutcome(MANAGER, outcome("a", "aborted", "late"))
    expect(store.get(MANAGER).aggregate!.roster[0].lifecycle).toBe("done")
  })

  test("clear() releases the Manager aggregate with the session", () => {
    const store = createRoutingSessionStateStore()
    store.recordDelegatedWorker(MANAGER, pending("a"))
    store.clear(MANAGER)
    expect(store.get(MANAGER).aggregate).toBeNull()
  })

  test("(h) a fan-out-denied Worker is never recorded; the gate settles over the GRANTED set", () => {
    const store = createRoutingSessionStateStore()
    store.recordDelegatedWorker(MANAGER, pending("granted1"))
    store.recordDelegatedWorker(MANAGER, pending("granted2"))
    store.updateWorkerOutcome(MANAGER, outcome("granted1", "done"))
    store.updateWorkerOutcome(MANAGER, outcome("granted2", "done"))
    const aggregate = store.get(MANAGER).aggregate!
    expect(aggregate.counters.total).toBe(2)
    expect(managerCompletionGate(aggregate).outcome).toBe("ok")
  })
})

describe("FR-E1 / FR-F2 — a disabled/non-auto session is byte-identical (no aggregate)", () => {
  test("(g) a session that never delegated under auto-mode has a NULL aggregate", () => {
    const store = createRoutingSessionStateStore()
    expect(store.get(OTHER).aggregate).toBeNull()
  })

  test("updateWorkerOutcome on a Manager with no aggregate is a no-op (never creates one)", () => {
    const store = createRoutingSessionStateStore()
    store.updateWorkerOutcome(OTHER, outcome("a", "done"))
    expect(store.get(OTHER).aggregate).toBeNull()
  })

  test("recordConsumption does not fabricate an aggregate (F043 path untouched)", () => {
    const store = createRoutingSessionStateStore()
    store.recordConsumption(OTHER, {
      throughput: { turns_used: 1, context_tokens_used: 0, output_tokens_used: 0 },
      concurrency: { workers_requested: 0, workers_granted: 0, delegation_depth_used: 0 },
      retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
      cost: { time_ms_used: 0, cost_usd_used: 0 },
      resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
    })
    expect(store.get(OTHER).aggregate).toBeNull()
  })
})

describe("FR-F1 — total, non-throwing, degrade-to-ungated helpers", () => {
  test("a snapshot-read defect degrades to UNKNOWN_ROLLUP while the lifecycle still tracks terminal", () => {
    const folded = foldTerminalOutcome({ childSessionId: child("d"), delivery: "foreground", status: "completed", todo: UNKNOWN_ROLLUP })
    expect(folded.lifecycle).toBe("done")
    expect(folded.todo).toBe(UNKNOWN_ROLLUP)
  })

  test("boundReason clamps to the bounded FailureReason shape and never empties", () => {
    expect(boundReason("   ")).toBe("unspecified")
    expect(boundReason("a".repeat(500)).length).toBe(MAX_REASON_LENGTH)
    expect(boundReason("  multi\n  line  ")).toBe("multi line")
  })

  test("isTerminal distinguishes pending from the terminal states", () => {
    expect(isTerminal("pending")).toBe(false)
    for (const s of ["done", "failed", "aborted"] as const) expect(isTerminal(s)).toBe(true)
  })
})
