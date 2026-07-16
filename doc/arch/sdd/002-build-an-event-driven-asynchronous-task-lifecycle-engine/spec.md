---
id: 019f697e-c09a-7b40-a82f-30df4badfc7b
number: 002
slug: build-an-event-driven-asynchronous-task-lifecycle-engine
status: specified
created_at: 2026-07-16T05:55:42.362102Z
---

## Scope and intent

Feature 002 specifies a single lifecycle-observation capability: canonical Task
executors publish typed lifecycle events; a per-session Process Table projects
those events for operators, local routing evidence, and OpenTelemetry. The Process
Table is read-only projection state, not an executor, scheduler, permission
authority, or second lifecycle.

This feature reuses and composes with [Feature 001 Smart Agent Routing and
Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md),
[ADR-0001 Telemetry Foundation](../../adr/0001-opentelemetry-telemetry-foundation.md),
and [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md).
The future ADR **Task Process Lifecycle and Operational Observation** is required
before `plan` or implementation; it is intentionally not created here.

## User Stories

### P1 — Lifecycle visibility and safety

- As an operator, I want a coherent lifecycle stream for every Task attempt so that
  I can distinguish queued, running, waiting, terminal, zombie, and unknown work.
- As a session owner, I want Process Table views segmented by session and process
  tree so that sibling sessions, projects, and agents cannot leak into one another.
- As a user, I want cancellation, steering, and handoff to use canonical services so
  that observation never becomes an unauthorized lifecycle control path.
- As an operator, I want terminal outcomes and failure reasons retained with bounded
  state so that restart, saturation, and cleanup behavior are explainable.

### P1 — Concurrency and backpressure

- As an operator, I want admission and backpressure to reflect measured capacity so
  that high I/O concurrency does not become infinite memory, CPU, provider, SQLite,
  or telemetry pressure.
- As a user, I want slow observers isolated from Task execution so that a dashboard or
  subscriber cannot block SessionRunner or lose terminal outcomes silently.

### P1 — Routing and telemetry evidence

- As a routing system, I want local lifecycle evidence with bounded windows,
  confidence, and TTL so that Smart Routing can use consistent observations without
  querying a remote telemetry backend per Task.
- As an operator, I want correlated lifecycle spans, metrics, and logs without prompts,
  secrets, paths, or tool payloads so that diagnosis remains useful and private.

### P2 — Operational management

- As an operator, I want tree/status/watch/cancel views in native surfaces when their
  future scope is authorized so that lifecycle operations are discoverable without
  exposing controls to an LLM, tool, MCP call, or prompt template.

## Functional Requirements

### Architecture and canonical ownership

1. The lifecycle engine MUST execute asynchronous work through Bun and Effect fibers
   or the canonical runtime; it MUST support high I/O concurrency without treating
   concurrency as infinite.
2. Capacity MUST account for measured CPU, memory, GC, provider, SQLite, tool,
   lifecycle-event-bus, and OpenTelemetry limits rather than an unqualified fixed
   concurrency promise.
3. Task Lifecycle Event Bus MUST be the primary observation mechanism. Canonical
   executors MUST publish lifecycle events before projections or exports consume them.
4. Task Process Table MUST be a read-only projection of lifecycle events. It MUST NOT
   execute work, schedule work, authorize work, own a parallel lifecycle, or become
   the source from which events are reconstructed.
5. The flow MUST be canonical executors → lifecycle events → Process Table, local
   metrics/evidence, OpenTelemetry, and Smart Routing projections.
6. The implementation MUST reuse TaskTool, BackgroundJob, SessionExecution,
   SessionRunCoordinator, SessionRunner, EventV2, session schemas/store, Effect
   Scope/Stream/PubSub, and existing lifecycle identities. It MUST NOT introduce a
   second executor, runtime, SessionRunner, EventV2 system, or lifecycle loop.
7. `task_id` MUST identify the logical Task, while `process_id` MUST identify an
   observable attempt/execution. `process_id` MUST NOT be described as an operating
   system PID or imply OS isolation or kill semantics.
8. Task V1 and V2 integration MUST preserve current ownership: V1 creates or reuses
   a child Session and BackgroundJob is process-local; V2 uses SessionExecution,
   SessionRunCoordinator, and SessionRunner without inventing an independent TaskV2.

### Event envelope and segmentation

9. Every lifecycle envelope MUST include typed event ID, event type, schema version,
   root/session/parent-session identity, task/process/parent-process/root-process
   identity, agent and actor kind, runtime instance, sequence, correlation and
   causation IDs, visibility, timestamp, attempt/generation, and redacted metadata.
10. Events MUST be segmented by session, process, and root tree. Ordering MUST be
    defined per aggregate/session/process and MUST NOT promise one global order.
11. The main context MAY observe its root-session tree subject to authorization; an
    agent MAY observe its session and permitted children; a subagent observes its own
    session by default; global observation requires privileged operational scope and
    redaction.
12. The event bus MUST prevent leakage between siblings, projects, sessions, and
    unauthorized root trees before delivery to any observer or projection.
13. Envelope metadata MUST be bounded and redacted; prompts, complete results, tool
    payloads, personal paths, secrets, and raw file contents MUST NOT be included by
    default.

### Dynamic observation

14. The typed observation API MUST conceptually provide `observeSession`,
    `observeProcess`, `observeTree`, and authorized `observeGlobal(filter)`.
15. Dynamic subscriptions MUST use Effect Stream/PubSub and Effect scopes/finalizers
    or equivalent canonical lifecycle cleanup. Subscribe/unsubscribe MUST be safe,
    observable, and leak-free.
16. An Observable is read-only. `cancel`, `steer`, `handoff`, and `resume` MUST pass
    through native control APIs; the runtime publishes their outcomes as events.
17. An Observer MUST NOT directly control lifecycle state, mutate the Process Table,
    or bypass permission and session boundaries.
18. Process Table state MUST update from events only; no reverse publication from the
    table to the lifecycle bus is permitted.
19. RxJS MUST NOT be added solely to provide an Observable abstraction when Effect
    Stream/PubSub already supplies the required semantics.

### Lifecycle events

20. The minimum event vocabulary MUST include `admitted`, `parent_attached`,
    `process_created`, `queued`, `waiting`, `started`, `promoted`, `extended`,
    `handoff`, `steer_requested`, `steer_accepted`, `steer_rejected`, `turn_started`,
    `turn_ended`, `turn_failed`, `tool_called`, `tool_settled`, `cancel_requested`,
    `cancelling`, `completed`, `failed`, `cancelled`, `owner_lost`,
    `zombie_detected`, `reconciled`, and `unknown`.
21. `extend`, `promote`, `steer`, and `handoff` MUST remain distinct semantic events;
    they MUST NOT be collapsed into a generic status update.
22. A handoff event MUST include source and target session/process, reason, generation,
    correlation, and causation. One canonical handoff event MUST be projectable to
    both affected sessions and their permitted root tree.
23. Terminal events MUST carry terminal reason and terminal timestamp, and all event
    consumers MUST tolerate duplicate delivery through idempotent projection.
24. Event schema evolution MUST be versioned and testable. The system MUST NOT promise
    exactly-once delivery or global ordering.

### Process Table

25. The Process Table MUST represent at least `created`, `queued`, `waiting`,
    `running`, `cancelling`, `completed`, `failed`, `cancelled`, `zombie`, and
    `unknown`. Handoff is an event and MUST NOT be a terminal state.
26. Each row MUST retain parent/root relations, owner/runtime/scope, status/reason and
    timestamps, attempt/generation/lease, agent/task class/profile/effort,
    provider/model/variant, dependencies/children/pending inputs/steers,
    cancellation/exit/error, token/cost/TTFT/stream/total duration, and trace/span
    IDs, subject to redaction and authorization.
27. Terminal rows MUST retain reason and terminal timestamps. Retention and compaction
    MUST be bounded and observable.
28. Prompts, complete results, tool payloads, personal paths, and secrets MUST remain
    outside Process Table rows by default.
29. Process Table projections MUST identify duplicate, out-of-order, unknown, and
    unreconciled events without silently inventing lifecycle state.

### Admission, concurrency, and backpressure

30. Admission MUST scale concurrency up to measured safe capacity with configurable
    limits and hard ceilings; it MUST support queued and waiting states and MUST never
    permit unbounded growth.
31. Admission policy MUST be able to account for global, root/session, child,
    provider, agent, tool, event queue, OTEL queue, SQLite, token, and cost budgets.
32. Priority and fairness MUST be explicit for parent/child work. Steers MAY be
    coalesced according to policy, waiting work MUST be cancellable, and saturation
    MUST be observable.
33. Pressure MUST produce controlled queueing, rejection, or backpressure. It MUST
    never silently allocate an unbounded queue or subscriber buffer.
34. No arbitrary `maxAgents` policy may be introduced without defining ownership,
    fairness, scope, capacity source, and observable rejection behavior.
35. Subscriber queues MUST be bounded with explicit overflow/drop/coalescing policy.
    A slow subscriber MUST NOT block Task, SessionRunner, or event producers.
36. Terminal events MUST not be silently dropped. Progress and heartbeat events MAY
    be sampled or coalesced, and no event per token or streaming delta may be
    persisted.
37. Event bus, subscriber, OTEL, and Process Table queue pressure MUST expose bounded
    depth/capacity, overflow, drop, retry, and terminal-preservation outcomes.

### Watchdog, lease, and recovery

38. Watchdog activity MUST use a light shared or bucketed mechanism, not one timer per
    Task. Heartbeat and lease state MAY remain in memory and MUST NOT write every
    heartbeat to SQLite.
39. The system MUST detect and publish `owner_lost`, `zombie_detected`, and `unknown`
    outcomes without claiming that a provider or external tool has stopped.
40. A zombie or crash MUST NOT trigger automatic retry or re-execution of effects
    without a future explicit decision and mutation-safety policy.
41. Local abort MUST be distinguished from effective remote cancellation; cancellation
    results MUST identify requested, accepted, rejected, unknown, or unconfirmed state.
42. Reconciliation with durable Sessions MUST be explicit and versioned. Recovery,
    fencing, placement, and distributed coordination remain phased/clarification
    concerns and MUST not be implied by a local Process Table.

### OpenTelemetry and Smart Routing integration

43. The feature MUST depend on and reference ADR-0001 Telemetry Foundation. It MUST
    correlate `task.execute`, wait, cancel, `session.execution`, `llm.request`,
    `tool.execute`, and `fallback` spans with lifecycle events.
44. Metrics MUST include active/started/completed/failed/cancelled/zombie counts,
    queue wait, execution duration, TTFT, tokens/s, retry/fallback, and saturation.
45. Metric labels MUST use bounded enums/buckets and active allowlisted IDs under the
    configured cardinality budget. Task, session, and process IDs belong only in
    traces/logs; prompts, paths, payloads, and secrets are excluded by default.
46. Telemetry export MUST be asynchronous and bounded and MUST NOT block the event
    producer, Task, SessionRunner, or Process Table hot path.
47. The feature MUST reference ADR-0002 Smart Routing and provide validated local
    lifecycle evidence with window, confidence, and TTL. Smart Routing MUST NOT query
    a remote telemetry backend per Task or use an inconsistent snapshot.
48. Manager brain observations of “decided to dispatch” MUST remain distinct from
    executor events showing “started” or “completed”.

### Operator management

49. Future TUI/App/API/CLI views MAY expose tree, status, watch, and health with
    redacted status, attempt, owner, model, timing, cost, and lifecycle details only
    within authorized scope; exact surfaces remain clarification.
50. Administrative commands MUST be native operator-only interfaces, not LLM, tool,
    MCP, or prompt-template interfaces. Final names, scope, and permissions remain
    clarification.
51. Cancel, handoff, and steer MUST use native services, require authorization, and
    publish audit events. No action may be performed directly by editing the Process
    Table or by an observer.

## Non-Functional Requirements

- **Correctness:** event envelopes, per-session/process ordering, idempotent
  projections, terminal preservation, and state transitions MUST be testable without
  relying on global ordering or exactly-once delivery.
- **Concurrency:** memory, subscriber queues, event queues, OTEL queues, and Process
  Table retention MUST have configured bounds and observable saturation behavior.
- **Isolation:** observers and projections MUST enforce root/session/project visibility
  before delivery; sibling and cross-project leakage is a failure.
- **Recovery:** restart and reconciliation behavior MUST be explicit for process-local
  registries, durable Sessions, unknown state, owner loss, and zombie detection.
- **Performance:** slow subscribers, telemetry exporters, and Process Table views MUST
  not block canonical Task or SessionRunner execution.
- **Privacy:** default lifecycle metadata is redacted and excludes prompts, results,
  tool payloads, paths, and secrets.
- **Compatibility:** existing Task V1/V2, BackgroundJob, SessionExecution,
  SessionRunCoordinator, SessionRunner, EventV2, and schema/store behavior remains
  the baseline unless a later ADR records an intentional seam.

## Acceptance Criteria

The following scenarios are executable acceptance targets for later planning and
implementation.

1. **High I/O concurrency bound.** Given many eligible Tasks, when admission reaches
   measured CPU/provider/SQLite/event/OTEL capacity, then new work queues or rejects
   under policy, memory remains bounded, and saturation is observable.
2. **Per-session ordering.** Given events for two sessions, when events are delivered,
   then each session/process aggregate preserves its declared ordering and no global
   order is implied.
3. **Sibling isolation.** Given sibling processes and projects, when an observer
   subscribes to one authorized tree, then sibling events and metadata are absent.
4. **Root observation.** Given an authorized main context, when it observes its root
   tree, then permitted child events are visible and unauthorized sessions remain
   hidden.
5. **Dynamic subscription cleanup.** Given repeated subscribe/unsubscribe operations,
   when scopes close, then subscriber resources are finalized and no leak or stale
   delivery remains.
6. **Handoff projection.** Given a handoff between sessions, when the event is
   published, then both permitted projections show the same source/target,
   generation, reason, correlation, and causation.
7. **Slow subscriber.** Given a subscriber that does not consume, when events arrive,
   then its bounded queue applies policy, the producer continues, and overflow is
   observable.
8. **Terminal preservation.** Given queue pressure, when a terminal event is emitted,
   then it is delivered or durably preserved according to policy and never silently
   discarded.
9. **Cancel waiting.** Given a queued or waiting process, when an authorized cancel is
   requested, then cancellation is recorded without starting the process and its
   outcome is observable.
10. **Cancel running.** Given a running process, when cancellation is requested, then
    requested/cancelling/effective outcome is distinguished and no remote stop is
    claimed without confirmation.
11. **Zombie detection.** Given a lost owner or stale lease, when watchdog evaluation
    runs, then zombie/owner-lost/unknown state is published without auto-reexecuting
    effects or claiming provider termination.
12. **OTLP unavailable.** Given an unavailable OTLP endpoint, when Tasks execute, then
    event production and Process Table updates continue, export degradation is bounded
    and observable, and the hot path is not blocked.
13. **Restart and reconcile.** Given in-memory jobs and durable Sessions, when the
    runtime restarts, then lost registry state is represented as unknown or
    unreconciled and no automatic effect retry occurs.
14. **Duplicate projection.** Given duplicate or out-of-order events, when the Process
    Table projects them, then state is idempotent, anomalies are observable, and no
    invented terminal state appears.
15. **Retention cleanup.** Given terminal rows beyond configured retention, when
    compaction runs, then cleanup is bounded, auditably counted, and active rows are
    preserved.
16. **Routing evidence window.** Given local lifecycle evidence with confidence and
    TTL, when Smart Routing reads it, then it uses only validated non-expired local
    observations and never queries a remote backend per Task.
17. **Bounded labels.** Given many task/session/process IDs, when metrics export, then
    IDs are absent from metric labels, allowlisted dimensions obey budget, and traces
    retain correlation.
18. **Operator-only commands.** Given an LLM, tool, MCP call, or prompt template,
    when it attempts lifecycle management, then the attempt is rejected and only
    authorized native operator commands can act.
19. **Process identity.** Given retries of one logical Task, when attempts are
    observed, then one task_id has distinct process_id/attempt/generation identities
    without PID or OS-kill claims.
20. **Event storm.** Given a burst of progress and heartbeat events, when the bus is
    saturated, then progress is coalesced/sampled by policy, terminal events survive,
    and no event per token/delta is persisted.
21. **Fair admission.** Given competing parent and child work under saturation, when
    admission selects the next process, then configured fairness/priority is applied
    and starvation/rejection is observable.
22. **No second authority.** Given TaskTool, BackgroundJob, SessionExecution,
    SessionRunCoordinator, SessionRunner, and EventV2, when lifecycle events and
    projections run, then no second executor, runtime, event system, or table-driven
    control loop is used.

## Security Requirements

1. **Visibility authorization.** Session, root-tree, project, and global observation
   MUST be authorized before event delivery or projection access. Global observation
   requires privileged operational scope and redaction.
2. **Data minimization.** Prompts, results, tool payloads, personal paths, secrets,
   and raw file content MUST be excluded from envelopes, Process Table rows, metrics,
   logs, and traces by default.
3. **Input validation.** Event types, schema versions, identities, sequences,
   filters, scopes, limits, lease values, and control requests MUST be validated and
   bounded before admission or observation.
4. **Control authorization.** Cancel, steer, handoff, resume, and future management
   commands MUST use canonical permissions and native services; observers and tables
   cannot mutate lifecycle state.
5. **Isolation.** The bus and observer APIs MUST reject cross-sibling, cross-project,
   and cross-session access not covered by an authorized root tree.
6. **Audit.** Control requests and lifecycle outcomes MUST record redacted actor,
   source, scope, correlation, causation, and result without impersonating an LLM.
7. **Recovery safety.** Owner loss, zombie, unknown, restart, and reconciliation MUST
   not silently retry or repeat mutation-risky effects.
8. **Transport and storage.** OTLP transport and persisted lifecycle metadata MUST
   follow the Telemetry Foundation's configured TLS, secure storage, redaction, and
   retention policy; no credentials are stored in event metadata.

## Observability

The lifecycle bus is the observation source. Conceptual spans include `task.execute`,
`session.execution`, queue wait, admission, cancel, `llm.request`, `tool.execute`,
fallback, handoff, and reconciliation. Metrics include active, started, completed,
failed, cancelled, zombie, and unknown counts; queue wait; execution duration; TTFT;
tokens/s; retries/fallback; queue depth/overflow; terminal preservation; subscriber
lag; and saturation. Logs record typed lifecycle events, projection anomalies,
authorization outcomes, owner loss, and recovery without sensitive payloads.

Metric labels use bounded enums/buckets and allowlisted catalog IDs under a budget.
Task, session, and process IDs are trace/log correlation only. OTLP export is
asynchronous and bounded. Smart Routing consumes local validated evidence with window,
confidence, and TTL; it does not query a backend per Task. Brain dispatch decisions
and executor start/completion events remain distinct.

## Compatibility and Migration

- This feature is additive to current Task V1/V2 and reuses the canonical points
  listed in research.md; no second SessionRunner, EventV2, executor, or runtime is
  introduced.
- Process-local BackgroundJob and active execution state remain process-local. Restart
  behavior exposes unknown/unreconciled state instead of pretending registry recovery.
- EventV2 durable/live distinction remains the baseline: semantic checkpoints and
  terminal transitions may be durable; deltas, heartbeats, and progress remain live,
  sampled, or coalesced under policy.
- Retention, schema evolution, event durability, admission configuration, recovery,
  operator surfaces, and distributed future behavior require clarification and a
  future ADR before implementation.
- ADR-0001 and ADR-0002 are referenced dependencies; this feature does not change
  their proposed status or decisions.

## Out of Scope

- Cluster, multi-worker, distributed leases, fencing, placement, or global scheduler.
- Real OS PID/KILL isolation or claims that `process_id` is an operating-system PID.
- A second SessionRunner, executor, runtime, EventV2 system, lifecycle loop, or
  RxJS-based Observable added solely for this feature.
- Automatic recovery, retry, or re-execution after zombie/crash with ambiguous effects.
- Persisting complete prompts, results, tool payloads, paths, secrets, or an event per
  token/delta.
- Per-Task watchdog timers, unbounded universal PubSub, or slow listeners in producer
  hot paths.
- Final command names, API exposure, admission algorithm/default limits, distributed
  semantics, and V1/V2 migration choices before clarification/ADR.

## Clarification Questions

1. What lifecycle event schema fields, types, versioning, and identity rules are final?
2. Which event classes are durable versus live, and which terminal/checkpoint durability
   guarantees apply across restart?
3. What queue capacities, overflow/drop/coalescing policies, retention, compaction,
   and terminal-preservation storage are configured, and what numeric defaults apply?
4. What admission algorithm, hard ceilings, capacity signals, priority, fairness, and
   scope limits govern global/root/session/child/provider/agent/tool/OTEL/SQLite/cost?
5. What are the exact process_id, attempt, generation, lease, and runtime-instance
   semantics, including identity across retries and restart?
6. What heartbeat/lease thresholds, bucket cadence, zombie criteria, fencing, and
   owner-lost transitions apply?
7. What reconciliation and recovery behavior is allowed for durable Sessions and
   process-local BackgroundJob after crash, including distributed future phases?
8. What are cancel requested/accepted/rejected/unknown semantics and the boundary for
   local abort versus remote provider/tool cancellation?
9. What TUI/App/API/CLI views and native operator command names, scopes, permissions,
   confirmation, and non-interactive forms are included in each phase?
10. What API exposure and visibility/filter syntax is approved for observeSession,
    observeProcess, observeTree, and privileged observeGlobal?
11. What sampling/cardinality budgets, local evidence window, confidence, TTL, and
    Smart Routing projection consistency rules are required?
12. What schema evolution, duplicate delivery, idempotent projection, replay, and
    backfill policy is supported without claiming global order or exactly-once?
13. What V1/V2 migration boundary and future distributed lifecycle ADR/ownership model
    will govern cluster, fencing, placement, and multi-worker execution?
14. **P1 gate — EventV2 seam.** What is the exact seam between EventV2 and the Task
    Lifecycle Event Bus: which event set is adapted, which adapter owns translation,
    and what local bounded layer is allowed, while preserving one EventV2/event
    system and no second event authority?
15. **P1 gate — terminal preservation.** Which component/authority preserves terminal
    events when bounded queues overflow or the runtime restarts, and what durable
    checkpoint, retry, replay, or recovery mechanism proves that preservation without
    promising global order or exactly-once delivery?
16. **P1 gate — ownership boundaries.** Which canonical owner separately owns capacity
    observation, admission decisions, execution, and Process Table projection, and
    what contracts prevent the projection or observer from becoming a scheduler,
    executor, or admission authority?
17. **P2 topology.** Is the Process Table topology a runtime-wide index with scoped
    views, a per-root/session projection, or a composed model, and how are indexes,
    visibility, retention, and restart behavior defined for each scope?
18. **P2 handoff aggregate.** Which canonical aggregate/owner records and publishes a
    cross-session handoff, and how does one event project consistently to source,
    target, and authorized root-tree views?
19. **P2 identity/order authority.** Which authority assigns sequence, generation,
    attempt, and idempotency identities, and how are live ordering, duplicate
    delivery, out-of-order events, and restart/replay handled without global order?
20. **P2 authorization authority.** Which canonical authority applies authorization,
    filtering, and redaction before projection and before subscription delivery, and
    how are root/session/project/global filters tested against sibling leakage?
21. **P2 quantitative contracts.** What numeric contracts and test matrix cover event
    rate, queue/retention bounds, admission ceilings, fairness, subscriber lag,
    terminal preservation, cancel storms, event storms, restart, OTEL outage, and
    fault injection? Which thresholds are provisional until acceptance testing?

## Related Decisions

- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 — Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [Plugin systems research](../../research/plugin-systems.md) — evidence only, not a decision.
- Future ADR required before plan/implementation: **Task Process Lifecycle and Operational Observation** (not created).
- Related scheduled-jobs feature: [003 Scheduled Jobs and Async Main-Context Notification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)

## Initial Traceability Matrix

| Outcome                            | Requirements       | Acceptance scenarios | Phase |
| ---------------------------------- | ------------------ | -------------------- | ----- |
| Canonical lifecycle ownership      | FR1–FR8, FR22–FR24 | 2, 6, 14, 22         | 1     |
| Segmented typed observation        | FR9–FR19           | 2–5, 18              | 1     |
| Process Table projection           | FR25–FR29          | 11, 13–15, 19        | 1     |
| Admission and bounded backpressure | FR30–FR37          | 1, 7–8, 20–21        | 1     |
| Watchdog and recovery safety       | FR38–FR42          | 9–13                 | 1–2   |
| OTEL and routing evidence          | FR43–FR48          | 12, 16–17, 20        | 1–2   |
| Operator management boundary       | FR49–FR51          | 18, 22               | 2     |
| Security and privacy               | NFRs, security     | 3–5, 11–18           | 1–2   |
