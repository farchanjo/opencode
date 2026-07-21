---
id: 019f8373-943c-7c43-b0e6-c8f82fadc8e6
number: 044
slug: compose-the-hierarchy-orchestration-contract-so-a-manager
status: tasked
created_at: 2026-07-21T06:53:37.725112Z
---
# Feature Specification: Compose The Hierarchy Orchestration Contract So A Manager

Feature: 044-compose-the-hierarchy-orchestration-contract-so-a-manager
Created: 2026-07-21
Scope: the Manager-role parent turn — the Task spawn seam
(`packages/opencode/src/session/prompt.ts` `handleSubtask`, :327-509, and
`packages/opencode/src/tool/task.ts` where a child session is created :240-256,
its dispatch lineage recorded :262-270, and its result awaited :418-451), the
session-owned Todo aggregate (`packages/opencode/src/session/todo.ts` `snapshot`
:174-177 / `dispatchSummary` :179-188 / `assertOwnership` :190-210, over the pure
`packages/opencode/src/routing/domain/todo-authority.ts` `TodoAggregate` :52-57 /
`completionGate` :135-147 / `summarize` :195-199), the live response loop
(`packages/opencode/src/session/processor.ts` `step-finish` :493-545 and the
pre-turn gate :722-732, where a turn is blocked via `ctx.blocked`), and the
session lifecycle bus (`packages/opencode/src/session/status.ts` `Event.Idle`
:43, `packages/opencode/src/session/session.ts` `Event.Deleted` / `Event.Error`
:326-328). It composes on the shared `RoutingSessionState` store
(`packages/opencode/src/session/routing-session-store.ts` :23-30,
`routing-state.ts` `recordDispatch` :120-129 / `recordConsumption` :131-133 /
`clear` :135-137).

Feature 042 (Phase 2a) wired per-subagent hierarchy delegation into the Task
spawn: a Manager-role parent can dispatch Worker children under the
`orchestration_only` allowlist (`tool/task.ts` `ORCHESTRATION_ALLOWED_TOOLS`
:44-55), with each dispatch lineage recorded on the store
(`routing-hierarchy.ts` `recordHierarchyDispatch` :282-302). Feature 043
(Phase 2b) wired live budget consumption and fan-out admission
(`routing-hierarchy.ts` `admitDispatchFanout` via `planDispatch` :382,
`fanoutGranted` :143/:415; `budget-consume.ts` `headroomFor` / `perWorkerReserve`
:261-283). But the Manager's ORCHESTRATION itself is unspecified: today a Manager
spawns a Worker and — in the foreground — blocks on a single `background.wait`
race (`tool/task.ts` :418-451) with no aggregate view of many Workers, no gate
that a Manager turn is not "done" while a Worker is still pending, no validation
chain over an accepted Worker result, and no wake-rule that advances the Manager
when a Worker reaches a terminal state. This feature is **Phase 3 of the
hierarchy contract**: the four orchestration leaves — the Todo AGGREGATE, the
COMPLETION gate, the VALIDATION chain, and the WAKE rule — that turn "a Manager
can dispatch a Worker" (F042/F043) into "a Manager correctly ORCHESTRATES a set
of Workers to completion".

Like Feature 043, the whole contract is INERT unless Smart Routing is
effectively active in fan-out mode (`activation.enabled && mode === "auto"`, the
Feature 037/042 gate): a disabled/default session is byte-identical to today — no
aggregate, no completion gate, no validation chain, no wake-rule. And like
Features 037/042/043 the contract is HANG/CRASH-SAFE: no orchestration mechanism
may deadlock a Manager turn if a Worker hangs or crashes — a bounded max-wait
then escalates/surfaces, and any failure in the contract degrades to today's
ungated behavior.

## Phasing

- **Phase 1 (Feature 037, shipped).** Wire the routing engine into the top-level
  implicit-default model of a live session; the hang/crash-safety contract this
  feature mirrors.
- **Phase 2a (Feature 042, shipped).** Wire per-subagent hierarchy delegation
  into the Task spawn — the Manager→Worker dispatch, the `orchestration_only`
  tool allowlist, and the dispatch-lineage record this feature orchestrates over.
- **Phase 2b (Feature 043, shipped).** Record live budget consumption,
  re-evaluate mid-session, and admit fan-out against real cost/token headroom —
  the admission gate a Manager's Worker set is bounded by.
- **Phase 3 (this feature).** Compose the four orchestration leaves — Todo
  aggregate roll-up, completion gate, validation chain, wake-rule — over the
  F042 dispatch and the F043 admission, activation-gated and hang/crash-safe.
- **Phase 4+ (out of scope, noted in ADR-0044).** The runtime TRIGGER that fires
  a Worker→Manager escalation (`routing-hierarchy.ts` `escalateWorkerToManager`
  :251-259 is the wired call site, awaiting its trigger); a durable
  cross-restart aggregate; telemetry surfacing of the orchestration outcomes onto
  OTLP spans/metrics; and the operator-stack `InstanceRef` candidate-resolver fix.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — A Manager sees a roll-up of every delegated Worker

- As a user who has enabled Smart Routing in `auto` mode, I want a Manager-role
  session to maintain an aggregate view of every Worker it delegated — each
  Worker's terminal outcome (done/failed/aborted) and a bounded roll-up of that
  Worker's own todo/completion state — so the Manager reasons over the whole
  delegated set, not one Worker at a time.

### P1 — A Manager turn is never "done" while a Worker is still pending

- As a maintainer, I want a Manager turn to be BLOCKED from reporting complete
  while any delegated Worker child session is still running or queued, so a
  Manager can never silently finish with delegated work outstanding.

### P1 — Each Worker result passes an ordered validation chain before acceptance

- As a maintainer, I want each Worker result to pass an ordered chain
  (shape/schema check → policy/legality check → domain-acceptance) before the
  Manager accepts it into its aggregate, so a malformed, illegal, or
  domain-unacceptable Worker result is rejected or surfaced — never silently
  folded into the roll-up.

### P1 — A terminal Worker WAKES the Manager rather than the Manager polling

- As a maintainer, I want a Worker reaching a terminal state to WAKE the Manager
  (re-evaluate the aggregate + completion gate) — event-driven, coalesced — so
  the Manager advances without polling or busy-waiting, and without deadlocking
  if a Worker never completes.

### P1 — The whole contract is inert unless routing is active in fan-out mode

- As an operator, I want the entire orchestration contract to be INERT unless
  Smart Routing is effectively enabled AND mode is `auto`, so a disabled/default
  session is byte-identical to today — no aggregate, no gate, no validation
  chain, no wake-rule.

### P1 — No orchestration mechanism can deadlock a Manager turn

- As a maintainer, I want every orchestration mechanism to be hang/crash-safe: a
  hung or crashed Worker is bounded by a max-wait then escalated/surfaced, and any
  failure in the contract degrades to today's ungated behavior — so the Manager
  turn can never deadlock, crash, or hang.

## Functional Requirements

### Group A — the Todo aggregate roll-up (FR-A)

1. **FR-A1 — a Manager maintains a delegated-Worker aggregate.** When a Manager
   (an orchestration-role parent — `RoutingSessionState.get(sessionId).hierarchyRole`
   is `"manager"`, or the `"architect"` root that dispatched via the manager edge)
   dispatches a Worker via the Task spawn seam (`tool/task.ts` :240-270), the
   runtime MUST record a delegated-child entry on the Manager keyed by the child
   session id — the same key `recordHierarchyDispatch` (`routing-hierarchy.ts`
   :282-302) already correlates. The aggregate is a roll-up: one `WorkerOutcome`
   per delegated child, carrying the child session id, its `WorkerLifecycle`
   state, and a bounded `TodoSummary` roll-up (`todo-authority.ts` `summarize`
   :195-199 — `ref`/`version`/`itemCount`/`statusCounts`, NEVER full item content).

2. **FR-A2 — a child's completion updates the aggregate.** When a delegated
   Worker reaches a terminal state, its `WorkerOutcome` MUST be updated to the
   terminal `WorkerLifecycle` (`done` on a completed result, `failed` on an error
   result, `aborted` on a cancelled/interrupted result — mapped from the
   `background.wait` result status the spawn already observes, `tool/task.ts`
   :346-355 / :424-435) and its `TodoSummary` refreshed from the child's own
   session-owned Todo snapshot (`session/todo.ts` `snapshot` :174-177). A Worker
   that is still running/queued is `pending`.

3. **FR-A3 — partial and failed children are first-class, never dropped.** A
   `failed` or `aborted` Worker MUST be represented explicitly in the aggregate
   (its `WorkerOutcome` carries the terminal state and, for a failure, a bounded
   `reason` string), NOT omitted. The aggregate's roll-up counters
   (`total`/`pending`/`done`/`failed`/`aborted`) MUST always sum to the number of
   delegated children, so a Manager can distinguish "all done" from "all terminal
   but some failed".

4. **FR-A4 — the aggregate honors Todo ownership.** The Manager's roll-up reads
   each child's Todo via the read-only `snapshot`/`summarize` projection only; it
   MUST NOT mutate a child's Todo aggregate — the parent-cannot-edit-child
   invariant (`todo-authority.ts` `assertOwner` :176-181, `session/todo.ts`
   `assertOwnership` :190-210) is preserved. Only the Manager's OWN Todo list is
   updated with the roll-up.

### Group B — the completion gate (FR-B)

5. **FR-B1 — a Manager turn is gated on all delegated Workers being terminal.**
   A Manager turn MUST NOT be reported complete while any delegated Worker in the
   aggregate is in a non-terminal (`pending`) `WorkerLifecycle`. The gate
   predicate is: EVERY delegated child is in a terminal state
   (`done | failed | aborted`). Until the predicate holds, the Manager turn is
   held open (mirroring the foreground `raceFirst` block already at
   `tool/task.ts` :418-451, generalized from one child to the whole delegated set).

6. **FR-B2 — a failed child SURFACES, it does not silently block.** The gate
   requires every child to be TERMINAL, not every child to have SUCCEEDED: a
   `failed` or `aborted` Worker satisfies the gate (it is terminal) and its
   failure is SURFACED into the Manager turn (the aggregate roll-up + a bounded
   reason), NOT held pending forever. The Manager decides how to proceed on a
   failed child (re-dispatch, escalate, or report) — the gate never deadlocks on
   a failure, and never silently swallows one.

7. **FR-B3 — the gate composes with the existing step-finish loop.** The
   completion gate is evaluated at the Manager's turn-boundary — the same
   response-loop seam the budget gate uses (`processor.ts` `step-finish` :493-545
   and the pre-turn gate :722-732, where a turn is held/blocked via `ctx.blocked`).
   It reuses the pure `todo-authority.ts` `completionGate` (:135-147) vocabulary
   (a `blocked` outcome with a pending count) rather than a parallel gate engine.
   A Manager turn already blocked by the budget gate (FR-B of Feature 043) stays
   blocked; the completion gate only ADDS the "delegated Workers still pending"
   reason.

### Group C — the validation chain (FR-C)

8. **FR-C1 — each Worker result passes an ordered validation chain.** Before a
   Worker's `WorkerOutcome` is accepted as `done` in the aggregate, its result
   MUST pass an ordered chain of stages, each evaluated only if the prior passed:
   (1) SHAPE — the result is well-formed (a bounded, decodable `task_result`
   envelope, `tool/task.ts` `renderOutput` :134-149); (2) POLICY — the result is
   legal for the child's role and the `orchestration_only` boundary (it did not
   escape the F042 allowlist, `tool/task.ts` :44-79); (3) DOMAIN — the result
   satisfies domain acceptance (the child's required Todo items are completed,
   `todo-authority.ts` `completionGate` :135-147 `validationPerformed`).

9. **FR-C2 — each stage has a defined fail-action.** A SHAPE failure REJECTS the
   result (the Worker is marked `failed` with a shape reason — a malformed result
   is never accepted). A POLICY failure REJECTS and MAY re-dispatch (an illegal
   result is not accepted; the Manager may re-dispatch the unit). A DOMAIN failure
   SURFACES a `blocked` completion reason (required items incomplete) WITHOUT
   crashing — the Manager sees the incomplete outcome and decides. No stage may
   silently pass a failing result.

10. **FR-C3 — the chain hooks at result acceptance, after the dispatch record.**
    The validation chain runs at the point the Manager ACCEPTS a Worker result
    (`tool/task.ts` :424-435, where the `background.wait` result is turned into
    the task output) — AFTER `recordHierarchyDispatch` (:262-270) recorded the
    lineage at spawn time, and BEFORE the `WorkerOutcome` is folded into the
    aggregate (FR-A2). The chain is a pure ordered function over the result +
    the child's Todo snapshot; it introduces no new I/O in the accept path.

### Group D — the wake-rule (FR-D)

11. **FR-D1 — a terminal Worker WAKES the Manager.** When a delegated Worker
    reaches a terminal state, the Manager MUST be WOKEN — re-evaluate the
    aggregate (FR-A2) and the completion gate (FR-B1) — rather than blocking on a
    poll. The wake TRIGGER is the child session's terminal lifecycle signal
    already on the bus: the `background.wait` resolution the spawn observes
    (`tool/task.ts` :346-355 for a background child, :424-427 for a foreground
    child), corroborated by `status.ts` `Event.Idle` (:43) and
    `session.ts` `Event.Deleted`/`Event.Error` (:326-328). The wake reads the
    child's terminal outcome; it never busy-polls.

12. **FR-D2 — wakes are coalesced/debounced.** Multiple terminal signals for the
    same Worker (e.g. an `Idle` event plus a `background.wait` resolution) MUST
    coalesce to a single aggregate re-evaluation per Worker terminal transition,
    so a burst of near-simultaneous Worker completions produces one gate
    re-evaluation per settled batch, not one per raw event. Coalescing is keyed by
    child session id; a Worker already recorded terminal is idempotent (a repeat
    signal is a no-op).

13. **FR-D3 — a hung/never-completing Worker is bounded by a max-wait.** The
    wake-rule MUST NOT deadlock if a Worker never reaches a terminal state: each
    delegated Worker carries a bounded MAX-WAIT (mirroring the F042
    `RESOLVE_TIMEOUT_MS` :50 and the F037/F043 timeout contract). On max-wait
    expiry the Worker's `WorkerOutcome` is force-transitioned to `aborted` with a
    `timeout` reason, the aggregate advances, and the completion gate can settle —
    so a hung/crashed Worker escalates/surfaces rather than blocking the Manager
    turn forever. The max-wait is a documented, operator-tunable plan constant.

### Group E — activation gating and composition (FR-E)

14. **FR-E1 — the whole contract is activation-gated (fan-out mode).** The Todo
    aggregate, the completion gate, the validation chain, and the wake-rule are
    ENGAGED only when Smart Routing is effectively enabled AND
    `activation.mode === "auto"` — the exact Feature 037/042 fan-out gate the
    spawn resolver already applies (`routing-hierarchy.ts` :369). When routing is
    disabled or in any non-`auto` mode, a Manager turn is byte-identical to today:
    no aggregate is recorded, the foreground single-child block is unchanged
    (`tool/task.ts` :418-451), no validation chain runs, and no wake-rule fires.

15. **FR-E2 — the contract composes with the F042 allowlist and F043 admission.**
    The aggregate MUST correctly resolve a delegated Worker that the F043 fan-out
    admission DENIED (`fanoutGranted` below the requested count,
    `routing-hierarchy.ts` :143/:415): a denied Worker is simply never dispatched,
    so it produces no `WorkerOutcome`, and the aggregate's `total` counts only the
    Workers actually spawned — the completion gate then settles over the granted
    set, not the requested one. A non-Worker (orchestration-only) child gated by
    the F042 allowlist (`tool/task.ts` :44-79) still resolves its aggregate entry
    correctly (its `WorkerLifecycle` tracks its terminal state like any child).

16. **FR-E3 — one store, one Todo authority, one response loop.** The contract
    reuses the shared `RoutingSessionState` store
    (`routing-session-store.ts` :23-30), the session-owned Todo authority
    (`session/todo.ts` over `todo-authority.ts`), and the `processor.ts`
    response-loop gate seam. It introduces no parallel dispatch store, Todo engine,
    or turn-loop; the aggregate is carried on the store the dispatch lineage
    already lives on, and released with it (`tool/task.ts` `store.clear` :447).

### Group F — back-compat and safety proof (FR-F)

17. **FR-F1 — total, non-throwing, hang-proof orchestration path.** A failure
    anywhere in the aggregate roll-up, the completion gate, the validation chain,
    or the wake-rule MUST degrade safely and NEVER crash, block, or deadlock the
    Manager turn — mirroring the Feature 037/042/043 safety contract. A defect in
    reading a child's Todo snapshot degrades that entry to an unknown roll-up (the
    lifecycle still tracks terminal state); a defect in the gate degrades to
    today's ungated single-child behavior; a hung Worker is bounded by the FR-D3
    max-wait. The ONE deliberate non-degrading outcome is a `blocked` completion
    gate (delegated Workers still pending), which is a typed, surfaced value — not
    a crash and not a silent finish.

18. **FR-F2 — a disabled/default session is byte-identical to pre-F044.** With
    Smart Routing disabled or non-`auto`, `grep` for the aggregate/gate/wake seams
    proves they are not engaged, and a Manager (or any) session behaves exactly as
    it did before this feature: the F042 spawn, the F043 budget path, and the
    existing foreground single-child block are untouched.

19. **FR-F3 — proven with real orchestration shapes.** Regression coverage MUST
    prove: (a) a Manager dispatching N Workers records N aggregate entries;
    (b) a Manager turn is blocked while any Worker is `pending` and settles when
    all are terminal; (c) a `failed`/`aborted` Worker surfaces in the aggregate and
    satisfies the terminal gate without deadlocking; (d) a Worker result failing
    the SHAPE/POLICY/DOMAIN stage takes the defined fail-action; (e) a terminal
    Worker wakes the Manager with wakes coalesced per Worker; (f) a
    never-completing Worker is force-`aborted` at max-wait and the gate settles;
    (g) a disabled/non-`auto` session is byte-identical to today; (h) a
    fan-out-denied Worker (F043) produces no entry and the gate settles over the
    granted set. No existing session/processor, routing, `tool/task.ts`, or
    `todo` assertion is weakened.

## Non-Functional Requirements

- **Inert by default, zero behavior change to a disabled session.** With Smart
  Routing off or non-`auto`, the contract is a no-op — byte-identical to
  pre-F044. Only an `auto`-mode Manager with delegated Workers sees the aggregate,
  the gate, the chain, and the wake-rule.
- **The Manager turn is never deadlocked, crashed, or hung.** Every leaf is
  bounded: the completion gate is a typed outcome, the wake-rule is event-driven
  with a max-wait floor, and every failure degrades to today's ungated behavior.
- **One store, one Todo authority, one response loop.** The contract reuses the
  shared `RoutingSessionState`, the session-owned Todo authority, and the
  `processor.ts` gate seam; no parallel orchestration engine.
- **Determinism.** The aggregate is a deterministic function of the observed
  Worker terminal outcomes; the completion gate and the validation chain are pure
  functions of the aggregate + the child Todo snapshots, so an orchestration
  outcome is reproducible from the recorded terminal states.

## Security Requirements

- **Data sensitivity/classification.** The contract reads the routing/activation
  configuration (operator metadata: enabled flag + mode) and each delegated
  child's Todo SUMMARY (`ref`/`version`/item-and-status counts — operational
  metadata, never full item content, `todo-authority.ts` `summarize` :195-199)
  plus the child's terminal lifecycle status. It records only the bounded
  `WorkerOutcome` roll-up (child session id, lifecycle, status counts, a bounded
  failure reason) onto the in-memory `RoutingSessionState`. It reads, logs, and
  persists NO message content, credential, or secret — only correlation ids and
  aggregate counts.
- **Authentication/authorization.** No new authenticated surface. The contract
  NARROWS orchestration: it enforces the parent-cannot-edit-child Todo invariant
  (`assertOwner` :176-181 — the Manager reads a child's Todo via the read-only
  projection only, never mutates it) and it composes UNDER the F042
  `orchestration_only` allowlist and the F043 admission gate — it can only confine
  a Manager's delegated set, never widen it.
- **Input validation.** The untrusted inputs are the Worker RESULT (validated by
  the FR-C ordered chain — a malformed result fails the SHAPE stage and is
  rejected, never accepted) and the child's Todo snapshot (already bounded by the
  Feature 001 Todo schema and the `summarize` projection). The child session id
  is the branded `ses_...` id the store already correlates
  (`routing-state.ts` `correlateAsChild` :70-75); a mismatched lineage is skipped,
  not folded in.
- **Cryptography in transit/at rest.** Not applicable — the contract performs no
  new network I/O and persists no new at-rest data. The aggregate is in-memory on
  the `RoutingSessionState` and released with the session
  (`tool/task.ts` `store.clear` :447); it moves no secret.
- **Logging/audit.** No new logging of sensitive material. The aggregate,
  validation outcomes, and wake events are correlated by session id in the
  in-memory store; no message content, config payload, or credential is written
  to a log line. A rejected/failed Worker logs only a bounded reason string
  (mirroring `tool/task.ts` :269 `logWarning`).
- **Error-handling information exposure.** An orchestration-path FAILURE collapses
  to today's ungated behavior (no stack trace, config fragment, or Todo content
  surfaced). A `blocked` completion gate surfaces only the typed outcome and a
  pending count (`completionGate` :135-147), and a failed Worker surfaces only a
  bounded reason — neither names a secret nor message content.

## Acceptance Scenarios

Given a Manager-role session with Smart Routing effectively enabled in `auto`
mode, dispatching Worker children through the Task spawn seam over the shared
`RoutingSessionState` store and the session-owned Todo authority

- **A Manager records a roll-up of every delegated Worker (FR-A1, FR-A2, FR-F3-a).**
  Given a Manager dispatches N Workers,
  When each dispatch is recorded,
  Then the Manager's aggregate carries N `WorkerOutcome` entries keyed by child
  session id, each with a `WorkerLifecycle` and a bounded `TodoSummary` roll-up,
  and the roll-up counters sum to N.

- **A Manager turn is gated while a Worker is pending (FR-B1, FR-B3, FR-F3-b).**
  Given at least one delegated Worker is still `pending`,
  When the Manager reaches its turn-boundary,
  Then the completion gate returns `blocked` with the pending count and the
  Manager turn is held open — it is not reported complete.

- **A failed Worker surfaces and satisfies the terminal gate (FR-A3, FR-B2, FR-F3-c).**
  Given every delegated Worker is terminal but one is `failed`,
  When the gate is re-evaluated,
  Then the gate is satisfied (all terminal), the failed Worker is represented in
  the aggregate with a bounded reason, and the failure is surfaced into the
  Manager turn rather than blocking it forever.

- **A Worker result passes/fails the ordered validation chain (FR-C1, FR-C2, FR-C3, FR-F3-d).**
  Given a Worker returns a result,
  When the Manager accepts it,
  Then the result passes SHAPE → POLICY → DOMAIN in order; a SHAPE or POLICY
  failure REJECTS the result (marked `failed`, may re-dispatch on POLICY) and a
  DOMAIN failure SURFACES a `blocked` reason — no stage silently accepts a failing
  result.

- **A terminal Worker wakes the Manager, coalesced (FR-D1, FR-D2, FR-F3-e).**
  Given a delegated Worker reaches a terminal state,
  When its terminal signal fires (possibly more than once),
  Then the Manager is woken exactly once per Worker terminal transition, the
  aggregate advances, and the completion gate is re-evaluated — with no polling.

- **A never-completing Worker is bounded by max-wait (FR-D3, FR-F1, FR-F3-f).**
  Given a delegated Worker never reaches a terminal state,
  When its max-wait expires,
  Then the Worker is force-transitioned to `aborted` with a `timeout` reason, the
  aggregate advances, and the completion gate settles — the Manager turn never
  deadlocks.

- **A disabled/non-`auto` session is byte-identical to today (FR-E1, FR-F2, FR-F3-g).**
  Given Smart Routing is disabled or in a non-`auto` mode,
  When a Manager (or any) session dispatches a child,
  Then no aggregate is recorded, no completion gate runs, no validation chain
  fires, and no wake-rule engages — the F042 spawn and the existing foreground
  single-child block are untouched.

- **A fan-out-denied Worker resolves the aggregate correctly (FR-E2, FR-F3-h).**
  Given the F043 admission granted fewer Workers than requested,
  When the Manager settles,
  Then a denied Worker produces no `WorkerOutcome`, the aggregate `total` counts
  only the granted set, and the completion gate settles over that set.

## Observability

Phase 3 adds no new metrics, log events, or trace spans. The orchestration
outcomes — the aggregate roll-up counters, the completion-gate `ok`/`blocked`
outcome with its pending count, the per-stage validation result, and the wake
transitions — are plain typed data carried on the `RoutingSessionState`. A
rejected/failed Worker logs a bounded reason (mirroring the existing
`tool/task.ts` :269 `logWarning`). Surfacing the orchestration outcomes onto the
OTLP telemetry seam (a span event / counter for `orchestration.blocked` /
`worker.timeout` / `validation.rejected`) is deferred to Phase 4. The behavioral
change is confined to WHEN a Manager turn settles (all delegated Workers
terminal) and HOW a failed/hung Worker is surfaced, and only when Smart Routing
is active in `auto` mode. Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The Manager records a delegated-Worker aggregate at the spawn seam, validates each
accepted Worker result through an ordered chain, gates its turn on all Workers
being terminal, and is woken by each Worker's terminal signal:

```
prompt.ts handleSubtask / tool/task.ts spawn (:240-270)
  recordHierarchyDispatch(store, childSessionId, lineageStub)   (F042 :282-302)
  aggregate.record(child) -> WorkerOutcome{ child_session_id,   (FR-A1)
     lifecycle: pending, todo: summarize(child snapshot) }
        |
        v  (a Worker returns a result — tool/task.ts :424-435)
  validationChain(result, child snapshot):                      (FR-C1, FR-C3)
     SHAPE  (decodable task_result envelope)  fail -> reject/failed   (FR-C2)
     POLICY (legal for role + orchestration_only allowlist) fail -> reject/re-dispatch
     DOMAIN (completionGate.validationPerformed) fail -> surface blocked
        |
        v  (a Worker reaches terminal — background.wait :346-355 / :424-427)
  wake(child):                                                  (FR-D1, FR-D2)
     coalesce per child_session_id; idempotent on repeat signal
     aggregate.update(child, terminal lifecycle + refreshed todo)  (FR-A2, FR-A3)
       done | failed(reason) | aborted(reason)
     max-wait expiry -> force aborted(timeout)                  (FR-D3)
        |
        v
  processor.ts turn-boundary gate (step-finish :493-545 / pre-turn :722-732)
  completionGate(managerAggregate):                             (FR-B1, FR-B3)
     any child pending      -> blocked(pendingWorkers)  (hold the turn)
     all children terminal  -> ok  (a failed/aborted child surfaces, FR-B2)
        |
        v
  activation gate: engaged only when enabled && mode == "auto"  (FR-E1)
  else byte-identical to today (no aggregate/gate/chain/wake)   (FR-E2, FR-F2)
  release: store.clear(childSessionId) on child finish          (FR-E3, tool/task.ts :447)
```

## Out of Scope

- **The runtime escalation TRIGGER** — the condition that fires a Worker→Manager
  reclassification (`routing-hierarchy.ts` `escalateWorkerToManager` :251-259 is
  the wired call site) is Phase 4; this feature orchestrates the delegated Worker
  set, it does not decide when a Worker becomes a Manager.
- **A durable, cross-restart aggregate** — the aggregate is in-memory on the
  `RoutingSessionState` (released with the session, `tool/task.ts` :447); a
  durable roll-up that survives an `opencode serve` restart is Phase 4. The Todo
  content it rolls up is already durably persisted (`session/todo.ts`).
- **Telemetry surfacing** of the orchestration outcomes onto OTLP
  spans/metrics (Phase 4).
- **The operator-stack `InstanceRef` candidate-resolver fix**
  (`operator/stack-live.ts:314/341`) — side-stepped via the session-local
  composition, as in Phase 1/2a/2b (Phase 4).
- **`always`/`never`-mode orchestration** — the contract engages only in `auto`
  (fan-out) mode, mirroring the F042/F043 fan-out gate.

## Clarifications

### Session 2026-07-21

Declarative resolutions for the Feature 044 clarify dimension. Each closes an open
question with a conservative, tunable default and a named acceptance hook (AC =
Acceptance Scenario above). This section fixes the decisions ADR-0044 formalizes.

- **C1 — the aggregate is keyed by child session id on the shared store.** The
  Manager's delegated-Worker aggregate is recorded on the same
  `RoutingSessionState` entry the dispatch lineage already lives on
  (`recordHierarchyDispatch` :282-302), keyed by the branded child session id, and
  released with the session (`store.clear` :447). No parallel dispatch store.
  Acceptance hook AC "A Manager records a roll-up of every delegated Worker".

- **C2 — the completion gate requires TERMINAL, not SUCCESS.** A Manager turn
  settles when every delegated Worker is in a terminal state
  (`done | failed | aborted`); a `failed`/`aborted` Worker satisfies the gate and
  is SURFACED (block-on-failure was rejected — it deadlocks a Manager on a Worker
  crash). The gate reuses the pure `completionGate` (:135-147) `blocked` vocabulary.
  Acceptance hooks AC "A Manager turn is gated while a Worker is pending" and
  "A failed Worker surfaces and satisfies the terminal gate".

- **C3 — the validation chain is SHAPE → POLICY → DOMAIN, ordered, fail-fast.**
  Each stage runs only if the prior passed; SHAPE/POLICY REJECT (POLICY may
  re-dispatch), DOMAIN SURFACES a `blocked` reason. The chain hooks at result
  acceptance (`tool/task.ts` :424-435), after `recordHierarchyDispatch` and before
  the aggregate fold. Acceptance hook AC "A Worker result passes/fails the ordered
  validation chain".

- **C4 — the wake-rule is event-driven with coalescing and a max-wait floor.** A
  Worker terminal signal (`background.wait` resolution, corroborated by
  `Event.Idle`/`Event.Deleted`/`Event.Error`) wakes the Manager; wakes coalesce
  per child session id; a never-completing Worker is force-`aborted` at a bounded,
  operator-tunable max-wait (mirroring `RESOLVE_TIMEOUT_MS` :50). Polling was
  rejected (busy-wait, no deadlock guarantee). Acceptance hooks AC "A terminal
  Worker wakes the Manager, coalesced" and "A never-completing Worker is bounded
  by max-wait".

- **C5 — the whole contract is activation-gated and hang/crash-safe.** Engaged
  only when `enabled && mode === "auto"` (the F037/042 fan-out gate); every leaf
  degrades to today's ungated behavior on any failure; a disabled/default session
  is byte-identical to pre-F044. Acceptance hooks AC "A disabled/non-`auto` session
  is byte-identical to today" and "A fan-out-denied Worker resolves the aggregate
  correctly".

## Related Features and Decisions

- [ADR-0044 — Compose the hierarchy orchestration contract so a Manager orchestrates its Workers](../../adr/0044-compose-the-hierarchy-orchestration-contract-so-a-manager.md)
- [Feature 042 — Wire per-subagent hierarchy delegation into the Task spawn](../042-wire-per-subagent-hierarchy-delegation-into-the-task-spawn/spec.md) — the Manager→Worker dispatch, the `orchestration_only` allowlist, and the dispatch-lineage record this feature orchestrates over.
- [Feature 043 — Enforce live budget consumption and fanout admission across the session](../043-enforce-live-budget-consumption-and-fanout-admission-across/spec.md) — the fan-out admission gate whose granted worker set this feature's aggregate and completion gate settle over; the activation gate and hang/crash-safety contract this feature mirrors.
- [Feature 037 — Wire the operator Smart Routing engine into the live session](../037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md) — Phase 1 (the hang/crash-safety and activation-gating contract this feature mirrors).
- [Feature 001 — Define one cohesive Smart Agent Routing and OpenTelemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the pure `todo-authority.ts` Todo aggregate / `completionGate` / `summarize`, the `RoutingSessionState` store, and the hierarchy dispatcher this feature composes over.
- The `WorkerOutcome` / `ManagerWorkerAggregate` / `WorkerValidationChain` / `WorkerWakeRule` value objects and the `worker.completed` / `orchestration.completion_blocked` domain events this feature records are bound by the CUE corpus under `doc/arch/schemas/orchestration/` (`ids.cue` / `aggregate.cue` / `gates.cue` / `wake-and-events.cue`).
