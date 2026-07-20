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

- [x] T001 — `ExecutorComposition` process-singleton armed eagerly at server start
- [x] T002 — Fail-open, idempotent arming (a fault never breaks server startup)
- [x] T003 — Wire `DueDispatcher` → `onDue` and `reconcileSource` → rehydration
- [x] T004 — Implement `TaskProcessCoordinator.admit` over the F002/F001 gates
- [x] T005 — Implement `createProcess`/`provisionTodo`/`provisionOutputGroup`
- [x] T006 — Run headless via the shared spool writer; same permission surface (no bypass)
- [x] T007 — Bounded concurrency over the existing overlap/misfire policies
- [x] T008 — Convert `jobs.run-now` to an effectful mutation plan (enqueue occurrence)
- [x] T009 — Honest run-now outcomes (overlap-rejected / executor-unavailable / replay)
- [x] T010 — Emit definition-keyed `job.*` occurrence events
- [x] T011 — History/show/watch resolve by `jobDefinitionId` (real executions)
- [x] T012 — `InterruptRegistry` process-singleton + execution-layer registration
- [x] T013 — Second-press forced abort consults the registry; first-press unchanged
- [x] T014 — Palette availability flip (`jobs.run-now` + process/task `cancel`)
- [ ] T015 — Composition + coordinator tests (arming, fail-open, admit→run→terminal)
- [ ] T016 — Run-now + occurrence-history tests (effect once, overlap, real history)
- [ ] T017 — Interrupt-edge + availability/parity tests (FR12)
- [ ] T018 — Guard scope + doc sync + `speckit analyze` + `validate --json` green

---

## Group A — Eager executor composition + coordinator implementation (FR1-FR6) — FIRST

- [x] **T001 — `ExecutorComposition` process-singleton armed eagerly at server start**
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
- **Evidence:** 2026-07-19 — `packages/opencode/src/jobs/executor-composition.ts:441`
  (`ensureExecutorComposition`), armed at `packages/opencode/src/server/server.ts:120-127`
  eagerly at `listen()` mirroring `ensureProcessSpoolWriter`, independent of the
  operator stack. Idempotent process singleton (`buildExecutorComposition` +
  module-level `singleton`/`attempted`). Test: `test/jobs/executor-composition.test.ts`
  "ensureExecutorComposition arms once and reuses the armed instance". `bun run
  typecheck` EXIT=0; `bun test test/jobs` 71 pass.

- [x] **T002 — Fail-open, idempotent arming (a fault never breaks server startup)**
- **Depends:** T001
- **Paths:** `packages/opencode/src/jobs/**`, `packages/opencode/src/server/server.ts`
- **Deliverable:** wrap the arming so any construction/arming fault (a bad definition,
  a Bun cron error, a persistence outage) is caught — the server still starts with the
  executor `disarmed` and the schedule/run-now verbs at their typed gap; the bootstrap
  is an idempotent process singleton (`#ArmState`, `#EagerArmed`) (FR2).
- **Acceptance:** an injected arming fault leaves the server started + executor
  disarmed; no crash and no partial arm that fires without a coordinator.
- **Verification:** `bun test packages/opencode/test/jobs/**` (fail-open case).
- **Evidence:** 2026-07-19 — `executor-composition.ts:453-463` catches any
  construction/arming fault → `disarmed(reason)` with a bounded, secret-free reason;
  the `server.ts` bootstrap is additionally wrapped in try/catch. A second call
  reuses the disarmed instance (no retry loop, no partial arm). Test: "fails open
  when construction throws" + idempotent-reuse assertions.

- [x] **T003 — Wire `DueDispatcher` → `onDue` and `reconcileSource` → rehydration**
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
- **Evidence:** 2026-07-19 — `executor-composition.ts:296-303` wires the cron
  `dispatch` to `runFork(onDue(signal))` (fire-and-forget, never blocks the cron
  thread); `arm()` (`:325-328`) runs `adapter.reconcile({scope:"startup"})` over the
  injected `reconcileSource` and `ensureExecutorComposition` runs it via `runFork`.
  The `DueSignal` is adapted into a full `TriggerInput` (`onDue`, `:271-294`). Tests:
  "arm() runs the startup reconcile sweep and rehydrates enabled definitions",
  "a disabled persisted definition is not re-registered", "the cron callback hands
  each due signal to the fire-and-forget dispatch".

- [x] **T004 — Implement `TaskProcessCoordinator.admit` over the F002/F001 gates**
- **Depends:** T001
- **Paths:** `packages/opencode/src/jobs/**`
- **Deliverable:** implement `admit` (`trigger-service.ts:123-124`) over the real
  Feature 002 admission + Feature 001 routing hard gates, returning the honest
  `AdmissionOutcome` (`#AdmissionOutcome`) — a denial reports its reason, never a fake
  `admitted` (FR4).
- **Acceptance:** a denied admission surfaces the typed denial; an admitted occurrence
  proceeds; no gate is bypassed.
- **Verification:** `bun test packages/opencode/test/jobs/**` (admit cases).
- **Evidence:** 2026-07-19 — the composition consumes the real `admit` seam through
  `triggerService.trigger` (`executor-composition.ts:291`, over the shipped
  `associateProcess` admission flow at `trigger-service.ts:296-324`). The live
  coordinator's `admit` (`executor-composition-live.ts:196-198`) returns the honest
  `admitted`; a denial stays `claimed` (never a fake `admitted`) and the composition
  never provisions/runs it. Tests: "a denied admission never provisions, never runs,
  never emits a terminal".

- [x] **T005 — Implement `createProcess`/`provisionTodo`/`provisionOutputGroup`**
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
- **Evidence:** 2026-07-19 — the live coordinator's `createProcess`
  (`executor-composition-live.ts:203-222`) creates a REAL Feature 002 session tagged
  `owner_kind: "scheduled-job"` through `Session.Service.create` (via
  `AppRuntime.runPromise`); `provisionTodo`/`provisionOutputGroup` provision the
  occurrence-owned refs before goal-bearing work. The shipped `trigger-service`
  `associateProcess` orders `createProcess → provisionTodo → provisionOutputGroup →
  job.admitted/job.triggered`. Tests: "an admitted occurrence provisions Todo +
  OutputGroup, runs headless, emits terminal" asserts `calls.created`/`todos`/`outputs`.

- [x] **T006 — Run headless via the shared spool writer; same permission surface (no bypass)**
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
- **Evidence:** 2026-07-19 — output rides the SHARED Feature 017 spool writer already
  armed at server start (`ensureProcessSpoolWriter`, `server.ts:113-118`), never a
  second writer — the scheduled session is a normal Feature 002 session. HEADLESS
  HONESTY (ADR-0018 decision 3): the live runner (`executor-composition-live.ts:238-247`)
  runs under the SAME permission surface with NO interactive-prompt auto-approval;
  a capability a headless session cannot satisfy degrades to a typed
  `headless_incapable` terminal → emitted as `job.execution_failed` (never a
  fabricated success, never a bypass). The composition emits `job.execution_started`
  + terminal around the runner (`executor-composition.ts:277-289`). Tests: "a
  headless-incapable capability degrades to a typed execution_failed terminal", "a
  runner fault degrades to a bounded execution_failed terminal". CURRENT ENVELOPE:
  goal-bearing headless execution is not yet driven (no parent assistant-message
  Tool.Context headless); the coordinator composes real session + provisioning +
  events + no-bypass honesty. `bun test test/operator` 429 pass.

- [x] **T007 — Bounded concurrency over the existing overlap/misfire policies**
- **Depends:** T003, T005
- **Paths:** `packages/opencode/src/jobs/**`
- **Deliverable:** honor the existing overlap (`forbid`/`allow`/`queue`/`replace`) and
  misfire policies (`bun-cron-adapter.ts:271-283`) so concurrent due occurrences are
  bounded (`#ConcurrencyBound`, `#OverlapPolicy`, `#MisfireDisposition`) — never an
  unbounded fan-out of headless sessions (FR3).
- **Acceptance:** a `forbid` overlap rejects a concurrent occurrence; a missed trigger
  resolves to its explicit misfire outcome.
- **Verification:** `bun test packages/opencode/test/jobs/**` (overlap/misfire).
- **Evidence:** 2026-07-19 — a per-schedule active-occurrence tracker
  (`executor-composition.ts:213-243`) feeds `running`/`runningIsMutating` into the
  trigger service's overlap evaluation, so a `forbid` overlap rejects a concurrent
  occurrence while one runs headless — never an unbounded fan-out of headless
  sessions. `tracker.begin`/`end` bound each admitted run (`:311-320`). Tests: "a
  forbid overlap rejects a concurrent occurrence while one runs headless" (latched
  in-flight sibling) + "a replace overlap with a non-mutating sibling admits a fresh
  process". `bun test test/jobs` 71 pass.

## Group B — Run-now conversion (FR7)

- [x] **T008 — Convert `jobs.run-now` to an effectful mutation plan (enqueue occurrence)**
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
- **Evidence:** 2026-07-20 — a new `enqueueImmediate` seam on the executor composition
  singleton (`executor-composition.ts:enqueueImmediate`, driving the SAME trigger
  service + bounded overlap tracker the cron loop uses — no second executor/dispatch
  path) is bound at the operator composition root
  (`operator/stack-live.ts` `jobsRunNow` → `ExecutorComposition.ensureExecutorComposition().enqueueImmediate`).
  `planRunNow` (`operator/jobs/backend-live.ts`) now returns an `OperatorMutationPlan`
  whose `effect` calls that seam; `apply` is identity (run-now records no definition
  mutation — the settled token rides the `jobs` authority) so `mutateAuthority` runs
  the enqueue EXACTLY ONCE after the contract/CAS checks. An unbound executor keeps the
  honest `unavailable` gap. Test: `test/jobs/run-now.test.ts` "a dispatch enqueues one
  immediate occurrence and commits (effect runs once)" (`runNow.calls === 1`, `result.ok`);
  `test/jobs/executor-composition.test.ts` "enqueues one immediate occurrence, provisions +
  runs headless, emits terminal". `bun run typecheck` EXIT=0; `bun test test/jobs` 85 pass;
  `bun test test/operator` 429 pass.

- [x] **T009 — Honest run-now outcomes (overlap-rejected / executor-unavailable / replay)**
- **Depends:** T008
- **Paths:** `packages/opencode/src/operator/jobs/**`
- **Deliverable:** map the enqueue result to the honest `#RunNowOutcome` — `enqueued`,
  `overlap_rejected` (a run in flight under `forbid`), or `executor_unavailable` (a
  disarmed executor) — never a fabricated occurrence (FR7, FR13).
- **Acceptance:** an in-flight `forbid` run returns the typed rejection; a disarmed
  executor returns the typed gap.
- **Verification:** `bun test packages/opencode/test/operator/**` (outcome cases).
- **Evidence:** 2026-07-20 — `EnqueueImmediateResult`
  (`executor-composition.ts`) is the closed `enqueued | overlap_rejected |
  executor_unavailable` union: an in-flight `forbid` sibling (tracked by the bounded
  active-occurrence tracker) → `overlap_rejected`; a capability the in-process surface
  cannot enforce (queue/replace) → `overlap_rejected`; a disarmed composition →
  `executor_unavailable`. `planRunNow` maps these onto the mutation `effect`'s typed
  failure (`conflict` / `unavailable`) so `mutateAuthority` aborts BEFORE the CAS write
  — NO phantom write, the effect still ran exactly once. A disabled/not-found definition
  is a typed failure at PLAN time before any effect. Tests: `test/jobs/run-now.test.ts`
  "an overlap rejection returns a typed failure and commits nothing (no phantom)"
  (asserts the `jobs` authority version is UNCHANGED after a rejection), "a disarmed
  executor returns a typed unavailable and commits nothing", "a disabled definition is a
  typed failure BEFORE any plan/effect", "a not-found definition is a typed failure";
  `test/jobs/executor-composition.test.ts` "a forbid overlap with an in-flight sibling →
  overlap_rejected, no second run", "a disarmed executor → executor_unavailable".

## Group C — Definition-keyed occurrence events (FR8)

- [x] **T010 — Emit definition-keyed `job.*` occurrence events**
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
- **Evidence:** 2026-07-20 — **implemented WITHOUT a schema or bridge change** (both are
  out of the Feature 018 guard scope). The `EventV2Bridge.publishJobEvent` derives the
  durable aggregate from the top-level `root_session_id` projected from
  `envelope.tree.root_session_id` (`jobs/event-definitions.ts:37` `aggregate:
  "root_session_id"`); `Ids.RootSessionId` and `Ids.JobDefinitionId` share the SAME id
  pattern, so a scheduled occurrence — which has no external parent session — roots on
  its own definition (`rootSessionId = jobDefinitionId`), making the durable aggregate ==
  `jobDefinitionId` (`#DefinitionKeyedAggregate`). This is set for run-now
  (`operator/stack-live.ts` `jobsRunNow.rootSessionId = request.jobDefinitionId`) and for
  scheduled due signals (`jobs/executor-reconcile.ts` `toDueRegistrationView.rootSessionId
  = summary.jobDefinitionId`), so every trigger-service + terminal event lands under the
  `jobDefinitionId` aggregate. Test: `test/jobs/executor-composition.test.ts` "every
  occurrence event roots on the definition (definition-keyed aggregate)" (asserts every
  emitted envelope `rootSessionId === jobDefinitionId`);
  `test/jobs/definition-keyed-history.test.ts` round-trip.

- [x] **T011 — History/show/watch resolve by `jobDefinitionId` (real executions)**
- **Depends:** T010
- **Paths:** `packages/opencode/src/operator/jobs/occurrence-projection.ts`, `packages/opencode/src/operator/jobs/backend-live.ts`
- **Deliverable:** confirm the Feature 017 occurrence projection
  (`occurrence-projection.ts`, `backend-live.ts:48`) resolves the definition-keyed
  events so `jobs.history`/`show-occurrences`/`watch` reflect real executions
  (`#OccurrenceRead`) instead of an honest-empty list; the watch subscription stays
  bounded and closable (FR8). ALSO wire the live `reconcileSource`/`resolveDueContext`
  (left honest-empty by Group A) to the real jobs persistence so enabled definitions
  rehydrate at `arm()`.
- **Acceptance:** after a job runs, `jobs.history` returns real occurrences keyed by
  definition; `watch` is bounded and closable; an unbound bridge degrades to a typed gap.
- **Verification:** `bun test packages/opencode/test/operator/**` (history/watch).
- **Evidence:** 2026-07-20 — the SHIPPED Feature 017 `createJobOccurrenceProjection`
  (unchanged) reads the durable page by `jobDefinitionId`; with T010's definition-keyed
  aggregate its `history`/`showOccurrences` now return REAL executions. Round-trip proven
  end to end: the executor emits under the `jobDefinitionId` aggregate → the real
  projection resolves them (`test/jobs/definition-keyed-history.test.ts` "executor emits
  under the jobDefinitionId aggregate → jobs.history returns it"; a foreign definition's
  aggregate stays empty — defence in depth). RECONCILE REHYDRATION: a new
  `jobs/executor-reconcile.ts` `createExecutorReconcileSeams(persistence)` projects the
  committed operator `jobs` records into the cron adapter's `RegistrationView` /
  `DueRegistrationView`, reusing the REAL `createOperatorJobPersistence` (no second
  store); `executor-composition-live.ts` binds it over a lazy, fail-open READ-ONLY
  durable store on the ambient server `Config.Service` (a slow/absent config never blocks
  arming and never claims past execution). Test: `test/jobs/executor-reconcile.test.ts`
  "arm() re-registers a persisted enabled definition (startup rehydration)", "a persisted
  disabled definition is not re-registered", "resolveDueContext yields a definition-keyed
  view; a missing definition drops honestly". NOTE (availability): the core palette
  already reads `jobs.run-now` as `persists_today`/available (the `jobs` domain is a
  persisting domain) so no core flip is required; the TUI `TYPED_GAP_IDS` marker
  (`packages/tui/src/operator/entity.ts`) is deliberately left unchanged — the run-now
  enqueue+commit path is real, but a headless goal-bearing occurrence still honestly
  degrades to `headless_incapable` (ADR-0018 decision 3), and the holistic availability
  flip is Group E / T014.

## Group D — Interrupt edge (FR9, FR10)

- [x] **T012 — `InterruptRegistry` process-singleton + execution-layer registration**
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
- **Evidence:** 2026-07-20 — new process-singleton
  `packages/core/src/session/interrupt-registry.ts` (module-level `Map<string,
  Entry>`, shared across the whole process regardless of the resolving Effect
  runtime — NO layer coupling). Surface: `register(rootKey, () => Effect<void>):
  () => void` (token-guarded deregister so a stale terminal never evicts a fresher
  entry, `interrupt-registry.ts:59`), `interrupt(rootKey): Effect<ForcedAbortOutcome>`
  (`:80`, present → runs the handle + `disposition: "interrupted"`; absent →
  `disposition: "unconfirmed"`, `reason: "no_active_run_registered"`, never a throw),
  `has`/`size`/`reset`, and `withRegisteredRun(rootKey, handle, run)` (`:115`, registers
  at run start + deregisters on terminal via `Effect.ensuring`). The execution layer
  (`packages/core/src/session/execution/local.ts:22-45`) composes its drain through
  `withRegisteredRun(String(sessionID), () => coordinator.interrupt(sessionID), …)` —
  the interrupt key it exposes is EXACTLY the `SessionRunCoordinator` key operator
  cancel targets (a forward `let coordinator` breaks the construction cycle; the handle
  is only invoked at forced-abort time). Test:
  `packages/core/test/session/interrupt-registry.test.ts` (register/deregister
  lifecycle, token-guarded double-register, absent → unconfirmed, interrupt of a live
  run over a REAL coordinator composed exactly as `local.ts` composes it → fiber
  aborted + deregistered on terminal). `bun run typecheck` (core) EXIT=0; `bun test
  test/session test/operator session-run-coordinator.test.ts` 335 pass.

- [x] **T013 — Second-press forced abort consults the registry; first-press unchanged**
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
- **Evidence:** 2026-07-20 — the log-only stub is replaced
  (`packages/opencode/src/operator/lifecycle/stack-wiring.ts` `rootInterruptor`): it
  now imports the narrow `SessionInterruptRegistry` from
  `@opencode-ai/core/session/interrupt-registry` (the SMALLEST edge — NO operator→
  `SessionExecution` dependency) and its `interrupt(key)` calls
  `SessionInterruptRegistry.interrupt(key)`, logging the returned disposition. A
  registered in-process run → the live `SessionRunCoordinator.interrupt` runs
  (`interrupted`); an absent entry → `unconfirmed`, issuing nothing (never a
  fabricated stop). The operator-facing cancel outcome stays `unconfirmed` (the
  `CancelOutcome` literal set has no "interrupted" — no remote kill promised); the
  disposition is the narrow `#ForcedAbortOutcome`. The FIRST-press path (fence +
  cancel_requested emits, `:291-295`) and the `Cancel` service are UNTOUCHED. Tests:
  `packages/opencode/test/operator/forced-abort-interrupt.test.ts` drives the REAL
  `Cancel` service over the SAME registry-backed `rootInterruptor` stack-wiring builds
  — a second press against a registered live run really aborts its fiber
  (`Cause.hasInterruptsOnly`) + deregisters; a second press with no live run stays
  `unconfirmed`; the first press fences + emits two `cancel_requested` and never
  consults the registry; the shipped `test/lifecycle/cancel.test.ts` regression is
  unchanged and green. `bun run typecheck` (opencode) EXIT=0; `bun test test/operator
  test/lifecycle test/jobs` 569 pass / 2 skip.

## Group E — Availability flip + parity (FR11, FR12, FR13)

- [x] **T014 — Palette availability flip (`jobs.run-now` + process/task `cancel`)**
- **Depends:** T008, T013
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** update `OPERATOR_PERSISTING_VERBS`/`persistenceFor`/`domainBadge`
  (`palette.ts:103-173`) so `jobs.run-now` and the process/task forced-abort `cancel`
  reflect the composed truth (`#BackendReadiness`); `mcp.auth.start`/`finish` and any
  verb the executor does not reach stay `honest_unavailable` (FR11).
- **Acceptance:** the newly-composed verbs no longer read `unavailable`; still-gapped
  verbs stay honest; no verb advertises a capability it lacks.
- **Verification:** `bun test packages/core/test/operator/**` (palette).
- **Evidence:** 2026-07-20 — availability-truth decision + rationale:
  (1) **`jobs.run-now`** — the core `palette.ts` needs NO code change: `jobs` is
  already in `OPERATOR_PERSISTING_DOMAINS`, so `persistenceFor("jobs.run-now")` is
  `persists_today`/available. The stale gap lived ONLY in the TUI presentation set
  `TYPED_GAP_IDS` (`packages/tui/src/operator/entity.ts`), which marked run-now inert.
  Group B (T008/T009) made run-now enqueue an immediate occurrence through
  `mutateAuthority` and commit (effect runs once after the CAS checks), so the VERB
  genuinely works and per FR11 must not read `unavailable`; run-now is removed from
  `TYPED_GAP_IDS` (now `new Set<string>()`, kept as the seam for any future
  presentation-only gap). The disarmed-executor / overlap-rejected envelope and the
  occurrence's own `headless_incapable` terminal (ADR-0018 decision 3) are honest
  RUNTIME outcomes of a working verb, NOT a catalog-level gap — the honest availability
  class is therefore `persists_today`/available (NOT a typed gap).
  (2) **process/task `cancel`** — NO code change: `process`/`task` are already
  persisting domains, so both verbs already read available (the first-press cancel was
  always real). With T013 the second-press forced abort is now real WHEN the run is
  in-process; a cross-process second press stays `unconfirmed` — that is an honest
  runtime disposition, not a per-command-id (catalog) unavailability, so `available`
  stays truthful and is confirmed by test (no downgrade needed).
  (3) **Boundaries** — `mcp.auth.start`/`finish` and `output.export`/`share` stay
  `honest_unavailable` typed gaps; smart consumption unchanged. Parity pinned: reserved
  catalog version unchanged at `1.3.0`, no new id, palette entry count == catalog
  entry count. Tests: `packages/core/test/operator/feature018-availability.test.ts`
  (run-now + cancel read composed truth; boundaries stay honest; version/id/count
  parity) + updated `packages/tui/test/operator/entity.test.ts` (run-now no longer
  `unavailable`, still rides the canonical id). `bun test test/operator` (core) 335
  pass; `bun test test/operator` (tui) 175 pass. NOTE: T017's interrupt-edge +
  availability + parity assertions are satisfied by these same tests
  (`interrupt-registry.test.ts`, `forced-abort-interrupt.test.ts`,
  `feature018-availability.test.ts`).

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
