# Tasks: Compose The Hierarchy Orchestration Contract So A Manager

Each task names the FR group it satisfies and the shipped-code seam it grounds
on. Tasks are ordered so each builds on the prior; `[P]` marks tasks that can run
in parallel with their siblings. No task weakens an existing assertion (FR-F3).

## Task Breakdown

### Leaf A — the Todo aggregate roll-up (FR-A)

- [x] T001 [P] Add the pure aggregate value objects to a new session-layer module
  `session/orchestration-aggregate.ts` — `WorkerLifecycle`, `WorkerOutcome`,
  `WorkerRollupCounters`, `WorkerRoster`, `ManagerWorkerAggregate` — bound by
  the CUE corpus under `doc/arch/schemas/orchestration/`.
  Pure, framework-free (mirrors `budget-consume.ts`); the counters always sum to
  the delegated total (FR-A3).
- [x] T002 Extend `RoutingSessionState` (`session/routing-state.ts` :35-43) with a
  per-Manager delegated-Worker aggregate keyed by child session id, plus
  `recordDelegatedWorker` / `updateWorkerOutcome` store methods alongside the
  existing `recordDispatch` (:120-129); release with `clear` (:135-137) (FR-A1,
  FR-E3).
- [x] T003 At the spawn seam (`tool/task.ts` :262-270, beside
  `recordHierarchyDispatch`), record a `pending` `WorkerOutcome` for each
  dispatched child with a bounded `TodoSummary` roll-up from the child's
  `session/todo.ts` `snapshot` (:174-177) via `summarize` (`todo-authority.ts`
  :195-199), read-only (never mutate a child's Todo — `assertOwnership` :190-210)
  (FR-A1, FR-A4).
- [x] T004 On a child terminal result (`tool/task.ts` :346-355 background /
  :424-435 foreground), map the `background.wait` status to a terminal
  `WorkerLifecycle` (`done`/`failed`/`aborted`) with a bounded reason and refresh
  the child's Todo roll-up (FR-A2, FR-A3).

### Leaf B — the completion gate (FR-B)

- [x] T005 Add a pure `managerCompletionGate(aggregate)` over the roster reusing
  the `todo-authority.ts` `completionGate` (:135-147) `blocked` vocabulary:
  `blocked` with a pending count while any Worker is `pending`, `ok` when all are
  terminal (a `failed`/`aborted` Worker is terminal, FR-B1, FR-B2).
- [x] T006 Wire the gate at the Manager turn-boundary in `processor.ts`
  (`step-finish` :493-545 / pre-turn :722-732) so a Manager turn is held via
  `ctx.blocked` while Workers are pending, composed AFTER the F043 budget gate (a
  budget-blocked turn stays blocked; this adds the "Workers pending" reason)
  (FR-B3).

### Leaf C — the validation chain (FR-C)

- [x] T007 [P] Add a pure ordered `workerValidationChain(result, childSnapshot)` —
  `SHAPE` (decodable `task_result` envelope, `tool/task.ts` `renderOutput`
  :134-149) → `POLICY` (legal for role + `orchestration_only` allowlist :44-79) →
  `DOMAIN` (`completionGate.validationPerformed`, required items complete) — with a
  per-stage fail-action (`reject` / `reject_redispatch` / `surface_blocked`)
  (FR-C1, FR-C2).
- [x] T008 Hook the chain at result acceptance (`tool/task.ts` :424-435), AFTER
  `recordHierarchyDispatch` and BEFORE the `WorkerOutcome` fold (T004): a rejected
  result marks the Worker `failed`; a POLICY rejection may re-dispatch; a DOMAIN
  failure surfaces a `blocked` reason (FR-C3).

### Leaf D — the wake-rule (FR-D)

- [x] T009 Add a coalesced, event-driven wake keyed by child session id: subscribe
  the Manager to each Worker's terminal signal (`background.wait` resolution,
  corroborated by `status.ts` `Event.Idle` :43 and `session.ts`
  `Event.Deleted`/`Event.Error` :326-328); a repeat signal for a child already
  terminal is idempotent (FR-D1, FR-D2).
- [x] T010 Bound each delegated Worker with a `MAX_WAIT_MS` plan constant
  (mirroring `routing-hierarchy.ts` `RESOLVE_TIMEOUT_MS` :50): on expiry
  force-transition the Worker to `aborted` with a `timeout` reason so the gate
  settles — no deadlock if a Worker never completes (FR-D3).

### Cross-cutting — activation gating, composition, safety (FR-E, FR-F)

- [x] T011 Gate the whole contract (aggregate, gate, chain, wake) on
  `activation.enabled && mode === "auto"` (the F037/042 gate,
  `routing-hierarchy.ts` :369): when off, no aggregate/gate/chain/wake — the F042
  spawn and the foreground single-child block (`tool/task.ts` :418-451) are
  untouched (FR-E1, FR-F2).
- [x] T012 Prove composition with F043 admission: a fan-out-denied Worker
  (`fanoutGranted` below requested, :143/:415) produces no `WorkerOutcome`, so the
  gate settles over the granted set; a non-Worker orchestration-only child still
  resolves its entry (FR-E2).
- [x] T013 Wrap every leaf so any defect degrades to today's ungated behavior and
  the Manager turn never crashes/blocks/deadlocks; the ONE deliberate
  non-degrading outcome is a `blocked` completion gate (FR-F1).
- [x] T014 Regression coverage for FR-F3 (a)-(h): N-Worker aggregate; pending-gate
  hold + terminal settle; failed/aborted surfaced without deadlock; per-stage
  validation fail-actions; coalesced wake; max-wait force-abort; disabled/non-auto
  byte-identical; fan-out-denied settles over the granted set. No existing
  session/processor, routing, `tool/task.ts`, or `todo` assertion weakened.

## Dependencies

- **T001-T004 → T005-T006**: the completion gate reads the aggregate the roll-up
  tasks populate.
- **T004 depends on T007-T008**: a Worker is folded as `done` only after the
  validation chain accepts its result.
- **T009-T010 depend on T002**: the wake advances the store-backed aggregate.
- **T011-T013 wrap all leaves**: activation gating and the safety wrap are the
  outermost layer; every leaf is inert unless T011's gate passes.
- **Upstream (shipped)**: Feature 042 delegation dispatch + `orchestration_only`
  allowlist, Feature 043 budget consumption + fan-out admission, Feature 001 Todo
  authority + `RoutingSessionState` store. No new external system or service.
