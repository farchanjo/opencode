# Tasks: Add Persistent Bun-Native Scheduled Jobs With Event

Ordered, measurable work breakdown derived from `plan.md` slices S0–S18,
`data-model.md`, `contracts/ports.ts`, ADR-0004, and the
`doc/arch/schemas/jobs/*.cue` mirrors. Every task stays inside the
`specScopeGlobs` declared in `doc/arch/speckit.toml`. Phase 1 (schema/protocol)
is additive and non-breaking; no runtime behavior changes until the Phase 3
wiring. Feature 003 adds no second scheduler, executor, event bus, persistence
store, or notification channel (ADR-0004): the runtime is the confirmed
in-process `Bun.cron(schedule, handler)` of Bun `1.3.14`, definitions persist in
the Feature 007 Config.Service authority, occurrences run as Feature 002 Task
Processes, `job.*` lifecycle and notification events register through
`EventV2.define`, and notifications ride the Feature 002 bounded observation
seam. Management authority for every operator surface is Feature 007 (ADR-0003):
Feature 003 supplies typed `jobs.*` domain implementations and audit events only
and never registers a parallel command registry (C12). The `job.*` event prefix
and the `jobs.*` operator command domain are distinct reserved namespaces (C13).

## Task Breakdown

### Schema and protocol foundation (Phase 1)

- [x] T001 [S0] Author `packages/schema/src/jobs/ids.ts` and
  `packages/schema/src/jobs/correlation.ts` with the branded identifiers from
  `data-model.md`: `JobDefinitionId`, `ScheduleId`, `OccurrenceId`, `ProcessId`
  (the Feature 002 Task Process id, never an OS PID), `RootProcessId`,
  `SessionId`, `ParentSessionId`, `RootSessionId`, `NotificationId`, `EventId`,
  plus `CorrelationId`, `CausationId`, `DecisionId`, `TurnId`, `Principal`,
  `SecretRef`, `PayloadRef`, `OutputRef`, `ProjectRef`, `TodoRef`; each built
  base-then-check-then-brand (`Schema.String.annotate({ identifier }).check(...)
  .pipe(Schema.brand("Jobs.*"))`), mirroring `ids.cue` and `correlation.cue`
  one-to-one with no cross-feature import; secrets are opaque references only
  (FR1, FR12, Security 3, C1, C6, C10, C16).
- [x] T002 [S0] Author `packages/schema/src/jobs/values.ts` and
  `packages/schema/src/jobs/text-values.ts` with the ordering/version/budget/lag
  counters (`Sequence`, `Attempt`, `Generation`, `SchemaVersion`, `Version`,
  `DeadlineMs`, `TimeoutMs`, `RetryBudget`, `Priority`, `ScheduleLagMs`) and the
  bounded redacted text/flag/permission value objects (`JobName`,
  `JobDescription`, `ActionTarget`, `BoundedSummary`, `Reason`, `TraceId`,
  `SpanId`, `Enabled`, `PermissionSet`), folding `Schema.isInt()` into integer
  checks and excluding raw prompts/results/spool paths/secrets, mirroring
  `values.cue` and `text-values.cue` (FR2, FR19, FR22, FR32, C6, Privacy).
- [x] T003 [S1] Author `packages/schema/src/jobs/schedule.ts` with
  `CronExpression` (5-field or supported nickname), `IanaTimezone`,
  `MinimumIntervalMs`, the branded `NominalDueTime` string key (never a decoded
  `DateTime`, so the idempotency tuple has stable identity), and the composite
  `CronSchedule`; the canonical stored form is an IANA timezone plus a 5-field
  cron expression normalized by the occurrence layer, and an unsupported zone is
  rejected before registration, mirroring `schedule.cue` (FR7, C4, AC22).
- [x] T004 [S0] Author `packages/schema/src/jobs/enums.ts`,
  `enums-event.ts`, `enums-notification.ts`, and `event-types.ts` with the
  closed enums as `Schema.Literals([...])`: `RegistrationState`
  (`pending|registered|unregistered|unknown|reconciled`), `RegistrationIntent`,
  the fifteen-member `OccurrenceState`, `MisfirePolicy`, `OverlapPolicy`,
  `ActionType`, `Scope`, `CapabilitySurface`, `ReconcileOutcome`, `EventClass`,
  `JobSource`, `ActorKind`, `Visibility`, `NotificationType`,
  `NotificationPriority`, `NotificationSource`, `DeliveryState`, `AckState`,
  `DeliveryAction`, `SafeBoundary`, and the closed 30-member `JobEventType`
  `job.*` vocabulary, mirroring `enums.cue`, `enums-event.cue`,
  `enums-notification.cue`, and `event-types.cue` (FR6, FR11, FR15, FR16, FR28,
  C3, C5, C9, C13, C19).
- [x] T005 [S3] Author `packages/schema/src/jobs/envelope.ts` composing the
  bounded sub-structs `EventKind`, `OccurrenceIdentity` (with `process_id` as
  `Schema.NullOr` until the Task Process associates), `TreeIdentity`, `Ordering`
  (per-aggregate `sequence` only; no global order), and `Delivery` (bounded
  `redacted_metadata` record, no prompts/results/payloads/paths/secrets) into
  `JobEnvelope`, mirroring `envelope.cue` and `envelope-parts.cue` (FR12, FR32,
  C6, C16).
- [x] T006 [S1] Author `packages/schema/src/jobs/definition.ts` composing
  `DefinitionIdentity`, `DefinitionSchedule`, `DefinitionPolicy`,
  `DefinitionExecution`, and `DefinitionAuthorization` (each within the
  calisthenics field bound) into the durable `JobDefinition` aggregate root with
  CAS `version`, cron schedule + IANA timezone, misfire/overlap/capability-surface
  policy, action type + redacted target, deadline/timeout/retry/priority, scope/
  project/root policy, permissions, `SecretRefList` (secure references only), and
  a nullable `payload_ref`, mirroring `definition.cue` and `definition-parts.cue`
  (FR2, FR6, FR28, FR29, FR32, C5, C10).
- [x] T007 [S2] Author `packages/schema/src/jobs/occurrence.ts` composing
  `IdempotencyKey` (the tuple `(job_definition_id, schedule_id, nominal_due_time,
  generation)`), `OccurrenceLineage` (correlation/causation, session/root,
  `Schema.NullOr` `process_id` until association), `OccurrenceExecution`
  (executor-owned attempt/generation/sequence, nullable occurrence-owned
  `todo_ref` and `output_ref`), and `OccurrenceStatus` (state, reason,
  `schedule_lag_ms` from nominal due, nullable `duplicate_of`) into the
  `JobOccurrence` aggregate root, mirroring `occurrence.cue` and
  `occurrence-parts.cue` (FR8, FR8a, FR10, FR19, C6, C14, C15, AC6).
- [x] T008 [S8] Author `packages/schema/src/jobs/reconciliation.ts` with
  `AutoRetryDisabled` (`Schema.Literal(false)`), `ScheduleRegistration` (durable
  intent + registration state + capability surface), `OccurrenceReconcile`, and
  `RegistrationReconcile`, each carrying `auto_retry` pinned false so
  reconciliation never re-executes an ambiguous mutating effect and no
  cross-system atomic commit is claimed, mirroring `reconciliation.cue` (FR6,
  FR14, C5, C11, AC19, AC23).
- [x] T009 [S4] Author `packages/schema/src/jobs/notification.ts` composing
  `NotificationRouting`, `NotificationDescriptor` (operator-only default
  `action`), `NotificationTiming` (created/expiry TTL, correlation/causation),
  `NotificationContent` (bounded `summary` + opaque Feature 005 `output_ref`,
  never full content or spool paths), and `NotificationState` (delivery/ack
  state, `safe_boundary`) into the `NotificationEnvelope` value object, mirroring
  `notification.cue` and `notification-parts.cue` (FR22, FR24, FR25, C9, C15,
  AC7, AC8, AC29).
- [x] T010 [S3] Author `packages/schema/src/jobs/events.ts` with the detail
  sub-objects (`DefinitionDetail`, `RegistrationDetail`, `TriggerDetail`,
  `MisfireDetail`, `OverlapDetail`, `ExecutionDetail`, `RetryDetail`,
  `NotificationDetail`, `ReconcileDetail`) and, across `events-definition.ts`,
  `events-occurrence.ts`, `events-execution.ts`, and `events-notification.ts`,
  one `Schema.Struct` per FR11 vocabulary member (each carrying `envelope`, a
  distinct-payload member adding one `detail`), then the closed 30-member
  `Schema.TaggedUnion("type", ...)` `JobEvent`, keeping definition-mutation,
  registration, misfire, overlap, execution-terminal, retry, notification, and
  reconciliation distinct and never collapsed, mirroring `events.cue`,
  `events-definition.cue`, `events-occurrence.cue`, `events-execution.cue`, and
  `events-notification.cue` (FR11, FR12, C8).
- [x] T011 [S0–S4] Author the barrel `packages/schema/src/jobs/index.ts`
  re-exporting every jobs schema module and register the barrel in
  `packages/schema/src/index.ts`.
- [x] T012 [S4] Author `packages/protocol/src/jobs/ports.ts`,
  `packages/protocol/src/jobs/commands.ts`, and
  `packages/protocol/src/jobs/index.ts` mirroring `contracts/ports.ts`: the
  `SchedulerPort`, `NotificationPort`, and `JobsPort` interfaces, the `jobs.*`
  command and query request/response payloads, the `NotificationTargetPrincipal`/
  `OperatorPrincipal` shapes, and the typed `SchedulerError`/`NotificationError`/
  `JobsError` unions (including `reserved_name` and `capability_unsupported`),
  never redefining the `packages/schema/src/jobs/*` event payload schemas (FR30,
  FR32, C9, C12, C13, AC22).

### Domain scheduler engine (Phase 2)

- [x] T013 [S5] Author `packages/core/src/jobs/cron.ts` performing 5-field +
  IANA-timezone parse/validate and next-occurrence computation over the injected
  `NextOccurrencePort`/`ClockPort` (wrapping `Bun.cron.parse` in the adapter
  layer, never importing the Bun runtime in the domain), applying minimum
  interval, DST duplicate/skipped/leap normalization per the configured policy,
  and measuring schedule lag from the nominal due instant, mirroring
  `schedule.cue` semantics (FR7, C4, AC4, AC22).
- [x] T014 [S6] Author `packages/core/src/jobs/occurrence-state-machine.ts`
  encoding the C6 transition table (`due`→{`claimed`,`misfired`,`skipped`,
  `coalesced`}; `claimed`→{`admitted`,`overlap_rejected`,`overlap_replaced`,
  `unknown`}; `overlap_replaced`→`admitted`; `admitted`→{`executing`,
  `reconciled`}; `executing`→{`completed`,`failed`,`cancelled`,`timed_out`,
  `unknown`}), rejecting illegal transitions, resolving duplicate delivery for
  one idempotency tuple to a single execution with an observable `duplicate_of`
  outcome, and never authoring sequence/attempt/generation (executor-owned),
  matching `doc/arch/statecharts/job-occurrence.md` (FR10, FR11, C6, AC6).
- [x] T015 [S7] Author `packages/core/src/jobs/misfire.ts` and
  `packages/core/src/jobs/overlap.ts`: the misfire evaluator over
  `skip|fire_once|bounded_catch_up|coalesce` with a bounded catch-up ceiling and
  no infinite catch-up, and the overlap evaluator over
  `allow|forbid(default)|queue|replace` that is capability-gated (an unsupported
  request fails validation before registration), honors in-process no-overlap for
  a pending handler past the next nominal due as an explicit misfire outcome, and
  keeps `replace` mutation-safe (never silently stops or kills a mutating
  handler/process), with provisional constants as explicit overridable data
  (FR15, FR16, C3, C19, AC3, AC5, AC24).
- [x] T016 [S8] Author `packages/core/src/jobs/scheduler-engine.ts` and
  `packages/core/src/jobs/reconciliation.ts`: the engine mapping a definition to
  a registration intent, computing the idempotency tuple, and measuring lag from
  nominal due; and startup rehydration that replays persisted definitions,
  re-registers enabled ones, and transitions registration state through
  `pending|registered|unregistered|unknown|reconciled` with idempotent
  compensation, `auto_retry` pinned false, and no claimed cross-system atomicity
  or false replay, mirroring `reconciliation.cue` (FR3, FR6, FR14, C5, C7, AC2,
  AC19, AC23).
- [ ] T017 [S12] Author `packages/core/src/jobs/event-bus.ts` registering one
  `EventV2.define` `Definition` per `job.*` member via `dataFields(Member.fields)`
  with `durable {version, aggregate: "root_session_id"}` on the durable members
  (`DURABLE_JOB_EVENT_TYPES`) and no `durable` annotation on the live members
  (`LIVE_JOB_EVENT_TYPES`), exposing no raw tagged union to the bus, and an
  idempotent projector keyed on event id plus `(aggregateID, seq)` that reuses the
  Feature 002 dedupe posture and never invents terminal state, so terminal and
  definition-mutation events are never coalesced or dropped (FR11, FR12, C8, AC18).
- [x] T018 [S12] Extend `packages/opencode/src/event-v2-bridge.ts` with
  `publishJobEvent` mirroring `publishLifecycleEvent`/`publishRoutingEvent`
  (location attach, single publish boundary) and extend
  `packages/schema/src/durable-event-manifest.ts` to join the durable `job.*`
  definitions into the `Durable` inventory through `Event.durable([...])`, so no
  second event authority or channel exists (C5, C8, C13).
- [x] T019 [S16] Author `packages/core/src/jobs/jobs-instruments.ts` adding the
  `job.schedule|trigger|claim|notify|dispatch|execute|retry|reconcile` spans
  linked to the Feature 001 `task.execute`/session-execution/LLM/tool/fallback
  spans, the enabled-definition / due / triggered / misfired / skipped /
  coalesced / lag / queue-wait / duration / success-failure-cancel-timeout /
  overlap / retry / notification-queue-delivery-ack-expiry / saturation /
  reconciliation metrics with bounded-enum labels, and reusing the Feature 001
  cardinality allowlist (IDs in traces/logs only; over-budget values map to
  `other`; async bounded export never blocks the trigger/execution hot path)
  (Observability, C18, AC15, AC16).
- [x] T020 [S5–S16] Author the barrel `packages/core/src/jobs/index.ts`
  re-exporting the cron, occurrence state machine, misfire, overlap, scheduler
  engine, reconciliation, event bus, and instruments modules.

### Application and adapters (Phase 3)

- [ ] T021 [S9] Author `packages/opencode/src/jobs/bun-cron-adapter.ts`
  implementing `SchedulerPort` over the in-process `Bun.cron(schedule, handler)`
  form: register/unregister/reschedule plus `Bun.cron.parse` for the next UTC
  instant behind the `NextOccurrencePort`, capability declaration separately for
  the in-process and OS-level surfaces, a typed capability gap surfaced instead of
  an invented API when a form/platform is unsupported, and no business logic in
  the callback and no permanent polling loop; the callback only claims the
  occurrence and delegates to the trigger service (FR4, FR5, FR9, C1, C2, AC1,
  AC22).
- [ ] T022 [S10] Author `packages/opencode/src/jobs/persistence.ts` persisting
  `JobDefinition` and `ScheduleRegistration` (durable intent + registration
  state) in the Feature 007 Config.Service authority through the reused
  ConfigPort/SecretPort — a new durable job-definition table, atomic within
  Config.Service with version/CAS and idempotency, secrets as secure references
  only, and the external Bun registration modeled as an idempotent effect paired
  with compensation with no cross-system transaction (FR3, FR6, FR32, C5, C10,
  C21, AC13, AC23).
- [ ] T023 [S11] Author `packages/opencode/src/jobs/trigger-service.ts`
  publishing `job.trigger_due`, creating the occurrence under its idempotency
  tuple before admission, then creating or associating a canonical Feature 002
  Task Process through TaskTool/BackgroundJob/SessionExecution/
  SessionRunCoordinator/SessionRunner (Process Table observes, never executes),
  provisioning the occurrence-owned Feature 002 session Todo and the Feature 005
  OutputGroup before goal-bearing work, passing Feature 002 admission and
  Feature 001 routing/hard gates (Process Table records `owner_kind`
  scheduled-job), applying no blind retry of ambiguous mutating effects, and
  emitting `job.*` via `publishJobEvent`; no second executor, runtime, event bus,
  or lifecycle (FR8, FR8a, FR9, FR13, FR14, FR17, C11, C14, C15, C16, AC11, AC12,
  AC20, AC26, AC27, AC28).
- [ ] T024 [S13] Author `packages/opencode/src/jobs/notification-service.ts`
  implementing `NotificationPort` over the Feature 002 bounded Effect
  Stream/PubSub observation seam segmented by root/session/project: enqueue
  (`job.notification_enqueued`), safe-active-turn-boundary delivery
  (`job.notification_delivered`) that queues/coalesces/expires on a busy or
  unsafe turn and never interrupts unsafe work, ack (`job.notification_acknowledged`),
  and TTL expiry (`job.notification_expired`) with bounded queues and no
  unbounded growth; the default action is operator-only, wake/queue/child are
  explicit and audited, delivery never depends on an LLM, and the envelope
  carries only a bounded summary + opaque Feature 005 OutputRef (FR20, FR22,
  FR23, FR24, FR25, FR26, C8, C9, C15, C19, AC7, AC8, AC10, AC21, AC29).
- [ ] T025 [S14] Author `packages/opencode/src/jobs/authorization.ts` applying
  the canonical Feature 007 Permission/Policy visibility filter and metadata
  redaction before notification delivery and projection, rejecting
  cross-session/cross-project access as a `cross_scope_leak_rejected` failure
  (never a silent drop), and keeping secrets/payloads/paths out of envelopes,
  metrics, logs, and traces by default (FR21, FR32, Security 4, C10, AC9, AC16).
- [ ] T026 [S11–S14] Author the barrel `packages/opencode/src/jobs/index.ts`
  re-exporting the Bun.cron adapter, persistence, trigger service, notification
  service, and authorization modules.
- [ ] T027 [S15] Author `packages/opencode/src/operator/jobs/**` with the typed
  `JobsPort` domain implementations for `jobs.list|status|show|create|update|
  enable|disable|delete|reschedule|run-now|history|watch`, each emitting audit
  events and registered through the Feature 007 registry with zero provider/model
  calls, tokens, or cost, redacted/versioned human and JSON output, operator
  principal + explicit scope + version/CAS + idempotency on every mutation,
  `disable`/`delete` reporting `unconfirmed`/`unknown` rather than a false kill of
  mutating work, and `run-now` creating a normal occurrence through admission/
  routing/permissions/lifecycle without starting an LLM turn for administration
  (FR28, FR30, FR31, FR32, Security 5, Security 7, C12, C17, AC14, AC17, AC25).
- [ ] T028 [S15] Extend the Feature 007 reserved catalog
  `packages/core/src/operator/catalog.ts` to add the missing `jobs.*` command
  entries (`jobs.show`, `jobs.reschedule`, `jobs.history`, `jobs.watch`) so the
  domain covers the full canonical operations list, bump
  `RESERVED_CATALOG_VERSION` additively from `1.2.0` to `1.3.0`, and update the
  catalog-version assertions under `packages/core/test/operator/**` and
  `packages/opencode/test/operator/**`; plugin/MCP/custom/PromptTemplate
  registration rejects `job.*`/`jobs.*` collisions with a structured
  `reserved_name` error (FR30, FR32, C12, C13, AC17).

### CLI and TUI surfaces (Phase 4)

- [ ] T029 [S17] Author `packages/cli/src/**/jobs/**` for `opencode op jobs
  list|status|show|create|update|enable|disable|delete|reschedule|run-now|
  history|watch`, each dispatching through the Feature 007 registry to the
  `JobsPort` with registry-generated names (no divergent hardcoded verbs),
  emitting redacted/versioned human and JSON output, and making zero
  provider/model calls (FR30, C12).
- [ ] T030 [S17] Author `packages/tui/src/**/operator/jobs/**` rendering the jobs
  panel (definitions, occurrences, registration state, redacted/versioned history)
  as a thin adapter over the Feature 007 registry with registry-generated names,
  live `job.*` watch over the observation seam, and screen-reader text
  independent of color (FR30, C12).

### Tests and validation (Phase 5)

- [ ] T031 [S18] Add pure deterministic unit tests under
  `packages/core/test/jobs/**` for cron parse/next-occurrence (UTC/DST/leap/
  duplicate-time), the occurrence state machine and duplicate idempotency
  resolution, misfire (no infinite catch-up), overlap (default forbid,
  capability gate, mutation-safe replace, long-handler misfire), scheduler
  reconciliation with `auto_retry` false, and the idempotency tuple, with a fake
  clock and no I/O (AC3, AC4, AC5, AC6, AC19, AC22, AC24).
- [ ] T032 [S18] Add schema and protocol tests under
  `packages/schema/test/jobs/**` and `packages/protocol/test/jobs/**` asserting
  contract hygiene (annotate-before-check identifiers), the closed 30-member
  `job.*` vocabulary and the durable-versus-live split, envelope redaction
  (no prompts/results/payloads/paths/secrets), the notification bounded-summary +
  opaque-OutputRef boundary, and `protocol/jobs` shape parity against
  `contracts/ports.ts` (FR11, FR12, FR22, FR32, C8, C15, AC29).
- [ ] T033 [S18] Add integration tests under `packages/opencode/test/jobs/**`
  through the Feature 007 sandbox stores under `.dev/` for Config.Service
  definition persistence + CAS, startup rehydration/reconciliation through
  `unknown`/`reconciled`, `job.*` projection over the EventV2 durable aggregate,
  trigger → occurrence → Feature 002 Task Process with occurrence-owned Todo +
  OutputGroup, notification delivery/ack/expiry under saturation, and
  authorization + redaction with cross-scope-leak rejection (AC2, AC7, AC8, AC9,
  AC11, AC13, AC18, AC23, AC26, AC28).
- [ ] T034 [S18] Add end-to-end and C20 fault-matrix tests through the Feature
  007 sandbox wrapper covering the CLI human + JSON `op jobs` output, the TUI
  jobs panel, `run-now` as a normal occurrence with zero admin-time model calls,
  disable/delete without a false kill, the disable/update/delete-vs-trigger race,
  reserved `job.*`/`jobs.*` collision rejection, and the fault injections
  (registration failure, partial persistence, event storms, cron fan-out,
  notification lag, long handlers, cancellation, OTEL outage, restart,
  reconciliation) bound to AC1, AC2, AC3, AC5, AC7, AC8, AC12, AC14, AC15, AC17,
  AC19, AC21, AC22, AC23, AC24, AC25.
- [ ] T035 [S18] Run per-package `tsgo --noEmit` typecheck and `bun test` for
  `packages/schema`, `packages/protocol`, `packages/core`, `packages/opencode`,
  `packages/cli`, and `packages/tui`, plus a telemetry cardinality audit under
  `packages/core/test/jobs/**` asserting `job_definition_id`/`occurrence_id`/
  `session_id`/`process_id` never appear as metric labels, over-budget dynamic
  values map to `other`, and `job.*` spans correlate with the Feature 001 spans;
  every package must typecheck and test green (Observability, C18, AC16).
- [ ] T036 [S0–S18] Close-out: tick every checkbox above once its task is
  complete and verified, confirm `speckit validate` is green with only the four
  pre-existing waived hygiene findings, and mark the Feature 003 workflow phase
  complete (all AC1–AC29 mapped to a task and the C20 fault matrix covered).

## Dependencies

**Sequencing (internal):**

- Schema and protocol (T001–T012) precede every domain, application, and surface
  task. Within Phase 1: T001 and T002 precede T003–T010 (identifiers and value
  objects are referenced by every enum and struct); T003 (schedule) depends on
  T002; T004 (enums) depends on T001–T002; T005 (envelope) depends on T001–T004;
  T006 (definition) depends on T002–T004; T007 (occurrence) depends on T002–T004;
  T008 (reconciliation) depends on T004; T009 (notification) depends on T004–T005
  and T007; T010 (events) depends on T005 and the detail enums in T004; T011
  (schema barrel) depends on T001–T010; T012 (protocol) depends on T004–T009.
- Domain engine (T013–T020) depends on the schemas (T001–T011). T013 (cron)
  depends on T003; T014 (state machine) depends on T007; T015 (misfire/overlap)
  depends on T004 and T014; T016 (engine/reconciliation) depends on T008, T013,
  and T014; T017 (event bus) depends on T010; T018 (bridge + manifest) depends on
  T017; T019 (instruments) depends on T014 and T017; T020 (core barrel) depends
  on T013–T019.
- Application and adapters (T021–T028) depend on the domain engine and schemas.
  T021 (Bun.cron adapter) depends on T013 and T016; T022 (persistence) depends on
  T006 and T008; T023 (trigger service) depends on T014, T017, T018, T021, and
  T022; T024 (notification service) depends on T009, T017, and T018; T025
  (authorization) precedes delivery in T024; T026 (application barrel) depends on
  T021–T025; T027 (operator commands) depends on T012, T022, T023, T024, and
  T025; T028 (catalog bump) precedes T027 registration and gates the reserved
  `jobs.*` IDs.
- CLI and TUI surfaces (T029–T030) depend on the operator commands (T027) and the
  catalog bump (T028); T030 additionally depends on T024 for the live watch
  stream.
- Tests and validation (T031–T036) depend on their corresponding implementation
  tasks; T033–T034 run only through the Feature 007 sandbox wrapper; T035
  (typecheck + test) depends on T001–T034; T036 (close-out) depends on every
  prior task and a green `speckit validate`.

**External dependencies (must be available or accepted first):**

- **ADR-0004 (Scheduled Job Runtime and Async Notification Channel, proposed)**
  is the required decision record; its numeric bounds — minimum interval,
  clock-skew tolerance, catch-up ceiling, queue capacities, notification TTL,
  retention/compaction, and per-scope budgets — are provisional plan constants in
  `data-model.md` fixed by acceptance testing and finalized here. OS-level
  `Bun.cron` execution and distributed multi-worker scheduling are deferred to
  ADR-0004 successors (C2, C7).
- **Bun `1.3.14`** provides the confirmed in-process `Bun.cron(schedule, handler)`
  callback and `Bun.cron.parse`; the adapter uses this capability where supported
  and surfaces a typed capability gap otherwise, never inventing an absent API
  (C1, AC22).
- **EventV2 remains the single event authority**: `packages/schema/src/event.ts`
  (`EventV2.define`), `packages/core/src/event.ts` (`Service`, `readAggregate`,
  `pruneDurable`), and the existing `packages/opencode/src/event-v2-bridge.ts`
  publish boundary are reused, not replaced. `job.*` and notification events
  register through `EventV2.define`; no second bus or channel is introduced (C8,
  C13).
- **Feature 002 (Task Lifecycle Event Bus and Process Table)** is a direct
  dependency: the executor (`SessionRunCoordinator`/`SessionRunner`/
  `SessionExecution`/`BackgroundJob`/`TaskTool`), the lifecycle bus, the Process
  Table, the session-owned Todo model, and the bounded observation seam are the
  only execution, occurrence, and notification-transport authority. Sequence,
  attempt, and generation belong to the Feature 002 executor, never the scheduler
  (FR8, C6, C14, C16).
- **Feature 001 (Smart Agent Routing and Telemetry)** supplies the routing hard
  gates for every dispatched occurrence and the telemetry instruments + cardinality
  allowlist reused by T019 and T035 (FR27, C11, C18).
- **Feature 005 (OutputSpool/ArtifactStore)** owns the occurrence OutputGroup, the
  opaque OutputRef, and content-plane settlement; T023 provisions the OutputGroup
  and T024 carries only bounded refs, never resolving content (FR8a, FR22, C15).
- **Feature 007 (Operator Control Plane, ADR-0003 accepted)** is the sole
  management authority: its Config.Service/SecretPort persistence, Permission/
  Policy authorization, reserved-ID catalog (`packages/core/src/operator/**`,
  bumped by T028), registry, CAS, idempotency, audit, and the
  `.dev/opencode-operator/` sandbox wrapper (env prefix `OPENCODE_DEV_OPERATOR_=1`,
  loopback port 14096) are the only path for `jobs.*` registration (T027,
  T029–T030) and for integration/e2e tests (T033–T034). Feature 003 registers no
  parallel command registry (C5, C10, C12, C13).
</content>
</invoke>
