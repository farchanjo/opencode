---
status: proposed
date: 2026-07-21
deciders: [project maintainers]
consulted: []
informed: []
---

# 0044 — Compose The Hierarchy Orchestration Contract So A Manager Orchestrates Its Workers

## Context and Problem Statement

Feature 042 (Phase 2a) wired per-subagent hierarchy delegation into the Task
spawn: a Manager-role parent can dispatch Worker children under the
`orchestration_only` allowlist (`tool/task.ts` `ORCHESTRATION_ALLOWED_TOOLS`
:44-55), each dispatch lineage recorded on the shared `RoutingSessionState` store
(`routing-hierarchy.ts` `recordHierarchyDispatch` :282-302). Feature 043
(Phase 2b) wired live budget consumption and admitted fan-out against real
cost/token headroom (`routing-hierarchy.ts` `planDispatch`/`fanoutGranted`
:382/:143/:415; `budget-consume.ts` :261-283). Both shipped the DISPATCH — but
not the ORCHESTRATION.

Today a Manager can spawn a Worker, but the Manager's coordination of a SET of
Workers is unspecified: in the foreground it blocks on a single `background.wait`
race (`tool/task.ts` :418-451), with (1) no AGGREGATE view of many Workers'
outcomes, (2) no COMPLETION gate that a Manager turn is not "done" while a Worker
is still pending, (3) no VALIDATION chain over an accepted Worker result, and
(4) no WAKE-rule that advances the Manager when a Worker reaches a terminal state
without polling. A Manager could therefore report complete with delegated work
outstanding, silently fold a malformed or illegal Worker result into its output,
or (if it did block) deadlock on a Worker that hangs or crashes.

Several design questions have no prior decision: whether the completion gate
blocks on FAILURE or only on PENDING; whether the Manager POLLS or is WOKEN by a
Worker terminal event; how a hung/never-completing Worker is bounded; where the
validation chain hooks relative to the F042 dispatch record; and whether the whole
contract is active out-of-box or gated on Smart Routing activation like F042/F043.

## Decision Drivers

- **A Manager must orchestrate a SET of Workers, not one at a time.** A roll-up of
  every delegated Worker's terminal outcome + Todo state is the aggregate a
  Manager reasons over.
- **A Manager turn must never silently finish with delegated work outstanding.** A
  completion gate must hold the turn while any Worker is pending.
- **A Worker result must be validated before acceptance.** A malformed, illegal,
  or domain-unacceptable result must never be silently folded into the roll-up.
- **A Manager must never deadlock, crash, or hang on a Worker.** A hung/crashed
  Worker must be bounded by a max-wait then escalated/surfaced — the F037/042/043
  hang/crash-safety contract.
- **The contract must be inert unless routing is active in fan-out mode.** A
  disabled/default session must be byte-identical to today.
- **Reuse the one store, one Todo authority, one response loop, and the Phase
  1/2a/2b safety pattern.** No parallel dispatch store, Todo engine, or turn-loop.

## Considered Options

### Overall composition

- **Option A — compose the four leaves over the F042 dispatch and the F043
  admission, activation-gated and hang/crash-safe (chosen).** Record a
  delegated-Worker aggregate on the shared `RoutingSessionState` keyed by child
  session id (the key `recordHierarchyDispatch` already correlates); gate the
  Manager turn at the `processor.ts` response-loop seam on all delegated Workers
  being terminal; validate each accepted Worker result through an ordered chain at
  the accept point; wake the Manager on each Worker terminal signal, coalesced,
  with a max-wait floor. Reuses the one store, the session-owned Todo authority,
  and the response loop; engaged only when `enabled && mode === "auto"`; every
  failure degrades to today's ungated behavior.
- **Option B — a standalone orchestration engine outside the session layer.**
  Rejected: it would duplicate the store the dispatch lineage already lives on and
  the Todo authority the session already owns, split the SSOT, and require its own
  lifecycle/cleanup — contradicting the "one store, one authority, one loop"
  driver.
- **Option C — leave orchestration to the model (prompt-only).** Rejected: a
  hard invariant (a Manager turn is not done while a Worker is pending; a Worker
  result is validated before acceptance) cannot be a suggestion a model may talk
  its way past — it must be an enforced, typed gate, exactly as the F043 budget
  maximum is.

### Completion gate — block-on-failure vs surface-and-continue (open question 1)

- **Option A1 — the gate requires TERMINAL, and a failure SURFACES (chosen).** The
  gate predicate is "every delegated Worker is in a terminal state
  (`done | failed | aborted`)"; a `failed`/`aborted` Worker satisfies the gate and
  is surfaced into the Manager turn (the aggregate roll-up + a bounded reason). The
  Manager then decides (re-dispatch, escalate, report).
- **Option A2 — block the Manager turn until every Worker SUCCEEDS.** Rejected: a
  single Worker crash would hold the Manager turn open forever — a deadlock on
  failure, the exact hazard the hang/crash-safety contract forbids. Completion is
  about all delegated work being SETTLED, not all of it SUCCEEDING.
- **Option A3 — hard-block the launching turn on a BACKGROUND Worker too.**
  Rejected: a `background`-launched Worker (and a foreground Worker PROMOTED to the
  background) is fire-and-continue BY DESIGN under the experimental
  background-subagent contract (`tool/task.ts` `BACKGROUND_STARTED` — the launch
  returns immediately and the launching turn finishes normally, telling the model to
  end its response). Error-blocking the launching turn on such a Worker would REGRESS
  that contract: the pre-F044 launch finished normally, and it must again. So the
  ENFORCING completion gate is scoped to FOREGROUND (awaited) delegation — where the
  Task tool call already blocks the turn until the Worker settles, making the gate a
  correct typed consistency assertion — while BACKGROUND / promoted Workers are
  tracked INFORMATIONALLY in the roll-up, updated + woken on every terminal signal
  via the background `inject` re-prompt (FR-D1), but never flipping the launching
  turn to blocked/error. This is the honest reconciliation: the invariant "a Manager
  never SILENTLY finishes with delegated work outstanding" is enforced where it can
  be (foreground) and made truthful where enforcement would contradict the platform
  contract (background = an explicit, model-visible fire-and-continue, not a silent
  finish). The in-memory aggregate is released with the launching prompt's run-loop
  (`session/prompt.ts` :1566); the Worker's Todo content is durably persisted
  independently (`session/todo.ts`).

### Wake — event-driven vs polling (open question 2)

- **Option B1 — event-driven wake, coalesced, with a max-wait floor (chosen).** A
  Worker terminal signal (`background.wait` resolution, corroborated by
  `status.ts` `Event.Idle` :43 and `session.ts` `Event.Deleted`/`Event.Error`
  :326-328) wakes the Manager to re-evaluate the aggregate + gate; wakes coalesce
  per child session id (idempotent on repeat); a never-completing Worker is
  force-`aborted` at a bounded, operator-tunable max-wait (mirroring
  `RESOLVE_TIMEOUT_MS` :50).
- **Option B2 — poll each Worker's status on an interval.** Rejected: a busy-wait
  wastes turns, adds latency proportional to the poll interval, and gives no
  deadlock guarantee (a poll loop with no bound hangs just as readily). The bus
  already carries the terminal signal; the wake reads it.

### Activation — active out-of-box vs gated (open question 3)

- **Option C1 — gated on Smart Routing activation in `auto` mode (chosen).** The
  whole contract (aggregate, gate, chain, wake) is engaged only when
  `activation.enabled && mode === "auto"` — the exact F037/042 fan-out gate the
  spawn resolver already applies (`routing-hierarchy.ts` :369). A disabled/default
  session is byte-identical to today.
- **Option C2 — active out-of-box for every Manager.** Rejected: orchestration is
  a fan-out concern; enforcing it on a session that never opted into fan-out
  routing would change the shipped default behavior of every subagent spawn,
  contradicting the "inert by default" driver and the F042/F043 precedent.

### Validation chain — where it hooks (open question 4)

- **Option D1 — an ordered SHAPE → POLICY → DOMAIN chain at result acceptance
  (chosen).** The chain runs where the `background.wait` result is turned into the
  task output (`tool/task.ts` :424-435) — AFTER `recordHierarchyDispatch` recorded
  the lineage at spawn time, BEFORE the `WorkerOutcome` is folded into the
  aggregate. Each stage runs only if the prior passed; SHAPE/POLICY REJECT (POLICY
  may re-dispatch), DOMAIN SURFACES a `blocked` reason. It is a pure ordered
  function over the result + the child's Todo snapshot — no new I/O in the accept
  path.
- **Option D2 — validate inside the child's own turn loop.** Rejected: acceptance
  is the MANAGER's decision over the child's RESULT; validating inside the child
  couples the Manager's acceptance policy into every Worker's processor and cannot
  re-dispatch from the Manager's vantage.

## Decision Outcome

Chosen option: **Option A** (compose the four leaves over the F042 dispatch and
F043 admission), combined with **Option A1** (the completion gate requires
terminal, a failure surfaces), **Option B1** (event-driven wake, coalesced, with a
max-wait floor), **Option C1** (activation-gated in `auto` mode), and **Option
D1** (an ordered SHAPE → POLICY → DOMAIN validation chain at result acceptance).
The contract composes over the shared `RoutingSessionState` store, the
session-owned Todo authority, and the `processor.ts` response loop — reusing the
one SSOT, honoring the parent-cannot-edit-child Todo invariant, leaving a
disabled/default session byte-identical to today, and degrading every failure to
today's ungated behavior so a Manager turn can never deadlock, crash, or hang,
while a `blocked` completion gate remains a deliberate typed outcome.

Key decisions recorded:

1. **Phase 3 composes the hierarchy orchestration contract.** Phase 2a wired the
   Manager→Worker dispatch; Phase 2b wired budget consumption + fan-out admission;
   Phase 3 wires the Todo aggregate roll-up, the completion gate, the validation
   chain, and the wake-rule. The runtime escalation trigger, a durable aggregate,
   and telemetry surfacing are Phase 4.

2. **The Todo aggregate is a roll-up on the shared store, keyed by child session
   id.** One `WorkerOutcome` per delegated child (child session id + a
   `WorkerLifecycle` + a bounded `TodoSummary` roll-up from `summarize` :195-199 —
   never full item content), recorded at the spawn seam alongside
   `recordHierarchyDispatch`, updated on each Worker terminal transition, and
   released with the session (`store.clear` :447). A `failed`/`aborted` Worker is
   first-class, never dropped; the roll-up counters always sum to the delegated
   count.

3. **The completion gate requires TERMINAL, not SUCCESS, and enforces on
   FOREGROUND delegation only; a failure surfaces (Option A1 + Option A3).** A
   Manager turn is held at the `processor.ts` response-loop seam while any
   FOREGROUND (awaited) delegated Worker is `pending`; it settles when every
   foreground Worker is `done | failed | aborted`. BACKGROUND / promoted Workers are
   fire-and-continue and are DELIBERATELY excluded from the enforcing block (Option
   A3) — they are tracked informationally in the roll-up and woken on every terminal
   signal, but never error-block the launching turn (that would regress the
   background-subagent fire-and-continue contract). The gate reuses the pure
   `completionGate` (:135-147) `blocked` vocabulary and composes with the F043 budget
   gate (a Manager already budget-blocked stays blocked; this only adds the
   "foreground Workers still pending" reason). A failure surfaces into the turn — it
   never deadlocks or silently finishes.

4. **Each Worker result passes an ordered SHAPE → POLICY → DOMAIN chain at
   acceptance (Option D1).** SHAPE (a decodable `task_result` envelope) and POLICY
   (legal for the role + the `orchestration_only` allowlist) REJECT on failure
   (POLICY may re-dispatch); DOMAIN (`completionGate.validationPerformed`, required
   items completed) SURFACES a `blocked` reason. The chain hooks after the dispatch
   record and before the aggregate fold; no stage silently accepts a failing
   result.

5. **A terminal Worker WAKES the Manager, coalesced, with a max-wait floor
   (Option B1).** The wake trigger is the Worker's terminal signal already on the
   bus (`background.wait` resolution, corroborated by
   `Event.Idle`/`Event.Deleted`/`Event.Error`); wakes coalesce per child session id
   and are idempotent on repeat; a never-completing Worker is force-`aborted` at a
   bounded, operator-tunable max-wait (mirroring `RESOLVE_TIMEOUT_MS` :50) so the
   gate always settles. No polling.

6. **The whole contract is activation-gated in `auto` mode (Option C1).** Engaged
   only when `activation.enabled && mode === "auto"` (the F037/042 fan-out gate);
   a disabled/default session is byte-identical to today — no aggregate, no gate,
   no chain, no wake.

7. **The contract composes with the F042 allowlist and F043 admission.** A
   fan-out-DENIED Worker (F043, `fanoutGranted` below requested) is never
   dispatched, produces no `WorkerOutcome`, and the gate settles over the GRANTED
   set — not the requested one. A non-Worker orchestration-only child (F042
   allowlist) still resolves its aggregate entry like any child.

8. **Total, non-throwing, hang-proof fallback + back-compat.** Any failure in the
   aggregate, gate, chain, or wake degrades to today's ungated behavior — the
   F037/042/043 contract — so the Manager turn never crashes, blocks, or
   deadlocks. A `blocked` completion gate is the one deliberate non-degrading
   typed outcome. A disabled/default session is byte-identical to pre-F044.

9. **One store, one Todo authority, one response loop.** The aggregate rides the
   shared `RoutingSessionState` the dispatch lineage already lives on, reads Todo
   through the session-owned authority, and gates at the existing `processor.ts`
   seam; no parallel orchestration engine, dispatch store, or turn-loop.

### Consequences

- Good: a Manager finally ORCHESTRATES its delegated Workers — a roll-up of every
  Worker's outcome, a turn that cannot finish with work pending, a validated
  acceptance of every result, and an event-driven advance — not just a single
  spawn-and-block.
- Good: a Manager turn can never deadlock on a hung/crashed Worker — a max-wait
  bounds every Worker and every failure degrades to today's behavior; a `blocked`
  gate is an honest typed outcome, not a hang.
- Good: a malformed, illegal, or domain-unacceptable Worker result is rejected or
  surfaced by the validation chain — never silently folded into the roll-up.
- Good: the parent-cannot-edit-child Todo invariant is preserved — the Manager
  reads each child's Todo through the read-only projection only.
- Good: a disabled/default session is byte-for-byte identical to pre-F044; only an
  `auto`-mode Manager with delegated Workers sees the contract.
- Neutral: the aggregate is in-memory on the `RoutingSessionState` and released
  with the session; it does not survive an `opencode serve` restart (the Todo
  content it rolls up is already durably persisted). A durable aggregate is
  Phase 4.
- Residual (Phase 4): the runtime Worker→Manager escalation trigger
  (`escalateWorkerToManager` :251-259 is the wired call site), a durable
  cross-restart aggregate, telemetry surfacing of the orchestration outcomes, the
  operator-stack `InstanceRef` fix (`stack-live.ts:314/341`), and `always`-mode
  orchestration are deferred.

## Related

- Feature specification: [044 Compose the hierarchy orchestration contract so a Manager](../sdd/044-compose-the-hierarchy-orchestration-contract-so-a-manager/spec.md)
- Phase 2a (the Manager→Worker dispatch, the `orchestration_only` allowlist, and the dispatch-lineage record this feature orchestrates over): [042 Wire per-subagent hierarchy delegation into the Task spawn](../sdd/042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn/spec.md)
- Phase 2b (the fan-out admission gate whose granted worker set the aggregate and completion gate settle over; the activation gate and hang/crash-safety contract this feature mirrors): [043 Enforce live budget consumption and fanout admission across the session](../sdd/043-enforce-live-budget-consumption-and-fanout-admission-across/spec.md)
- Phase 1 (the hang/crash-safety and activation-gating contract this feature mirrors): [037 Wire the operator Smart Routing engine into the live session](../sdd/037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md)
- The pure `todo-authority.ts` Todo aggregate / `completionGate` / `summarize`, the `RoutingSessionState` store, and the hierarchy dispatcher this feature composes over: [001 Define one cohesive Smart Agent Routing and OpenTelemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- The hierarchical adaptive routing model (Architect → Manager → Worker, depth ≤ 2) the orchestration contract enforces: [ADR-0002 Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Records the hierarchy delegation dispatch this feature orchestrates over: [ADR-0042 Wire per-subagent hierarchy delegation into the Task spawn](0042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn.md)
- Records the budget consumption + fan-out admission gate whose granted set this feature settles over: [ADR-0043 Enforce live budget consumption and fanout admission across the session](0043-enforce-live-budget-consumption-and-fanout-admission-across.md)
