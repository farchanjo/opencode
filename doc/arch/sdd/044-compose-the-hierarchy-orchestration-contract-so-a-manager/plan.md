# Implementation Plan: Compose The Hierarchy Orchestration Contract So A Manager

## Overview

This plan composes the four orchestration leaves — the Todo aggregate roll-up
(FR-A), the completion gate (FR-B), the validation chain (FR-C), and the wake-rule
(FR-D) — onto the ALREADY-SHIPPED hierarchy delegation (Feature 042) and budget
consumption / fan-out admission (Feature 043). It turns "a Manager can dispatch a
Worker" into "a Manager correctly ORCHESTRATES a set of Workers to completion",
while staying INERT unless Smart Routing is active in `auto` mode (FR-E) and
HANG/CRASH-SAFE so a hung/crashed Worker can never deadlock the Manager turn
(FR-F). It reuses one store (`RoutingSessionState`), one Todo authority
(`session/todo.ts` over `todo-authority.ts`), and one response loop
(`processor.ts`); it introduces no parallel orchestration engine.

## Technical Approach

**Architectural layers affected.** Three existing seams plus one new pure module:

- **Pure domain (new `session/orchestration-aggregate.ts`).** Framework-free value
  objects and functions — the `ManagerWorkerAggregate`/`WorkerOutcome` roll-up
  (FR-A), the `managerCompletionGate` over the roster reusing `todo-authority.ts`
  `completionGate` (:135-147) vocabulary (FR-B), and the ordered
  `workerValidationChain` SHAPE→POLICY→DOMAIN (FR-C). No I/O, no Effect import;
  mirrors `budget-consume.ts`. Bound by the feature CUE schema.
- **The store (`session/routing-state.ts` :35-43).** Extend `RoutingSessionState`
  with the per-Manager delegated-Worker aggregate keyed by child session id, with
  `recordDelegatedWorker`/`updateWorkerOutcome` beside `recordDispatch`
  (:120-129); the shared instance (`routing-session-store.ts` :23-30) makes it
  visible to the processor, the prompt layer, and the spawn seam; released with
  `clear` (:135-137).
- **The spawn seam (`tool/task.ts`, `prompt.ts` `handleSubtask`).** Record a
  `pending` `WorkerOutcome` beside `recordHierarchyDispatch` (:262-270); run the
  validation chain at result acceptance (:424-435); fold the terminal
  `WorkerOutcome` from the `background.wait` status (:346-355 / :424-435).
- **The response loop (`processor.ts` `step-finish` :493-545 / pre-turn
  :722-732).** Evaluate the completion gate at the Manager turn-boundary, holding
  the turn via `ctx.blocked` while Workers are pending, composed AFTER the F043
  budget gate.
- **The lifecycle bus (`status.ts` `Event.Idle` :43, `session.ts`
  `Event.Deleted`/`Event.Error` :326-328).** Drive the coalesced wake-rule.

**Key data structures.** `WorkerOutcome` (child session id + `WorkerLifecycle` +
bounded `TodoRollup` + optional reason); `WorkerRollupCounters` (total/pending/
done/failed/aborted, invariant sum); `ManagerWorkerAggregate` (manager session id
+ `WorkerRoster` + counters); `WorkerValidationChain` (ordered
`ValidationStageResult`s + acceptance); `WorkerWakeRule` (trigger + `MaxWaitMs` +
coalescing). All defined in the feature CUE schema.

**Key algorithm — the wake-and-gate loop.** A Worker terminal signal wakes the
Manager (coalesced per child session id, idempotent); the wake updates the
`WorkerOutcome` (via the validation chain for a result) and re-evaluates the
completion gate; the gate holds the turn while any Worker is `pending` and settles
when all are terminal. A per-Worker `MAX_WAIT_MS` (mirroring
`RESOLVE_TIMEOUT_MS` :50) force-transitions a never-completing Worker to
`aborted(timeout)` so the gate always settles — event-driven, never a poll loop,
never a deadlock.

**Integration points and invariants.** The contract composes with the F042
`orchestration_only` allowlist (a non-Worker child still resolves its entry) and
the F043 admission gate (a fan-out-denied Worker produces no entry; the gate
settles over the GRANTED set). It preserves the parent-cannot-edit-child Todo
invariant (`assertOwner` :176-181 — the Manager reads each child's Todo through the
read-only `summarize` projection only). The whole contract is gated on
`activation.enabled && mode === "auto"` (:369); when off it is byte-identical to
today. Every leaf is wrapped so any defect degrades to the ungated single-child
behavior; the one deliberate non-degrading outcome is a `blocked` completion gate.

## Companion Artifacts

The CUE contract for this feature lives under
`doc/arch/schemas/orchestration/` (`ids.cue` / `aggregate.cue` / `gates.cue` /
`wake-and-events.cue`) — the `WorkerOutcome` / `ManagerWorkerAggregate` / `CompletionGateResult` /
`WorkerValidationChain` / `WorkerWakeRule` value objects and the
`worker.completed` / `orchestration.completion_blocked` / `worker.timed_out`
domain events). The Gherkin behavior corpus lives at
`doc/arch/specs/features/compose-the-hierarchy-orchestration-contract-so-a-manager.feature`.
No `research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is required —
the shipped seams (F042/F043) and the feature CUE schema fully ground the design.
