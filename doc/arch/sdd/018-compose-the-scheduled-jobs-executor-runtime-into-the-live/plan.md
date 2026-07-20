# Implementation Plan: Compose the Scheduled Jobs Executor Runtime into the Live Runtime

Feature: 018-compose-the-scheduled-jobs-executor-runtime-into-the-live
Status target: planned (after this plan is complete)
ADR: [ADR-0018](../../adr/0018-compose-the-scheduled-jobs-executor-runtime-into-the-live.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR13; domain model; fail-open + bounded + no-privilege-bypass invariants)

## Overview

Features 002 and 003 shipped a **complete but never-composed** scheduled executor.
A gap sweep (2026-07-19, every `file:line` verified) found the machinery shipped
and idle:

1. **The cron loop is never started** — `createBunCronAdapter`
   (`packages/opencode/src/jobs/bun-cron-adapter.ts`) has a `DueDispatcher`
   (`:181-187`) and a `reconcileSource` (`:189-208`), but nothing outside `jobs/`
   self-exports and tests arms the loop.
2. **The `TaskProcessCoordinator` seam is never implemented**
   (`trigger-service.ts:122-131`) — no composition root wires it to the real
   `TaskTool`/`SessionExecution`/`SessionRunCoordinator`.
3. **`jobs.run-now` is a typed gap** (`operator/jobs/backend-live.ts:93`).
4. **Occurrence history is honest-empty** — Feature 017 wired the projection
   (`backend-live.ts:48`) but no executor emits the `job.*` events, and the durable
   read aggregates by `root_session_id` while history keys by `jobDefinitionId`.
5. **The forced-abort second-press is a log-only stub**
   (`operator/lifecycle/stack-wiring.ts:283-289`) — the live `SessionRunCoordinator`
   (`packages/core/src/session/run-coordinator.ts:14`) is not reachable from the
   operator `AppRuntime`.

This plan is a **composition** change: arm the executor eagerly and fail-open at
server start (mirroring the Feature 017 `ensureProcessSpoolWriter` eager seam) and
implement the coordinator over the real seams FIRST (nothing runs without it), then
convert `jobs.run-now` to an effectful mutation plan, emit definition-keyed
occurrence events, expose the live `SessionRunCoordinator` through a narrow
interrupt registry, and flip the palette availability to truth — keeping the MCP
interactive-OAuth and Smart Routing edges typed gaps.

**Explicitly out of this plan (invariants preserved):**

- **Feature 007 registration authority (FR12).** No catalog id is added and no
  catalog version is bumped; only executor composition, backend wiring, and the
  availability flip are supplied.
- **No new dispatch path (parity, FR12).** Each verb rides the SAME
  `OperatorClient`/`executeOperatorCommand` loopback; no parallel registry.
- **Reuse the shipped machinery.** The scheduler engine, `createBunCronAdapter`, the
  trigger service + `TaskProcessCoordinator` seam, the Feature 002 execution seams,
  the Feature 017 `SpoolProcessWriter`, the `EventV2Bridge`, and the Feature 017
  occurrence projection are reused; the composition root wires onto them.
- **No control-plane flag change.** Operator work stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`; the
  scheduler arming rides the existing server lifecycle.
- **Fail-open, bounded, no privilege bypass (FR2, FR3, FR6).** The eager arming never
  breaks the server; concurrency is bounded by the existing overlap/misfire policies;
  a scheduled session runs under the same permission/config surfaces as a normal one.
- **No fabricated success / no phantom write (FR13).** `run-now` commits through
  `mutateAuthority` via the effect seam; every read/observation degrades to a typed
  envelope. The MCP interactive-OAuth and Smart Routing edges stay typed gaps.

## Technical Approach

### Architecture layers affected

```
Eager executor composition (packages/opencode/src/server/server.ts, jobs/**)  -- FIRST --> (FR1-FR3)
  ExecutorComposition process-singleton @ listen() (mirrors ensureProcessSpoolWriter);
  createBunCronAdapter (DueDispatcher -> onDue, reconcileSource -> rehydration);
  fail-open on any arming fault; bounded by overlap/misfire policies
        |
        v
TaskProcessCoordinator impl (packages/opencode/src/jobs/**, tool/task.ts, session/**)
  admit (F002 admission + F001 routing gates) -> createProcess (owner_kind scheduled-job)
  -> provisionTodo + provisionOutputGroup -> run headless (same permission surface)
  -> terminal; output via the SHARED Feature 017 spool writer  -->  (FR4-FR6)
        |  (statechart: doc/arch/statecharts/job-executor-composition.md)
        v
Run-now conversion (packages/opencode/src/operator/jobs/backend-live.ts)
  planRunNow -> OperatorMutationPlan(effect) enqueues an immediate occurrence
  after CAS/idempotency; honest overlap-rejected / executor-unavailable  -->  (FR7)
        |
        v
Definition-keyed occurrence events (jobs/**, event-v2-bridge.ts, operator/jobs/**)
  emit job.* under a definition-keyed aggregate -> occurrence-projection resolves
  by jobDefinitionId; history/show/watch reflect real executions  -->  (FR8)
        |
        v
Interrupt edge (packages/core/src/session/**, operator/lifecycle/stack-wiring.ts)
  execution/local.ts registers active root run -> InterruptRegistry (process singleton);
  second-press forced abort consults it -> SessionRunCoordinator.interrupt | unconfirmed;
  first-press cancel UNCHANGED  -->  (FR9, FR10)
        v
Availability flip (packages/core/src/operator/palette.ts) + parity
  jobs.run-now + process/task cancel flip to truth; auth.start/finish stay gaps  -->  (FR11)
Honest degradation everywhere -- typed envelopes, no fabricated occurrence/phantom write (FR12, FR13)
```

The reused runtime — the Feature 003 scheduler/cron/trigger, the Feature 002
`TaskTool`/`SessionExecution`/`SessionRunCoordinator`, the Feature 017
`SpoolProcessWriter`, the `EventV2Bridge`, and the Feature 017 occurrence
projection — is the single source the composition root wires onto; the
executor-composition ValueObjects are specified in
`doc/arch/schemas/executor-composition/` and the composition lifecycle in
`doc/arch/statecharts/job-executor-composition.md`.

### Phase 1 — Eager executor composition + coordinator implementation (FR1-FR6) — FIRST

- **Compose the executor at server start.** A process-singleton
  `ExecutorComposition` arms the scheduler engine + `createBunCronAdapter` + trigger
  service at `server.ts` `listen()` (mirroring
  `SpoolProcessWriter.ensureProcessSpoolWriter()` at `:113-118`), independent of the
  operator stack. The `DueDispatcher` is wired to
  `AppRuntime.runFork(triggerService.onDue(signal))`; the `reconcileSource` to the
  persisted registration rehydration. The bootstrap is idempotent and **fail-open**
  (any arming fault is caught so it never breaks server startup, leaving the executor
  disarmed and the schedule verbs at their typed gap). Concurrency is bounded by the
  existing overlap/misfire policies.
- **Implement the `TaskProcessCoordinator`.** Over the real Feature 002 machinery:
  `admit` runs the Feature 002 admission + Feature 001 routing gates (honest denial);
  `createProcess` creates the Task Process with `owner_kind: "scheduled-job"` through
  `TaskTool` (`packages/opencode/src/tool/task.ts`) / `SessionExecution`;
  `provisionTodo`/`provisionOutputGroup` provision the occurrence-owned Todo +
  OutputGroup. The admitted occurrence runs headless under the SAME permission/config
  surface as a normal session (no privilege bypass), and its output is captured
  through the SHARED Feature 017 spool writer — never a second writer.

### Phase 2 — Run-now conversion (FR7)

- **Convert `planRunNow`** (`operator/jobs/backend-live.ts:93`) from the typed gap to
  an `OperatorMutationPlan` whose `effect` (the Feature 017 fix-round seam,
  `application/handler.ts`) enqueues an immediate occurrence, run exactly once by
  `mutateAuthority` after contract + idempotency + CAS and before the committed
  write. Honest outcomes: `enqueued` (occurrence identity), `overlap_rejected`, or
  `executor_unavailable`; an idempotent replay returns the stored result without
  re-enqueuing.

### Phase 3 — Definition-keyed occurrence events (FR8)

- **Emit definition-keyed `job.*` occurrence events** through the `EventV2Bridge`
  under a definition-keyed durable aggregate (the `jobDefinitionId`) so the Feature
  017 occurrence projection (`operator/jobs/occurrence-projection.ts`) resolves them
  by definition; `jobs.history`/`show-occurrences`/`watch` then reflect real
  executions instead of an honest-empty list. A definition-keyed secondary index over
  the session-aggregated stream is the documented fallback.

### Phase 4 — Interrupt edge (FR9, FR10)

- **Expose the live `SessionRunCoordinator` through a narrow interrupt registry.** A
  process-singleton `InterruptRegistry`
  (`packages/core/src/session/interrupt-registry.ts`) the execution layer
  (`packages/core/src/session/execution/local.ts`) registers the active root run into
  at run start; the operator lifecycle stack-wiring
  (`operator/lifecycle/stack-wiring.ts:283-289`) consults it so the second-press
  forced abort drives `SessionRunCoordinator.interrupt(key)`. The first-press cancel
  (`:291-295`) is unchanged; an absent registry entry degrades to the honest
  `unconfirmed` outcome.

### Phase 5 — Availability flip + parity + honest degradation (FR11, FR12, FR13)

- **Flip the palette availability** (`packages/core/src/operator/palette.ts`) so
  `jobs.run-now` and the process/task forced-abort `cancel` reflect the composed
  truth; `mcp.auth.start`/`finish` and any verb the executor does not reach stay
  `honest_unavailable`.
- **Preserve parity.** No new catalog id, no version bump, no new dispatch path or
  flag; command ids unchanged; the executor reaches no new external system.

### Phase 6 — Tests + guard scope + doc sync (FR12)

- **Composition (Phase 1).** The eager arming arms at server start and fails open on
  a fault; the reconcile sweep rehydrates enabled definitions; the coordinator admits
  under the F002/F001 gates, creates the scheduled-job process, provisions Todo +
  OutputGroup, runs headless under the same permission surface, captures output
  through the shared writer, and emits terminal events; bounded concurrency honors
  the overlap/misfire policies.
- **Run-now (Phase 2).** The mutation-plan effect enqueues an immediate occurrence
  once after the CAS/idempotency checks; overlap rejection + disarmed-executor gap;
  an idempotent replay does not re-enqueue.
- **Occurrence history (Phase 3).** The definition-keyed events make
  history/show/watch reflect real executions; the watch subscription is bounded and
  closable.
- **Interrupt edge (Phase 4).** The execution layer registers the active root run;
  the second-press forced abort interrupts through the registry; an absent entry
  degrades to `unconfirmed`; the first-press cancel is unchanged.
- **Availability + parity (Phase 5, FR12).** The palette flip is truthful; reuse the
  Feature 007 parity harness to assert each verb rides the same command id / loopback
  with no new dispatch path, no new catalog id, no version bump.
- **Doc sync.** Keep the spec, ADR-0018, the `executor-composition/*.cue` corpus, and
  the job-executor-composition statechart in sync with the shipped shapes.

## Data model and migration strategy

No new store or table. The executor reuses the EXISTING scheduler engine + cron
adapter + trigger service (`packages/opencode/src/jobs/**`), the EXISTING Feature 002
`TaskTool`/`SessionExecution`/`SessionRunCoordinator` seams, the EXISTING Feature 017
`SpoolProcessWriter` + control store, and the EXISTING `EventV2Bridge` durable seam.
`run-now` is a mutation whose effect enqueues an occurrence (no CAS-versioned config
row of its own — the settled token rides the store-scoped authority the effect
commits through). **Migration note:** none — the scheduler was never armed before, so
scheduled occurrences simply begin firing once the composition lands, and
`jobs.history` begins reflecting them once the definition-keyed events flow. The
operator-surface projections and readiness classes are typed by the ValueObjects in
`doc/arch/schemas/executor-composition/` (`#ExecutorComposition`, `#DueDispatch`,
`#ConcurrencyBound`, `#AdmissionOutcome`, `#ScheduledProcess`, `#CoordinatorStep`,
`#RunNowPlan`, `#RunNowResult`, `#OccurrenceRead`, `#DefinitionKeyedAggregate`,
`#InterruptEntry`, `#ForcedAbortOutcome`, and the bounded enums).

## Executor composition state machine

Per `doc/arch/statecharts/job-executor-composition.md`:

```
arming -> { disarmed (fail-open) | armed (reconcile rehydrate) }
armed -> due_occurrence -> claim (bounded overlap/misfire) -> admit ->
         { denied | provision -> run (headless, same permission) -> terminal ->
           recorded (definition-keyed events) }
armed -> run_now -> enqueue immediate occurrence (effect after CAS/idempotency)
interrupt_edge: execution registers root run -> { first-press unchanged;
         second-press -> interrupted | unconfirmed }
```

The composition is fail-open and bounded; a scheduled session never bypasses a
permission/config surface (FR6); `run-now` commits through `mutateAuthority` and an
absent interrupt entry degrades to `unconfirmed` (FR9, FR10).

## Security and threat boundaries

| Concern                      | Mitigation                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| No new authenticated surface | The scheduled session runs under the SAME permission/config surface as a normal session; the interrupt registry is process-local, in-memory (FR6, FR9). |
| No privilege bypass          | The coordinator never auto-approves an interactive permission prompt; a headless-incapable capability degrades to a typed terminal outcome (FR6). |
| Fail-open arming             | Any scheduler construction/arming fault is caught so the server still starts; the executor stays disarmed and the verbs at their typed gap (FR2). |
| Bounded concurrency          | The existing overlap/misfire policies bound concurrent due occurrences; no unbounded fan-out of headless sessions (FR3). |
| Input validation             | A malformed rehydrated definition is rejected on the reconcile sweep; the DueSignal carries no business decision; the run-now payload is schema-validated -> typed `invalid_argument` (FR7, Security). |
| Typed capability gaps        | A disarmed executor, an overlap rejection, an absent interrupt entry, and the MCP interactive-OAuth / Smart Routing edges return typed gaps (FR7, FR10, FR13). |
| No phantom write             | `run-now`'s effect runs once, after `mutateAuthority`'s CAS/idempotency checks; an idempotent replay does not re-enqueue (FR7). |
| No secret/content leakage    | Reads/errors carry only bounded, secret-free reasons; no prompt, session transcript, spool page body, definition secret, or config fragment (FR13, Security). |
| Content-free events          | The occurrence events carry no content; a scheduled session's output leaves the content plane only as an authorized paged `output.read` (Feature 005 C22). |
| Audit                        | `run-now` and the forced abort emit the Feature 007 EventV2 audit correlation via `mutateAuthority` with bounded labels. |

## Observability

No new telemetry of its own. Operator dispatches continue to project through the
Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free,
bounded labels. The scheduled executor reuses the Feature 003 `job.*` durable event
vocabulary and the Feature 017 spool-writer observability; the eager arming emits a
bounded armed/disarmed signal and a fail-open reason on a caught error. The
occurrence projection and the interrupt port record only bounded, typed outcomes. No
prompt, session transcript, spool page body, definition secret, or config payload is
exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Narrow paths; most of the surface is already in scope under the Feature 002 / 003 /
005 / 007 / 017 blocks. Genuinely new to Feature 018: the narrow interrupt registry
in the core session layer, the execution-layer registration hook, and the TaskTool
execution seam the coordinator wires onto. Reused seams are listed for traceability:

```toml
# Genuinely new to Feature 018:
"packages/core/src/session/interrupt-registry.ts",  # process-singleton narrow interrupt registry (FR9)
"packages/core/src/session/run-coordinator.ts",     # narrow interrupt-key export for the registry (FR9)
"packages/core/src/session/execution/**",           # execution layer registers the active root run at run start (FR9)
"packages/opencode/src/tool/task.ts",               # TaskProcessCoordinator wires onto the TaskTool execution surface (FR4)
"packages/core/test/session/**",                    # interrupt-registry + execution-hook tests (FR9)
# Already in scope — NOT re-added, listed for traceability:
#   packages/opencode/src/jobs/**                -> scheduler/cron/trigger + composition root + coordinator (FR1-FR8) [Feature 003]
#   packages/opencode/src/operator/**            -> run-now conversion, occurrence-projection, lifecycle consult (FR7-FR10) [Feature 007]
#   packages/opencode/src/server/server.ts       -> eager executor-composition bootstrap (FR1, FR2) [repo-health block]
#   packages/opencode/src/event-v2-bridge.ts     -> definition-keyed job.* events (FR8) [Feature 001]
#   packages/opencode/src/session/**             -> opencode session execution seam (FR5) [Feature 017 block]
#   packages/core/src/operator/**                -> palette.ts availability flip (FR11) [Feature 007]
#   packages/{opencode/test/operator,opencode/test/jobs,core/test/jobs}/** -> tests
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Eager executor composition + `TaskProcessCoordinator` implementation (FIRST —
   nothing runs without it).
2. Run-now conversion (effectful mutation plan).
3. Definition-keyed occurrence events.
4. Interrupt edge (narrow registry + execution-layer registration + operator consult).
5. Availability flip + parity + honest degradation.
6. Tests (composition, run-now, occurrence history, interrupt, availability, parity)
   + guard scope + doc sync.

## Companion artifacts

None required beyond this plan. The executor-composition ValueObjects
(`doc/arch/schemas/executor-composition/`) and the statechart
(`doc/arch/statecharts/job-executor-composition.md`) carry the data model; no
`research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR13 mapped to ordered phases (eager composition + coordinator FIRST)
- [x] No new catalog id / no catalog version bump / no new dispatch path / no flag (FR12)
- [x] Eager fail-open composition + bounded concurrency + no privilege bypass (FR1-FR3, FR6)
- [x] Coordinator implemented over the real F002 seams; output via the shared writer (FR4, FR5)
- [x] Run-now as an effectful mutation plan (FR7)
- [x] Definition-keyed occurrence events -> real history/show/watch (FR8)
- [x] Narrow interrupt registry; second-press real, first-press unchanged (FR9, FR10)
- [x] Availability flip + typed gaps for still-absent verbs (FR11, FR13)
- [x] specScopeGlobs narrow; only the interrupt registry + execution hook + TaskTool seam genuinely new
- [ ] `tasks.md` generated and filled
- [ ] `speckit analyze` clean of new Critical/High/Medium blockers
- [ ] `speckit validate --json` green (0 new findings on Feature 018 artifacts)

## Implementation notes (recorded during implement)

- _(reserved — filled during implement with date + file:line + test results)_
