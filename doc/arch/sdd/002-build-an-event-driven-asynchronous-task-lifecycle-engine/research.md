# Task Lifecycle Event Bus and Process Table Research

Feature: [002 Task Lifecycle Event Bus and Process Table](spec.md)

This note records current-core evidence separately from requirements and decisions.
It is not an ADR and does not authorize implementation. Requirements live in
`spec.md`; architectural decisions are reserved for a future ADR named there.

## Confirmed core facts

- Bun is the priority runtime. Effect fibers are the lightweight unit for concurrent
  asynchronous work. The current TaskTool enters the Effect runtime and BackgroundJob
  service at [`packages/opencode/src/tool/task.ts:81-92`](../../../../packages/opencode/src/tool/task.ts#L81-L92).
- Task V1 creates or reuses a child Session and uses process-local BackgroundJob;
  child-session creation and parent linkage are visible at
  [`packages/opencode/src/tool/task.ts:136-172`](../../../../packages/opencode/src/tool/task.ts#L136-L172).
  BackgroundJob stores active jobs in an in-memory state map and forks work into a
  scope at [`packages/core/src/background-job.ts:173-188`](../../../../packages/core/src/background-job.ts#L173-L188)
  and [`packages/core/src/background-job.ts:202-251`](../../../../packages/core/src/background-job.ts#L202-L251).
  V2 has SessionExecution, SessionRunCoordinator, and SessionRunner; there is no
  independent TaskV2 runtime in the observed lifecycle code.
- Session, parentID, and messages are durable. BackgroundJob and active executions
  are in memory; restart loses their process-local registry.
- SessionRunCoordinator serializes work per Session, permits distinct Sessions to run
  concurrently, and coalesces wakes; its active-key map, wake coalescing, and
  per-key drain are shown at
  [`packages/core/src/session/run-coordinator.ts:5-15`](../../../../packages/core/src/session/run-coordinator.ts#L5-L15)
  and [`packages/core/src/session/run-coordinator.ts:67-103`](../../../../packages/core/src/session/run-coordinator.ts#L67-L103).
- No global scheduler, `maxTasks`, `maxAgents`, or central admission authority was
  found in the current core search. The observed coordinator exposes only a per-key
  active set, run, wake, and interrupt contract at
  [`packages/core/src/session/run-coordinator.ts:5-15`](../../../../packages/core/src/session/run-coordinator.ts#L5-L15),
  while BackgroundJob owns a local job map at
  [`packages/core/src/background-job.ts:190-200`](../../../../packages/core/src/background-job.ts#L190-L200).
  This is an evidence boundary, not a requirement or a decision; the admission
  ownership question remains open.
- EventV2 distinguishes durable and live events through its durable aggregate reader
  and stream APIs at [`packages/core/src/event.ts:63-108`](../../../../packages/core/src/event.ts#L63-L108).
  Its global PubSub is unbounded at [`packages/core/src/event.ts:170-180`](../../../../packages/core/src/event.ts#L170-L180),
  while `allBounded` creates a subscriber-local dropping queue at
  [`packages/core/src/event.ts:152-164`](../../../../packages/core/src/event.ts#L152-L164).
  The server event handler currently selects a subscriber capacity at
  [`packages/server/src/handlers/event.ts:9-34`](../../../../packages/server/src/handlers/event.ts#L9-L34).
- SessionEvent is currently a schema re-export at
  [`packages/core/src/session/event.ts:1-2`](../../../../packages/core/src/session/event.ts#L1-L2);
  EventV2 durable/live behavior is therefore the observed event evidence rather than
  a claim that a Task lifecycle bus already exists.
- OpenTelemetry support is partial in the current core: endpoint/header inputs are
  exposed at [`packages/core/src/flag/flag.ts:16-17`](../../../../packages/core/src/flag/flag.ts#L16-L17),
  and the current exporter path focuses on trace OTLP HTTP setup at
  [`packages/core/src/observability/otlp.ts:7-71`](../../../../packages/core/src/observability/otlp.ts#L7-L71).
  Complete Task lifecycle spans, meters, and a Process Table are not established by
  the current core. This research note records the absence as evidence, not as a
  design decision.
- Canonical lifecycle points are TaskTool, BackgroundJob, SessionExecution,
  SessionRunCoordinator, SessionRunner, and EventV2.

## Current UI, usage, and cancellation evidence

- The TUI discovers child sessions from the synced session set and renders a
  `SubagentFooter` for child sessions at
  [`packages/tui/src/routes/session/index.tsx:1295-1297`](../../../../packages/tui/src/routes/session/index.tsx#L1295-L1297).
  It exposes child/background navigation around
  [`packages/tui/src/routes/session/index.tsx:1495-1515`](../../../../packages/tui/src/routes/session/index.tsx#L1495-L1515).
- The current TUI subagent footer derives sibling index/total from parentID and
  displays only last-message aggregate context/cost usage at
  [`packages/tui/src/routes/session/subagent-footer.tsx:11-55`](../../../../packages/tui/src/routes/session/subagent-footer.tsx#L11-L55).
  `DialogSubagent` currently offers only an Open action at
  [`packages/tui/src/routes/session/dialog-subagent.tsx:4-24`](../../../../packages/tui/src/routes/session/dialog-subagent.tsx#L4-L24).
- Todo state is rendered as a compact sidebar projection with status text/icon at
  [`packages/tui/src/feature-plugins/sidebar/todo.tsx:8-29`](../../../../packages/tui/src/feature-plugins/sidebar/todo.tsx#L8-L29)
  and [`packages/tui/src/component/todo-item.tsx:3-30`](../../../../packages/tui/src/component/todo-item.tsx#L3-L30).
- Direct/mini mode has an existing subagent inspector with running/completed/
  cancelled/error states and keyboard close/cycle/scroll behavior at
  [`packages/opencode/src/cli/cmd/run/footer.subagent.tsx:13-29`](../../../../packages/opencode/src/cli/cmd/run/footer.subagent.tsx#L13-L29)
  and [`packages/opencode/src/cli/cmd/run/footer.subagent.tsx:94-121`](../../../../packages/opencode/src/cli/cmd/run/footer.subagent.tsx#L94-L121).
  Its command panel has a distinct `subagent` command entry at
  [`packages/opencode/src/cli/cmd/run/footer.command.tsx:15-24`](../../../../packages/opencode/src/cli/cmd/run/footer.command.tsx#L15-L24).
- Direct/mini subagent data is bounded by bootstrap/call/commit/call/role/error
  limits and tracks tabs/details at
  [`packages/opencode/src/cli/cmd/run/subagent-data.ts:12-18`](../../../../packages/opencode/src/cli/cmd/run/subagent-data.ts#L12-L18)
  and [`packages/opencode/src/cli/cmd/run/subagent-data.ts:40-71`](../../../../packages/opencode/src/cli/cmd/run/subagent-data.ts#L40-L71).
  Shared direct-mode types distinguish footer phase, usage, interrupt, output kinds,
  and task snapshots at [`packages/opencode/src/cli/cmd/run/types.ts:75-140`](../../../../packages/opencode/src/cli/cmd/run/types.ts#L75-L140).
- The direct reducer computes usage by summing known input/output/reasoning/cache
  fields and suppresses non-positive totals at
  [`packages/opencode/src/cli/cmd/run/session-data.ts:134-160`](../../../../packages/opencode/src/cli/cmd/run/session-data.ts#L134-L160).
  This is evidence for usage handling, not proof that live usage exists for every
  provider or SDK path.
- The TUI main session uses the canonical child task part/session metadata and a
  timeline projection over synced messages/parts at
  [`packages/app/src/pages/session/timeline/message-timeline.tsx:92-98`](../../../../packages/app/src/pages/session/timeline/message-timeline.tsx#L92-L98)
  and [`packages/app/src/pages/session/timeline/message-timeline.tsx:309-329`](../../../../packages/app/src/pages/session/timeline/message-timeline.tsx#L309-L329).
  The projection derives active messages from incomplete assistant state at
  [`packages/app/src/pages/session/timeline/projection.ts:33-49`](../../../../packages/app/src/pages/session/timeline/projection.ts#L33-L49).
- V2 message projection records final tokens/cost at Step.Ended and streams text/tool
  boundaries through MessageUpdater at
  [`packages/core/src/session/message-updater.ts:209-228`](../../../../packages/core/src/session/message-updater.ts#L209-L228).
  The V2 runner publishes provider events live and settles tool fibers before the
  step settlement at [`packages/core/src/session/runner/llm.ts:232-275`](../../../../packages/core/src/session/runner/llm.ts#L232-L275)
  and [`packages/core/src/session/runner/llm.ts:316-344`](../../../../packages/core/src/session/runner/llm.ts#L316-L344).
  These are current live/settlement seams; they do not establish the new panel.
- `inputLabel()` currently returns description, command, filePath, pattern, query,
  URL, path, or prompt directly at
  [`packages/opencode/src/cli/cmd/run/subagent-data.ts:142-180`](../../../../packages/opencode/src/cli/cmd/run/subagent-data.ts#L142-L180).
  This is a confirmed redaction risk for a lifecycle card and must not be forwarded
  to the renderer without allowlisting and workspace-relative sanitization.
- Current TUI cancellation is split: the keymap assigns Esc to session interrupt at
  [`packages/tui/src/config/keybind.ts:93-99`](../../../../packages/tui/src/config/keybind.ts#L93-L99),
  the prompt command requires a second interrupt within its local window before
  calling `session.abort` at
  [`packages/tui/src/component/prompt/index.tsx:391-419`](../../../../packages/tui/src/component/prompt/index.tsx#L391-L419),
  and the renderer disables automatic Ctrl+C exit at
  [`packages/tui/src/app.tsx:194-204`](../../../../packages/tui/src/app.tsx#L194-L204).
  Existing behavior therefore does not yet implement root-tree cancellation; the
  feature requirement must use native lifecycle APIs and preserve these contextual
  distinctions until clarified.
- The external image supplied during investigation is reference material only. It is
  not an existing panel or component in this repository.

## Panel and cancellation evidence boundaries

- V1/session schema exposes normalized token fields including input, output, reasoning,
  and cache read/write at [`packages/schema/src/session.ts:20-35`](../../../../packages/schema/src/session.ts#L20-L35).
  The legacy V1 schema carries corresponding usage fields at
  [`packages/schema/src/v1/session.ts:250-260`](../../../../packages/schema/src/v1/session.ts#L250-L260)
  and [`packages/schema/src/v1/session.ts:476-485`](../../../../packages/schema/src/v1/session.ts#L476-L485).
- Session normalization accepts provider usage fields and maps them to normalized
  tokens/cost at [`packages/opencode/src/session/session.ts:338-376`](../../../../packages/opencode/src/session/session.ts#L338-L376).
  The AI SDK bridge emits usage, totalUsage, and reasoning events at
  [`packages/opencode/src/session/llm/ai-sdk.ts:44-116`](../../../../packages/opencode/src/session/llm/ai-sdk.ts#L44-L116)
  and [`packages/opencode/src/session/llm/ai-sdk.ts:158-183`](../../../../packages/opencode/src/session/llm/ai-sdk.ts#L158-L183).
  These facts support provenance/reconciliation requirements; they do not prove that
  every provider supplies valid live usage.
- The App timeline is message/part based and identifies active incomplete assistant
  work at [`packages/app/src/pages/session/timeline/projection.ts:33-49`](../../../../packages/app/src/pages/session/timeline/projection.ts#L33-L49),
  while child Task descriptions are derived from task-part metadata at
  [`packages/app/src/pages/session/timeline/message-timeline.tsx:92-98`](../../../../packages/app/src/pages/session/timeline/message-timeline.tsx#L92-L98).
  A lifecycle Process Table panel would be a new projection, not an existing App
  component.
- Direct/mini usage formatting currently sums known token fields and suppresses totals
  that are not positive at [`packages/opencode/src/cli/cmd/run/session-data.ts:134-160`](../../../../packages/opencode/src/cli/cmd/run/session-data.ts#L134-L160).
  Direct subagent inspection is bounded and session-based at
  [`packages/opencode/src/cli/cmd/run/subagent-data.ts:12-18`](../../../../packages/opencode/src/cli/cmd/run/subagent-data.ts#L12-L18)
  and [`packages/opencode/src/cli/cmd/run/subagent-data.ts:40-71`](../../../../packages/opencode/src/cli/cmd/run/subagent-data.ts#L40-L71).
- `inputLabel()` currently prefers unredacted description, command, filePath,
  filepath, pattern, query, URL, path, and prompt values at
  [`packages/opencode/src/cli/cmd/run/subagent-data.ts:142-180`](../../../../packages/opencode/src/cli/cmd/run/subagent-data.ts#L142-L180).
  This is evidence of a renderer-boundary redaction risk, not an approved panel
  representation.
- Current Esc/cancel behavior is context-specific: `session_interrupt` is bound to Esc
  at [`packages/tui/src/config/keybind.ts:93-99`](../../../../packages/tui/src/config/keybind.ts#L93-L99),
  the prompt interrupt counts a second press before calling session abort at
  [`packages/tui/src/component/prompt/index.tsx:391-419`](../../../../packages/tui/src/component/prompt/index.tsx#L391-L419),
  and the renderer disables automatic Ctrl+C exit at
  [`packages/tui/src/app.tsx:194-204`](../../../../packages/tui/src/app.tsx#L194-L204).
  Root-tree Ctrl+C, first/second press semantics, modal/PTY/copy/platform behavior,
  and escalation are not established by the current implementation and remain
  requirements/questions.

## Evidence boundaries

- These observations describe the current core at research time and may become stale
  as implementation changes.
- The proposed lifecycle bus must reuse the canonical points above and must not become
  a second executor, runtime, lifecycle loop, or EventV2 system.
- The Process Table described by Feature 002 is a proposed event projection, not a
  fact that the current core already provides.

## Related evidence

- [Feature 001 specification](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- [ADR-0001 — OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 — Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Plugin systems research](../../research/plugin-systems.md)

## Hierarchy observation alignment (Feature 001 / ADR-0002)

Feature 001 and ADR-0002 confirm hierarchical adaptive routing with Architect,
optional Manager, and Worker roles. Feature 002 does not own classification or role
pools. Observation seams that must align when those roles are active:

- Process Table rows and live panel cards project hierarchy role, delegation
  depth/path, fanout requested/granted, and validation state for the authorized root
  without mixing sessions.
- Session views show **direct children only**; Process Table may retain the full
  authorized tree for control-plane scope.
- Architect/Manager “decided to dispatch / validating / escalating” observations
  remain distinct from Worker executor start/completion events.
- Admission projection surfaces requested versus granted fanout under existing
  global/root/provider/agent/cost/token limits; unbounded concurrency is not implied.
- Hierarchy fields follow Feature 001/ADR-0001 cardinality rules: no high-cardinality
  IDs as metric labels.

These points refine projection requirements in `spec.md`; they do not rewrite Feature
002 scope or authorize implementation.

## Hierarchical Session UI evidence (confirmed gaps)

- **TUI direct-child/root discovery bug.** Session children are computed with
  `const parentID = session()?.parentID ?? session()?.id` and then filter
  `x.parentID === parentID || x.id === parentID` at
  [`packages/tui/src/routes/session/index.tsx:207-212`](../../../../packages/tui/src/routes/session/index.tsx#L207-L212).
  On a root Session this collapses to parentID = current id (intended direct
  children). On a child Session it uses the **parent's** id, so the view shows
  **siblings of the current Session** (same parent) rather than direct children of
  the current Session. This is the confirmed full-root / sibling-tree bug that
  direct-child-only Session UI must correct.
- **Child sidebar / prompt visibility disabled on child.** Permissions, questions,
  and main prompt visibility are gated off when `session()?.parentID` is set at
  [`packages/tui/src/routes/session/index.tsx:228-235`](../../../../packages/tui/src/routes/session/index.tsx#L228-L235)
  and SubagentFooter is shown only for parented sessions at
  [`packages/tui/src/routes/session/index.tsx:1295-1297`](../../../../packages/tui/src/routes/session/index.tsx#L1295-L1297).
  Child Session Todo/panel ownership for hierarchical navigation is therefore not
  yet a first-class Session view.
- **App direct timeline/back.** App timeline derives parentID and navigates back to
  parent via `navigate(href(parentID))` at
  [`packages/app/src/pages/session/timeline/message-timeline.tsx:295-302`](../../../../packages/app/src/pages/session/timeline/message-timeline.tsx#L295-L302)
  and [`packages/app/src/pages/session/timeline/message-timeline.tsx:784-789`](../../../../packages/app/src/pages/session/timeline/message-timeline.tsx#L784-L789).
  This supports enter/back navigation but is not yet a full hierarchical Process
  Table panel with direct-child-only cards and breadcrumb state.
- **Direct children API, no recursive enter panel.** Session service exposes
  `children(parentID)` filtering `SessionTable.parent_id` at
  [`packages/opencode/src/session/session.ts:598-605`](../../../../packages/opencode/src/session/session.ts#L598-L605)
  and HTTP `session.children` at
  [`packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:82`](../../../../packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L82)
  / handlers at
  [`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:91`](../../../../packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L91).
  Direct children exist as an API, but there is no recursive enter/lazy-level
  Process Table Session UI that uses only direct children at each level.
- **Session parent/root V1/V2 gaps.** V2 Session schema carries optional `parentID`
  only at [`packages/schema/src/session.ts:21`](../../../../packages/schema/src/session.ts#L21)
  without a durable root_session identity field. V1 session similarly uses optional
  `parentID` at [`packages/schema/src/v1/session.ts:550`](../../../../packages/schema/src/v1/session.ts#L550).
  Parent/root process tree projection for hierarchy therefore remains a Feature 002
  seam, not an established complete identity model.

## Session-owned Todo evidence (confirmed gaps)

- **Todo schema/table/update.** Schema `SessionTodo.Info` is content/status/priority
  only (no stable item ID, owner role, version/CAS, result/OutputRefs) at
  [`packages/schema/src/session-todo.ts:7-15`](../../../../packages/schema/src/session-todo.ts#L7-L15).
  Core update deletes and reinserts rows per Session at
  [`packages/core/src/session/todo.ts:32-57`](../../../../packages/core/src/session/todo.ts#L32-L57)
  and table definition at
  [`packages/core/src/session/sql.ts:100-115`](../../../../packages/core/src/session/sql.ts#L100-L115).
  Event type is only `todo.updated` today.
- **Subagent todowrite denial.** Subagent session permissions default-deny
  `todowrite` unless explicitly allowed at
  [`packages/opencode/src/agent/subagent-permissions.ts:11-25`](../../../../packages/opencode/src/agent/subagent-permissions.ts#L11-L25);
  task tool repeats the deny at
  [`packages/opencode/src/tool/task.ts:144-146`](../../../../packages/opencode/src/tool/task.ts#L144-L146);
  native `general` agent denies `todowrite` at
  [`packages/opencode/src/agent/agent.ts:188`](../../../../packages/opencode/src/agent/agent.ts#L188).
  This is the confirmed migration gap for mandatory goal-bearing subagent Todo.
- **Compaction does not rehydrate Todo.** Compaction rebuilds message history and
  summaries at
  [`packages/core/src/session/compaction.ts`](../../../../packages/core/src/session/compaction.ts)
  and continues turns after compaction at
  [`packages/core/src/session/runner/llm.ts:153-216`](../../../../packages/core/src/session/runner/llm.ts#L153-L216)
  without reading or re-injecting SessionTodo snapshot/version into the prompt/
  context builder. Todo is not rehydrated as work authority after compaction.
- **No completion gate.** Todo update publishes `todo.updated` only; there is no
  `todo.completion_blocked` event or Session/Task completion check against pending/
  in_progress items in the observed Todo service or runner seams.
- **App idle cache clear.** App session cache eviction deletes `store.todo[sessionID]`
  via `dropSessionCaches` at
  [`packages/app/src/context/global-sync/session-cache.ts:24-39`](../../../../packages/app/src/context/global-sync/session-cache.ts#L24-L39)
  and server-session `evict` at
  [`packages/app/src/context/server-session.ts:417-429`](../../../../packages/app/src/context/server-session.ts#L417-L429).
  Idle/cache policy can clear client Todo projection; target requirements forbid
  hiding incomplete durable Todo when idle.
- **TUI Todo sidebar.** Compact Todo sidebar projection exists at
  [`packages/tui/src/feature-plugins/sidebar/todo.tsx:8-29`](../../../../packages/tui/src/feature-plugins/sidebar/todo.tsx#L8-L29)
  and App dock at
  [`packages/app/src/pages/session/composer/session-todo-dock.tsx`](../../../../packages/app/src/pages/session/composer/session-todo-dock.tsx).
  These are UI projections only and do not establish mandatory gates, versioned
  rehydration, or hierarchical parent/child Todo isolation.

These evidence points justify the direct-child UI and mandatory Todo requirements in
`spec.md`. They do not authorize implementation.

## Feature 007 native-only control plane (factual cross-ref)

Process/task operator control (status, tree, watch, cancel, steer, handoff) is
native-only via
[Feature 007 Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
and [ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md)
(proposed). Vocabulary: **control plane** = authorized native operator commands and
audit; **runtime data plane** = lifecycle execution plus session-owned Todo work-item
semantic updates under permission/CAS (not Todo policy/setup mutation). This note does
not restate Feature 007 requirements.
