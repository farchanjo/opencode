---
id: 019f698e-8b57-7851-84d1-8f09a10d08e2
number: 003
slug: add-persistent-bun-native-scheduled-jobs-with-event
status: specified
created_at: 2026-07-16T06:12:57.303777Z
---

## Scope and intent

Feature 003 specifies persistent scheduled jobs whose triggers produce canonical
occurrences and asynchronous, authorized notifications for the main context. It
depends on [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
for execution and lifecycle projection, and on [Feature 001 Smart Agent Routing and
Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
for manager/brain dispatch and telemetry policy.

Bun `1.3.14` provides `Bun.cron` in-process and OS-level registration capabilities,
but in-process jobs do not survive process exit. Therefore a durable definition is
persisted and rehydrated at startup; the runtime adapter is not itself the durable
scheduler. No permanent `while true` plus `sleep` polling loop is permitted.
The future ADR **Scheduled Job Runtime and Async Notification Channel** is required
before `plan` or implementation and is intentionally not created here.

## User Stories

### P1 — Durable scheduling and execution

- As an operator, I want to declare, inspect, enable, disable, update, and delete
  scheduled jobs so that recurring work is explicit and auditable.
- As a user, I want each trigger to become a lifecycle occurrence and canonical Task
  Process so that scheduling does not bypass admission, permissions, or routing.
- As an operator, I want restart, misfire, overlap, and reconciliation behavior to be
  explicit so that a process-local cron registration is not mistaken for durability.

### P1 — Main-context notification

- As a main-context owner, I want an authorized asynchronous notification channel so
  that the brain can observe scheduled occurrences without polling.
- As a user, I want notifications bounded, segmented, redacted, and safe at active-turn
  boundaries so that a scheduled event cannot leak or interrupt unsafe work.
- As an operator, I want delivery, acknowledgement, expiry, and action outcomes
  audited so that notification behavior is explainable.

### P1 — Safety and observability

- As an operator, I want overlap, admission, retry, cost, and effect boundaries
  observable so that cron fan-out cannot create unbounded execution or blind retries.
- As a routing system, I want local scheduled-job evidence correlated with Feature 001
  and Feature 002 so that dispatch remains hard-gated and backend-independent.
- As an operator, I want each executable scheduled occurrence to own its own Todo
  aggregate so that Job Definitions never share a live work list and cancelling one
  occurrence cannot rewrite future definition state.

### P2 — Native management

- As an operator, I want native menu/palette/slash/CLI management of jobs so that
  scheduling is never exposed as an LLM, tool, MCP, or custom prompt interface.

## Functional Requirements

### Job identity, persistence, and adapter

1. The system MUST distinguish durable `job_definition_id`, `schedule_id`, logical
   `occurrence_id`, execution `process_id`, `session_id`, `root_session_id`, and
   `attempt` identities.
2. A Job Definition MUST include name/description, enabled state, schedule/cron,
   requested timezone, target/action type, scope/project/root-session policy, redacted payload
   reference, concurrency/overlap policy, misfire policy, deadline/timeout,
   retry/fallback budget, priority, permissions, owner, created/updated timestamps,
   and version.
3. Definitions MUST be durably persisted and rehydrated at startup. In-process Bun
   cron registration MUST NOT be treated as durable by itself.
4. The scheduler adapter MUST encapsulate native registration, unregister, and
   reschedule operations and MUST support deterministic clock abstraction and tests.
   It MUST declare its capabilities separately for in-process and OS-level Bun cron,
   including overlap, misfire, timezone, persistence, process boundary, and stop
   semantics. It MUST NOT implement a permanent polling loop or business logic in the
   callback.
5. The adapter MUST use the confirmed Bun `1.3.14` capability where supported and
   MUST expose a capability gap rather than inventing an API when runtime/platform
   support is unavailable.
6. Create, update, enable, disable, delete, and reschedule MUST be atomic and
   idempotent within the canonical persistent authority, with durable intent and
   registration state. The external Bun/OS operation MUST be idempotent and paired
   with compensating action/reconciliation. The system MUST NOT promise one
   transaction spanning SQLite/persistence and Bun or an OS scheduler. Registration
   state MUST distinguish `pending`, `registered`, `unregistered`, `unknown`, and
   `reconciled`; all operations remain validated, permissioned, and audited.
7. Cron grammar, requested timezone, minimum interval, DST, clock skew/change, leap,
   and duplicate times MUST be validated against the selected adapter/capability or
   normalized by an explicitly defined occurrence layer. Incompatible configuration
   MUST fail before external registration; timezone is not universal across adapters.

### Trigger and lifecycle consistency

8. A trigger MUST produce `job.trigger_due` and an occurrence before admission; it
   MUST then create or associate a Feature 002 Task Process through TaskTool,
   BackgroundJob, SessionExecution, SessionRunCoordinator, SessionRunner, and EventV2
   services. Each executable scheduled occurrence MUST receive its own session-owned
   Todo aggregate under Feature 002 mandatory Todo rules before goal-bearing work
   starts. A Job Definition MUST NOT share a Todo list with occurrences or with other
   definitions.
   8a. Each **admitted** scheduled occurrence MUST own its own
   [Feature 005](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
   **OutputGroup** for that occurrence's execution (process/attempt/generation). A Job
   Definition MUST NOT share a mutable OutputGroup or spool channel with occurrences
   or with other definitions. Lifecycle terminal status remains Feature 002 execution
   authority; Feature 005 owns content-plane settlement for the occurrence's outputs.
9. The scheduler MUST not execute business logic directly, bypass admission, bypass
   Smart Routing, or create a second executor, runtime, EventV2 system, or lifecycle.
10. The occurrence MUST carry idempotency identity and correlation/causation to its
    definition, schedule, session/root tree, and resulting process. Projection MUST
    be idempotent and delivery MUST NOT promise exactly-once.
11. Minimum typed events MUST include `job.definition_created`, `job.definition_updated`,
    `job.definition_enabled`, `job.definition_disabled`, `job.definition_deleted`,
    `job.registered`, `job.unregistered`, `job.rescheduled`, `job.trigger_due`,
    `job.occurrence_claimed`, `job.triggered`, `job.misfired`, `job.skipped`,
    `job.coalesced`, `job.queued`, `job.admitted`, `job.notification_enqueued`,
    `job.notification_delivered`, `job.notification_acknowledged`,
    `job.notification_expired`, `job.execution_started`, `job.execution_completed`,
    `job.execution_failed`, `job.execution_cancelled`, `job.execution_timed_out`,
    `job.retry_scheduled`, `job.overlap_rejected`, `job.overlap_replaced`,
    `job.reconciled`, and `job.unknown`.
12. Events MUST carry aggregate/sequence, correlation/causation, occurrence, session,
    root-session, process, attempt, generation, source, visibility, timestamp, and
    redacted metadata. Feature 002 terminal-event preservation and per-aggregate
    ordering remain authoritative.
13. `job.trigger_due`, notification delivery, and executor start/completion MUST be
    distinct lifecycle observations. The Process Table observes them and never executes
    a job.
14. Crash between occurrence claim and dispatch MUST yield reconciled/unknown state
    without silently replaying a mutation. Auto-retry after ambiguous effects is out
    of scope until an explicit policy exists.

### Misfire, overlap, admission, and capacity

15. Misfire policy MUST be configurable among skip, fire-once, bounded catch-up, and
    coalescing only when the selected adapter or occurrence layer supports the policy.
    Unsupported policy MUST fail validation before registration. It MUST not allow
    infinite catch-up and defaults remain open.
16. Overlap policy MUST be configurable among allow, forbid, queue, and replace only
    when the selected adapter/occurrence layer can enforce it. In-process no-overlap
    applies to a handler while its returned Promise is pending; OS-level execution is
    a separate process boundary and requires explicit core bootstrap/IPC semantics.
    Replace MUST respect mutation boundaries and MUST never silently stop or kill a
    mutating handler/process.
17. Feature 002 admission/backpressure MUST govern every execution. Scheduler fan-out
    MUST respect global, job, project, provider, agent, tool, event, OTEL, token, and
    cost limits.
18. Priority, fairness, queueing, rejection, and bounded event/notification growth
    MUST be observable. Saturation MUST never create unbounded queues or catch-up.
19. Schedule lag MUST be measured from due time; missed triggers MUST produce explicit
    misfire/skipped/coalesced outcomes rather than hidden retries.

### Async main-context notification

20. Notifications MUST use a typed, bounded, asynchronous channel segmented by
    root/session/project and based on the authorized Effect Stream/PubSub/EventV2 seams
    from Feature 002. Polling is prohibited.
21. The main context/brain MAY receive notifications for its authorized tree/scope;
    agents/subagents receive only permitted scope. Cross-session/project leakage MUST
    be rejected before delivery.
22. A notification envelope MUST include notification/event/occurrence/job IDs,
    target root/session, source, type, priority, created/expiry timestamps,
    correlation/causation, redacted payload reference, delivery state, and ack state.
    When the occurrence produced observed output, the envelope MUST carry only a
    **bounded summary and Feature 005 OutputRef** (or equivalent opaque ref), never
    full content, spool filesystem paths, or unbounded payloads.
23. Data plane observation MUST be read-only. Control plane wake/queue/steer MUST use
    native SessionInput/SessionExecution APIs; observers cannot directly mutate a
    lifecycle or Process Table.
24. The policy MUST distinguish operator-only notification, manager wake, structured
    input queue, and new child session/Task creation. Each action MUST be bounded,
    authorized, auditable, and explicit; raw prompt injection is prohibited.
25. Busy/offline main contexts MUST queue, coalesce, or expire notifications according
    to configured policy and MUST not interrupt an unsafe active turn.
26. Delivery MUST not depend on an LLM. Only a configured action MAY invoke a model,
    with explicit permission, budget, cost, and Feature 001 routing.
27. Brain → router → specialist handoff MUST use Feature 001/ADR-0002 and MUST NOT
    bypass hard gates or the router.

### Action targets and operator management

**Normative transversal rule (Feature 007 Operator Control Plane).** All setup,
configuration, and management for scheduled jobs MUST use
[Feature 007](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
unified Operator Control Plane and native Settings/menu/palette/native-slash/CLI/App/
Desktop adapters calling typed core domain commands/queries directly. MUST NOT use
Config.command/custom templates, `session.command` prompt path, ToolRegistry, MCP
tools/prompts, plugins, skills, shell commands issued by an LLM, or free-form model
instructions as management authority. Native slash is intercepted before prompt
admission/transcript; zero provider/model calls/tokens/cost by default; output not
added to Message/Part/context by default. Mutations require operator principal,
explicit scope, version/CAS, idempotency, and audit; secret refs only. Canonical job
IDs: list, status, show, create, update, enable, disable, delete, reschedule, run-now,
history, watch. Job admin creates native lifecycle occurrences (Feature 002), not LLM
turns. Plugin/MCP/custom registries MUST NOT register reserved operator IDs.

28. Target/action types MUST be categorized as native maintenance/action, operator
    notification only, main-context wake/structured input, Smart Routing dispatch, or
    approved workflow/template.
29. Shell or mutating tool actions MUST require explicit allowlist, permission,
    confirmation/policy, and secure secret references; arbitrary scheduling is not
    available to an untrusted LLM, plugin, or prompt.
30. Native operator-only surfaces MUST provide Feature 007 canonical job operations:
    list, status, show, create, update, enable, disable, delete, reschedule, run-now,
    history, and watch. Final display aliases remain clarification; reserved IDs and
    scopes are Feature 007 authority.
31. `run-now` MUST create a normal occurrence and pass through admission, routing,
    permissions, and lifecycle events; it MUST not bypass scheduled-job identity or
    Process Table semantics. It MUST NOT start an LLM turn solely for administration.
32. Human/JSON output MUST be redacted and versioned. Secrets MUST not occur in
    arguments, shell history, output, prompt templates, or LLM/tool/MCP surfaces.

## Non-Functional Requirements

- **Durability:** definitions survive restart through the canonical durable store;
  durable intent and registration state survive restart; in-process registrations and
  active occurrences remain explicitly recoverable or unknown according to policy.
- **Atomicity boundary:** persistent definition/intent/state transitions are atomic
  within their authority. Bun/OS registration is an idempotent external effect with
  pending/registered/unregistered/unknown/reconciled state and compensation; no
  cross-system transaction is assumed.
- **Boundedness:** scheduler callbacks, admission, event queues, notification queues,
  retention, catch-up, and OTEL export have configured bounds and observable overflow.
- **Consistency:** event schema, aggregate sequence, occurrence idempotency, terminal
  preservation, projection idempotency, and delivery semantics are testable without
  exactly-once promises.
- **Isolation:** target visibility and notification authorization apply before
  subscription/projection and prevent sibling/project/session leakage.
- **Safety:** disabling/deleting a definition does not silently kill a mutating active
  execution; native cancellation follows Feature 002 boundaries.
- **Performance:** scheduling and notification do not block canonical execution or
  require an LLM/model call for administrative state operations.
- **Privacy:** payload references are redacted and large/sensitive contents remain
  outside envelopes, metrics, logs, traces, and tables by default.
- **Compatibility:** existing SessionInput, SessionExecution, RunCoordinator,
  BackgroundJob, TaskTool, EventV2, command registries, config, and persistence remain
  canonical.
- **Occurrence-owned Todo:** each executable occurrence Session owns exactly one Todo
  aggregate under Feature 002; Job Definitions never share live Todo lists; cancel of
  one occurrence preserves incomplete Todo for that occurrence without rewriting
  future definitions.

## Acceptance Criteria

1. **Cron trigger without polling.** Given an enabled valid definition, when its due
   time arrives, then a native Bun scheduler callback produces a trigger event without
   a permanent `while true`/`sleep` loop.
2. **Restart rehydration.** Given persisted definitions and no active registrations,
   when the runtime starts, then definitions validate and re-register or report an
   explicit capability/registration state without claiming past execution.
3. **Misfire policy.** Given a missed trigger, when reconciliation runs, then skip,
   fire-once, bounded catch-up, or coalesce is applied explicitly and no infinite
   catch-up occurs.
4. **DST/clock change.** Given timezone and clock transitions, when a due calculation
   occurs, then duplicate/leap/skipped times follow the configured policy and lag is
   recorded.
5. **Overlap.** Given a running occurrence and a new due trigger, when overlap policy
   applies, then allow/forbid/queue/replace outcome is evented and replace cannot
   blindly terminate a mutating execution.
6. **Duplicate trigger.** Given duplicate delivery for one occurrence, when projection
   runs, then one idempotency identity prevents duplicate execution and the duplicate
   outcome is observable.
7. **Main busy.** Given an active unsafe main turn, when a notification arrives, then
   it queues/coalesces/expires without unsafe interruption.
8. **Main offline/expiry.** Given an unavailable target context and notification TTL,
   when delivery cannot occur, then expiry is recorded and no unbounded queue grows.
9. **Isolation.** Given sibling sessions and projects, when a notification or tree view
   is requested, then only authorized root/session/project events are delivered.
10. **Safe wake.** Given an authorized main notification policy, when a safe boundary
    occurs, then SessionInput/SessionExecution performs the configured wake/queue/new
    child action and records it; no raw prompt is silently injected.
11. **Smart dispatch.** Given a configured routing action, when an occurrence is
    admitted, then Feature 001 routing and hard gates select the allowed route and
    Process Table records owner_kind scheduled-job.
12. **Admission saturation.** Given provider/project/global limits are saturated,
    when a trigger fans out, then it queues or rejects under Feature 002 policy and
    schedule lag/backpressure is observable.
13. **Disable race.** Given a trigger races with disable/update/delete, when operations
    commit, then atomic version/occurrence rules produce one auditable outcome without
    partial definition or registration state.
14. **Run now.** Given an operator invokes run-now, when it executes, then it creates a
    normal occurrence and follows admission, routing, permissions, and lifecycle.
15. **OTEL outage.** Given OTLP is unavailable, when a trigger and execution occur,
    then local authority/events continue, export remains bounded/asynchronous, and
    outage is observable.
16. **Redaction/cardinality.** Given many jobs, occurrences, sessions, and processes,
    when metrics/logs/traces export, then IDs are not metric labels, labels are bounded,
    and secrets/payloads/paths are absent by default.
17. **Operator-only surface.** Given an LLM, tool, MCP call, plugin, or prompt template,
    when it attempts job administration, then it is rejected; native operator commands
    remain functional without an LLM/provider.
18. **Event consistency.** Given due, claim, notification, admission, and execution
    transitions, when events are ordered per aggregate, then terminal preservation and
    Process Table consistency match Feature 002 without global order/exactly-once.
19. **Claim crash.** Given a crash after claim before dispatch, when reconciliation
    runs, then occurrence is reconciled/unknown and no ambiguous mutation is replayed.
20. **Mutation ambiguity.** Given a failed mutating action, when retry/fallback is
    considered, then no blind repeat occurs without explicit mutation-safe policy.
21. **Event storm.** Given cron fan-out and notification bursts, when bounded queues
    saturate, then coalescing/drop/rejection policy is observed and memory remains
    bounded.
22. **Unsupported adapter capability.** Given a definition requests overlap, misfire,
    timezone, or persistence semantics unsupported by the selected adapter/occurrence
    layer, when it is created or updated, then validation fails before registration and
    the durable definition records the rejected capability without an external job.
23. **Partial registration reconciliation.** Given persistent intent commits but Bun or
    OS registration crashes or returns an unknown result, when startup reconciliation
    runs, then state transitions through pending/unknown/reconciled with idempotent
    compensation or registration and never claims a cross-system atomic commit.
24. **Long-running in-process handler.** Given an in-process handler remains pending
    beyond the next nominal due time, when the cron adapter schedules the next fire,
    then the adapter's documented no-overlap behavior is observed and no overlapping
    handler invocation is created.
25. **No false kill.** Given replace, disable, unregister, or cancellation occurs while
    a handler or OS-level process may be mutating, when control is applied, then stop
    or unregister is not reported as an OS kill or confirmed remote cancellation and
    no mutation is silently repeated or terminated without the native lifecycle result.
26. **Occurrence-owned Todo.** Given an executable scheduled occurrence, when it is
    admitted for goal-bearing work, then it has its own non-empty session-owned Todo
    snapshot under Feature 002 and does not share the Job Definition's list or any
    sibling occurrence list.
27. **Cancel occurrence preserves definition and Todo independence.** Given an active
    occurrence with incomplete Todo, when that occurrence is cancelled, then only that
    occurrence/process is cancelled, incomplete Todo items and outcome/reason are
    preserved for that occurrence, and the future Job Definition remains enabled and
    unchanged for later triggers.
28. **Occurrence-owned OutputGroup.** Given an admitted scheduled occurrence that
    produces observed output, when execution runs, then that occurrence owns its own
    Feature 005 OutputGroup and does not share a mutable OutputGroup or spool channel
    with the Job Definition or sibling occurrences; lifecycle terminal remains Feature 002.
29. **Notification carries bounded summary/ref only.** Given an occurrence with sealed
    or open output, when a main-context notification is delivered, then the envelope
    includes only a bounded summary and Feature 005 OutputRef (opaque), never full
    content or spool filesystem paths.

## Security Requirements

1. Job ownership, global/project/root/session scope, action permissions, and observer
   visibility MUST be authorized before registration, trigger, projection, or delivery.
2. Cron expressions, timezones, payload references, action types, quotas, deadlines,
   retry budgets, and filters MUST be schema-validated and bounded.
3. Secrets MUST be secure references, never raw payloads, arguments, shell history,
   prompts, event metadata, logs, traces, or notifications.
4. Event and notification delivery MUST redact before crossing observer/session/project
   boundaries. Large prompts, results, paths, and tool content remain references only
   when explicitly authorized.
5. Native control actions (cancel, wake, steer, handoff, delete, disable) MUST use
   canonical permission and lifecycle services; tables and observers cannot mutate.
6. Rate limits, quotas, overlap controls, notification limits, and abuse protection
   MUST bound untrusted or high-fan-out definitions and triggers.
7. Disable/delete MUST not silently terminate mutation-risky work; cancellation and
   recovery must follow Feature 002 mutation boundaries.
8. LLM, plugin, tool, MCP, and prompt callers MUST not administer jobs unless a
   separate authorized native operator path explicitly represents the action.
9. Audit events MUST identify operator/interface actor, source, scope, occurrence,
   correlation, causation, action, result, and configuration version without exposing
   secrets or pretending an LLM acted.

## Observability

This feature depends on ADR-0001 and Feature 001 telemetry conventions and Feature
002 lifecycle events. Spans include `job.schedule`, `job.trigger`, `job.claim`,
`job.notify`, `job.dispatch`, `job.execute`, `job.retry`, and `job.reconcile`, linked
to `task.execute`, session execution, LLM, tool, and fallback spans.

Metrics include enabled definitions, due/triggered/misfired/skipped/coalesced counts,
schedule lag, queue wait, duration, success/failure/cancel/timeout, overlap, retry,
notification queue/delivery/ack/expiry, saturation, and reconciliation. Structured
logs include redacted lifecycle events and authorization outcomes. IDs are traces/logs
only; metric labels use bounded enums/buckets and allowlisted catalog IDs under a
cardinality budget. Async bounded OTLP export never blocks trigger or execution and
local authority remains usable during outage.

## Compatibility and Migration

- Definitions persist in the existing canonical configuration/persistence layer; Bun
  registrations are rehydrated at startup and reconciled rather than treated as the
  durable source.
- Triggered work uses Feature 002 Task Lifecycle Event Bus and Process Table,
  Feature 002 session-owned Todo per occurrence, Feature 005 OutputGroup per
  admitted occurrence, and Feature 001 routing; no scheduler-owned executor, event
  bus, shared Todo/OutputGroup, or bypass path exists.
- SessionInput, SessionExecution, RunCoordinator, BackgroundJob, TaskTool, EventV2,
  native command registries, permissions, config, and session store remain canonical.
- Bun in-process and OS-level cron differences, supported platforms, timezones,
  restart, misfire, registration, and migration behavior remain clarification items.
- Feature flags, V1/V2 seam, rollout, durable schema, and distributed ownership
  require clarification and the future ADR before plan/implementation.

## Out of Scope

- Distributed/multi-worker scheduler, leader election, fencing, placement, and cluster
  ownership unless a later ADR explicitly adds them.
- Exactly-once delivery or execution guarantee.
- Arbitrary shell scheduling by default, direct LLM control, or custom prompt/tool/MCP
  administration.
- Polling loops, manual sleep schedulers, bypassing Task lifecycle or Smart Routing.
- Unbounded catch-up, queues, notification/event fan-out, or raw notification injection
  into unsafe active turns.
- Sharing one Todo list across Job Definition and occurrences, or rewriting future
  Job Definition Todo state when cancelling a single occurrence.
- Sharing one mutable OutputGroup/spool across Job Definition and occurrences, or
  carrying full occurrence output/content/paths in notification envelopes.

## Clarification Questions

1. What is the minimum Bun version, exact native API/adapter capability, supported
   platform set, and behavior when Bun cron is unavailable?
2. Is Phase 1 in-process Bun, OS-level Bun, or both, and what bootstrap/IPC seam is
   required for OS-level scripts that do not share Session/services/pools?
3. What overlap behavior is real for each adapter, what is the default, and how are
   long-running in-process handlers treated?
4. What requested timezone is accepted, normalized, or rejected per adapter, including
   UTC, DST, clock-change, minimum interval, leap, and duplicate-time rules?
5. What durable store/schema, registration-state model, retention, compaction, durable
   intent, and startup rehydration/reconciliation guarantees apply?
6. What occurrence claim state machine, aggregate/sequence authority, idempotency key,
   duplicate delivery, projection, and live-ordering authority is canonical?
7. How is multi-instance ownership, fencing, leader election, or distributed scheduling
   treated in future phases versus initial out-of-scope behavior?
8. Which Feature 002 authority owns notification enqueue, delivery, acknowledgement,
   and event seam, and how does Feature 003 integrate without a second channel authority?
9. Does a notification notify the operator, wake the manager, queue structured input,
   or create a child session/Task by default, and what safe-boundary rule applies?
10. What permission authority and secure secret resolver govern target/action allowlists,
    native/workflow/template/shell actions, and operator commands?
11. What retry, timeout, cost, token, provider, and mutation-safety policy applies per
    job, project, root, session, and global scope?
12. What UI/command names, scopes, human/JSON schema, history/watch views, and
    operator permissions are included in each phase?
13. What migration/feature flag/rollout and V1/V2 seam is approved?
14. What numeric limits and fault-injection matrix cover registration failure,
    partial persistence, event storms, cron fan-out, notification lag, long handlers,
    cancellation, OTEL outage, restart, and reconciliation?

## Related Decisions

- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 — Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — proposed sole management authority.
- [Feature 003 research](research.md) — evidence, not a decision.
- Related content-plane feature: [005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — occurrence output groups and notification refs; lifecycle remains Feature 002 execution authority.
- Related semantic retrieval feature: [006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — scheduled index reconciliation natively, no LLM by default; coalesced triggers.
- Related management foundation: [007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — jobs command IDs, auth, audit; not runtime execution authority.
- Related MCP runtime: [008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — optional scheduled/wake for resource policy only; no automatic wake per update; ownership unchanged.
- Future ADR required before plan/implementation: **Scheduled Job Runtime and Async Notification Channel** (not created).

## Initial Traceability Matrix

| Outcome                            | Requirements              | Acceptance scenarios    | Phase |
| ---------------------------------- | ------------------------- | ----------------------- | ----- |
| Durable native scheduling          | FR1–FR7                   | 1–4, 13                 | 1     |
| Event-consistent occurrences       | FR8–FR14                  | 6, 11, 13, 18–20, 26–29 | 1     |
| Occurrence-owned Todo              | FR8                       | 26–27                   | 1     |
| Occurrence OutputGroup + notif ref | FR8a, FR22                | 28–29                   | 1     |
| Misfire/overlap/admission safety   | FR15–FR19                 | 3, 5, 12, 21            | 1     |
| Authorized async notifications     | FR20–FR27                 | 7–10, 17                | 1–2   |
| Operator management                | FR28–FR32                 | 14, 17                  | 2     |
| OTEL and Process Table integration | NFRs, FR8–FR14, FR43–FR48 | 11–12, 15–16, 18        | 1–2   |
| Security and privacy               | Security Requirements     | 8–10, 16–20             | 1–2   |
