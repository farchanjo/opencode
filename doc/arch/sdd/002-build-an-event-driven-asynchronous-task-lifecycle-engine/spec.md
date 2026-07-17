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

**Hierarchy alignment (Feature 001 / ADR-0002, not a scope rewrite).** Feature 002
MUST project the confirmed Architect/Manager/Worker hierarchy and validation states
into Process Table rows, lifecycle events, and live panel surfaces without mixing
sessions. Routing semantics, role pools, and classification remain owned by Feature
001; this feature owns observation, projection, admission visibility, panel
surfaces, direct-child Session UI, and session-owned Todo lifecycle authority for
that tree.

**Confirmed hierarchical Session UI.** Process Table MAY retain the full authorized
root tree. Each Session view (TUI, direct/mini, App) shows ONLY direct children where
`parent_session_id == current_session_id`. Main/Architect view shows only Managers
or Workers called directly — never grandchildren or Workers nested under a Manager.
Entering a Manager/Agent Session shows only that Session's direct children; deeper
descendants are lazy-loaded by level, never flattened into main. Mouse/click and
keyboard are required; back/breadcrumb preserve state/selection and allow Architect
→ Manager → Worker navigation (exact responsive details remain clarification).
Root-tree Ctrl+C still reaches all invisible descendants; visibility does not limit
control scope. Permissions/questions from deeper descendants that escalate to root
are a control-plane exception, not a card-flattening rule. Any prior requirement that
rendered a full root tree inside one Session view is superseded by direct-child-only
Session views with semantic parity across TUI/direct/App.

**Confirmed mandatory session-owned Todo.** Every goal-bearing Session (Architect,
Manager, Worker/agent/subagent, including simple tasks) owns exactly one Todo
aggregate. Requirements 1–20 in the Todo section below are product requirements;
hidden lifecycle agents remain clarification/exemption candidates.

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

### P1 — Live subagent and process panel

- As an operator, I want a read-only live card for every authorized **direct-child**
  subagent/process of the current Session so that queued, running, streaming,
  waiting, cancelling, and terminal work is understandable without opening each
  child, without flattening grandchildren into the current view.
- As an operator, I want the live panel to represent the Architect/Manager/Worker
  hierarchy and validation statuses for the authorized root so that orchestration
  roles and Worker execution are distinguishable without mixing sessions, while
  each Session view shows only direct children.
- As a user, I want usage provenance and missing-data states to be honest so that an
  unavailable live usage signal never appears as a false zero.
- As a user, I want the panel to remain bounded, reconnectable, accessible, and
  isolated between subagents so that high update rates do not degrade execution or
  disclose another session's data.

### P1 — Hierarchical Session navigation

- As an operator, I want Main/Architect to show only directly called Managers or
  Workers so that nested Workers under a Manager never appear as main-level cards.
- As an operator, I want opening a Manager Session to show only that Manager's direct
  Workers, and opening a Worker to show only its direct children if permitted, so
  that depth is lazy-loaded by level.
- As a user, I want back/breadcrumb navigation that preserves state/selection across
  Architect → Manager → Worker so that hierarchical browsing is reversible.

### P1 — Mandatory session-owned Todo

- As a user, I want every goal-bearing Session — including simple tasks and
  subagents — to own a durable Todo snapshot so that work cannot start empty or
  complete while required items remain open.
- As an operator, I want Todo to rehydrate after compaction, restart, and resume with
  the same version so that message summary cannot replace work authority.
- As a parent Architect/Manager, I want my own dispatch/validation Todo while only
  observing child TodoRef/version/counts, never editing child lists.
- As a user, I want each Session UI to show that Session's Todo even when idle, so
  incomplete durable work is never hidden by cache eviction or idle state.

### P1 — Root-tree cancellation

- As an operator, I want Ctrl+C during execution to request cancellation of the current
  root process tree so that main, foreground/background agents, and subagents stop
  through one native lifecycle boundary, including descendants not currently visible
  in the direct-child Session UI.
- As a user, I want Esc to remain dismiss/back/navigation and not cancel a root tree so
  that modal and browsing behavior remains safe and predictable.
- As an operator, I want cancellation acknowledgement and unknown remote effects
  visible on every affected card so that cancellation is not confused with OS kill or
  mutation reversal.

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
   When hierarchical Smart Routing is active, envelopes MUST carry hierarchy role,
   delegation depth/path when known, and validation-related outcome fields needed for
   Process Table projection, without prompts or complete outputs.
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
    IDs, subject to redaction and authorization. When Smart hierarchical routing is
    active, each row MUST also retain hierarchy role (`architect` | `manager` |
    `worker`), delegation depth and path, selected route path when known, fanout
    requested versus granted when applicable, and validation state at that node,
    without using high-cardinality IDs as metric labels.
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
    When a Manager requests Worker fanout under Feature 001 hierarchical routing,
    admission MUST grant total or partial concurrency under those limits and MUST
    expose requested versus granted fanout in lifecycle projection; dynamic request
    MUST NOT imply unbounded concurrency.
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
48. Architect/Manager orchestration observations of “decided to dispatch”,
    “validating”, or “escalating” MUST remain distinct from Worker/executor events
    showing “started” or “completed”. Hierarchy role and validation state MUST not be
    collapsed into a generic status update.

### Operator management

**Normative transversal rule (Feature 007 Operator Control Plane).** All setup,
configuration, and management for process/task control MUST use
[Feature 007](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
unified Operator Control Plane and native Settings/menu/palette/native-slash/CLI/App/
Desktop adapters calling typed core domain commands/queries directly. MUST NOT use
Config.command/custom templates, `session.command` prompt path, ToolRegistry, MCP
tools/prompts, plugins, skills, shell commands issued by an LLM, or free-form model
instructions as management authority. Native slash is intercepted before prompt
admission/transcript; zero provider/model calls/tokens/cost by default; output not
added to Message/Part/context by default. Mutations require operator principal,
explicit scope, version/CAS, idempotency, and audit; secret refs only. Canonical
process/task IDs: `process/task` status, tree, watch, cancel, steer, handoff. Todo
work-item semantic updates remain restricted runtime data plane under permission/CAS;
Todo policy/exemptions/retention/override, required-list clear, completion-gate
bypass, and child Todo edit are not model-setup paths. Plugin/MCP/custom registries
MUST NOT register reserved operator IDs.

49. Future TUI/App/API/CLI views MAY expose tree, status, watch, and health with
    redacted status, attempt, owner, model, timing, cost, and lifecycle details only
    within authorized scope via Feature 007 adapters; exact surface chrome remains
    clarification while canonical IDs are fixed by Feature 007.
50. Administrative commands MUST be native operator-only interfaces registered in the
    Feature 007 operator command registry, not LLM, tool, MCP, or prompt-template
    interfaces. Final display aliases remain clarification; reserved IDs are not open.
51. Cancel, handoff, and steer MUST use native services through Feature 007 typed
    commands, require authorization, and publish audit events. No action may be
    performed directly by editing the Process Table or by an observer.

### Live subagent/process panel and hierarchical Session UI

52. The system MUST provide a read-only panel/card projection for each authorized
    **direct child** of the current Session while it is `queued`, `running`,
    `streaming`, `waiting`, or `cancelling`, and MUST retain a bounded terminal card
    after completion, failure, cancellation, or unknown outcome. Process Table MAY
    retain the full authorized Architect/Manager/Worker tree internally. Session views
    MUST NOT flatten grandchildren into the current render. The panel MUST NOT mix
    sessions or invent routing authority.
53. Each card MUST expose, when available and authorized: todo progress
    (ref/version/counts when known); agent name and type; foreground/background Task
    role; hierarchy role (`architect` | `manager` | `worker`) when hierarchical
    routing is active; validation status when known; bounded description; textual
    status; bounded/redacted current activity; model/provider/variant; normalized
    reasoning and task effort; input/output/reasoning/cache-read/cache-write tokens;
    usage provenance (`estimated` or `reported`) and source (`provider`, `runtime`, or
    `local-estimate`); live elapsed time from monotonic timestamps; valid tokens/s;
    output cursor/reference; and terminal outcome with final usage.
54. The panel MUST use the local Process Table/Event projection as its source and MUST
    not query a remote OTEL backend on the UI hot path. The projection MUST support
    multi-subagent identity, reconnect reconstruction, and per-root/session isolation.
55. If live usage is unavailable, the panel MUST display `streaming/generating` and
    `tokens unavailable` or an equivalent explicit unavailable state; it MUST NOT show
    zero or fabricate usage. Estimates MUST be optional and labeled. Provider-reported
    usage MUST reconcile and replace an estimate at settlement. Unknown token fields
    MUST NOT be summed.
56. Current activity MUST use an allowlisted enum/structure such as `Read relative/path`,
    `Edit`, `Run command`, `Waiting`, and `Generating`, with workspace-relative or
    redacted paths. Prompts, reasoning text, raw tool input/output, secrets, absolute
    paths, sensitive queries, and URLs MUST never reach the renderer by default.
57. Live events MUST be coalesced or throttled. Terminal, cancellation, and tool
    boundaries MUST have priority. A slow panel subscriber MUST NOT block an executor,
    SessionRunner, or lifecycle producer.
58. The panel MUST support narrow-terminal responsive layout, keyboard navigation,
    mouse/click enter into a child Session, expand/collapse, text states independent of
    color, and screen-reader semantics in App surfaces. An output cursor/reference MAY
    open or expand authorized content; complete output MUST not be loaded by default.
    [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) owns the definitive OutputRef/cursor
    contract.
    58a. Each Session view (TUI, direct/mini, App) MUST show only sessions/processes where
    `parent_session_id == current_session_id`. Main/Architect view MUST show only
    Managers or Workers called directly and MUST hide Workers nested under a Manager.
    Opening a Manager/Agent Session MUST show only that Session's direct children;
    deeper descendants MUST be lazy-loaded by level. Back/breadcrumb MUST preserve
    state/selection and support Architect → Manager → Worker navigation (exact
    responsive breadcrumb UX remains clarification). TUI/direct/App MUST converge
    semantically on direct-child-only Session views.
    58b. Permissions/questions that escalate from deeper descendants to the root MAY surface
    as control-plane exceptions on the authorized root without flattening those
    descendants' cards into the main Session view.

### Mandatory session-owned Todo

58c. Each Session MUST own exactly one Todo aggregate. Parent, child, and sibling
Sessions MUST never share a list. Goal-bearing Architect, Manager, Worker/agent/
subagent Sessions — including simple tasks — MUST apply the Todo requirements
below. Hidden lifecycle agents (title/summary/compaction) are clarification/
exemption candidates and MUST NOT be pretended to already use Todo tools.
58d. Before goal-bearing execution or dispatch, the Session MUST have a non-empty
durable Todo snapshot. Simple tasks MUST use at least one bounded item. An empty
list MUST NOT bypass the gate. While executable work remains, exactly one item
MUST be `in_progress`. Updates MUST persist on real semantic transitions, not
per-token loops.
58e. Future schema MUST support stable item ID, objective, typed status/priority,
owner Session/role, version/CAS, result/evidence/OutputRefs, aggregate
outcome/timestamps. Final field details remain clarification/plan.
58f. Snapshot/version MUST be durable outside message prose and compaction and is the
authority of logical work. Prompt/context builders MUST rehydrate the same
snapshot/version after compaction, restart, resume/replay, and before the next
turn. Textual summary MUST NOT diverge from or replace the snapshot.
58g. Handoff/dispatch envelopes MUST carry TodoRef, version, bounded authorized
summary, and Lang Lock tag/version. [Feature 005 OutputSpool](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) MUST pass
result/evidence/handoff via refs/slices, not full content.
58h. Completion gate: Session/Task MUST NOT terminate as `completed` while required
items are pending/in_progress, version mismatches, or a validation step is
missing. The system MUST record `todo.completion_blocked`. Failure/cancel MUST
preserve incomplete items and aggregate outcome/reason and MUST NOT falsely
convert them to completed. Operator override, if any, remains clarification and
MUST be audited.
58i. Parent Architect/Manager MUST keep their own dispatch/validation Todo. They MAY
observe child summary/ref/version/counts; when the operator opens a child Session,
that Session's authorized list is visible. Parent model MUST NOT edit child Todo.
Worker completion MUST NOT complete Manager; Manager validates Workers/synthesizes
and completes its Todo; Architect validates Manager or direct Worker and completes
its own.
58j. Sibling isolation MUST apply before API/event/projection. Cross-root/project leak
is a failure. Native policy MUST eventually allow Todo tool/operation for all
goal-bearing primary/agents/subagents; prompt-only is insufficient. Existing
subagent `todowrite` denial is a migration gap and MUST be covered by acceptance
tests that assert target availability despite legacy deny.
58k. Process Table MUST observe todo_ref/version/counts/consistency/outcome and MUST
NOT execute or edit Todo. Todo MUST NOT schedule or cancel Tasks.
58l. UI of each Session MUST display its Todo, including child Sessions, and MUST NOT
clear or hide incomplete durable Todo when idle. App idle cache eviction MUST NOT
erase incomplete durable Todo authority. Completed retention/archive remains
clarification.
58m. Todo events MUST include initialized, updated, completed, completion_blocked,
failed, cancelled, stale, rehydrated, handoff_attached, plus compaction
correlation. OTEL MUST export only enums/counts/buckets — no content or IDs as
labels. Objective/item/progress/result/failure/handoff text follows Feature 004
Lang Lock; UI chrome does not.

### Ctrl+C root-tree cancellation

59. Esc MUST remain dismiss, back, close-modal, detail, or navigation behavior and
    MUST NOT cancel the current root process tree.
60. Ctrl+C during execution MUST request native cancellation of the current root
    process tree, including the main context and foreground/background agents and
    subagents in `queued`, `waiting`, or `running` state, **including descendants not
    currently visible** in the direct-child Session UI. Visibility MUST NOT limit
    control scope. It MUST not affect another root session or project.
61. After a root cancel request, admission MUST reject or quarantine new descendants
    of that root. Propagation and acknowledgement MUST use native lifecycle APIs,
    Event Bus, and Process Table state, never an LLM command, tool, prompt, or MCP call.
62. Affected cards MUST expose `running`/`streaming` → `cancelling` → `cancelled`,
    `failed`, or `unknown`, preserving committed progress and output. A provider,
    tool, or remote process effect MAY remain unknown; cancellation MUST NOT promise
    remote kill, reversal, or mutation rollback.
63. Cancelling an active scheduled occurrence MUST cancel that occurrence/process only;
    it MUST NOT disable or delete the future Job Definition.
64. Root-tree cancellation MUST request seal or abort of OutputSpool writers while
    preserving committed bytes. [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
    owns the content-plane seal/abort/settlement contract (OutputRef, cursor, committed
    bytes). Feature 002 owns lifecycle terminal status and MUST NOT mark Task terminal
    as successfully settled without Feature 005 settlement or an explicit intermediate
    settling/unknown/corrupt condition.
65. The system MUST distinguish first versus second Ctrl+C and behavior in idle input,
    modal/dialog, PTY, copy-selection, and platform-specific terminal contexts. Timeout
    and escalation behavior remain clarification questions.

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
- **Panel boundedness:** live update frequency, card count, terminal retention,
  description/activity lengths, and subscriber buffers MUST be bounded and observable;
  coalescing MUST preserve terminal and cancellation transitions.
- **Usage accuracy:** usage fields MUST carry provenance and source; missing live usage
  MUST remain unavailable, estimates MUST be labeled, and settlement reconciliation
  MUST be deterministic and idempotent.
- **Interaction safety:** Ctrl+C MUST target only the current authorized root tree;
  Esc MUST remain navigation/dismissal; cancellation MUST use native lifecycle APIs
  and preserve committed output.
- **Accessibility:** panel status MUST be textual, keyboard navigable, responsive in
  narrow terminals, and semantically exposed to screen readers without color-only
  meaning.
- **Hierarchy projection fidelity:** Process Table and live panel MUST distinguish
  Architect, Manager, and Worker roles and their validation states for the authorized
  root without session mixing or claiming routing authority owned by Feature 001.
- **Direct-child Session UI:** TUI, direct/mini, and App Session views MUST show only
  direct children of the current Session; Process Table MAY retain full authorized
  tree for observation/control; grandchildren MUST never flatten into main.
- **Mandatory session-owned Todo:** non-empty snapshot before goal-bearing work,
  exactly one `in_progress` while work remains, durable version authority,
  completion gate, rehydration after compaction/restart, sibling isolation, and
  Process Table observation without Todo mutation MUST hold for Architect, Manager,
  and Worker goal-bearing Sessions.

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
23. **Multi-subagent panel.** Given multiple authorized foreground/background
    **direct-child** subagents of the current Session, when their processes are
    queued, running, streaming, waiting, or cancelling, then separate cards show
    agent, role, description, status, activity, model identity, progress, and
    acknowledgement without mixing sessions or showing grandchildren.
    23a. **Hierarchy tree panel (direct children only).** Given an Architect root with a
    Manager and Workers (or a direct Worker path), when the main Session view
    renders, then it shows only Managers or Workers called directly, hides Workers
    nested under a Manager, exposes hierarchy role and validation status for visible
    cards, and does not mix another session or root.
    23b. **Open Manager shows direct Workers.** Given a Manager with Workers, when the
    operator opens the Manager Session, then only that Manager's direct Workers
    appear; deeper descendants remain hidden until their parent Session is opened.
    23c. **Open Worker shows direct children.** Given a Worker with permitted direct
    children, when the operator opens that Worker Session, then only those direct
    children appear.
    23d. **Back/breadcrumb state.** Given navigation Architect → Manager → Worker, when
    the operator uses back/breadcrumb, then prior Session view state and selection
    are preserved without flattening the tree.
    23e. **Direct Architect→Worker UI.** Given a direct Worker path without Manager, when
    the main Architect Session renders, then the Worker appears as a direct child
    card and no Manager level is invented.
    23f. **Full-tree cancel with direct-only visible UI.** Given invisible Manager Workers
    under the root, when Ctrl+C cancels the root tree, then all permitted descendants
    including invisible ones transition through cancelling while the main view still
    shows only direct children.
24. **High update rate.** Given a burst of live events, when the panel subscriber is
    slower than the producer, then updates coalesce/throttle, terminal/tool/cancel
    boundaries remain visible, and execution is not blocked.
25. **Missing live usage.** Given no live usage signal, when a card renders during
    streaming, then it says `streaming/generating` and `tokens unavailable` rather
    than showing zero or an invented number.
26. **Final reconciliation.** Given an optional local estimate followed by provider
    settlement, when the terminal event arrives, then reported usage replaces the
    estimate with provenance/source and unknown fields are not summed.
27. **Disconnect/reconnect.** Given a panel disconnect and reconnect, when local
    projection state is rebuilt, then authorized cards and usage provenance reconstruct
    without duplicate or cross-root content.
28. **Path redaction.** Given tool activity containing an absolute path, command,
    query, URL, prompt, or payload, when current activity reaches the renderer, then
    only an allowlisted bounded redacted/relative representation is shown.
29. **Root-tree Ctrl+C.** Given a current root with main, foreground/background agents,
    and queued/waiting/running subagents, when Ctrl+C requests cancellation, then all
    permitted descendants transition through cancelling and a terminal outcome while
    another root/project is unchanged.
30. **Descendant admission block.** Given a root cancellation request, when a child
    attempts admission, then it is rejected/quarantined and the rejection is visible
    in the lifecycle projection.
31. **Esc isolation.** Given a detail, modal, navigation, or input view, when Esc is
    pressed, then it dismisses/navigates/backs according to context and does not cancel
    the root tree.
32. **Remote unknown.** Given a provider/tool/remote effect during cancellation, when
    the local lifecycle settles, then unknown is shown where remote termination is
    unconfirmed and no false kill or rollback is reported.
33. **Scheduled occurrence.** Given an active scheduled occurrence, when root Ctrl+C
    cancels it, then only that occurrence/process is cancelled and the future Job
    Definition remains enabled.
34. **Accessibility.** Given keyboard-only, monochrome, narrow-terminal, and App
    screen-reader contexts, when cards update, then status/action meaning remains
    textual, navigable, responsive, and not color-dependent.
35. **Terminal retention.** Given a completed/failed/cancelled process, when bounded
    retention applies, then its final outcome, committed progress, final usage, and
    cancellation acknowledgement remain visible until policy cleanup.
36. **Missing telemetry.** Given OTEL is unavailable, when the panel renders, then
    local Process Table/Event projection continues to show lifecycle state without a
    remote telemetry query or blocked executor.
37. **Output reference.** Given a card has authorized output, when expand/open is
    requested, then it uses a bounded cursor/reference and does not load complete
    output; the [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) writer/content contract remains explicit.
38. **Simple singleton Todo.** Given a simple goal-bearing Session, when execution
    starts, then a non-empty session-owned Todo with at least one bounded item exists
    and empty-list bypass is rejected.
39. **Subagent Todo migration.** Given a goal-bearing subagent under legacy policy
    that denies `todowrite`, when the target native Todo policy is applied, then that
    subagent Session still has an available session-owned Todo path; the legacy deny
    is treated as a migration gap covered by test.
40. **Premature completion blocked.** Given required Todo items pending or
    in_progress, when Session/Task attempts `completed`, then completion is blocked
    and `todo.completion_blocked` is recorded.
41. **Compaction rehydrates same version.** Given durable Todo snapshot version V,
    when compaction completes and the next turn builds context, then snapshot version
    V is rehydrated and textual summary does not replace it.
42. **Restart/resume snapshot survives.** Given durable Todo snapshot, when process
    restarts or Session resumes/replays, then the same snapshot/version is available
    before the next goal-bearing turn.
43. **Handoff read-only child ref.** Given parent dispatch/handoff, when the envelope
    is observed, then it carries child TodoRef/version and bounded summary while the
    parent model cannot edit the child Todo.
44. **Sibling/cross-root isolation.** Given two sibling or cross-root Sessions, when
    Todo API/event/projection is requested, then only the authorized Session list is
    delivered and no cross leak occurs.
45. **Cancel preserves incomplete Todo.** Given incomplete Todo items, when Session
    or process is cancelled, then incomplete items and aggregate outcome/reason are
    preserved and not falsely marked completed.
46. **App idle does not hide incomplete Todo.** Given incomplete durable Todo, when
    the Session becomes idle or App cache eviction runs, then incomplete Todo remains
    durable and is not cleared/hidden as empty by idle UI policy.
47. **Content-free Todo OTEL.** Given Todo lifecycle events, when metrics export,
    then only enums/counts/buckets are labeled and Todo content/IDs are absent from
    metric labels.

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
9. **Panel authorization.** Project/root/session/tree authorization and redaction MUST
   occur before panel projection, card rendering, output cursor access, or reconnect
   reconstruction. Operator/manager principal policy remains an explicit gap for
   clarification/ADR.
10. **Cancellation authorization.** Ctrl+C cancellation MUST use the canonical
    permission and lifecycle authority, reject descendants after the root request, and
    never imply remote kill, rollback, or access to another root/project.
11. **Content minimization.** Absolute paths, prompts, reasoning text, raw tool
    payloads/output, secrets, sensitive query/URL values, and uncommitted output MUST
    remain outside cards and renderer payloads by default.
12. **Todo isolation and authority.** Todo aggregates MUST be session-scoped and
    authorized before get/update/projection. Parent models MUST NOT edit child Todo.
    Process Table observation MUST NOT become Todo mutation. Sibling and cross-root
    Todo access is denied.
13. **Todo content privacy.** Objective/item text, results, and evidence content MUST
    not become metric labels or default exported OTEL content; refs/slices and
    bounded summaries apply under redaction and Feature 004 Lang Lock for text axes.

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
confidence, and TTL; it does not query a backend per Task. Architect/Manager dispatch, validation, and escalation observations remain distinct
from Worker/executor start/completion events. Hierarchy role, delegation path, fanout
requested/granted, and validation states are projected with bounded labels.

Panel observability MUST include bounded state-transition, panel update/coalescing,
usage-provenance, reconnect, output-reference, hierarchical enter/back navigation,
and root-cancel metrics/spans. It MUST record cancellation request/ack/terminal/
unknown outcomes and descendant-admission rejections without IDs as metric labels or
content payloads. The panel reads local Process Table/Event projection; OTEL is
export/diagnostic evidence and never the UI hot-path authority.

Todo observability MUST include initialized/updated/completed/completion_blocked/
failed/cancelled/stale/rehydrated/handoff_attached events with compaction
correlation. Metrics use only enums/counts/buckets for status, consistency, and
outcome classes. Todo content and item/session IDs MUST NOT be metric labels.
Process Table may project todo_ref/version/counts/consistency/outcome without
executing Todo.

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
  their proposed status or decisions. Process Table and live panel MUST align with
  ADR-0002 hierarchical adaptive roles (Architect/Manager/Worker) as observation
  surfaces only; routing classification and role-pool configuration remain Feature
  001 ownership.
- Existing TUI child discovery/subagent footer, direct/mini footer, and App timeline
  remain compatibility baselines; the new panel is a lifecycle projection, not a
  replacement for transcript/timeline rendering. Direct-child Session UI supersedes
  any prior full-root-tree-in-one-view behavior (including the TUI
  `parentID = session.parentID ?? id` sibling/root discovery pattern) and requires
  semantic parity across TUI/direct/App.
- Existing Esc and session interrupt behavior remain distinct until the root-tree
  Ctrl+C policy is implemented through native lifecycle APIs. Feature 003 scheduled
  occurrences use the same cancellation boundary without disabling definitions and
  each executable occurrence owns its own Todo.
- Existing Todo schema/table/update, subagent `todowrite` denial, compaction without
  Todo rehydration, missing completion gate, and App idle cache clear of Todo are
  migration baselines documented in research.md; target policy is session-owned
  mandatory Todo with durable rehydration and completion gate.
- [Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) owns the content-plane OutputRef/cursor, seal/abort, committed-byte, and settlement contract.
  Feature 002 owns lifecycle terminal status and Process Table projection of bounded refs only.
  Shared clarify remains limited to terminal↔settlement ordering, crash reconciliation between FS and control metadata, and generation fencing — not redefinition of either ownership boundary.

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
- Owning the Feature 005 content-plane seal/abort/settlement contract, or loading
  complete output into a live card (bounded OutputRef/cursor only).
- Treating OTEL remote data as the panel source or adding LLM/tool/MCP administration
  to panel or cancellation controls.
- Owning Smart Agent Routing classification, role-pool configuration, or validation
  acceptance criteria (Feature 001 / ADR-0002). Feature 002 only projects hierarchy
  role, fanout, and validation states for observation, owns direct-child Session UI
  projection, and owns session-owned Todo lifecycle authority/observation seams.
- Flattening the full authorized tree into Main/Architect Session cards.
- Sharing one Todo list across parent/child/sibling Sessions, treating Process Table
  as Todo editor/executor, or using prompt-only Todo without durable snapshot/version.

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
22. Which operator/manager principal and permission authority may view cards, expand
    OutputRef/cursors, or request root cancellation, and what remains an explicit
    Feature 001/ADR authorization gap?
23. What is the exact first versus second Ctrl+C behavior and timeout/escalation policy?
24. How do Ctrl+C and Esc behave in idle input, active input, modal/detail/navigation,
    PTY/shell, copy-selection, and platform-specific terminal contexts?
25. Which native lifecycle API owns root cancellation propagation and acknowledgement,
    and how are queued/waiting descendants fenced from new admission?
26. What shared terminal↔settlement ordering, intermediate settling states, and FS↔control
    reconciliation algorithm integrate Feature 002 lifecycle terminal status with the
    [Feature 005](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) content-plane
    seal/abort/settlement contract (Feature 005 owns seal/abort/OutputRef/cursor/committed
    bytes; Feature 002 owns terminal lifecycle — do not reopen that ownership split)?
27. What exact live usage schema and provider/runtime/local-estimate provenance rules
    apply to token fields, effort, tokens/s validity, and settlement reconciliation?
28. What card update coalescing/throttle, terminal-retention, responsive narrow-layout,
    keyboard-navigation, and screen-reader quantitative limits form the acceptance
    matrix?
29. What Process Table and panel field schema projects hierarchy role, delegation
    depth/path, fanout requested/granted, and validation state without inventing
    routing authority or high-cardinality metric labels?
30. How are Architect/Manager orchestration events distinguished from Worker executor
    events in Event Bus vocabulary while remaining one lifecycle system?
31. What exact breadcrumb UX, responsive truncation, and selection restoration apply
    for Architect → Manager → Worker navigation across TUI/direct/App?
32. What Todo schema fields, CAS conflict rules, failure status model, archive/
    retention/reopen policy, and quantitative item limits are final?
33. What pure social/no-goal chat and hidden lifecycle agent exemptions apply to the
    non-empty Todo gate?
34. What operator completion override authorization and audit trail exist, if any?
35. How much child Todo content may a parent model observe versus ref/version/counts?
36. What permission/question escalation surfaces from deeper descendants to root
    without flattening cards?
37. What task/tool denial migration path converts legacy subagent `todowrite` deny
    into native goal-bearing Todo availability?

Confirmed Feature 001 hierarchy decisions, direct-child Session UI, and mandatory
session-owned Todo requirements are not reopened here; Feature 002 aligns
observation, projection, UI navigation, and Todo lifecycle authority.

## Related Decisions

- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 — Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — proposed sole management authority.
- [Plugin systems research](../../research/plugin-systems.md) — evidence only, not a decision.
- Future ADR required before plan/implementation: **Task Process Lifecycle and Operational Observation** (not created).
- Related scheduled-jobs feature: [003 Scheduled Jobs and Async Main-Context Notification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Related content-plane feature: [005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — owns content-plane seal/abort/settlement; Feature 002 owns lifecycle terminal.
- Related semantic retrieval feature: [006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — index job lifecycle and budget/wake projection only; lifecycle remains Feature 002.
- Related management foundation: [007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — process/task command IDs, auth, audit; not runtime execution authority.
- Related MCP runtime: [008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — MCP call/task children, progress UI, standard cancel vs tasks/cancel; lifecycle authority remains Feature 002.

## Initial Traceability Matrix

| Outcome                              | Requirements                     | Acceptance scenarios | Phase |
| ------------------------------------ | -------------------------------- | -------------------- | ----- |
| Canonical lifecycle ownership        | FR1–FR8, FR22–FR24               | 2, 6, 14, 22         | 1     |
| Segmented typed observation          | FR9–FR19                         | 2–5, 18              | 1     |
| Process Table projection             | FR25–FR29                        | 11, 13–15, 19        | 1     |
| Admission and bounded backpressure   | FR30–FR37                        | 1, 7–8, 20–21        | 1     |
| Watchdog and recovery safety         | FR38–FR42                        | 9–13                 | 1–2   |
| OTEL and routing evidence            | FR43–FR48                        | 12, 16–17, 20        | 1–2   |
| Operator management boundary         | FR49–FR51                        | 18, 22               | 2     |
| Live subagent/process panel          | FR52–FR58                        | 23–28, 34–37         | 1–2   |
| Direct-child hierarchical Session UI | FR52, FR58a–FR58b                | 23–23f, 29, 34       | 1–2   |
| Hierarchy role/validation projection | FR9, FR26, FR31, FR48, FR52–FR53 | 23, 23a, 16–17       | 1–2   |
| Mandatory session-owned Todo         | FR58c–FR58m                      | 38–47, 23e           | 1–2   |
| Root-tree Ctrl+C cancellation        | FR59–FR65                        | 29–33, 35, 23f       | 1–2   |
| Security and privacy                 | NFRs, security                   | 3–5, 11–18, 23–47    | 1–2   |
