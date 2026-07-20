---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0018 — Compose the Scheduled Jobs Executor Runtime into the Live Runtime

## Context and Problem Statement

Features 002 and 003 shipped a **complete but never-composed** scheduled executor.
A gap sweep (2026-07-19, every `file:line` verified) found every piece present and
idle:

- **The cron loop is never started.** `createBunCronAdapter`
  (`packages/opencode/src/jobs/bun-cron-adapter.ts`) exposes a `DueDispatcher` whose
  intended wiring is `AppRuntime.runFork(triggerService.onDue(signal))` (`:181-187`)
  and a `reconcileSource` startup rehydration (`:189-208`), but nothing outside
  `jobs/` self-exports and tests ever constructs the adapter or arms the loop.
- **The `TaskProcessCoordinator` seam is never implemented.** The trigger service
  declares it (`trigger-service.ts:122-131`) with the doc comment "the composition
  root wires each method to the real `TaskTool`/`SessionExecution`/
  `SessionRunCoordinator`" — but there is no composition root.
- **`jobs.run-now` is a typed gap** (`operator/jobs/backend-live.ts:93`,
  `planRunNow: () => Effect.fail(unavailable(...))`).
- **Occurrence history is honest-empty.** Feature 017 wired the projection
  (`backend-live.ts:48`, `occurrence-projection.ts`), but no executor emits the
  `job.*` events, and the durable read aggregates by `root_session_id`
  (`schemas/jobs/envelope-parts.cue:37`) while operator history keys by
  `jobDefinitionId` (`:27`).
- **The lifecycle forced-abort second-press is a log-only stub**
  (`operator/lifecycle/stack-wiring.ts:283-289`) because the live
  `SessionRunCoordinator` (`packages/core/src/session/run-coordinator.ts:14`) is not
  reachable from the operator `AppRuntime`. The **first-press** cancel
  (cancel_requested + admission fence, `:291-295`) is fully real and must stay so.

The corpus mandates the end state: the surface must not advertise a scheduler that
never runs, a `run-now` that never fires, a history that is always empty, or a
forced abort that does nothing. Feature 007 stays the sole registration authority
(FR11); availability is derived from backend readiness, not the catalog.

## Decision Drivers

- **Compose what already exists.** Arm the shipped scheduler + cron + trigger
  service and implement the declared coordinator seam — no new executor, no new
  scheduler, no Smart Routing, no new store.
- **Fail-open and eager.** The scheduler must arm at server start independent of the
  operator stack (the Feature 017 `ensureProcessSpoolWriter` precedent) and never
  break server startup on an arming fault.
- **One command authority (Feature 007 FR11).** No catalog id is added and no
  catalog version is bumped; only executor composition, backend wiring, and the
  availability flip are supplied.
- **No phantom writes.** `run-now` commits through `mutateAuthority` /
  `OperatorMutationPlan` using the Feature 017 fix-round `effect` seam — the enqueue
  runs once, after the CAS/idempotency checks.
- **Typed gaps over fabricated data.** A disarmed executor, an overlap rejection, an
  absent interrupt entry, or a headless-incapable capability returns a typed gap —
  never synthesized state.
- **No privilege bypass.** A scheduled session runs under the SAME permission and
  config surfaces as a normal session; the composition opens no new authenticated
  surface.
- **Narrowest interrupt edge.** Expose the live `SessionRunCoordinator` to the
  operator through the smallest possible port, not a broad operator→SessionExecution
  dependency.

## Considered Options

- **Compose the executor over the shipped machinery (arm eagerly + fail-open,
  implement the coordinator, convert `run-now` via the effect seam, emit
  definition-keyed events, expose a narrow interrupt registry), flip availability to
  truth, keep the still-absent verbs typed gaps.** The honest completion of what is
  now reachable; preserves the parity/registration invariants. **Chosen.**
- **Wire the executor lazily inside the operator stack.** Rejected — a session that
  never opens the operator would never schedule, exactly the Feature 017 spool-writer
  defect; the arming must be eager at server start.
- **Expose `SessionRunCoordinator` to the operator via a broad dependency.**
  Rejected — it drags the whole `SessionExecution` layer into the operator runtime;
  a narrow process-singleton interrupt registry is the smallest edge.
- **Fabricate an occurrence / a stop when the executor is disarmed or the interrupt
  seam is absent.** Rejected — typed gaps are the honest surface.
- **Bump the catalog to mark `run-now`/`cancel` as newly working.** Breaks the
  Feature 007 registration invariant; rejected — availability derives from backend
  readiness.

## Decision Outcome

Chosen option: **"Compose the scheduled executor into the live runtime over the
shipped Feature 002/003 machinery — arm it eagerly and fail-open at server start,
implement the `TaskProcessCoordinator` over the real execution seams, convert
`jobs.run-now` to an effectful mutation plan, emit definition-keyed occurrence
events, expose the live `SessionRunCoordinator` through a narrow interrupt registry,
and flip the palette availability to truth"**, because it makes every advertised
scheduled-jobs capability real over dependencies that are now reachable while
preserving the Feature 007 parity and registration invariants and fabricating
nothing.

- **Eager fail-open composition (FR1, FR2, FR3).** An `ExecutorComposition`
  process-singleton arms at server start (`server.ts` `listen()`, mirroring
  `SpoolProcessWriter.ensureProcessSpoolWriter()` at `:113-118`), independent of the
  operator stack. It constructs the scheduler engine + `createBunCronAdapter` (the
  `DueDispatcher` wired to `AppRuntime.runFork(triggerService.onDue(signal))`, the
  `reconcileSource` to the persisted rehydration) and the `TaskProcessCoordinator`.
  Any arming fault is caught so it never breaks server startup — the executor stays
  disarmed and the schedule/run-now verbs stay at their typed gap. The bootstrap is
  idempotent (a second call reuses the armed instance, never a second cron loop).
  Concurrency is bounded by the existing overlap/misfire policies
  (`bun-cron-adapter.ts:271-283`).
- **`TaskProcessCoordinator` implementation (FR4, FR5, FR6).** The seam
  (`trigger-service.ts:122-131`) is implemented over the real Feature 002 machinery:
  `admit` runs a REAL Feature 002 `AdmissionController` token-bucket gate (session
  scope) — a denial (`queued`/`rejected`/`partial`) is a typed `admitted:false`,
  never a fake `admitted`; `createProcess` creates the Task Process with
  `owner_kind: "scheduled-job"` through `TaskTool`
  (`packages/opencode/src/tool/task.ts`) / `SessionExecution`; `provisionTodo` and
  `provisionOutputGroup` provision the occurrence-owned Todo + OutputGroup. The
  admitted occurrence runs headless and its output is captured through the SAME
  Feature 017 `SpoolProcessWriter` — never a second writer. The scheduled session
  runs under the SAME permission/config surfaces as a normal session (no privilege
  bypass); a capability a headless session cannot satisfy degrades to a typed
  terminal outcome.

  **Admission authority (honest scope, adversarial-fix round).** The eager executor
  arms independent of the operator stack, so it does NOT share the lifecycle-wiring
  `AdmissionController` instance (that one is constructed inside
  `createLifecycleDomainWiring()`, which only runs when the operator opens; there is
  no process-singleton to reach, and the admission module is outside the Feature 018
  guard scope). The coordinator therefore owns a real `AdmissionController` for the
  scheduled path — the SAME framework-free token-bucket gate class the lifecycle
  domain uses, honestly enforcing the per-`rootSessionId` session ceiling — NOT a
  shared interactive budget, and NOT the Feature 001 routing gate (which requires a
  routing-decision context a headless scheduled trigger does not carry). This is the
  honest, in-scope reach; the shared/global admission budget and the routing gate
  remain documented boundaries.

  **Coordinator headless-honesty verdict + no-session-leak (flagged decision,
  adversarial-fix round).** A headless scheduled session has no interactive operator
  to satisfy a permission prompt and no parent assistant-message `Tool.Context` to
  drive goal-bearing work. Chosen: the coordinator consults a **headless-capability
  probe BEFORE `createProcess`**. While no goal-bearing headless driver exists the
  probe reports `incapable`, so the coordinator persists **NO** Feature 002 session
  for that occurrence (a per-minute cron must not grow dead scheduled-job sessions);
  the occurrence carries a synthetic, non-persisted process handle and degrades to a
  typed `headless_incapable` terminal — no auto-approved prompt, no fabricated
  success. When a headless goal-bearing driver lands, the same probe flips to
  `capable` and `createProcess` persists the REAL `owner_kind: "scheduled-job"`
  session before goal-bearing work. The permission-surface seam and the final
  headless capability envelope are recorded in `tasks.md`.
- **`jobs.run-now` effectful mutation plan (FR7).** `planRunNow`
  (`operator/jobs/backend-live.ts:93`) converts to an `OperatorMutationPlan` whose
  `effect` (the Feature 017 fix-round seam on `application/handler.ts`, run EXACTLY
  ONCE by `mutateAuthority` AFTER contract + idempotency-claim + CAS-precondition and
  BEFORE the committed write) enqueues an immediate occurrence onto the armed
  executor. A successful enqueue reports the occurrence identity; an overlap-policy
  rejection reports the typed rejection; a disarmed executor degrades to `unavailable`;
  an idempotent replay returns the stored result WITHOUT re-enqueuing.

  **Effect-only plan — no CAS churn (adversarial-fix round).** Run-now records NO
  definition-document mutation, so the plan is marked `effectOnly`: `mutateAuthority`
  runs the enqueue once after the contract/idempotency/CAS-precondition checks and
  then SKIPS the committed CAS write. A successful run-now therefore leaves the `jobs`
  authority version UNCHANGED — it never bumps the definitions doc and never
  spuriously conflicts with a concurrent definition edit — while staying idempotent
  and audited. (The prior identity-`apply` plan still committed a no-op CAS that
  bumped the version on every successful run.) `effectOnly` is a general
  `OperatorMutationPlan` capability threaded through the dispatcher into
  `mutateAuthority`; a rejected enqueue still aborts before any write (no phantom).
- **Definition-keyed occurrence events (FR8, flagged decision).** The Feature 017
  occurrence projection keys by `jobDefinitionId`, but the durable stream aggregates
  by `root_session_id`, so occurrence history is honest-empty. The `job.*` envelope
  already carries BOTH `occurrence.job_definition_id` (`envelope-parts.cue:27`) and
  `tree.root_session_id` (`:37`). Chosen: the executor emits the `job.*` occurrence
  events through the `EventV2Bridge` under a **definition-keyed durable aggregate**
  (the `job_definition_id` as the aggregate key the projection reads), so
  `occurrence-projection.ts` resolves by definition directly and history/show/watch
  reflect real executions. A definition-keyed secondary index over the
  session-aggregated stream was the fallback; the durable definition-keyed aggregate
  is preferred because it needs no separate index store and stays within the Feature
  003 event vocabulary. The implement phase confirms the exact aggregate/index shape
  against the `EventV2Bridge` durable read and records it in `tasks.md`.
- **Narrow interrupt registry (FR9, FR10, flagged decision).** The live
  `SessionRunCoordinator` (`packages/core/src/session/run-coordinator.ts:14`) is
  exposed through the SMALLEST edge: a **process-singleton interrupt registry** the
  execution layer (`packages/core/src/session/execution/local.ts`) registers the
  active root run into at run start, and the operator lifecycle stack-wiring consults
  — NOT a broad operator→SessionExecution dependency. The second-press forced abort
  (`operator/lifecycle/stack-wiring.ts:283-289`, today a log-only stub) drives the
  registered `interrupt(key)`; the first-press cancel (`:291-295`) is unchanged. A
  root key absent from the registry (a run this process does not own, or an
  unregistered execution layer) degrades to the honest `unconfirmed` outcome — never
  a fabricated stop. A broad dependency edge was rejected as it would couple the
  operator runtime to the whole execution layer.
- **Availability flip (FR11).** `packages/core/src/operator/palette.ts`
  (`OPERATOR_PERSISTING_DOMAINS`/`OPERATOR_PERSISTING_VERBS`/`persistenceFor`/
  `domainBadge`) is updated so `jobs.run-now` and the process/task forced-abort
  `cancel` reflect the composed truth; `mcp.auth.start`/`finish` and any verb the
  executor does not reach stay `honest_unavailable`.
- **Parity preserved (FR12, FR13).** No new catalog id, no catalog version bump, no
  new dispatch path or flag; command ids unchanged. `run-now` and the forced abort
  commit through `mutateAuthority` with the Feature 007 audit correlation; every
  read/observation degrades to a typed envelope; no error path leaks a prompt,
  secret, transcript, spool page body, or config fragment.

The executor-composition ValueObjects are specified in
`doc/arch/schemas/executor-composition/` and the composition lifecycle as a
statechart in `doc/arch/statecharts/job-executor-composition.md`.

### Consequences

#### Positive

- Scheduled jobs actually run: an enabled definition fires its due occurrences into
  real headless sessions from process start, `jobs.run-now` fires on demand, and
  occurrence history reflects real executions.
- The second-press forced abort actually interrupts the active root run, while the
  first-press cancel is unchanged.
- Every mutating verb commits through the single `mutateAuthority` path; nothing is
  fabricated; Feature 007 stays the sole registration authority (no catalog id or
  version changes).

#### Trade-offs

- The executor arms eagerly at server start (`packages/opencode/src/server/
  server.ts`) and the interrupt registry lives in the core session layer
  (`packages/core/src/session/**`) — both shared runtime seams; the write access is
  scoped narrowly to the composition entry and the registry, and recorded in the
  guard block.
- The coordinator wires onto `TaskTool` (`packages/opencode/src/tool/task.ts`), a
  shared tool seam; the access is scoped to a narrow read of its execution surface.
- A headless scheduled session cannot satisfy an interactive permission prompt; such
  a capability degrades to a typed terminal outcome rather than an auto-approved
  bypass — a deliberate no-privilege-escalation trade-off.
- **Single-process occurrence dedup.** The occurrence idempotency registry
  (`executor-composition-live.ts` `createLiveRegistry`) and the scheduled-path
  `AdmissionController` are process-local in-memory state. Deduplication and
  concurrency bounding are therefore honest only WITHIN one process — cross-process /
  multi-node occurrence dedup is out of scope, matching the "no distributed/multi-node
  scheduler" boundary. A restart re-registers enabled definitions via the reconcile
  sweep without claiming past execution.

#### Follow-ups

- Feature 018 `plan`/`tasks` compose the executor (eager arming → coordinator →
  run-now → definition-keyed events → interrupt edge → availability flip + tests).
- A distributed/multi-node scheduler, the MCP interactive-OAuth auth verbs, and any
  Smart Routing consumption edge remain open for future features under their own
  authorization.

## Related

- Feature specification: [018 Compose the Scheduled Jobs Executor Runtime into the Live Runtime](../sdd/018-compose-the-scheduled-jobs-executor-runtime-into-the-live/spec.md)
- Eager-seam + effect-seam + deferred edges composed: [017 Close the Implementable Operator Capability Gaps](../sdd/017-close-the-implementable-operator-capability-gaps-so-the/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Execution seams composed: [002 Task Lifecycle Engine](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Scheduler/cron/trigger + occurrence events composed: [003 Scheduled Jobs](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- OutputGroup + spool writer reused: [005 Output Spool](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Domain schema: [executor-composition ValueObjects](../schemas/executor-composition/enums.cue)
- Composition statechart: [job-executor-composition](../statecharts/job-executor-composition.md)
- Related ADR: [0004 — Scheduled job runtime and async notification channel](0004-scheduled-job-runtime-and-async-notification-channel.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0017 — Close the Implementable Operator Capability Gaps](0017-close-the-implementable-operator-capability-gaps-so-the.md)
