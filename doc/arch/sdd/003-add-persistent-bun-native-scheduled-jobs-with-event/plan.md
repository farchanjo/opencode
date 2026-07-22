# Implementation Plan: Persistent Bun-Native Scheduled Jobs and Async Main-Context Notification (Feature 003)

Feature: 003-add-persistent-bun-native-scheduled-jobs-with-event
Status target: planned (after this plan is complete)
Spec: [spec.md](spec.md) (status: planned; FR1–FR32 plus FR8a, and clarification decisions C1–C22)
Research: [research.md](research.md)
Required ADR (now created): **[ADR-0004 Scheduled Job Runtime and Async Notification Channel](../../adr/0004-scheduled-job-runtime-and-async-notification-channel.md)** (proposed)
Dependencies:
[Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md) (direct dependency: executor, lifecycle events, Process Table, session-owned Todo, observation seam),
[Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) (routing, hard gates, telemetry),
[ADR-0001 Telemetry Foundation](../../adr/0001-opentelemetry-telemetry-foundation.md) (proposed),
[ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md) (proposed),
[ADR-0003 Operator Control Plane](../../adr/0003-operator-control-plane-and-native-command-authority.md) (accepted, sole management authority),
[Feature 005 OutputSpool/ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) (occurrence OutputGroup, notification OutputRef),
[Feature 007 Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) (Config.Service, Permission/Policy, `jobs.*` command IDs).

---

## Overview

Feature 003 delivers persistent scheduled jobs whose triggers become canonical Feature 002
occurrences and bounded, authorized asynchronous notifications for the main context. It
adds no second scheduler, executor, event bus, persistence store, or notification channel:
the runtime is the confirmed in-process `Bun.cron(schedule, handler)` capability of Bun
`1.3.14`, definitions persist in the Feature 007 Config.Service authority, occurrences run
as Feature 002 Task Processes, `job.*` lifecycle and notification events register through
`EventV2.define`, and notifications ride the Feature 002 bounded observation seam. Every
decision follows ADR-0004 and the C1–C22 clarify resolutions.

- **Phase 1 — Schema and protocol foundation.** Job identity value objects, the Job
  Definition and Occurrence shapes, registration-state and occurrence-state enums, the
  `job.*` event vocabulary (FR11), the notification envelope, and the typed operator/query/
  notification payloads. Additive schema/protocol modules; no runtime behavior change.
- **Phase 2 — Domain scheduler engine (`packages/core/src/jobs/**`).** Cron parsing and
  next-occurrence computation over `Bun.cron.parse` behind a clock abstraction, the misfire
  and overlap policy evaluators, the occurrence state machine (C6), and startup registration
  reconciliation (C5). Framework-free, deterministic, no I/O in hot logic.
- **Phase 3 — Application and adapters (`packages/opencode/src/jobs/**`).** The `Bun.cron`
  scheduler adapter (register/unregister/reschedule, capability declaration), Config.Service
  persistence of definitions and durable intent, the trigger service that turns an occurrence
  into a Feature 002 Task Process and publishes `job.*` through the Feature 002 lifecycle
  bridge, the notification service over the Feature 002 observation seam, authorization/
  redaction before delivery, and the Feature 007 `jobs.*` operator domain port.
- **Phase 4 — Surfaces.** CLI `opencode op jobs <op>` verbs and the TUI jobs panel, both thin
  adapters over the Feature 007 registry with registry-generated names (C12).
- **Phase 5 — Tests.** Unit (pure domain), integration (persistence/reconciliation/projection
  against sandbox stores), contract (`jobs.*` IDs vs Feature 007), and e2e through the
  Feature 007 sandbox harness, covering AC1–AC29 and the C20 fault matrix.

Management authority for every operator surface is Feature 007 (ADR-0003, accepted).
Feature 003 supplies typed domain query/command implementations and audit events only; it
never registers a parallel command registry (C12).

---

## Non-goals

- Implementing code during the plan phase.
- A second executor, runtime, SessionRunner, EventV2 system, notification channel, or a
  permanent `while true`/`sleep` polling loop (FR9, FR20, AC1).
- Treating an in-process `Bun.cron` registration as the durable authority (FR3).
- A parallel definition/persistence store beside Config.Service (C5, C21).
- OS-level `Bun.cron(path, schedule, title)` execution in V1, or its bootstrap/IPC seam
  (C2 — deferred to V2 and an ADR-0004 successor).
- Distributed multi-worker scheduling, leader election, fencing, or placement (C7 — future
  distributed ADR).
- Exactly-once delivery or execution, or global event ordering (FR10, C6).
- Auto-retry or re-execution of ambiguous mutating effects after a crash (FR14, C11).
- Sharing one Todo list or one mutable OutputGroup/spool across a Job Definition and its
  occurrences, or carrying full occurrence output/content/paths in notification envelopes
  (FR8, FR8a, FR22, C14, C15).
- Owning Feature 002 lifecycle terminal status, Feature 005 settlement, Feature 001 routing
  classification, or Feature 007 reserved-ID authority.
- Fixing numeric budgets, retention/compaction bounds, minimum interval, clock-skew
  tolerance, queue capacities, or catch-up ceilings — provisional plan constants with named
  acceptance hooks, finalized in the tasks phase (C4, C5, C11, C19, C20).

---

## Technical Approach

### Architecture layers

```
Adapters (inbound)
  CLI opencode op jobs list|status|show|create|update|enable|disable|
      delete|reschedule|run-now|history|watch   (Feature 007 thin adapters)
  TUI jobs panel (definitions, occurrences, registration state, redacted history)
  Operator palette / native slash /op.jobs.<op> / App
        |
        v
Application (Feature 003 — packages/opencode/src/jobs/**)
  BunCronAdapter        — in-process register/unregister/reschedule + capability declaration
  JobPersistence        — Config.Service definitions + durable intent + registration state
  TriggerService        — occurrence -> Feature 002 Task Process; publish job.* via bridge
  NotificationService   — bounded, redacted delivery over the Feature 002 observation seam
  Authorization         — Permission/Policy visibility + redaction BEFORE delivery
  Operator jobs domain  — jobs.* typed command/query impls (via Feature 007)
        |
        v
Domain (Feature 003 core — packages/core/src/jobs/**, zero framework deps)
  Cron                  — parse/validate + next-occurrence over Bun.cron.parse + clock port
  OccurrenceStateMachine — due -> claimed -> admitted -> executing -> terminal (+ branches)
  MisfirePolicy         — skip | fire-once | bounded catch-up | coalesce (no infinite)
  OverlapPolicy         — allow | forbid(default) | queue | replace (capability-gated)
  SchedulerEngine       — definition -> registration intent; idempotency tuple; lag from due
  Reconciliation        — startup rehydration; pending/unknown/reconciled; no false replay
  JobsInstruments       — job.* spans/metrics extending Feature 001
        |
        v
Reused canonical points (existing — NOT re-implemented)
  Bun.cron (runtime)        — in-process callback + Bun.cron.parse (next UTC instant)
  Config.Service            — durable definition/intent authority (Feature 007)
  EventV2 + EventV2Bridge    — single event authority + publish boundary
  Feature 002 lifecycle bus  — publishLifecycleEvent; TaskTool/BackgroundJob/SessionExecution
  SessionRunCoordinator/Runner — execution; sequence/attempt/generation authority
  Feature 002 ObservationService — bounded Effect Stream/PubSub notification seam
  Feature 002 Todo model     — occurrence-owned Todo aggregate
  Feature 005 OutputGroup    — occurrence output; opaque OutputRef for envelopes
  Permission / Policy         — authorization and redaction authority (Feature 007)
  Feature 001 TelemetryInstruments + OTLP exporter — bounded async export
```

Dependency rule: adapters → application → domain. Domain MUST NOT import TUI/CLI/HTTP
frameworks, EventV2, Config.Service, or Bun runtime APIs directly; it takes a clock port and
a next-occurrence port and returns decisions. The scheduler never executes business logic in
the callback, never polls, and never bypasses Feature 002 admission or Feature 001 routing.

### Packages and modules (reuse first, no parallel authority)

| Concern | Existing location (reuse) | Feature 003 addition |
| ------- | ------------------------- | -------------------- |
| Scheduling runtime | `Bun.cron(schedule, handler)`, `Bun.cron.parse`, `Bun.cron.remove` (bun-types@1.3.13) | `BunCronAdapter` wrapping the confirmed in-process form behind a typed port (C1) |
| Definition persistence | `packages/core/src/operator/**`, `packages/opencode/src/operator/**` (Feature 007 Config.Service) | New durable job-definition table + durable intent/registration state (C5, C21) |
| Event authority | `packages/schema/src/event.ts` (`EventV2.define`), `packages/core/src/event.ts` (`Service`, `readAggregate`, `allBounded`, `pruneDurable`) | `job.*` and notification `Definition`s; no new bus (C8, C13) |
| Publish boundary | `packages/opencode/src/event-v2-bridge.ts` (`publishRoutingEvent`, `publishLifecycleEvent`) | `publishJobEvent` on the same bridge (C8) |
| Durable manifest | `packages/schema/src/durable-event-manifest.ts` (`Event.durable([...])`) | Job durable definitions joined into the `Durable` inventory (C5) |
| Executor / occurrence | `packages/opencode/src/tool/task.ts`, `packages/core/src/background-job.ts`, `packages/core/src/session.ts`, `packages/core/src/session/run-coordinator.ts` | Occurrence creates/associates a Feature 002 Task Process at existing seams; no TaskV3 (FR8, C16) |
| Lifecycle projection | Feature 002 `packages/core/src/lifecycle/**`, `packages/opencode/src/lifecycle/**` | Consume Process Table observation read-only; `job.*` are distinct observations (FR13, C16) |
| Notification seam | Feature 002 `observation-service.ts`, `authorization.ts` (Effect Stream/PubSub, redaction) | `NotificationService` over the same seam; no second channel (C8, C9) |
| Todo | Feature 002 session-owned Todo model (status `pending|in_progress|completed|cancelled`, CAS) | Occurrence-owned Todo per admitted occurrence; no shared list (FR8, C14) |
| OutputGroup | Feature 005 OutputGroup/OutputRef | Occurrence-owned OutputGroup; opaque OutputRef in envelopes (FR8a, FR22, C15) |
| Permission / secrets | `packages/core/src/permission.ts`, Feature 007 Policy + OS keychain | Target/action allowlists, operator auth, secret references only (FR29, C10) |
| Operator registry | `packages/core/src/operator/**`, `packages/opencode/src/operator/**` (Feature 007) | Register `jobs.*` via Feature 007 ports; reserved-ID collision rejection (C12, C13) |
| Telemetry | `packages/core/src/observability/telemetry-instruments.ts`, `otlp.ts` (Feature 001) | `job.*` spans/metrics reusing bounded-cardinality helpers (C18) |
| Schema / Protocol | `packages/schema`, `packages/protocol` | Jobs schema (novo), notification + command payloads (novo) |
| TUI | `packages/tui/src/**/operator/**`, `packages/tui/src/**/settings/**` | Jobs panel (definitions/occurrences/registration/history) (C12) |
| CLI | `packages/cli`, `packages/opencode/src/cli/cmd/op.ts` | `opencode op jobs <op>` verbs via Feature 007 (C12) |

**New module tree target:**

```
packages/schema/src/jobs/                      # novo — schema authority
  ids.ts             # JobDefinitionId, ScheduleId, OccurrenceId, ProcessId, SessionId,
                     #   RootSessionId, Attempt, Generation VOs (FR1)
  enums.ts           # RegistrationState (pending|registered|unregistered|unknown|reconciled),
                     #   OccurrenceState, MisfirePolicy, OverlapPolicy, ActionType,
                     #   NotificationType, DeliveryState, AckState (FR6, FR11, FR28)
  definition.ts      # JobDefinition: name/desc, enabled, schedule/cron, IANA timezone,
                     #   target/action, scope/project/root policy, redacted payload ref,
                     #   overlap/misfire/deadline/retry/priority/permissions/owner/version (FR2)
  schedule.ts        # CronExpression + IanaTimezone value objects (FR7)
  occurrence.ts      # Occurrence: idempotency tuple, correlation/causation, session/root,
                     #   process/attempt/generation, state, outcome (FR10, C6)
  events.ts          # job.* closed vocabulary, one Struct per event (FR11, FR12)
  notification.ts    # NotificationEnvelope: IDs, target root/session, source/type/priority,
                     #   created/expiry, correlation/causation, bounded summary + OutputRef,
                     #   delivery/ack state (FR22, C15)
  index.ts
packages/protocol/src/jobs/                    # novo — typed transport contracts
  ports.ts           # SchedulerPort, ClockPort, NextOccurrencePort, JobQueryPort,
                     #   NotificationPort (application/domain boundary)
  commands.ts        # jobs.* command + query payloads (C12)
  index.ts
packages/core/src/jobs/                        # novo — framework-free domain engine
  cron.ts            # parse/validate + next-occurrence over the NextOccurrencePort (C4)
  occurrence-state-machine.ts  # due->claimed->admitted->executing->terminal + branches (C6)
  misfire.ts         # skip|fire-once|bounded-catch-up|coalesce; no infinite catch-up (C19)
  overlap.ts         # allow|forbid(default)|queue|replace; capability-gated (C3)
  scheduler-engine.ts # definition -> registration intent; idempotency tuple; lag from due
  reconciliation.ts  # startup rehydration; pending/unknown/reconciled; no false replay (C5)
  jobs-instruments.ts # job.* spans/metrics extending Feature 001 (C18)
  index.ts
packages/opencode/src/jobs/                    # novo — application + adapters
  bun-cron-adapter.ts        # in-process Bun.cron register/unregister/reschedule + capability
  persistence.ts             # Config.Service definitions + durable intent + registration state
  trigger-service.ts         # occurrence -> Feature 002 Task Process; publishJobEvent (C16)
  notification-service.ts    # bounded delivery over the Feature 002 observation seam (C8, C9)
  authorization.ts           # Permission/Policy visibility + redaction before delivery (C10)
  index.ts
packages/opencode/src/operator/jobs/           # novo — Feature 007 jobs.* domain impls (C12)
packages/opencode/src/event-v2-bridge.ts       # existing — extend: publishJobEvent (C8)
packages/schema/src/durable-event-manifest.ts  # existing — extend Durable inventory (C5)
packages/cli/src/**/jobs/                       # novo — opencode op jobs ... commands
packages/tui/src/**/operator/jobs/              # novo — jobs panel
doc/arch/schemas/jobs/*.cue                     # novo — CUE mirrors (calisthenics-compliant)
```

CUE data-model companions mirror the schema modules under `doc/arch/schemas/jobs/*.cue`
(ids, enums, definition, schedule, occurrence, events, notification), following the
Feature 001/002 calisthenics style: every entity field is a `#ValueObject` reference, each
file carries a `// DDD role:` header, and each definition file stays under the
ten-definition warning bound.

---

## Incremental slices

| Slice | Name | Delivers | Phase | Depends |
| ----- | ---- | -------- | ----- | ------- |
| S0 | Job identifiers + enums | `ids.ts`, `enums.ts`: definition/schedule/occurrence/process/session/root VOs, attempt/generation; registration-state, occurrence-state, misfire, overlap, action, notification, delivery, ack enums (FR1, FR6, FR11) | 1 | — |
| S1 | Definition + schedule schema | `definition.ts` (FR2), `schedule.ts` cron+IANA timezone VOs (FR7) | 1 | S0 |
| S2 | Occurrence schema | `occurrence.ts`: idempotency tuple `(job_definition_id, schedule_id, nominal_due_time, generation)`, correlation/causation, session/root/process/attempt/generation, state, outcome (FR10, C6) | 1 | S0 |
| S3 | Event vocabulary | `events.ts`: the `job.*` closed vocabulary (FR11), one Struct per event; envelope fields per FR12 | 1 | S1, S2 |
| S4 | Notification envelope + payloads | `notification.ts` (FR22, C15); `protocol/jobs/ports.ts`, `commands.ts` (FR30, C12) | 1 | S2, S3 |
| S5 | Cron + next-occurrence | `cron.ts`: parse/validate 5-field + IANA timezone; next-occurrence via the `NextOccurrencePort` over `Bun.cron.parse`; minimum interval, DST duplicate/skip/leap normalization; lag from nominal due (FR7, C4, AC4) | 2 | S1 |
| S6 | Occurrence state machine | `occurrence-state-machine.ts` due→claimed→admitted→executing→terminal with branch outcomes; idempotent duplicate resolution (FR10, FR11, C6, AC6) | 2 | S2 |
| S7 | Misfire + overlap policy | `misfire.ts` skip/fire-once/bounded-catch-up/coalesce, no infinite; `overlap.ts` allow/forbid(default)/queue/replace, capability-gated, mutation-safe replace (FR15, FR16, C3, C19, AC3, AC5, AC24) | 2 | S6 |
| S8 | Scheduler engine + reconciliation | `scheduler-engine.ts` definition→registration intent, idempotency tuple, lag; `reconciliation.ts` startup rehydration, pending/unknown/reconciled, no false replay, no cross-system atomicity (FR3, FR6, C5, AC2, AC23) | 2 | S5, S6 |
| S9 | Bun.cron adapter | `bun-cron-adapter.ts` in-process register/unregister/reschedule; capability declaration for in-process vs OS-level; typed capability gap; no polling, no business logic in callback (FR4, FR5, C1, AC1, AC22) | 3 | S8 |
| S10 | Definition persistence | `persistence.ts` Config.Service durable definitions + intent + registration state; atomic within authority; external effect + compensation (FR6, C5, C21, AC13) | 3 | S8 |
| S11 | Trigger → occurrence → Task Process | `trigger-service.ts` publish `job.trigger_due`, create occurrence, create/associate Feature 002 Task Process via TaskTool/SessionExecution; occurrence-owned Todo + Feature 005 OutputGroup; `publishJobEvent` on the bridge (FR8, FR8a, C14, C15, C16, AC11, AC26, AC28) | 3 | S9, S10 |
| S12 | Job event bus | `job.*` `EventV2.define` Definitions; durable/live split; durable manifest extension; idempotent projection reusing Feature 002 posture (FR11, FR12, C8, AC18) | 2–3 | S3 |
| S13 | Notification service | `notification-service.ts` bounded delivery over the Feature 002 observation seam, segmented by root/session/project; operator-only default action; safe-boundary queue/coalesce/expire; bounded summary + opaque OutputRef only (FR20–FR27, C8, C9, C15, AC7–AC10, AC29) | 3 | S12 |
| S14 | Authorization + redaction | `authorization.ts` Permission/Policy visibility + redaction before delivery; cross-session/project leakage rejected; secret references only (FR21, FR32, C10, AC9, AC16, AC17) | 3 | S13 |
| S15 | Operator jobs domain | `operator/jobs/**` typed `jobs.*` command/query impls + audit events via Feature 007; reserved `job.*`/`jobs.*` collision rejection; `run-now` normal occurrence, no LLM turn (FR28–FR32, C12, C13, AC14, AC17) | 3 | S11, S14 |
| S16 | Jobs telemetry | `jobs-instruments.ts` `job.schedule|trigger|claim|notify|dispatch|execute|retry|reconcile` spans linked to `task.execute`; bounded-label metrics; async bounded export (Observability, C18, AC15, AC16) | 2–3 | S6, S12 |
| S17 | CLI + TUI surfaces | `cli/**/jobs/**` `opencode op jobs <op>`; `tui/**/operator/jobs/**` panel; registry-generated names; redacted/versioned output (FR30, C12) | 4 | S15 |
| S18 | Tests + validation | Unit (cron/state-machine/misfire/overlap/reconciliation), integration (persistence/projection/notification under sandbox stores), contract (`jobs.*` vs Feature 007), e2e + C20 fault matrix through the Feature 007 sandbox (all AC1–AC29) | 5 | all |

---

## Data model and persistence strategy

Entity field definitions, enums, and schema-module mapping are SSOT in
[data-model.md](data-model.md) and `doc/arch/schemas/jobs/*.cue` — this plan only
records the durability split and authority boundaries for implementers.

- **Job Definitions + durable registration intent** → Feature 007 Config.Service
  (new durable table); Bun registration is an external effect, never the store of
  record (FR2, FR6, C5).
- **Occurrences, notifications, and `job.*` lifecycle events** → EventV2
  projections only; sequence/attempt/generation stay Feature 002 executor
  authority (FR10, C6, C8).
- **Occurrence-owned Todo / OutputGroup** → one Todo and one Feature 005 OutputGroup
  per occurrence; never shared with the Job Definition (FR8, FR8a, C14, C15).
- **Notification envelope** → bounded summary + opaque OutputRef only; no paths or
  full content (FR22, C15).

See [data-model.md](data-model.md) for Job Definition fields, registration-state
enums, idempotency tuple, durable-vs-live event vocabulary, and envelope shapes.

---

## API and command contracts

### Notification and query ports (C8, C9)

Read-only observation over the Feature 002 Effect Stream/PubSub seam with scoped finalizers;
authorization and redaction run before delivery; an observer never mutates lifecycle state.
Control-plane wake/queue/steer uses native SessionInput/SessionExecution.

| Port operation | Signature intent | Scope |
| -------------- | ---------------- | ----- |
| `NotificationPort.observe(scope)` | Bounded stream of authorized `job.notification_*` envelopes | root/session/project |
| `NotificationPort.acknowledge(id)` | Record ack for a delivered notification | session |
| `JobQueryPort.list(filter)` | Redacted definitions with enabled/registration state | project |
| `JobQueryPort.occurrences(jobId)` | Redacted occurrence history with outcomes | project |

### Operator command surface (C12, registered via Feature 007)

Canonical dotted IDs under the reserved `jobs.*` domain, owned by Feature 007 per ADR-0003;
Feature 003 supplies typed domain implementations and audit events only. Native slash is
intercepted before prompt admission; zero provider/model calls, tokens, or cost by default;
output not added to Message/Part/context by default. The registry generates palette labels,
slash aliases (`/op.jobs.<op>`), and CLI verbs (`opencode op jobs <op>`). Reserved IDs are
never registered by plugin/MCP/custom registries.

| Palette/slash ID | CLI | Description | Model calls | Cost |
| ---------------- | --- | ----------- | ----------- | ---- |
| `jobs.list` | `opencode op jobs list` | Redacted definitions, enabled + registration state | 0 | 0 |
| `jobs.status` | `opencode op jobs status <id>` | Definition status, next due, last outcome | 0 | 0 |
| `jobs.show` | `opencode op jobs show <id>` | Full redacted definition + occurrence history | 0 | 0 |
| `jobs.create` | `opencode op jobs create` | Create definition (CAS, scope, audit) | 0 | 0 |
| `jobs.update` | `opencode op jobs update <id>` | Update definition (version/CAS) | 0 | 0 |
| `jobs.enable` | `opencode op jobs enable <id>` | Enable + register (idempotent) | 0 | 0 |
| `jobs.disable` | `opencode op jobs disable <id>` | Disable + unregister; no silent kill | 0 | 0 |
| `jobs.delete` | `opencode op jobs delete <id>` | Delete definition + compensating unregister | 0 | 0 |
| `jobs.reschedule` | `opencode op jobs reschedule <id>` | Change schedule; re-register intent | 0 | 0 |
| `jobs.run-now` | `opencode op jobs run-now <id>` | Create a normal occurrence through admission/routing | 0 | 0 |
| `jobs.history` | `opencode op jobs history <id>` | Redacted occurrence/notification history | 0 | 0 |
| `jobs.watch` | `opencode op jobs watch <id>` | Live `job.*` stream over the observation seam | 0 | 0 |

Create, update, enable, disable, delete, reschedule, and run-now require operator
authorization, explicit scope, version/CAS, idempotency, and audit; no action is performed by
editing state directly or by an observer (FR32, Security 5). `run-now` starts no LLM turn
solely for administration (FR31, AC14).

---

## State machines

Occurrence, registration, and notification state machines (including absorbing
terminals, attempt/generation ownership, and reconcile edges) are SSOT in
[data-model.md](data-model.md) — Occurrence lifecycle (C6), Registration state
machine (C5), Notification delivery lifecycle (C9). This plan only sketches the
implementer-facing trigger path.

### Trigger flow (C16)

```
Bun.cron in-process callback fires (no polling)
  -> publish job.trigger_due + create Occurrence (idempotency tuple)
  -> Feature 002 admission + Feature 001 routing (hard-gated)
  -> create/associate Feature 002 Task Process (TaskTool/SessionExecution)
  -> occurrence-owned Todo + Feature 005 OutputGroup before goal-bearing work
  -> executor runs; job.execution_* + notification_* projected on EventV2
  -> Process Table observes; it never executes a job
```

---

## Security and threat boundaries

| Threat | Mitigation |
| ------ | ---------- |
| LLM/tool/MCP/prompt as job admin | Administration is Feature 007 native operator-only; attempts rejected (FR28, Security 8, AC17) |
| Reserved namespace hijack | `job.*` and `jobs.*` reserved; plugin/MCP/custom/PromptTemplate collisions rejected with `reserved_name` (C13) |
| Cross-session/project notification leakage | Authorization + visibility filter + redaction before delivery/projection; leak is a failure (FR21, C10, AC9) |
| Secret / payload / path leakage | Secure references only; envelopes carry bounded summary + opaque OutputRef; no content/paths in metrics/logs/traces (FR22, FR32, Security 3, C15) |
| Raw prompt injection into a busy turn | Operator-only default; safe-boundary queue/coalesce/expire; wake/queue/child explicit + audited (FR24, FR25, C9) |
| Unbounded cron fan-out / queues | Feature 002 admission + bounded queues + explicit misfire; no infinite catch-up (FR17–FR19, C19, AC12, AC21) |
| False kill of mutating work | Disable/delete never silently terminates; `unconfirmed`/`unknown`; no false remote kill (FR16, Security 7, C17, AC25) |
| Cross-system atomicity claim | Atomic within Config.Service only; external effect + compensation; pending/unknown/reconciled (FR6, C5, AC23) |
| Auto-retry of ambiguous mutation | No blind retry absent an explicit mutation-safe policy; reconciled/unknown instead (FR14, C11, AC19, AC20) |
| High-cardinality metric labels | Bounded enums/buckets; IDs only in traces/logs; over-budget maps to `other` (C18, AC16) |
| Invented Bun API on unsupported platform | Typed capability gap; validation fails before registration (FR5, C1, AC22) |

---

## Rollback strategy

| Layer | Rollback |
| ----- | -------- |
| Jobs schema/protocol | Additive modules; removal restores prior behavior; no runtime coupling until Phase 3 wiring |
| `job.*` EventV2 Definitions | Additive to the inventory; unregistering removes projection input without affecting routing/lifecycle events |
| Bun.cron adapter | Feature-flagged; disabled leaves no in-process registrations; definitions remain durable and unregistered |
| Definition persistence | Config.Service atomic CAS rollback per mutation; audit retained; new table is additive |
| Occurrence engine | Pure domain; discarding it stops new occurrences without mutating Feature 002 state |
| Notification service | Bounded observation over the Feature 002 seam; scoped finalizers guarantee leak-free teardown |
| Operator commands | Feature 007 atomic CAS rollback per command; audit retained |
| Cancellation | Cancel is a request, not a mutation; unconfirmed remote effects surface as `unknown` |

---

## Isolation harness

Feature 003 operator surfaces and integration/e2e tests reuse the existing Feature 007
isolation harness. Hot-path domain logic (cron next-occurrence, occurrence state machine,
misfire, overlap, reconciliation) runs in-process with a fake clock and mock ports; Bun cron
uses fake timers where the runtime supports them.

| Item | Value |
| ---- | ----- |
| Sandbox root | `.dev/opencode-operator/` (gitignored) |
| Env prefix | `OPENCODE_DEV_OPERATOR_=1`, `OPENCODE_CONFIG_DIR=.dev/opencode-operator/config` |
| Port | 14096 (loopback) |
| Wrapper | `scripts/dev/opencode-operator-sandbox` |
| Forbidden | `~/.config/opencode`, system service register, OS-level cron register, real OAuth, non-loopback bind |
| Proof tests | Default config paths and prod ports unchanged when the wrapper is unused; no host crontab/launchd entry created in V1 |

---

## Testing matrix

| Layer | Scope | How |
| ----- | ----- | --- |
| Unit | Cron parse/next-occurrence (UTC/DST/leap/duplicate), occurrence state machine, misfire, overlap, reconciliation, idempotency tuple, envelope redaction | Pure tests; fake clock; deterministic; no I/O |
| Integration | Config.Service persistence + CAS, startup rehydration/reconciliation, `job.*` projection over EventV2, notification delivery/ack/expiry under saturation, authorization + redaction | Sandbox stores under `.dev/`; mock exporter; fake timers |
| Contract | `jobs.*` IDs vs Feature 007 registry; reserved `job.*`/`jobs.*` collision rejection; notification/query payloads vs `protocol/jobs/**` | Spec-driven; specScopeGlobs enforced |
| E2E | CLI human + JSON `op jobs`; TUI jobs panel; disable/delete without false kill; run-now occurrence | Feature 007 sandbox wrapper only |
| Fault (C20) | Registration failure, partial persistence, event storms, cron fan-out, notification lag, long handlers, cancellation, OTEL outage, restart, reconciliation | Bound to AC1, AC2, AC3, AC5, AC7, AC8, AC12, AC15, AC19, AC21, AC22, AC23, AC24, AC25 |
| Telemetry | `job.*` spans correlated with `task.execute`; bounded labels; async export never blocks | Cardinality audit; no IDs as labels |

Acceptance coverage maps every scenario AC1–AC29 to a slice. Provisional numeric thresholds
carry named acceptance hooks (AC3, AC4, AC8, AC12, AC15, AC20, AC21) and are fixed in the
tasks phase.

---

## Observability alignment

- `job.*` spans `job.schedule`, `job.trigger`, `job.claim`, `job.notify`, `job.dispatch`,
  `job.execute`, `job.retry`, and `job.reconcile` link to `task.execute`, session execution,
  LLM, tool, and fallback spans (Observability, C18).
- Metric labels reuse the Feature 001 bounded enums and `createCardinalityAllowlist`;
  over-budget values map to `other`.
- Metrics: enabled definitions; due/triggered/misfired/skipped/coalesced counts; schedule
  lag; queue wait; duration; success/failure/cancel/timeout; overlap; retry; notification
  queue/delivery/ack/expiry; saturation; reconciliation (Observability).
- `job_definition_id`/`occurrence_id`/`session_id`/`process_id` appear only in traces/logs,
  never metric labels (C18, AC16). Prompts, paths, payloads, and secrets are excluded by
  default.
- OTLP export is asynchronous and bounded through the Feature 001 exporter and never blocks
  the trigger, occurrence, or execution hot path; local authority remains usable during an
  OTEL outage (AC15).
- Feature 003 adds no new exporter, SDK, or pipeline; it reuses ADR-0001/Feature 001 and
  Feature 002 lifecycle events (C18).

---

## Proposed specScopeGlobs (tasks/implement phase)

Narrow, file-exact globs to add to `doc/arch/speckit.toml` in the tasks phase — **not applied
by this plan**. Feature 001/002/007 TOML paths are preserved unchanged; existing shared seams
(`packages/opencode/src/event-v2-bridge.ts`, `packages/schema/src/durable-event-manifest.ts`,
`packages/core/src/event.ts`, `packages/core/src/operator/**`,
`packages/opencode/src/operator/**`) already cover the reused points and are not duplicated.
The plan-phase corpus lives under the always-derived `doc/arch/sdd/003-.../**` scope and
needs no glob addition.

```toml
specScopeGlobs = [
  # Feature 003 — Persistent Bun-Native Scheduled Jobs (novo implement paths).
  "packages/schema/src/jobs/**",
  "packages/protocol/src/jobs/**",
  "packages/core/src/jobs/**",
  "packages/opencode/src/jobs/**",
  "packages/opencode/src/operator/jobs/**",
  "packages/cli/src/**/jobs/**",
  "packages/tui/src/**/operator/jobs/**",
  "packages/schema/test/jobs/**",
  "packages/protocol/test/jobs/**",
  "packages/core/test/jobs/**",
  "packages/opencode/test/jobs/**",
  # Existing shared paths extended (already in scope; listed for traceability):
  # "packages/opencode/src/event-v2-bridge.ts",
  # "packages/schema/src/durable-event-manifest.ts",
]
```

---

## Companion artifacts

| File | Purpose |
| ---- | ------- |
| [research.md](research.md) | Evidence base: Bun.cron runtime + type surface, EventV2/Config.Service mechanics, Feature 002 seams, alternatives |
| [spec.md](spec.md) | Feature specification (planned; FR1–FR32 + FR8a, C1–C22) |
| [ADR-0004](../../adr/0004-scheduled-job-runtime-and-async-notification-channel.md) | Required runtime + notification-channel decision record |
| `data-model.md` (novo) | Entity definitions: JobDefinition, Schedule, Occurrence, NotificationEnvelope, registration/occurrence enums |
| `contracts/` (novo) | TypeScript port contracts: SchedulerPort, ClockPort, NextOccurrencePort, JobQueryPort, NotificationPort, `jobs.*` command payloads |
| `hierarchy-flow.md` (novo) | Diagram: trigger → occurrence → Feature 002 Task Process → EventV2 → observers/notification/OTEL |
| `doc/arch/schemas/jobs/*.cue` (novo) | CUE data-model mirrors, calisthenics-compliant per the routing/lifecycle exemplars |

---

## Implementation order (task groups preview)

Phase 1 (schema/protocol foundation, additive):

1. Job identifiers and enums (`ids.ts`, `enums.ts`).
2. Job Definition and schedule schemas (`definition.ts`, `schedule.ts`).
3. Occurrence schema with the idempotency tuple (`occurrence.ts`).
4. The `job.*` event vocabulary and envelope fields (`events.ts`).
5. Notification envelope and protocol ports/commands (`notification.ts`, `protocol/jobs/**`).

Phase 2 (domain scheduler engine):

6. Cron parse/validate and next-occurrence over `Bun.cron.parse` behind a port (`cron.ts`).
7. Occurrence state machine with idempotent duplicate resolution (`occurrence-state-machine.ts`).
8. Misfire and overlap policy evaluators (`misfire.ts`, `overlap.ts`).
9. Scheduler engine and startup reconciliation (`scheduler-engine.ts`, `reconciliation.ts`).
10. `job.*` EventV2 Definitions, durable/live split, idempotent projection.
11. Jobs telemetry spans/metrics reusing Feature 001 instruments.

Phase 3 (application + adapters):

12. Bun.cron in-process adapter with capability declaration (`bun-cron-adapter.ts`).
13. Config.Service definition persistence and registration state (`persistence.ts`).
14. Trigger service: occurrence → Feature 002 Task Process; occurrence-owned Todo + OutputGroup.
15. Notification service over the Feature 002 observation seam with safe-boundary policy.
16. Authorization and redaction before delivery.
17. Feature 007 `jobs.*` domain commands and audit events.

Phase 4 (surfaces):

18. CLI `opencode op jobs <op>` verbs.
19. TUI jobs panel (definitions, occurrences, registration state, redacted history).

Phase 5 (tests):

20. Unit, integration, contract, e2e, and the C20 fault matrix across AC1–AC29.

---

## Feature cross-dependencies

| Feature | Dependency | Interaction |
| ------- | ---------- | ----------- |
| 001 Smart Routing | Every dispatched occurrence passes hard gates and the router; reuses telemetry instruments | S11, S16 (FR27, C11, C18) |
| 002 Task Lifecycle | Direct dependency: executor, `job.*`/lifecycle events, Process Table, session-owned Todo, observation seam | S6, S11–S14 (FR8, C14, C16) |
| 005 OutputSpool | Occurrence-owned OutputGroup; opaque OutputRef in notification envelopes; Feature 005 owns settlement | S11, S13 (FR8a, FR22, C15) |
| 006 Milvus Semantic | Scheduled index reconciliation as coalesced native occurrences, no LLM by default | S7, S11 |
| 007 Operator Control Plane | Sole management authority for `jobs.*` IDs, auth, audit; Config.Service + Permission/Policy | S10, S15 (C10, C12, C13) |
| 008 MCP Tools | Optional scheduled/wake for resource policy only; no automatic wake per update; ownership unchanged | S13 |

---

## Validation checklist (plan complete when)

- [x] Runtime is the confirmed in-process `Bun.cron(schedule, handler)`; no polling loop; no
      invented API (FR4, FR5, C1, AC1, AC22)
- [x] Definitions and durable intent persist in Config.Service; a Bun registration is never
      the durable authority (FR3, C5, C21)
- [x] Registration state `pending|registered|unregistered|unknown|reconciled`; atomic within
      authority; external effect + compensation; no cross-system transaction (FR6, C5, AC23)
- [x] Occurrence state machine with the idempotency tuple; executor owns sequence/attempt/
      generation; no exactly-once, no global order (FR10, C6, AC6)
- [x] Every trigger re-enters Feature 002 admission/routing/lifecycle; no second executor,
      runtime, event bus, or lifecycle (FR8, FR9, C16, AC11)
- [x] Single EventV2 authority; `job.*` and notification events via `EventV2.define`; no
      second channel (FR11, FR20, C8, C13)
- [x] Overlap default `forbid`, capability-gated, mutation-safe replace; misfire without
      infinite catch-up; lag from nominal due (FR15, FR16, FR19, C3, C19)
- [x] Notification bounded/redacted/segmented; operator-only default; safe-boundary
      queue/coalesce/expire; bounded summary + opaque OutputRef only (FR22–FR25, C9, C15)
- [x] Occurrence-owned Todo and Feature 005 OutputGroup; no shared live state; cancel
      preserves independence (FR8, FR8a, C14, C15, AC26–AC29)
- [x] Reserved `job.*`/`jobs.*` namespaces; collisions rejected with `reserved_name` (C13)
- [x] Native-only administration via Feature 007; `run-now` starts no LLM turn; CAS/audit
      (FR28–FR32, C12, AC14, AC17)
- [x] No false kill of mutating work; `unconfirmed`/`unknown`; no auto-retry of ambiguous
      effects (FR14, FR16, C11, C17, AC19, AC20, AC25)
- [x] Telemetry reuses ADR-0001/Feature 001 and Feature 002 events; bounded labels; async
      export never blocks; IDs in traces/logs only (C18, AC15, AC16)
- [x] OS-level `Bun.cron` and distributed scheduling deferred to ADR-0004 successors (C2, C7)
- [x] Proposed specScopeGlobs listed for the tasks phase; Feature 001/002/007 paths preserved
- [x] Companion artifacts listed (`data-model.md`, `contracts/`, `hierarchy-flow.md`,
      `doc/arch/schemas/jobs/*.cue`)
- [x] Provisional numeric thresholds carry named acceptance hooks; finalized in the tasks phase
</content>
