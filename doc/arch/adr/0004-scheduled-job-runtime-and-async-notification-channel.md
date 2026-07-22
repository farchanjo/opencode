---
status: accepted
date: 2026-07-18
deciders: [project maintainers]
---

# 0004 — Scheduled Job Runtime and Async Notification Channel

## Context and Problem Statement

Feature 003 specifies persistent scheduled jobs whose triggers become canonical
lifecycle occurrences and asynchronous, authorized notifications for the main context.
Bun `1.3.14` exposes `Bun.cron` in-process and OS-level registration, but in-process
registrations do not survive process exit, so a Bun registration cannot be the durable
scheduler by itself. The feature `spec.md` marks this ADR **required before `plan` or
implementation** and forbids a permanent `while true`/`sleep` polling loop.

Without one decision record, Feature 003 risks a second scheduler-owned executor, a
parallel definition store beside Config.Service, a second notification/event channel
beside EventV2, a false claim of cross-system atomicity across persistence and the OS
scheduler, raw prompt injection into unsafe active turns, or leakage of occurrence output
into notification envelopes. The clarify session (2026-07-18, C1–C22) resolved these
decisions declaratively; this ADR formalizes them so `plan` and `tasks` proceed against a
fixed runtime and notification contract without reopening Feature 001 hard gates,
Feature 002 lifecycle/Todo authority, Feature 005 content-plane ownership, or Feature 007
native-only operator authority.

## Decision Drivers

- One scheduling runtime that reuses the confirmed Bun capability and never polls.
- Durable definitions and registration intent that survive restart; a Bun registration is
  never the durable authority by itself.
- One occurrence identity, state machine, and idempotency key across duplicate delivery.
- One event authority (EventV2): `job.*` lifecycle events, no second channel.
- One executor: every trigger re-enters Feature 002 admission, routing, and lifecycle.
- Bounded, redacted, safe-boundary notifications with an operator-only default action.
- Occurrence-owned Todo and OutputGroup; a Job Definition never shares live work state.
- No cross-system transaction across persistence and Bun/OS; honest reconciled/unknown.
- Reserved, non-colliding namespaces: `job.*` events versus `jobs.*` operator commands.
- Single-instance V1; OS-level and distributed scheduling deferred to a later ADR.

## Considered Options

- **In-process `Bun.cron` single-instance, durable definitions in Config.Service, occurrences
  on EventV2, notifications over the Feature 002 observation seam** — selected: reuses the
  confirmed runtime, one persistence authority, one event authority, one executor.
- **OS-level `Bun.cron(path, schedule, title)` as the V1 authority** — rejected for V1: the
  launched module runs in a separate process that does not share the OpenCode Session,
  Effect services, database pools, or in-memory runtime, and returning its execution to the
  core requires an explicit bootstrap/IPC seam; deferred to V2 and this ADR's successors.
- **Permanent `while true` + `sleep` poller or a bespoke timer scheduler** — rejected: the
  spec forbids polling, and `Bun.cron` (in-process callback plus `Bun.cron.parse` for the
  next UTC instant) is confirmed present in Bun `1.3.14`.
- **A second notification/event channel beside EventV2** — rejected: splits event authority;
  notification events register through `EventV2.define` on the single authority.
- **A scheduler-owned executor, runtime, or lifecycle** — rejected: every occurrence is a
  Feature 002 Task Process via TaskTool/BackgroundJob/SessionExecution/SessionRunCoordinator.
- **A parallel definition/persistence store** — rejected: definitions reuse the Feature 007
  Config.Service/persistence authority; no parallel store.
- **Distributed multi-worker scheduling with leader election/fencing** — rejected for V1:
  out of scope until a future distributed ADR; restart safety uses reconciliation, not
  cluster coordination.
- **Auto-retry after ambiguous mutating effects** — rejected: no blind retry absent an
  explicit mutation-safe policy; ambiguous crash yields reconciled/unknown.

## Decision Outcome

Chosen option: **in-process `Bun.cron` single-instance runtime with durable definitions in
Config.Service, canonical Feature 002 occurrences on the single EventV2 authority, and a
bounded, redacted, safe-boundary async notification channel over the Feature 002
observation seam**.

- **Runtime and adapter.** V1 uses the in-process `Bun.cron(schedule, handler)` form only,
  single-instance. The scheduler adapter encapsulates register/unregister/reschedule and a
  deterministic clock abstraction; it runs no business logic in the callback and no
  permanent polling loop. It declares capabilities separately for the in-process and
  OS-level forms (overlap, misfire, timezone, persistence, process boundary, stop). Where a
  runtime or platform does not support a requested capability, the adapter exposes a typed
  capability gap and validation fails before external registration; it never invents an
  absent API. The confirmed Bun `1.3.14` capability is used where supported.
- **Durability and registration state.** Job Definitions and durable intent persist in the
  canonical Config.Service/persistence authority (no parallel store) as a new table.
  Registration state is exactly `pending`, `registered`, `unregistered`, `unknown`, and
  `reconciled`. Persistent definition/intent/state transitions are atomic within their
  authority; the Bun/OS registration is an idempotent external effect paired with
  compensation. No transaction spanning persistence and the scheduler is promised. Startup
  rehydration replays definitions, re-registers enabled ones, and reconciles registration
  state without claiming past execution.
- **Occurrence identity and state machine.** An occurrence progresses `due` → `claimed` →
  `admitted` → `executing` → terminal, with branch outcomes `misfired`, `skipped`,
  `coalesced`, `overlap_rejected`, `overlap_replaced`, `reconciled`, and `unknown`. The
  idempotency identity is the tuple `(job_definition_id, schedule_id, nominal_due_time,
  generation)`; duplicate delivery resolves to one execution with an observable duplicate
  outcome. Sequence, attempt, and generation authority belongs to the canonical executor
  (`SessionRunCoordinator`/`SessionRunner`), never to the scheduler or a projection.
- **Single executor.** A trigger publishes `job.trigger_due` and produces an occurrence
  before admission, then creates or associates a Feature 002 Task Process through TaskTool,
  BackgroundJob, SessionExecution, SessionRunCoordinator, SessionRunner, and EventV2 — never
  a second executor, runtime, event system, or lifecycle. `job.trigger_due`, notification
  delivery, and executor start/completion are distinct lifecycle observations; the Process
  Table observes them and never executes a job.
- **Single event authority.** The `job.*` lifecycle vocabulary registers through
  `EventV2.define` in a Feature-003-owned schema module and publishes through the existing
  bridge; notification lifecycle events (`job.notification_enqueued`,
  `job.notification_delivered`, `job.notification_acknowledged`,
  `job.notification_expired`) are projected on that same authority. Feature 003 introduces
  no second channel. Projection is idempotent and reuses the Feature 002 posture (dedupe on
  event id plus durable `(aggregateID, seq)`). Delivery is at-least-once for durable events
  and best-effort for live events; neither exactly-once nor global order is promised.
- **Async notification channel.** The channel reuses the Feature 002 bounded Effect
  Stream/PubSub observation seam, segmented by root/session/project, authorized and redacted
  before delivery. Data-plane observation is read-only; control-plane wake/queue/steer uses
  native SessionInput/SessionExecution. The envelope carries only a bounded summary and an
  opaque Feature 005 OutputRef — never full content, spool filesystem paths, or unbounded
  payloads. The default action is operator-only notification; manager wake, structured input
  queue, and new child session/Task creation are explicit, per-definition, authorized,
  bounded, and audited, never the default, and raw prompt injection is prohibited. A
  notification is delivered or acted upon only at a safe active-turn boundary; a busy or
  unsafe turn queues, coalesces, or expires it per policy and never interrupts unsafe work.
  Delivery never depends on an LLM; only a configured action invokes a model under explicit
  permission, budget, cost, and Feature 001 routing.
- **Overlap and misfire.** The default overlap policy is `forbid` (no overlap); `allow`,
  `queue`, and `replace` are honored only when the selected adapter or occurrence layer can
  enforce them, and an unsupported request fails validation before registration. In-process
  no-overlap is authoritative: the next fire waits for the handler's returned Promise to
  settle. A handler pending beyond the next nominal due time yields an explicit misfire
  outcome, never a second overlapping invocation. `replace` respects mutation boundaries and
  never silently stops or kills a mutating handler or process. Misfire policy is
  configurable among skip, fire-once, bounded catch-up, and coalescing, with no infinite
  catch-up; schedule lag is measured from nominal due time.
- **Occurrence-owned Todo and OutputGroup.** Each executable occurrence owns exactly one
  Feature 002 session-owned Todo aggregate created before goal-bearing work; each admitted
  occurrence that produces output owns its own Feature 005 OutputGroup scoped to
  process/attempt/generation. A Job Definition never shares a live Todo list or a mutable
  OutputGroup/spool channel with occurrences or other definitions; cancelling one occurrence
  preserves that occurrence's incomplete Todo and outcome without rewriting future
  definition state. Lifecycle terminal status remains Feature 002 execution authority;
  Feature 005 owns content-plane settlement.
- **Namespaces and operator authority.** `job.*` is the Feature 003 lifecycle event
  vocabulary on EventV2; `jobs.*` is the Feature 007 operator command domain (list, status,
  show, create, update, enable, disable, delete, reschedule, run-now, history, watch). Both
  are reserved; plugin, MCP, custom command, and PromptTemplate registration reject
  collisions with either at register/migrate time with a structured `reserved_name` error.
  Reserved operator IDs are versioned in the `reserved-operator-ids` catalog and bumped
  additively. All scheduled-job administration is native-only through the Feature 007
  control plane; `run-now` creates a normal occurrence through admission/routing/permissions/
  lifecycle and starts no LLM turn solely for administration.
- **Safety and reconciliation.** Disabling or deleting a definition never silently
  terminates a mutating active execution; native cancellation follows Feature 002 mutation
  boundaries and reports `unconfirmed`/`unknown` where a remote effect cannot be confirmed,
  never a false kill. A crash between claim and dispatch yields reconciled/unknown state and
  replays no ambiguous mutation; auto-retry after ambiguous effects is out of scope until an
  explicit mutation-safe policy exists.
- **Permissions, secrets, observability.** Target/action allowlists and operator commands are
  governed by the canonical Feature 007 Permission/Policy authority; secrets are
  OS-keychain-backed secure references only, never raw in arguments, shell history, output,
  prompts, event metadata, logs, traces, or notifications. Feature 003 adds no new exporter,
  SDK, or pipeline: it reuses the ADR-0001/Feature 001 OTLP foundation and Feature 002
  lifecycle events; IDs appear only in traces/logs, metric labels use bounded enums/buckets,
  and async bounded OTLP export never blocks trigger or execution.

### V1 decisions accepted with this ADR (Feature 003 clarify package C1–C22)

Declarative clarify resolutions (2026-07-18); full matrices live in Feature 003 `spec.md`
Clarifications. Numeric bounds this feature defers are provisional plan constants with named
acceptance hooks, never open placeholders:

1. **Runtime.** Bun `1.3.14` in-process `Bun.cron(schedule, handler)`; typed capability gap
   rather than an invented API when a form or platform is unsupported (C1).
2. **Phase.** Phase 1 in-process, single-instance; OS-level bootstrap/IPC seam deferred to V2
   behind a feature flag (C2, C21).
3. **Overlap.** Default `forbid`; in-process no-overlap authoritative; long handlers misfire,
   never double-fire; `replace` is mutation-safe (C3).
4. **Timezone.** Canonical IANA timezone plus 5-field cron; occurrence layer computes due
   instants; unsupported timezone rejected before registration; lag from nominal due (C4).
5. **Persistence.** Config.Service durable definitions/intent; registration state
   `pending|registered|unregistered|unknown|reconciled`; no cross-system transaction; startup
   rehydration and reconciliation (C5).
6. **Occurrence.** `due→claimed→admitted→executing→terminal` with branch outcomes;
   idempotency tuple `(job_definition_id, schedule_id, nominal_due_time, generation)`;
   canonical executor owns sequence/attempt/generation; no exactly-once, no global order (C6).
7. **Ownership.** Single-instance; distributed scheduling deferred to a future ADR; restart
   safety via `unknown`/`reconciled` and reconciliation (C7).
8. **Notification authority.** Single EventV2 authority and Feature 002 observation seam; no
   second channel; enqueue/delivery/ack/expiry projected on that authority (C8).
9. **Default action.** Operator-only notification; wake/queue/child are explicit and audited;
   safe active-turn boundary; TTL expiry with no unbounded queue; no LLM-dependent delivery
   (C9).
10. **Permissions/secrets.** Feature 007 Permission/Policy; OS-keychain secure references only
    (C10).
11. **Budgets.** Feature 002 admission and Feature 001 routing/budget authority; no blind
    retry of ambiguous mutating effects; per-scope numeric budgets are provisional plan
    constants (C11).
12. **Operator domain.** `jobs.*` Feature 007 domain with the canonical operations; project
    default scope; redacted/versioned output; CAS/idempotency/audit; `run-now` starts no LLM
    turn (C12).
13. **Namespaces.** `job.*` events versus `jobs.*` commands, both reserved; collisions
    rejected with `reserved_name`; reserved IDs versioned additively (C13).
14. **Todo.** Occurrence-owned Feature 002 Todo; closed status set
    `pending|in_progress|completed|cancelled` with version/CAS; no shared list; cancel
    preserves independence (C14).
15. **OutputGroup.** Occurrence-owned Feature 005 OutputGroup; notification carries bounded
    summary plus opaque OutputRef only; Feature 002 owns terminal, Feature 005 owns
    settlement (C15).
16. **Canonical process.** `job.trigger_due` plus occurrence, then Feature 002 Task Process;
    distinct lifecycle observations; Process Table never executes (C16).
17. **Cancellation.** No silent kill of mutating work; `unconfirmed`/`unknown` where a remote
    effect is unconfirmed; cancel affects only that occurrence (C17).
18. **Observability.** Reuse ADR-0001/Feature 001 OTLP and Feature 002 events; IDs in
    traces/logs only; bounded labels; async export never blocks (C18).
19. **Boundedness.** Bounded callbacks/queues/retention/catch-up/export with observable
    overflow; explicit misfire outcomes; numeric ceilings are provisional plan constants
    (C19).
20. **Fault matrix.** Registration failure, partial persistence, event storms, cron fan-out,
    notification lag, long handlers, cancellation, OTEL outage, restart, and reconciliation
    bind to named acceptance hooks; thresholds fixed by acceptance testing (C20).
21. **Migration.** Additive, feature-flagged; V1 in-process single-instance; no existing
    canonical behavior changes; new durable job-definition table under Config.Service (C21).
22. **Security completeness.** The Security Requirements section is complete for clarify;
    permission authority and secret resolver resolve to Feature 007 Permission/Policy and OS
    keychain (C22).

This ADR is **proposed**; it is the required decision record that unblocks Feature 003
`plan`/`tasks`. ADR-0001 and ADR-0002 remain proposed; ADR-0003 is accepted.

### Consequences

#### Positive

- One scheduling runtime, one persistence authority, one event authority, and one executor;
  no second scheduler, store, channel, or lifecycle.
- Restart safety is explicit through registration state and reconciliation rather than a
  false durable-registration or cross-system-atomicity claim.
- Notifications are bounded, redacted, safe-boundary, and operator-only by default; no raw
  prompt injection and no occurrence content or spool paths in envelopes.
- Occurrence-owned Todo and OutputGroup prevent shared live work state across a definition
  and its occurrences.
- Reserved `job.*`/`jobs.*` namespaces and native-only administration close LLM/plugin/MCP/
  prompt admin paths and name collisions.

#### Trade-offs

- OS-level `Bun.cron`, distributed multi-worker scheduling, leader election, and fencing are
  deferred; V1 is in-process single-instance.
- No exactly-once or global-order guarantee; duplicate delivery is resolved by idempotency
  identity, and ambiguous mutating effects surface as reconciled/unknown without auto-retry.
- Per-scope numeric budgets, retention/compaction bounds, minimum interval, clock-skew
  tolerance, queue capacities, and catch-up ceilings remain provisional plan constants fixed
  by acceptance testing.
- The in-process/OS-level capability split means a definition requesting an unsupported
  overlap/misfire/timezone/persistence semantic fails validation before registration.

#### Follow-ups

- Feature 003 `plan`/`tasks` implement Phase 1 slices, the occurrence state machine,
  registration reconciliation, and the notification channel, reusing the Feature 007 sandbox
  harness.
- OS-level execution bootstrap/IPC and distributed ownership require a successor ADR before
  implementation.
- An explicit mutation-safe retry policy requires a separate decision before any auto-retry
  of ambiguous effects.

## Related

- Feature specification: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Feature research: [003 research](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/research.md)
- Feature plan: [003 plan](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/plan.md)
- Direct dependency: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Routing/telemetry dependency: [001 Smart Agent Routing and Telemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Content-plane feature: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
</content>
</invoke>

## Links

- Related: ADR-0018.
