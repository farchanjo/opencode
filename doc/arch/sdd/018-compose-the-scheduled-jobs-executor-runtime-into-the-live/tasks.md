# Tasks: Compose the Scheduled Jobs Executor Runtime into the Live Runtime (Feature 018)

Synced with plan.md (Phase 1 eager composition + coordinator FIRST, Phase 2 run-now
conversion, Phase 3 definition-keyed occurrence events, Phase 4 interrupt edge,
Phase 5 availability flip + parity, Phase 6 tests + guard + doc sync) and the
specScopeGlobs in doc/arch/speckit.toml. ADR-0018 proposed.

Composition ONLY. NO new executor, NO new catalog id, NO catalog version bump, NO
new dispatch path, NO new flag — the Feature 007 registration + `OperatorClient`
loopback parity invariant (FR12) is preserved. `run-now` commits through
`mutateAuthority` via the Feature 017 `OperatorMutationPlan.effect` seam; the eager
arming is fail-open and bounded; a scheduled session never bypasses a
permission/config surface (FR6); every read/mutation honest-degrades to a typed
envelope (FR13). The MCP interactive-OAuth (`auth.start`/`finish`) and Smart Routing
edges stay typed capability gaps. No code is executed in this documentary pass;
tasks are the implement backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below). Group A (eager composition +
coordinator) is FIRST — nothing runs without it.

- [ ] T001 — `ExecutorComposition` process-singleton armed eagerly at server start
- [ ] T002 — Fail-open, idempotent arming (a fault never breaks server startup)
- [ ] T003 — Wire `DueDispatcher` → `onDue` and `reconcileSource` → rehydration
- [ ] T004 — Implement `TaskProcessCoordinator.admit` over the F002/F001 gates
- [ ] T005 — Implement `createProcess`/`provisionTodo`/`provisionOutputGroup`
- [ ] T006 — Run headless via the shared spool writer; same permission surface (no bypass)
- [ ] T007 — Bounded concurrency over the existing overlap/misfire policies
- [ ] T008 — Convert `jobs.run-now` to an effectful mutation plan (enqueue occurrence)
- [ ] T009 — Honest run-now outcomes (overlap-rejected / executor-unavailable / replay)
- [ ] T010 — Emit definition-keyed `job.*` occurrence events
- [ ] T011 — History/show/watch resolve by `jobDefinitionId` (real executions)
- [ ] T012 — `InterruptRegistry` process-singleton + execution-layer registration
- [ ] T013 — Second-press forced abort consults the registry; first-press unchanged
- [ ] T014 — Palette availability flip (`jobs.run-now` + process/task `cancel`)
- [ ] T015 — Composition + coordinator tests (arming, fail-open, admit→run→terminal)
- [ ] T016 — Run-now + occurrence-history tests (effect once, overlap, real history)
- [ ] T017 — Interrupt-edge + availability/parity tests (FR12)
- [ ] T018 — Guard scope + doc sync + `speckit analyze` + `validate --json` green

---

## Group A — Eager executor composition + coordinator implementation (FR1-FR6) — FIRST

- [ ] **T001 — `ExecutorComposition` process-singleton armed eagerly at server start**
- **Depends:** none
- **Paths:** `packages/opencode/src/jobs/**` (new composition root), `packages/opencode/src/server/server.ts`
- **Deliverable:** a process-wide `ExecutorComposition` that constructs the scheduler
  engine + `createBunCronAdapter` (`bun-cron-adapter.ts`) + trigger service
  (`trigger-service.ts`) and arms the cron loop, armed eagerly at `server.ts`
  `listen()` mirroring `SpoolProcessWriter.ensureProcessSpoolWriter()` (`server.ts:113-118`),
  independent of the operator stack (schema `executor-composition/composition.cue`
  `#ExecutorComposition`).
- **Acceptance:** the executor arms at `listen()` without the operator being opened; a
  second call reuses the armed instance (idempotent), never a second cron loop.
- **Verification:** `bun test packages/opencode/test/jobs/**`; `bun run typecheck`.
- **Evidence:** _(reserved)_

- [ ] **T002 — Fail-open, idempotent arming (a fault never breaks server startup)**
- **Depends:** T001
- **Paths:** `packages/opencode/src/jobs/**`, `packages/opencode/src/server/server.ts`
- **Deliverable:** wrap the arming so any construction/arming fault (a bad definition,
  a Bun cron error, a persistence outage) is caught — the server still starts with the
  executor `disarmed` and the schedule/run-now verbs at their typed gap; the bootstrap
  is an idempotent process singleton (`#ArmState`, `#EagerArmed`) (FR2).
- **Acceptance:** an injected arming fault leaves the server started + executor
  disarmed; no crash and no partial arm that fires without a coordinator.
- **Verification:** `bun test packages/opencode/test/jobs/**` (fail-open case).
- **Evidence:** _(reserved)_

- [ ] **T003 — Wire `DueDispatcher` → `onDue` and `reconcileSource` → rehydration**
- **Depends:** T001
- **Paths:** `packages/opencode/src/jobs/**`
- **Deliverable:** wire the `DueDispatcher` to
  `AppRuntime.runFork(triggerService.onDue(signal))` (`bun-cron-adapter.ts:181-187`)
  and the `reconcileSource` to the persisted registration rehydration
  (`:189-208`) so enabled definitions re-register on the startup sweep without claiming
  past execution (`#DueDispatch`).
- **Acceptance:** an enabled persisted definition re-registers on startup; a due time
  fires `onDue` fire-and-forget without blocking the cron thread.
- **Verification:** `bun test packages/opencode/test/jobs/**` (reconcile + dispatch).
- **Evidence:** _(reserved)_

- [ ] **T004 — Implement `TaskProcessCoordinator.admit` over the F002/F001 gates**
- **Depends:** T001
- **Paths:** `packages/opencode/src/jobs/**`
- **Deliverable:** implement `admit` (`trigger-service.ts:123-124`) over the real
  Feature 002 admission + Feature 001 routing hard gates, returning the honest
  `AdmissionOutcome` (`#AdmissionOutcome`) — a denial reports its reason, never a fake
  `admitted` (FR4).
- **Acceptance:** a denied admission surfaces the typed denial; an admitted occurrence
  proceeds; no gate is bypassed.
- **Verification:** `bun test packages/opencode/test/jobs/**` (admit cases).
- **Evidence:** _(reserved)_

- [ ] **T005 — Implement `createProcess`/`provisionTodo`/`provisionOutputGroup`**
- **Depends:** T004
- **Paths:** `packages/opencode/src/jobs/**`, `packages/opencode/src/tool/task.ts`
- **Deliverable:** implement `createProcess` (owner_kind `"scheduled-job"`) through
  `TaskTool` (`tool/task.ts`) / `SessionExecution`, and `provisionTodo` /
  `provisionOutputGroup` for the occurrence-owned Feature 002 Todo + Feature 005
  OutputGroup (`trigger-service.ts:125-130`, `#ScheduledProcess`) — no second executor
  or lifecycle (Feature 003 C16).
- **Acceptance:** an admitted occurrence creates a Task Process tagged `scheduled-job`
  and provisions its Todo + OutputGroup before goal-bearing work.
- **Verification:** `bun test packages/opencode/test/jobs/**` (provision cases).
- **Evidence:** _(reserved)_

- [ ] **T006 — Run headless via the shared spool writer; same permission surface (no bypass)**
- **Depends:** T005
- **Paths:** `packages/opencode/src/jobs/**`, `packages/opencode/src/session/**`
- **Deliverable:** run the admitted occurrence headless through `SessionExecution`,
  capturing output through the SAME Feature 017 `SpoolProcessWriter`
  (`outputspool/spool-process-writer.ts`) — never a second writer or control-store
  connection — and emit the terminal occurrence events. The scheduled session runs
  under the SAME permission/config surface as a normal session; a capability a headless
  session cannot satisfy degrades to a typed terminal outcome (`#CoordinatorStep`,
  `#SamePermissionSurface`, `#SharedSpoolWriter`) (FR5, FR6).
- **Acceptance:** output lands in the shared control store; a permission gate a user
  session hits is hit by the scheduled session too; no auto-approved bypass.
- **Verification:** `bun test packages/opencode/test/jobs/**` + `packages/opencode/test/operator/**`.
- **Evidence:** _(reserved)_

- [ ] **T007 — Bounded concurrency over the existing overlap/misfire policies**
- **Depends:** T003, T005
- **Paths:** `packages/opencode/src/jobs/**`
- **Deliverable:** honor the existing overlap (`forbid`/`allow`/`queue`/`replace`) and
  misfire policies (`bun-cron-adapter.ts:271-283`) so concurrent due occurrences are
  bounded (`#ConcurrencyBound`, `#OverlapPolicy`, `#MisfireDisposition`) — never an
  unbounded fan-out of headless sessions (FR3).
- **Acceptance:** a `forbid` overlap rejects a concurrent occurrence; a missed trigger
  resolves to its explicit misfire outcome.
- **Verification:** `bun test packages/opencode/test/jobs/**` (overlap/misfire).
- **Evidence:** _(reserved)_

## Group B — Run-now conversion (FR7)

- [ ] **T008 — Convert `jobs.run-now` to an effectful mutation plan (enqueue occurrence)**
- **Depends:** T001, T005
- **Paths:** `packages/opencode/src/operator/jobs/backend-live.ts`, `packages/opencode/src/operator/jobs/**`
- **Deliverable:** convert `planRunNow` (`backend-live.ts:93`) from the typed
  `unavailable` gap to an `OperatorMutationPlan` whose `effect` (the Feature 017
  fix-round seam, `application/handler.ts`) enqueues an immediate occurrence, run
  EXACTLY ONCE by `mutateAuthority` after contract + idempotency + CAS and before the
  committed write (`#RunNowPlan`, `#RunNowResult`) (FR7).
- **Acceptance:** a dispatch enqueues one immediate occurrence and returns its identity;
  the effect runs once after the checks; an idempotent replay does not re-enqueue.
- **Verification:** `bun test packages/opencode/test/operator/**` (run-now plan).
- **Evidence:** _(reserved)_

- [ ] **T009 — Honest run-now outcomes (overlap-rejected / executor-unavailable / replay)**
- **Depends:** T008
- **Paths:** `packages/opencode/src/operator/jobs/**`
- **Deliverable:** map the enqueue result to the honest `#RunNowOutcome` — `enqueued`,
  `overlap_rejected` (a run in flight under `forbid`), or `executor_unavailable` (a
  disarmed executor) — never a fabricated occurrence (FR7, FR13).
- **Acceptance:** an in-flight `forbid` run returns the typed rejection; a disarmed
  executor returns the typed gap.
- **Verification:** `bun test packages/opencode/test/operator/**` (outcome cases).
- **Evidence:** _(reserved)_

## Group C — Definition-keyed occurrence events (FR8)

- [ ] **T010 — Emit definition-keyed `job.*` occurrence events**
- **Depends:** T006
- **Paths:** `packages/opencode/src/jobs/**`, `packages/opencode/src/event-v2-bridge.ts`
- **Deliverable:** emit the `job.*` occurrence events (`events-occurrence.cue`) through
  the `EventV2Bridge` under a definition-keyed durable aggregate (the
  `jobDefinitionId`, `envelope.occurrence.job_definition_id`) — or a definition-keyed
  index over the session-aggregated stream — so the occurrence read is keyed by
  definition (`#DefinitionKeyedAggregate`) (FR8).
- **Acceptance:** a completed occurrence emits definition-keyed events; the durable read
  resolves them by `jobDefinitionId`.
- **Verification:** `bun test packages/opencode/test/jobs/**` + `packages/opencode/test/operator/**`.
- **Evidence:** _(reserved)_

- [ ] **T011 — History/show/watch resolve by `jobDefinitionId` (real executions)**
- **Depends:** T010
- **Paths:** `packages/opencode/src/operator/jobs/occurrence-projection.ts`, `packages/opencode/src/operator/jobs/backend-live.ts`
- **Deliverable:** confirm the Feature 017 occurrence projection
  (`occurrence-projection.ts`, `backend-live.ts:48`) resolves the definition-keyed
  events so `jobs.history`/`show-occurrences`/`watch` reflect real executions
  (`#OccurrenceRead`) instead of an honest-empty list; the watch subscription stays
  bounded and closable (FR8).
- **Acceptance:** after a job runs, `jobs.history` returns real occurrences keyed by
  definition; `watch` is bounded and closable; an unbound bridge degrades to a typed gap.
- **Verification:** `bun test packages/opencode/test/operator/**` (history/watch).
- **Evidence:** _(reserved)_

## Group D — Interrupt edge (FR9, FR10)

- [ ] **T012 — `InterruptRegistry` process-singleton + execution-layer registration**
- **Depends:** none
- **Paths:** `packages/core/src/session/interrupt-registry.ts`, `packages/core/src/session/run-coordinator.ts`, `packages/core/src/session/execution/local.ts`
- **Deliverable:** a process-singleton `InterruptRegistry`
  (`interrupt-registry.ts`) the execution layer (`execution/local.ts`) registers the
  active root run into at run start, exposing the narrow `interrupt(key)` from
  `SessionRunCoordinator` (`run-coordinator.ts:14`) — NOT a broad operator→SessionExecution
  dependency (`#InterruptEntry`, `#InterruptRegistered`) (FR9).
- **Acceptance:** the execution layer registers the active root run; the registry
  exposes only the narrow interrupt-key edge.
- **Verification:** `bun test packages/core/test/session/**`; `bun run typecheck`.
- **Evidence:** _(reserved)_

- [ ] **T013 — Second-press forced abort consults the registry; first-press unchanged**
- **Depends:** T012
- **Paths:** `packages/opencode/src/operator/lifecycle/stack-wiring.ts`, `packages/opencode/src/operator/lifecycle/**`
- **Deliverable:** replace the log-only `rootInterruptor` stub (`stack-wiring.ts:283-289`)
  so the second-press forced abort consults the `InterruptRegistry` and drives
  `SessionRunCoordinator.interrupt(key)`; an absent entry degrades to the honest
  `unconfirmed` outcome (`#ForcedAbortOutcome`, `#InterruptDisposition`). The
  first-press cancel (cancel_requested + admission fence, `:291-295`) is UNCHANGED
  (FR9, FR10).
- **Acceptance:** a registered root run is interrupted on second press; an absent key
  degrades to `unconfirmed`; the first-press path is byte-for-byte unchanged.
- **Verification:** `bun test packages/opencode/test/operator/**` (forced abort).
- **Evidence:** _(reserved)_

## Group E — Availability flip + parity (FR11, FR12, FR13)

- [ ] **T014 — Palette availability flip (`jobs.run-now` + process/task `cancel`)**
- **Depends:** T008, T013
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** update `OPERATOR_PERSISTING_VERBS`/`persistenceFor`/`domainBadge`
  (`palette.ts:103-173`) so `jobs.run-now` and the process/task forced-abort `cancel`
  reflect the composed truth (`#BackendReadiness`); `mcp.auth.start`/`finish` and any
  verb the executor does not reach stay `honest_unavailable` (FR11).
- **Acceptance:** the newly-composed verbs no longer read `unavailable`; still-gapped
  verbs stay honest; no verb advertises a capability it lacks.
- **Verification:** `bun test packages/core/test/operator/**` (palette).
- **Evidence:** _(reserved)_

## Group F — Tests + guard scope + doc sync (FR12)

- [ ] **T015 — Composition + coordinator tests (arming, fail-open, admit→run→terminal)**
- **Depends:** T001-T007
- **Paths:** `packages/opencode/test/jobs/**`
- **Deliverable:** tests that the executor arms eagerly and fails open on a fault; the
  reconcile sweep rehydrates enabled definitions; the coordinator admits under the
  F002/F001 gates, creates the scheduled-job process, provisions Todo + OutputGroup,
  runs headless under the same permission surface, captures output through the shared
  writer, emits terminal events; bounded concurrency honors the overlap/misfire policies.
- **Acceptance:** all composition + coordinator cases green.
- **Verification:** `bun test packages/opencode/test/jobs/**`.
- **Evidence:** _(reserved)_

- [ ] **T016 — Run-now + occurrence-history tests (effect once, overlap, real history)**
- **Depends:** T008-T011
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** tests that the run-now effect enqueues once after the CAS/idempotency
  checks (an idempotent replay does not re-enqueue), overlap-rejection + disarmed-gap
  outcomes, and that the definition-keyed events make history/show/watch reflect real
  executions with a bounded, closable watch.
- **Acceptance:** all run-now + history cases green.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(reserved)_

- [ ] **T017 — Interrupt-edge + availability/parity tests (FR12)**
- **Depends:** T012-T014
- **Paths:** `packages/core/test/session/**`, `packages/opencode/test/operator/**`, `packages/core/test/operator/**`
- **Deliverable:** tests that the execution layer registers the active root run, the
  second-press forced abort interrupts through the registry, an absent entry degrades
  to `unconfirmed`, and the first-press cancel is unchanged; plus the palette flip is
  truthful and the Feature 007 parity harness asserts each verb rides the same command
  id / loopback with no new dispatch path, no new catalog id, no version bump.
- **Acceptance:** all interrupt + availability + parity cases green.
- **Verification:** `bun test packages/core/test/session/** packages/opencode/test/operator/** packages/core/test/operator/**`.
- **Evidence:** _(reserved)_

- [ ] **T018 — Guard scope + doc sync + `speckit analyze` + `validate --json` green**
- **Depends:** T001-T017
- **Paths:** `doc/arch/speckit.toml`, `doc/arch/sdd/018-*/**`, `doc/arch/adr/0018-*.md`, `doc/arch/schemas/executor-composition/**`, `doc/arch/statecharts/job-executor-composition.md`, `doc/arch/functional/product-overview.md`
- **Deliverable:** confirm the Feature 018 guard block covers every genuinely-new
  implement path (the interrupt registry + execution hook + TaskTool seam); keep the
  spec, ADR-0018, the `executor-composition/*.cue` corpus, and the statechart in sync
  with the shipped shapes; `speckit analyze` clean and `speckit validate --json` green
  (0 new findings on Feature 018 artifacts).
- **Acceptance:** `speckit analyze` reports no new Critical/High/Medium; `speckit
  validate --json` is `ok:true` with 0 new findings.
- **Verification:** `speckit analyze`; `speckit validate --json`.
- **Evidence:** _(reserved)_
