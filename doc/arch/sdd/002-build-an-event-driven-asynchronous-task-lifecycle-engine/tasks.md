# Tasks: Build An Event Driven Asynchronous Task Lifecycle Engine

Ordered, measurable work breakdown derived from `plan.md` slices S0–S17,
`data-model.md`, `contracts/ports.ts`, and the `doc/arch/schemas/lifecycle/*.cue`
mirrors. Every task stays inside the `specScopeGlobs` declared in
`doc/arch/speckit.toml`. Phase 1 (schema/protocol) is additive and non-breaking; no
runtime behavior changes until Phase 2 wiring. The Process Table is a read-only
in-memory projection over the single EventV2 authority (C2) and publishes nothing back
(FR18). All `process.*`/`task.*` operator surfaces register through the Feature 007
registry (C19); Feature 002 supplies typed domain implementations and audit events
only and never holds management authority of its own.

## Task Breakdown

### Schema and protocol foundation (Phase 1)

- [x] T001 [S0] Author `packages/schema/src/lifecycle/ids.ts` and
  `packages/schema/src/lifecycle/correlation-ids.ts` with the branded identifiers from
  `data-model.md`: `TaskId`, `ProcessId`, `ParentProcessId`, `RootProcessId`,
  `SessionId`, `ParentSessionId`, `RootSessionId`, `RuntimeInstanceId`, `LeaseId`,
  `EventId`, `CorrelationId`, `CausationId`, `DecisionId`, `TurnId`, `AgentName`,
  `ModelId`, `ProviderName`, `VariantName`, `TodoRef`, `TodoVersion`; each a
  `Schema.String.pipe(Schema.brand("Lifecycle.*"))` mirroring `ids.cue` and
  `correlation.cue` one-to-one, with no cross-feature import (FR7, C8, C15).
- [x] T002 [S0] Author `packages/schema/src/lifecycle/values.ts` and
  `packages/schema/src/lifecycle/usage-values.ts` with the shared value objects:
  `Sequence`, `Attempt`, `Generation`, `SchemaVersion`, `DelegationDepth`,
  `FanoutCount`, `ItemCount`, `Reason`, `Description`, `ActivityLabel`, `TokenCount`,
  `CostUsd`, `ElapsedMs`, `DurationMs`, `TokensPerSecond`, `TraceId`, `SpanId`,
  `OutputRef`, `Cursor`, `Confidence`, reusing `PositiveInt`/`NonNegativeInt`/
  `Schema.Finite` from `packages/schema/src/schema.ts` and mirroring `values.cue` and
  `usage-values.cue` (FR26, C21).
- [x] T003 [S0] Author `packages/schema/src/lifecycle/enums.ts` with the ten-member
  `ProcessState`, the 26-member `LifecycleEventType` (prefixed `lifecycle.*`),
  `EventClass` (`durable`/`live`), `TerminalReason`, `SettlementState`, `Visibility`,
  `AgentKind`, and `ActorKind` as `Schema.Literals([...])`, mirroring `enums.cue`
  (FR20, FR25, C4, C7, C20).
- [x] T004 [S0] Author `packages/schema/src/lifecycle/enums-observation.ts` with
  `UsageProvenance`, `UsageSource`, `ActivityKind`, `HierarchyRole`,
  `ValidationOutcome`, `AnomalyKind`, `CancelOutcome`, `WatchdogOutcome`,
  `AdmissionScope`, `AdmissionDecision`, and `ObservationKind`, mirroring
  `enums-observation.cue` (C9, C11, C14, C15, C17, C21).
- [x] T005 [S1] Author `packages/schema/src/lifecycle/envelope.ts` composing the
  bounded sub-structs `EventKind`, `TreeIdentity`, `ProcessIdentity`, `Ordering`,
  `Delivery`, and `HierarchyContext` into `LifecycleEnvelope`, with `hierarchy` as
  `Schema.NullOr(HierarchyContext)` present only when Smart hierarchical routing is
  active and `redacted_metadata` as a bounded `Schema.Record`, mirroring
  `envelope.cue`/`envelope-parts.cue`/`envelope-hierarchy.cue` (FR9, FR13, C15).
- [x] T006 [S3] Author `packages/schema/src/lifecycle/usage.ts` with `TokenBreakdown`
  (each token field optional so an absent key is unavailable), `UsageProvenanceMark`,
  and `LiveUsage` carrying `available`, `provenance`, `source`, monotonic
  `elapsed_ms`, and null-unless-valid `tokens_per_second`, mirroring `usage.cue`
  (FR55, C21).
- [x] T007 [S2] Author `packages/schema/src/lifecycle/events.ts`,
  `events-durable.ts`, and `events-live.ts` with the detail sub-objects
  (`AdmissionDetail`, `HandoffDetail`, `TerminalDetail`, `WatchdogDetail`,
  `ToolActivityDetail`, `SteerDetail`, `ReconcileDetail`), one `Schema.Struct` per
  vocabulary member, and the closed `LifecycleEvent` `Schema.TaggedUnion("type", ...)`
  over all 26 members, keeping `extend`, `promote`, `steer`, and `handoff` distinct,
  mirroring `events.cue`/`events-durable.cue`/`events-live.cue` (FR20, FR21).
- [x] T008 [S3] Author `packages/schema/src/lifecycle/process-row.ts` and
  `process-row-parts.ts` composing `RowIdentity`, `RowLineage` (relations/ownership/
  graph), `RowStatus`, `RowProfile` (classification/model), `RowAccounting` (usage/
  outcome/telemetry), and `Schema.NullOr(RowHierarchy)` into `ProcessRow`, keeping
  prompts/results/payloads/paths/secrets out by default, mirroring `process-row.cue`
  and its part files (FR26, FR28, C15, C18).
- [x] T009 [S8, S9, S11] Author `packages/schema/src/lifecycle/admission.ts`,
  `watchdog.ts`, and `cancel.ts` with `CapacitySignals`, `TokenBucketState`,
  `AdmissionBucket`, `AdmissionResult`, `WatchdogLease`, `ZombieAssessment`,
  `ReconcileRecord` (with `auto_retry: Schema.Literal(false)`), `RootCancelScope`,
  and `CancelRequestRecord`, mirroring `admission.cue`/`watchdog.cue`/`cancel.cue`
  (C11, C12, C13, C17).
- [x] T010 [S4] Author `packages/schema/src/lifecycle/observation.ts` with
  `ObservationScope`, `ObservationFilter`, `AnomalyRecord`, and `ObservationResult`
  (carrying an already-authorized-and-redacted `LifecycleEvent` plus a nullable
  anomaly), mirroring `observation.cue` (FR14, C9, C14).
- [x] T011 [S15] Author `packages/schema/src/lifecycle/todo-events.ts` with the
  session-owned `todo.updated`, `todo.completed`, `todo.failed`, `todo.cancelled`,
  `todo.stale`, `todo.rehydrated`, and `todo.handoff_attached` members carrying
  `TodoRef`/`TodoVersion`/bounded counts only, distinct from the Feature 001
  `todo.initialized`/`todo.completion_blocked` events consumed read-only (FR58m,
  C23–C25).
- [x] T012 [S0–S4] Author the barrel `packages/schema/src/lifecycle/index.ts`
  re-exporting every lifecycle schema module and register the barrel in
  `packages/schema/src/index.ts`.
- [x] T013 [S4] Author `packages/protocol/src/lifecycle/ports.ts`,
  `packages/protocol/src/lifecycle/commands.ts`, and
  `packages/protocol/src/lifecycle/index.ts` mirroring `contracts/ports.ts`:
  the `LifecyclePort`, `ObservationPort`, and `ProcessPort` interfaces plus the
  `process.*`/`task.*` command and query request/response payloads and their typed
  error unions (FR14, C19).

### Domain engine (Phase 2)

- [x] T014 [S5] Author `packages/core/src/lifecycle/event-bus.ts` registering one
  `EventV2.define` `Definition` per lifecycle member via `dataFields(Member.fields)`
  with `durable {version, aggregate: "root_process_id"}` on the eleven durable members
  and no `durable` annotation on the fifteen live members, exposing no raw tagged union
  to the bus (C2, C4).
- [x] T015 [S5] Extend `packages/opencode/src/event-v2-bridge.ts` with
  `publishLifecycleEvent` mirroring `publishRoutingEvent` (location attach, single
  publish boundary) and extend `packages/schema/src/durable-event-manifest.ts` to join
  the eleven durable lifecycle definitions into the `Durable` inventory through
  `Event.durable([...])` (C1, C2, C5).
- [x] T016 [S6] Author `packages/core/src/lifecycle/projection.ts` as the idempotent
  projector keyed on event id plus `(aggregateID, seq)`, surfacing duplicate,
  out-of-order, unknown-process, and unreconciled events as observable
  `ProjectionAnomaly` records without throwing and without inventing terminal state
  (FR23, FR29, C9).
- [x] T017 [S7] Author `packages/core/src/lifecycle/state-machine.ts` encoding the ten
  states and the exact permitted transition table from C7 (`created`→`queued`→
  {`waiting`,`running`}; `running`↔`waiting`; {`queued`,`waiting`,`running`}→
  `cancelling`→{`cancelled`,`failed`,`unknown`}; `running`→{`completed`,`failed`};
  any non-terminal→{`zombie`,`unknown`}), rejecting illegal transitions (FR25, C7).
- [x] T018 [S7] Author `packages/core/src/lifecycle/process-table.ts` as the
  per-root/session in-memory projection rebuilt by replaying the durable aggregate via
  `EventV2.readAggregate`, applying events through the projector and state machine, and
  enforcing bounded retention via `EventV2.pruneDurable` with auditable counts (FR4,
  FR27, C6).
- [x] T019 [S8] Author `packages/core/src/lifecycle/admission/token-bucket.ts` and
  `packages/core/src/lifecycle/admission/capacity.ts`: a per-scope token bucket with
  hard `capacity` ceilings never relaxed by a model, and measured CPU/mem/provider/
  SQLite/event-queue/OTEL saturation signals as an explicit, overridable data constant
  surface (FR2, FR34, C11).
- [x] T020 [S8] Author `packages/core/src/lifecycle/admission/admission-controller.ts`
  granting `granted`/`partial`/`queued`/`rejected` decisions per
  global/root/session/child/provider/agent/tool/event-queue/OTEL/SQLite/token/cost
  scope, projecting requested-versus-granted fanout, applying parent/child fairness
  weights, and quarantining descendants after a root fence, with no unbounded queue
  (FR30–FR34, C11).
- [x] T021 [S9] Author `packages/core/src/lifecycle/watchdog.ts` as a single shared
  bucketed sweeper holding in-memory lease and heartbeat state (never one timer per
  Task, never a per-heartbeat SQLite write) and publishing `owner_lost`,
  `zombie_detected`, and `unknown` without claiming a provider stopped (FR38, FR39,
  C12).
- [x] T022 [S9] Author `packages/core/src/lifecycle/reconciliation.ts` performing
  explicit versioned reconciliation against durable Sessions, emitting
  `ReconcileRecord` with `auto_retry` fixed false so no zombie or crash re-executes
  effects (FR40, FR42, C13).
- [x] T023 [S14] Author `packages/core/src/lifecycle/lifecycle-instruments.ts` adding
  the `admission`, `queue.wait`, `cancel`, `handoff`, and `reconciliation` spans
  correlated with the Feature 001 `task.execute`/`session.execution`/`llm.request`/
  `tool.execute`/`fallback` spans, the active/started/completed/failed/cancelled/
  zombie/unknown counters, queue-wait/TTFT/tokens-per-second/saturation metrics with
  bounded labels, and the local evidence window/confidence/TTL for Smart Routing,
  reusing the Feature 001 instruments and cardinality allowlist (FR43–FR47, C18).
- [x] T024 [S5–S14] Author the barrel `packages/core/src/lifecycle/index.ts`
  re-exporting the event bus, projection, state machine, process table, admission,
  watchdog, reconciliation, and instruments modules.

### Application and adapters (Phase 3)

- [ ] T025 [S5] Author `packages/opencode/src/lifecycle/eventv2-adapter.ts` mapping
  each lifecycle event to its EventV2 `Definition` and back, committing durable events
  atomically via `EventV2.PublishOptions.commit(seq)` and publishing live events
  without a sequence, and subscribing the projection through `EventV2.Service.listen`
  (C3, C4).
- [ ] T026 [S10] Author `packages/opencode/src/lifecycle/observation-service.ts`
  implementing `observeSession`, `observeProcess`, `observeTree`, and
  `observeGlobal(filter)` over Effect Stream/PubSub with scoped finalizers so
  subscribe/unsubscribe is leak-free and no Observable controls lifecycle state (FR14,
  FR15, FR16, C14).
- [ ] T027 [S10] Author `packages/opencode/src/lifecycle/authorization.ts` applying the
  canonical Permission/Policy visibility filter and metadata redaction before delivery
  and projection, rejecting sibling and cross-project access as a
  `sibling_leak_rejected` failure (FR11, FR12, FR13, C14).
- [ ] T028 [S11] Author `packages/opencode/src/lifecycle/handoff.ts` publishing one
  durable single-owner handoff event carrying source/target session and process,
  reason, generation, correlation, and causation, projectable to both affected
  sessions and their permitted root tree (FR22, C16).
- [ ] T029 [S11] Author `packages/opencode/src/lifecycle/cancel.ts` implementing the
  native root-tree cancel path through `SessionRunCoordinator.interrupt`, transitioning
  visible and invisible descendants through `cancelling`, fencing new descendant
  admission, distinguishing first versus second Ctrl+C within the escalation window,
  and promising no remote kill, reversal, or mutation rollback (FR59–FR62, C17).
- [ ] T030 [S12] Extend `packages/opencode/src/lifecycle/eventv2-adapter.ts` and
  `packages/core/src/lifecycle/process-table.ts` with the `settling`/`unknown`/
  `corrupt` terminal settlement sub-states so a Task is never marked terminal-as-settled
  until Feature 005 reports settlement, projecting bounded `OutputRef`/cursor only
  (FR64, C20).
- [ ] T031 [S13] Author `packages/opencode/src/operator/lifecycle/**` with the typed
  `ProcessPort` domain implementations for `process.status|tree|watch|cancel|steer|
  handoff` and `task.status|tree|watch|cancel`, each emitting audit events and
  registering through the Feature 007 registry with zero model calls, redacted output,
  and no output added to Message/Part/context by default; reserved IDs are never
  registered by plugin/MCP/custom registries (FR49–FR51, C19).
- [ ] T032 [S15] Extend `packages/opencode/src/lifecycle/eventv2-adapter.ts` to consume
  the Feature 001 `todo.initialized`/`todo.completion_blocked` events read-only, publish
  the Feature 002 session-owned `todo.*` events at their existing seams, and project
  `todo_ref`/version/counts/consistency/outcome into Process Table rows without
  mutating any Todo, with sibling isolation before projection (FR58k, C23–C25).
- [ ] T033 [S10–S13] Author the barrel `packages/opencode/src/lifecycle/index.ts`
  re-exporting the eventv2 adapter, observation service, authorization, handoff, and
  cancel modules.

### CLI and TUI surfaces (Phase 4)

- [ ] T034 [S16] Author `packages/cli/src/**/process/**` for `opencode process
  status|tree|watch|cancel|steer|handoff`, each dispatching through the Feature 007
  registry to the `ProcessPort`, emitting human and JSON output with redacted rows, and
  making zero provider/model calls.
- [ ] T035 [S16] Author `packages/cli/src/**/task/**` for `opencode task
  status|tree|watch|cancel`, resolving a logical Task to its `process_id`/attempt/
  generation set through the Feature 007 registry with zero model calls.
- [ ] T036 [S16] Author `packages/tui/src/routes/session/process-panel/**` rendering
  direct-child-only cards (`parent_session_id == current_session_id`) with hierarchy
  role, validation status, bounded/redacted activity, live usage with provenance and
  explicit unavailable state, live elapsed and valid tokens/s, breadcrumb navigation
  preserving state and selection, Esc-as-dismiss and Ctrl+C-as-root-cancel semantics,
  and screen-reader text independent of color (FR52–FR58, FR58a, C22).

### Tests and validation (Phase 5)

- [ ] T037 [S17] Add pure deterministic unit tests under
  `packages/core/test/lifecycle/**` for state-machine transitions, projection
  idempotency over duplicate and out-of-order events, admission token-bucket ceilings
  and fanout, watchdog sweep, reconciliation with no auto-retry, and usage provenance
  reconciliation, with no I/O (AC2, AC11, AC13, AC14, AC21, AC26).
- [ ] T038 [S17] Add schema and protocol tests under
  `packages/schema/test/lifecycle/**` and `packages/protocol/test/lifecycle/**`
  asserting envelope redaction, the closed 26-member vocabulary, the durable-versus-live
  split, and `protocol/lifecycle` shape parity against `contracts/ports.ts` (FR9, FR13,
  FR20, FR24).
- [ ] T039 [S17] Add integration tests under `packages/opencode/test/lifecycle/**`
  through the Feature 007 sandbox stores under `.dev/` for projection over the EventV2
  durable aggregate, replay and restart rebuild into `unknown`/`unreconciled`, admission
  under saturation, observation authorization and redaction with sibling-leak rejection,
  and single-event dual handoff projection (AC1, AC3, AC4, AC6, AC13, AC15).
- [ ] T040 [S17] Add end-to-end tests through the Feature 007 sandbox wrapper covering
  the CLI human and JSON output, the TUI direct-child process panel, root-tree Ctrl+C
  cancellation of visible and invisible descendants, Esc isolation, and reconnect
  reconstruction, with UI tests under `packages/tui/test/**` (AC23–AC23f, AC27, AC29,
  AC31, AC34).
- [ ] T041 [S17] Add a telemetry cardinality audit under
  `packages/core/test/lifecycle/**` asserting `task_id`/`session_id`/`process_id` never
  appear as metric labels, over-budget dynamic values map to `other`, lifecycle spans
  correlate with the Feature 001 spans, and Todo metrics export only enums/counts/
  buckets (AC16, AC17, AC47, C18).

## Dependencies

**Sequencing (internal):**

- Schema and protocol (T001–T013) precede every domain, application, and surface task.
  Within Phase 1: T001 and T002 precede T003–T011 (identifiers and value objects are
  referenced by every enum and struct); T005 (envelope) depends on T001–T004; T006
  (usage) precedes T007–T008 (`TerminalDetail` and `RowAccounting` embed `LiveUsage`);
  T007 (events) depends on T005 and T006; T008 (process row) depends on T004–T006;
  T012 (schema barrel) depends on T001–T011; T013 (protocol) depends on T003–T010.
- Domain engine (T014–T024) depends on the schemas (T001–T012). T014 (event bus)
  depends on T007; T015 (bridge + manifest) depends on T014; T016 (projection) depends
  on T014; T017 (state machine) precedes T018; T018 (process table) depends on T016 and
  T017; T019 precedes T020 (admission controller over the token bucket); T021 precedes
  T022 (reconciliation over watchdog leases); T023 (instruments) depends on T016 and
  T020; T024 (core barrel) depends on T014–T023.
- Application and adapters (T025–T033) depend on the domain engine and schemas. T025
  (eventv2 adapter) depends on T014 and T015; T026 (observation service) depends on
  T018; T027 (authorization) precedes delivery in T026; T028 (handoff) and T029 (cancel)
  depend on T020 and T026; T030 (settlement seam) depends on T018 and T025; T031
  (operator commands) depends on T026, T028, and T029; T032 (Todo projection) depends on
  T016 and T025; T033 (application barrel) depends on T025–T032.
- CLI and TUI surfaces (T034–T036) depend on the operator commands (T031) and the
  observation service (T026); T036 additionally depends on T032 for the Todo card fields.
- Tests (T037–T041) depend on their corresponding implementation tasks; T039–T041 run
  only through the Feature 007 sandbox wrapper.

**External dependencies (must be available or accepted first):**

- The future ADR **Task Process Lifecycle and Operational Observation** must be accepted
  before any implement-phase task is relied upon in production; it fixes the provisional
  numeric constants in `data-model.md` (queue capacities, admission ceilings, retention
  windows, watchdog cadence, escalation window, evidence window/confidence/TTL).
- EventV2 remains the single event authority: `packages/schema/src/event.ts`
  (`EventV2.define`), `packages/core/src/event.ts` (`Service`, `readAggregate`,
  `PublishOptions.commit`, `pruneDurable`), and the existing
  `packages/opencode/src/event-v2-bridge.ts` publish boundary are reused, not replaced
  (C2). No second executor, runtime, SessionRunner, EventV2 system, or lifecycle loop is
  introduced (FR6, AC22).
- Feature 001 (Smart Agent Routing and Telemetry) supplies the eight EventV2 routing/
  hierarchy/Todo definitions consumed read-only (C1), the telemetry instruments and
  cardinality allowlist reused by T023 (C18), the local metrics/evidence store, the
  hierarchy role and validation vocabulary reused verbatim (C15), and the Budget policy
  that derives `todo_item_max` (T023, T032).
- Feature 007 (Operator Control Plane, ADR-0003 accepted) is the sole management
  authority: its registry, dispatcher, authorization, CAS, idempotency, audit, and the
  `.dev/opencode-operator/` sandbox wrapper (env prefix `OPENCODE_DEV_OPERATOR_=1`,
  loopback port 14096) are the only path for `process.*`/`task.*` registration
  (T031, T034–T035) and for integration/e2e tests (T039–T041).
- Feature 005 (OutputSpool/ArtifactStore) owns the content-plane OutputRef/cursor,
  seal/abort, committed-byte, and settlement contract; T030 projects bounded refs only
  and never resolves content (C20).
- Canonical execution owners reused unchanged: `SessionRunCoordinator`
  (`packages/core/src/session/run-coordinator.ts`, root-cancel via `interrupt`),
  `SessionRunner`, `SessionExecution` (`packages/core/src/session.ts`), `BackgroundJob`
  (`packages/core/src/background-job.ts`), and `TaskTool`
  (`packages/opencode/src/tool/task.ts`); lifecycle events publish at these existing
  seams (FR6, FR8, C3).
- Feature 003 (Scheduled Jobs) reuses the T029 cancellation boundary so cancelling an
  occurrence never disables the Job Definition (FR63); Feature 004 (Lang Lock) governs
  Todo objective/item/handoff text projected by T032 and T036 (FR58m).
</content>
