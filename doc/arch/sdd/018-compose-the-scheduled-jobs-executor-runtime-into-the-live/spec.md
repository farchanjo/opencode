---
id: 019f7d4f-8ba9-7ed0-88f0-5f2e0b1a2a9e
number: 018
slug: compose-the-scheduled-jobs-executor-runtime-into-the-live
status: implemented
created_at: 2026-07-20T02:16:32.937261Z
---
# Feature Specification: Compose the Scheduled Jobs Executor Runtime into the Live Runtime

Feature: 018-compose-the-scheduled-jobs-executor-runtime-into-the-live
Created: 2026-07-20
Scope: Features 002 and 003 shipped a **complete but never-composed** scheduled
executor. The scheduler engine + Bun cron adapter
(`packages/opencode/src/jobs/bun-cron-adapter.ts` — `createBunCronAdapter`,
`onDue`), the trigger service with its `TaskProcessCoordinator` seam
(`packages/opencode/src/jobs/trigger-service.ts:122-131` — `admit`/`createProcess`/
`provisionTodo`/`provisionOutputGroup`), and the occurrence-claim state machine all
exist, but **nothing outside `jobs/` self-exports and tests ever starts the cron
loop or wires the coordinator to the real `TaskTool`/`SessionExecution`/
`SessionRunCoordinator`.** As a consequence `jobs.run-now` stays a typed
`unavailable` gap (`packages/opencode/src/operator/jobs/backend-live.ts:93`),
occurrence history is honest-empty (Feature 017 wired the projection plumbing —
`occurrences?` at `backend-live.ts:48` — but the durable read is keyed by the
session aggregate while operator history keys by `jobDefinitionId`), and the
lifecycle forced-abort second-press is a **log-only stub**
(`packages/opencode/src/operator/lifecycle/stack-wiring.ts:283-289`) because the
live `SessionRunCoordinator` (`packages/core/src/session/run-coordinator.ts:14`)
is not reachable from the operator `AppRuntime`. This feature **composes the
executor into the live runtime**: it arms the scheduler engine + cron + trigger
service eagerly at server start (the Feature 017 `ensureProcessSpoolWriter` eager
seam is the precedent), implements the `TaskProcessCoordinator` over the real
Feature 002 execution seams, converts `jobs.run-now` to an effectful mutation
plan that enqueues an immediate occurrence, emits **definition-keyed** occurrence
events so history/show/watch reflect real executions, exposes a **narrow**
interrupt port so the second-press forced abort actually interrupts, and flips the
palette availability to truth. Feature 007 remains the sole command-registration
authority: no catalog id is added, no catalog version is bumped, no new dispatch
path or flag is introduced. The arming is **fail-open** (a scheduler failure never
breaks the server), concurrency is **bounded** by the jobs domain's existing
overlap/misfire policies, and every scheduled session runs under the **same
permission/config surfaces** as a normal session — no privilege bypass. Where a
capability is still genuinely absent (`mcp.auth.start`/`finish`), it stays a typed
capability gap; nothing is fabricated.

## Problem

Features 002 and 003 delivered every piece of the scheduled executor except the
composition that starts it. A gap sweep (2026-07-19, every fact `file:line`
verified) found the machinery shipped and idle:

- **The cron loop is never started.** The Bun cron adapter
  (`packages/opencode/src/jobs/bun-cron-adapter.ts`) exposes `createBunCronAdapter`
  with a `DueDispatcher` seam whose intended wiring is
  `AppRuntime.runFork(triggerService.onDue(signal))` (`:181-187`) and a
  `reconcileSource` that rehydrates enabled definitions on a startup sweep
  (`:189-208`), but a grep confirms **nothing outside `jobs/` self-exports and
  tests** ever constructs the adapter or arms the loop. The scheduler is dead code
  in production.

- **The `TaskProcessCoordinator` seam is never implemented.** The trigger service
  declares the canonical Feature 002 execution seam
  (`packages/opencode/src/jobs/trigger-service.ts:122-131`) whose doc comment says
  "the composition root wires each method to the real `TaskTool`/`SessionExecution`/
  `SessionRunCoordinator`" — but there is no composition root, so `admit`,
  `createProcess`, `provisionTodo`, and `provisionOutputGroup` have no live
  implementation. No occurrence can become a real headless session.

- **`jobs.run-now` is a typed gap.** `createLiveJobsBackend`
  (`packages/opencode/src/operator/jobs/backend-live.ts:93`) returns
  `planRunNow: () => Effect.fail(unavailable("run-now requires the Feature 002
  executor seam, not reachable from the operator runtime"))`. The verb the operator
  surface advertises can never fire an occurrence.

- **Occurrence history is honest-empty.** Feature 017 wired the occurrence
  projection over the durable `EventV2Bridge` (`backend-live.ts:48`,
  `occurrence-projection.ts`), but no executor ever emits the `job.*` occurrence
  events, and — where lifecycle events do exist — the durable read aggregates by
  `root_session_id` (`doc/arch/schemas/jobs/envelope-parts.cue:37`, `tree`) while
  the operator history keys by `jobDefinitionId`
  (`envelope-parts.cue:27`, `occurrence`). So `jobs.history`/`show-occurrences`/
  `watch` stay honestly empty even though the projection is bound.

- **The lifecycle forced-abort second-press is a log-only stub.** The operator
  lifecycle stack-wiring (`packages/opencode/src/operator/lifecycle/
  stack-wiring.ts:283-289`) stubs `rootInterruptor.interrupt` to a
  `logDebug("lifecycle.cancel.forced_abort_unavailable")` because the live
  `SessionRunCoordinator` (`packages/core/src/session/run-coordinator.ts:14`, the
  generic per-key `Coordinator.interrupt` used by
  `packages/core/src/session/execution/local.ts`) is not exposed to the operator
  `AppRuntime`. The **first-press** cancel is fully real (publish one
  `lifecycle.cancel_requested` per active descendant + fence root admission,
  `stack-wiring.ts:291-295`) and must stay unchanged; only the **second-press**
  forced abort is a stub.

Leaving these residuals means the scheduled-jobs surface advertises a scheduler
that never runs, a `run-now` that never fires, a history that is always empty, and
a forced abort that does nothing. The fix is a **composition** change over
machinery that already exists — arm the engine, implement the coordinator, convert
`run-now`, key the events by definition, and expose the interrupt through a narrow
port — with no new executor, no Smart Routing, and no new catalog id or dispatch
path.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Scheduled jobs actually run

- As an operator, I want the scheduler engine + Bun cron adapter + trigger service
  armed eagerly at server start so that an enabled scheduled definition fires its
  due occurrences into real headless sessions, without my having to open the
  operator surface, and a scheduler failure never breaks the server (fail-open).

### P1 — A due occurrence becomes a real session

- As an operator, I want the `TaskProcessCoordinator` implemented over the real
  Feature 002 `TaskTool`/`SessionExecution`/`SessionRunCoordinator` seams so that a
  due occurrence is admitted under the Feature 002 admission + Feature 001 routing
  gates, provisions its occurrence-owned Todo and OutputGroup, runs headless, and
  emits terminal occurrence events — with output captured through the same Feature
  017 spool writer, never a second writer.

### P1 — Run a job now

- As an operator, I want `jobs.run-now` to convert from a typed gap to a mutation
  plan whose effectful apply enqueues an immediate occurrence after the CAS and
  idempotency checks pass, so that I can fire a scheduled definition on demand and
  receive an honest outcome — including an honest overlap-policy rejection when a
  run is already in flight — never a fabricated occurrence.

### P1 — See real occurrence history

- As an operator, I want the executor to emit **definition-keyed** occurrence
  events so that `jobs.history`/`show-occurrences`/`watch` project real executions
  keyed by `jobDefinitionId`, and history stops being honestly empty when a job has
  actually run.

### P1 — Second-press cancel actually interrupts

- As an operator, I want the live `SessionRunCoordinator` exposed to the operator
  runtime through a **narrow** interrupt port so that the second Ctrl+C forced abort
  actually interrupts the active root run, while the first-press cancel
  (cancel_requested + admission fence) stays exactly as it is — and where the
  interrupt seam is genuinely absent the cancel still degrades to a typed
  `unconfirmed`, never a fabricated stop.

### P1 — Truthful availability

- As an operator, I want the palette availability map updated so that `jobs.run-now`
  and the process/task forced-abort `cancel` flip from `honest_unavailable` to the
  truth now that the executor is composed, and no verb advertises a capability it
  still lacks.

### P1 — No privilege bypass

- As an operator, I want every scheduled session to run under the **same**
  permission and config surfaces as a normal interactive session, so that a
  scheduled job can never do more than a user session and the executor composition
  introduces no new authenticated surface or trust escalation.

### P2 — Parity across surfaces

- As an operator, I want every newly-composed verb to ride the same command id and
  the same `OperatorClient` loopback across palette, slash, CLI, and TUI, so that no
  surface diverges and no new dispatch path, catalog id, or catalog version is
  introduced.

## Functional Requirements

### Group 1 — Eager executor composition (G1)

1. **Eager arming at server start (FR1).** A process-wide executor composition MUST
   arm the scheduler engine + Bun cron adapter (`createBunCronAdapter`,
   `packages/opencode/src/jobs/bun-cron-adapter.ts`) + trigger service
   (`packages/opencode/src/jobs/trigger-service.ts`) eagerly at server start
   (`packages/opencode/src/server/server.ts` `listen()`, mirroring the Feature 017
   `SpoolProcessWriter.ensureProcessSpoolWriter()` eager seam at `:113-118`),
   independent of the operator stack, so a session spools and schedules from process
   start even if the operator is never opened. The composition MUST wire the
   `DueDispatcher` to `AppRuntime.runFork(triggerService.onDue(signal))`
   (`bun-cron-adapter.ts:181-187`) and the `reconcileSource` to the persisted
   registration rehydration (`bun-cron-adapter.ts:189-208`) so enabled definitions
   re-register on a startup sweep without claiming past execution.
2. **Fail-open arming (FR2).** The composition MUST be **fail-open**: any failure to
   construct or arm the scheduler (a bad definition, a Bun cron error, a persistence
   outage) MUST be caught so it never breaks server startup, leaving the executor
   disarmed and the schedule/run-now verbs at their typed capability gap — never a
   crash and never a partial arm that fires without a coordinator. The bootstrap is
   an idempotent process singleton (a second call reuses the armed instance, never a
   second cron loop or a duplicate `onDue` fan-out).
3. **Bounded concurrency (FR3).** The executor MUST respect the jobs domain's
   existing overlap and misfire policies (`OverlapPolicy` = `forbid`/`allow`/`queue`/
   `replace`, `MisfirePolicy`, `bun-cron-adapter.ts:271-283`) so concurrent due
   occurrences are bounded — a `forbid`/`queue`/`replace` overlap is honored, and a
   missed trigger resolves to the explicit misfire outcome — never an unbounded
   fan-out of headless sessions.

### Group 2 — Coordinator implementation (G2)

4. **Implement the `TaskProcessCoordinator` over the real seams (FR4).** The
   `TaskProcessCoordinator` seam
   (`packages/opencode/src/jobs/trigger-service.ts:122-131`) MUST be implemented
   over the real Feature 002 execution machinery — `admit` runs a REAL Feature 002
   `AdmissionController` token-bucket gate (session scope) and reports a denial
   honestly (never a fake `admitted`); `createProcess` creates/associates the
   canonical Feature 002 Task Process with `owner_kind: "scheduled-job"` through
   `TaskTool` (`packages/opencode/src/tool/task.ts`) / `SessionExecution`;
   `provisionTodo` and `provisionOutputGroup` provision the occurrence-owned Feature
   002 Todo and Feature 005 OutputGroup before goal-bearing work. It MUST NOT
   introduce a second executor or lifecycle (Feature 003 C16). **Admission scope
   (honest reach):** the eager executor arms independent of the operator stack, so it
   owns a real `AdmissionController` for the scheduled path rather than the
   lifecycle-wiring instance (no process-singleton exists to share, and the admission
   module is outside this feature's guard scope); the shared/global admission budget
   and the Feature 001 routing gate (which needs a routing-decision context a headless
   scheduled trigger does not carry) stay documented boundaries.
5. **Run to terminal, output through the shared writer (FR5).** The admitted
   occurrence MUST run headless through the Feature 002 `SessionExecution` seam and
   emit the terminal occurrence events; its output MUST be captured through the SAME
   Feature 017 process spool writer
   (`packages/opencode/src/outputspool/spool-process-writer.ts`), never a second
   OutputSpool writer or a duplicate control-store connection.
6. **Headless honesty and no privilege bypass (FR6).** The coordinator MUST be honest
   about what a headless scheduled session can do: a scheduled session runs under the
   **same** permission and config surfaces as a normal interactive session — no
   privilege escalation, no bypass of a permission gate, and no interactive prompt is
   silently auto-approved. Where a headless session genuinely cannot satisfy a
   capability (e.g. an interactive permission prompt with no operator present), the
   occurrence degrades to a typed, honest terminal outcome — never a fabricated
   success. **No session leak:** the coordinator consults a headless-capability probe
   BEFORE `createProcess`, so an incapable occurrence persists NO Feature 002 session
   (a per-minute cron never grows dead scheduled-job sessions); the persisted session
   is created only once the run is known to be able to do goal-bearing work.

### Group 3 — Run-now conversion (G3)

7. **`jobs.run-now` as an effectful mutation plan (FR7).** `planRunNow`
   (`packages/opencode/src/operator/jobs/backend-live.ts:93`) MUST convert from the
   typed `unavailable` gap to an `OperatorMutationPlan` whose **effectful `apply`**
   (the Feature 017 fix-round `effect` seam on `OperatorMutationPlan`,
   `packages/opencode/src/operator/application/handler.ts`, run EXACTLY ONCE by
   `mutateAuthority` AFTER the contract/idempotency-claim/CAS-precondition checks and
   BEFORE the committed write) enqueues an **immediate occurrence** onto the armed
   executor. The outcome MUST be honest: a successful enqueue reports the occurrence
   identity; an **overlap-policy rejection** (a run already in flight under a
   `forbid` policy) reports the typed rejection; a disarmed executor degrades to the
   typed `unavailable` gap. An idempotent replay returns the stored result WITHOUT
   re-enqueuing.

### Group 4 — Definition-keyed occurrence events / index (G4)

8. **Definition-keyed occurrence events (FR8).** The executor MUST emit its `job.*`
   occurrence events (Feature 003 vocabulary — `job.triggered`/`admitted`/
   `occurrence_claimed`/terminal, `doc/arch/schemas/jobs/events-occurrence.cue`)
   through the `EventV2Bridge` so that the Feature 017 occurrence projection
   (`packages/opencode/src/operator/jobs/occurrence-projection.ts`) resolves them by
   `jobDefinitionId` (`envelope.occurrence.job_definition_id`,
   `envelope-parts.cue:27`) — either by writing the durable occurrence stream under a
   definition-keyed aggregate or by maintaining a definition-keyed index over the
   session-aggregated stream (`tree.root_session_id`, `:37`). Whichever is chosen,
   `jobs.history`/`show-occurrences`/`watch` MUST reflect real executions keyed by
   definition and stop being honestly empty when a job has run. The chosen shape is
   recorded in ADR-0018.

### Group 5 — Interrupt edge (G5)

9. **Narrow interrupt port (FR9).** The live `SessionRunCoordinator`
   (`packages/core/src/session/run-coordinator.ts:14`) MUST be exposed to the
   operator runtime through the **smallest** edge — a process-singleton interrupt
   registry the execution layer (`packages/core/src/session/execution/local.ts`)
   registers into at run start and the operator lifecycle stack-wiring consults —
   NOT a broad dependency from the operator onto `SessionExecution`. The
   second-press forced abort (`packages/opencode/src/operator/lifecycle/
   stack-wiring.ts:283-289`, today a log-only stub) MUST then drive the registered
   `interrupt(key)` so the active root run actually stops. The first-press cancel
   (cancel_requested + admission fence, `stack-wiring.ts:291-295`) MUST stay
   unchanged.
10. **Honest degradation when absent (FR10).** When the interrupt registry has no
    entry for the requested root key (the run is not owned by this process, or the
    execution layer never registered), the forced abort MUST degrade to the honest
    `unconfirmed` cancel outcome — never a fabricated stop and never a crash.

### Group 6 — Availability, invariants, and boundaries (G6)

11. **Availability flip to truth (FR11).** The palette per-verb classification
    (`packages/core/src/operator/palette.ts`,
    `OPERATOR_PERSISTING_DOMAINS`/`OPERATOR_PERSISTING_VERBS`/`persistenceFor`/
    `domainBadge`) MUST be UPDATED so that `jobs.run-now` and the process/task
    forced-abort `cancel` reflect the composed truth, and any verb that stays
    genuinely gapped (`mcp.auth.start`/`finish`, and anything the executor does not
    reach) stays `honest_unavailable`. No verb may advertise a capability it still
    lacks, and no verb that now works may read as `unavailable`.
12. **Parity + registration invariant preserved (FR12).** This feature adds NO
    catalog id, bumps NO catalog version, introduces NO new dispatch path, and adds
    NO new flag: every verb rides the same `OperatorClient` loopback with unchanged
    command ids across palette/slash/CLI/TUI. Feature 007 stays the sole
    command-registration authority (Feature 007 FR11). The executor composition
    reaches no new external system and opens no new authenticated surface.
13. **Honest degradation everywhere (FR13).** Every mutation MUST commit through
    `mutateAuthority`/`OperatorMutationPlan` with the Feature 007 audit correlation
    (`run-now`'s effect runs once, after the checks); every read/observation MUST
    degrade to a typed envelope (`unavailable`, `executor_unavailable`,
    `version_conflict`, `invalid_argument`) on any unreachable/disarmed path — never
    a fabricated success, a synthesized occurrence, or a phantom write. No error path
    leaks a prompt, a secret, a session transcript, a spool page body, or a config
    payload fragment.

## Non-Functional Requirements

- **Reuse the shipped machinery.** The scheduler engine, the `createBunCronAdapter`
  loop, the trigger service + `TaskProcessCoordinator` seam, the Feature 002
  `TaskTool`/`SessionExecution`/`SessionRunCoordinator`, the Feature 017
  `SpoolProcessWriter`, the `EventV2Bridge` durable seam, and the Feature 017
  occurrence projection are REUSED, not re-authored; the composition root wires onto
  them.
- **Fail-open, bounded, idempotent.** The eager arming never breaks the server; the
  bootstrap is an idempotent process singleton; concurrency is bounded by the
  existing overlap/misfire policies; the interrupt port is a narrow registry, not a
  broad dependency.
- **Typed gaps over fabricated data.** Where a live dependency (the interrupt seam
  for a non-local run, a disarmed executor, an interactive-OAuth MCP auth verb) is
  unreachable, the verb returns a typed capability gap — never synthesized state.
- **No new flag.** All operator work stays behind the existing operator control-plane
  flag (`OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`);
  the scheduler arming rides the existing server lifecycle.
- **No new catalog id or dispatch path.** Feature 007 stays the sole command
  authority; availability is derived from backend readiness, not the catalog.

## Acceptance Scenarios

Given the server is started

- **Arm the executor eagerly and fail open.**
  Given an enabled scheduled definition is persisted,
  When the server starts,
  Then the scheduler engine + cron adapter + trigger service arm at `listen()`
  independent of the operator stack, the definition re-registers on the startup
  reconcile sweep, and a construction/arming failure is caught so the server still
  starts with the executor disarmed and the schedule verbs at their typed gap.

- **A due occurrence becomes a real session.**
  Given the executor is armed and a definition's cron time fires,
  When `onDue` claims the occurrence,
  Then the `TaskProcessCoordinator` admits it under the Feature 002 admission +
  Feature 001 routing gates, creates the Task Process with `owner_kind:
  "scheduled-job"`, provisions the occurrence-owned Todo and OutputGroup, runs
  headless, captures output through the shared Feature 017 spool writer, and emits
  the terminal occurrence events — a denied admission is reported honestly, never a
  fake `admitted`.

- **Run a job now.**
  Given `jobs.run-now` rides the `mutation_plan` contract with an effectful apply,
  When the operator dispatches it,
  Then `mutateAuthority` runs the effect exactly once after the CAS/idempotency
  checks and enqueues an immediate occurrence, returning the occurrence identity;
  an overlap-policy rejection returns the typed rejection; a disarmed executor
  returns the typed `unavailable` gap; an idempotent replay returns the stored
  result without re-enqueuing.

- **See real occurrence history.**
  Given the executor emits definition-keyed occurrence events,
  When a job runs and the operator runs `jobs.history`/`show-occurrences`/`watch`,
  Then the projection resolves the `job.*` events by `jobDefinitionId` and reflects
  the real executions instead of an honest-empty list, with the watch subscription
  bounded and closable.

- **Second-press cancel actually interrupts.**
  Given the execution layer registered the active root run into the narrow interrupt
  registry,
  When the operator issues the second-press forced abort,
  Then the operator consults the registry and drives `SessionRunCoordinator.interrupt`
  so the active root run stops; the first-press cancel (cancel_requested + admission
  fence) is unchanged; and a root key absent from the registry degrades to the honest
  `unconfirmed` outcome.

- **No privilege bypass.**
  Given a scheduled session and a normal interactive session both request the same
  capability,
  When each runs,
  Then the scheduled session is subject to the exact same permission and config
  surfaces — a permission gate a user session hits, the scheduled session hits too,
  and a capability a headless session cannot satisfy degrades to a typed terminal
  outcome, never an auto-approved bypass.

- **Show a truthful availability map.**
  Given the executor is composed,
  When the grouped operator menu derives availability,
  Then `jobs.run-now` and the process/task `cancel` read as the composed truth and no
  verb advertises a capability it still lacks; `mcp.auth.start`/`finish` stay
  `honest_unavailable`.

- **Preserve command parity.**
  Given the same command id is dispatched from palette, slash, CLI, and TUI,
  When any composed verb is invoked,
  Then it rides the same `OperatorClient` loopback with no new dispatch path, and no
  catalog id is added and no catalog version is bumped.

## Security Requirements

- **Data sensitivity/classification.** This feature reads persisted scheduled-job
  definitions (schedule, enablement, bounded definition parts), durable `job.*`
  occurrence events, and the live process/session identity of an active root run,
  and it mutates by enqueuing an immediate occurrence (`run-now`) and by interrupting
  an active run (forced abort). It reads no session transcript, prompt body, or spool
  page body across the operator seam; occurrence reads project bounded, redacted
  summaries; a scheduled session's output content leaves the content plane only as an
  authorized paged `output.read` (Feature 005 C22), never as an event payload.
- **Authentication/authorization.** No new authenticated surface. The scheduled
  session runs under the SAME permission and config surfaces as a normal session —
  the executor composition introduces no privilege escalation and no bypass of a
  permission gate (FR6). Every operator verb rides the Feature 007 `OperatorClient`
  loopback and operator principal, scope, version/CAS, and confirmation gates; the
  executor registers no command ids and cannot relax those gates. The interrupt
  registry is a process-local, in-memory port — it opens no network surface and
  exposes no run to another process.
- **Input validation.** The untrusted inputs are the persisted definition rehydrated
  on the startup sweep, the `DueSignal` the cron callback hands the trigger service,
  the `run-now` payload, and the root key the forced abort targets. A malformed
  definition is rejected on the reconcile sweep and never claims past execution; the
  `DueSignal` carries no business decision (the trigger service computes the
  idempotency tuple and overlap/misfire outcome); the `run-now` payload is
  schema-validated and rejected with a typed `invalid_argument` envelope; an unknown
  root key degrades to `unconfirmed`. The eager arming is fail-open against any of
  these faults.
- **Cryptography in transit/at rest.** No new at-rest store and no new secret
  material. The executor reuses the existing durable `EventV2Bridge` and the Feature
  017 control store; any provider/model credential a scheduled session resolves stays
  `SecretRef`-only under the Feature 007 SecretPort, resolved at use time, never
  persisted or logged in plaintext.
- **Logging/audit.** `run-now` and the forced abort emit the Feature 007 audit
  correlation through `mutateAuthority` with content-free, bounded labels (command
  id, domain, outcome). The scheduler arming, the coordinator, and the occurrence
  projection record only bounded, typed outcomes — never a prompt, a session
  transcript, a spool page body, or a definition secret. The eager arming logs a
  bounded fail-open reason on a caught error, never a stack trace with sensitive
  detail.
- **Error-handling information exposure.** Every failure path degrades to a typed
  envelope carrying only a bounded, secret-free reason. A disarmed executor, a denied
  admission, an overlap rejection, an absent interrupt entry, or a malformed
  definition never leaks a stack trace, a prompt, a secret, a session transcript, a
  spool page body, or a raw config fragment in a result, toast, or log.

## Domain Model

The executor-composition ValueObjects are specified in
`doc/arch/schemas/executor-composition/` and the composition lifecycle as a
statechart in `doc/arch/statecharts/job-executor-composition.md`:

```
Composition (armed eagerly at server start, fail-open, bounded)
  server.listen() → ExecutorComposition.arm()   (mirrors ensureProcessSpoolWriter)
    → scheduler engine + createBunCronAdapter (DueDispatcher → onDue,
      reconcileSource → persisted rehydration)
    → TaskProcessCoordinator over TaskTool/SessionExecution/SessionRunCoordinator
    → armed | disarmed (fail-open on any arming error)                     (FR1, FR2, FR3)

Due occurrence path
  onDue(DueSignal) → claim (idempotency tuple, overlap/misfire) → admit →
    createProcess(owner_kind=scheduled-job) → provisionTodo + provisionOutputGroup →
    run (headless, same permission/config surfaces) → terminal                (FR4, FR5, FR6)
    → output captured via the SHARED Feature 017 spool writer                 (FR5)
    → definition-keyed job.* occurrence events → history/show/watch reflect real (FR8)

Run-now immediate path
  jobs.run-now → OperatorMutationPlan(effect) → mutateAuthority (contract →
    idempotency → CAS → effect ENQUEUE immediate occurrence → commit) →
    { occurrence enqueued | overlap_rejected | executor_unavailable }         (FR7)

Interrupt edge (narrow port)
  execution/local.ts registers active root run → InterruptRegistry (process singleton)
  first-press cancel (cancel_requested + admission fence) — UNCHANGED           (FR9)
  second-press forced abort → operator consults registry →
    SessionRunCoordinator.interrupt(key) | unconfirmed (absent)               (FR9, FR10)

Every mutation carries the Feature 007 audit correlation and commits through
mutateAuthority; an unreachable dependency (disarmed executor, absent interrupt
entry, headless-incapable capability) → a typed capability gap — never a fabricated
occurrence, phantom write, or privilege bypass (FR11-FR13).
```

## Observability

Operator dispatches continue to project through the Feature 007 EventV2 audit and
the ADR-0001 OTLP foundation with content-free, bounded labels (command id, domain,
surface, scope, outcome). The scheduled executor reuses the Feature 003 `job.*`
durable event vocabulary and the Feature 017 spool-writer observability; the eager
arming emits a bounded armed/disarmed signal and a fail-open reason on a caught
error. The occurrence projection and the interrupt port emit no telemetry of their
own and record only bounded, typed outcomes. No prompt, session transcript, spool
page body, definition secret, or config payload is exported. Conventions live in
`doc/arch/observability/observability.md`.

## Out of Scope

- Standing up a new executor, scheduler, or lifecycle — the Feature 002/003
  machinery is composed, not re-authored.
- Smart Routing consumption (repo rule: no Smart Routing implementation without
  explicit authorization); the executor uses the Feature 001 routing gates already
  shipped, and adds no new routing path.
- The MCP interactive-OAuth auth verbs (`mcp.auth.start`/`finish`), which stay typed
  capability gaps (Feature 017 boundary).
- Adding any catalog id, bumping the catalog version, or introducing a new dispatch
  path, parallel registry, or divergent command name.
- A new feature flag, a distributed/multi-node scheduler, or a non-loopback executor
  control surface.
- Cross-process / multi-node occurrence deduplication and concurrency bounding — the
  occurrence idempotency registry and the scheduled-path admission gate are
  process-local in-memory state, honest only within a single process (a restart
  re-registers enabled definitions via the reconcile sweep without claiming past
  execution). This matches the "no distributed/multi-node scheduler" boundary above.
- App/Desktop parity (Feature 007 Phase 2), multi-user directory, vault backends, or
  a non-loopback operator API.

## Related Features and Decisions

- [ADR-0018 — Compose the scheduled jobs executor runtime into the live runtime](../../adr/0018-compose-the-scheduled-jobs-executor-runtime-into-the-live.md)
- [Feature 017 Close the Implementable Operator Capability Gaps](../017-close-the-implementable-operator-capability-gaps-so-the/spec.md) — the eager `ensureProcessSpoolWriter` seam, the `OperatorMutationPlan` `effect` seam, the occurrence projection plumbing, and the deferred executor/cancel edges this feature composes.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, registration invariant (FR11), `mutateAuthority`/`OperatorMutationPlan`, the SecretPort seam.
- [Feature 002 Task Lifecycle Engine](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md) — the `TaskTool`/`SessionExecution`/`SessionRunCoordinator` seams the coordinator composes, and the admission gates.
- [Feature 003 Scheduled Jobs](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md) — the scheduler engine, cron adapter, trigger service, and `job.*` occurrence event vocabulary composed here.
- [Feature 005 OutputSpool](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — the OutputGroup provisioning and the spool writer reused for scheduled-session output.
- [ADR-0004 — Scheduled job runtime and async notification channel](../../adr/0004-scheduled-job-runtime-and-async-notification-channel.md)
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Domain schema](../../schemas/executor-composition/enums.cue)
- [Executor composition statechart](../../statecharts/job-executor-composition.md)

## Clarifications

### Session 2026-07-20

- **Interrupt-edge shape (FR9).** The live `SessionRunCoordinator` is exposed to the
  operator through the SMALLEST edge — a **process-singleton interrupt registry** the
  execution layer (`packages/core/src/session/execution/local.ts`) registers the
  active root run into at run start, and the operator lifecycle stack-wiring consults
  for the second-press forced abort — NOT a broad operator→SessionExecution
  dependency. A root key absent from the registry degrades to the honest
  `unconfirmed` outcome. Recorded in ADR-0018.
- **Definition-keyed history design (FR8).** The `job.*` envelope already carries both
  `occurrence.job_definition_id` and `tree.root_session_id`. The executor emits its
  occurrence events through the `EventV2Bridge` under a **definition-keyed durable
  aggregate** (the `jobDefinitionId` as the aggregate key), so the Feature 017
  occurrence projection resolves by definition directly and history stops being
  honest-empty; a definition-keyed secondary index over the session-aggregated stream
  is the documented fallback. The implement phase confirms the exact aggregate/index
  shape against the durable read. Recorded in ADR-0018.
- **Coordinator headless-honesty verdict (FR6).** A headless scheduled session runs
  under the SAME permission/config surface as a normal session — the coordinator does
  NOT auto-approve an interactive permission prompt; a capability that genuinely
  requires interactive confirmation degrades to a typed, honest terminal outcome for
  that occurrence. No privilege bypass, no fabricated success. Recorded in ADR-0018.
- **Eager fail-open composition (FR1, FR2).** The executor is armed by a
  process-singleton bootstrap at `server.ts` `listen()`, mirroring the Feature 017
  `ensureProcessSpoolWriter` eager seam — independent of the operator stack, idempotent,
  and fail-open (an arming fault leaves the executor disarmed, never a crash).
- **`run-now` effect seam (FR7).** `jobs.run-now` reuses the Feature 017 fix-round
  `OperatorMutationPlan.effect` seam: `mutateAuthority` runs the enqueue EXACTLY ONCE,
  after the contract/idempotency/CAS checks and before the committed write; an
  idempotent replay returns the stored result without re-enqueuing.
- **Deferred edges.** The MCP interactive-OAuth auth verbs (`mcp.auth.start`/`finish`)
  and any Smart Routing consumption edge stay typed capability gaps (repo rule: no
  Smart Routing without explicit authorization); the executor uses the Feature 001
  routing gates already shipped and adds no new routing path.
- **Phase order.** The eager composition + coordinator implementation is the FIRST
  implementation phase (nothing runs without it); run-now, the definition-keyed
  events, the interrupt edge, and the availability flip follow. Reflected in plan.md
  and the task DAG.
