# Data Model: Persistent Bun-Native Scheduled Jobs and Async Main-Context Notification (Feature 003)

Feature: [003 Scheduled Jobs and Async Main-Context Notification](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
ADR: [ADR-0004 Scheduled Job Runtime and Async Notification Channel](../../adr/0004-scheduled-job-runtime-and-async-notification-channel.md) (proposed)
Status: draft (finalized in the tasks phase; numeric defaults resolved in ADR-0004
and its successors — C4, C5, C11, C19, C20)

Two shapes here are stores of record and nothing else is: **Job Definitions and
their durable registration intent** persist in the Feature 007 Config.Service
authority (a new durable table), and **occurrences, notifications, and lifecycle
events** are projections over the single EventV2 authority (C5, C8). No shape below
is a second executor, event bus, scheduler, or notification channel. Each `job.*`
event registers through `EventV2.define` on the existing `EventV2Bridge` via a new
`publishJobEvent` boundary, mirroring the Feature 001 routing and Feature 002
lifecycle patterns (C8, C16).

## Schema surface conventions

All TypeScript shapes use this repository's Effect `Schema` v4 surface, matching
`packages/schema/src/schema.ts` and the existing `packages/schema/src/lifecycle/**`
and `packages/schema/src/routing/**` modules:

- Closed enums use `Schema.Literals([...])`; a single discriminant literal uses
  `Schema.Literal("...")`.
- **Annotate-first on a plain base for every checked scalar.** Each identifier,
  counter, and bounded-text ValueObject is built on the plain `Schema.String` /
  `Schema.Number` base, `.annotate({ identifier })` is applied BEFORE any
  `.check(...)`, and `Schema.brand(...)` (where the CUE definition is
  identifier-shaped) is applied last. Annotating an already-checked schema (including
  `Schema.Int`, the shared `PositiveInt` / `NonNegativeInt`) drops the root identifier
  from `.ast.annotations` in favor of the last check, so base-then-check-then-brand is
  load-bearing for contract hygiene (see `packages/schema/src/lifecycle/ids.ts`,
  `values.ts`, and `test/contract-hygiene.test.ts`).
- Integer counters fold `Schema.isInt()` into the check chain alongside the bound
  check; real-valued fields use `Schema.Finite`.
- Optional keys use the shared `optional(...)` helper; explicit nullable fields use
  `Schema.NullOr(...)`.
- Epoch-millis observational timestamps decode through `DateTimeUtcFromMillis`. The
  `nominal_due_time` idempotency component is a branded string (a canonical
  scheduling-instant key), never a decoded `DateTime`, so the idempotency tuple has a
  stable identity (C6).
- No stale `Schema.literal` / `Schema.Clamp` / `Schema.Positive` / `Schema.Number`
  (bare) forms are used; those are not part of this repository's surface.

Each shape names its target module under `packages/schema/src/jobs/**` and mirrors a
CUE definition under `doc/arch/schemas/jobs/*.cue` one-to-one. The CUE packages are
`jobs.shared`, `jobs.schedule`, `jobs.enums`, `jobs.envelope`, `jobs.definition`,
`jobs.occurrence`, `jobs.reconciliation`, `jobs.notification`, and `jobs.events`.

---

## Shared identifiers

Name parity with `lifecycle.shared` and `routing.shared` is intentional; this feature
does not cross-import those modules, so the identifier concepts are re-declared
locally (C1, C6, C16). `process_id` is the Feature 002 Task Process id, never an OS
PID (C16). Mirrors `doc/arch/schemas/jobs/ids.cue`.

```typescript
// packages/schema/src/jobs/ids.ts (novo)

import { Schema } from "effect"

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/
const notificationIdPattern = /^ntf_[A-Za-z0-9_-]{1,120}$/

// JobDefinitionId identifies a durable Job Definition aggregate (FR1, FR2).
export const JobDefinitionId = Schema.String.annotate({ identifier: "JobsIds.JobDefinitionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.JobDefinitionId"))
export type JobDefinitionId = typeof JobDefinitionId.Type

// ScheduleId identifies one schedule bound to a Job Definition (FR1).
export const ScheduleId = Schema.String.annotate({ identifier: "JobsIds.ScheduleId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.ScheduleId"))
export type ScheduleId = typeof ScheduleId.Type

// OccurrenceId identifies one logical trigger occurrence (FR1, FR10).
export const OccurrenceId = Schema.String.annotate({ identifier: "JobsIds.OccurrenceId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.OccurrenceId"))
export type OccurrenceId = typeof OccurrenceId.Type

// ProcessId is the Feature 002 Task Process id — never an OS PID (FR1, C16).
export const ProcessId = Schema.String.annotate({ identifier: "JobsIds.ProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.ProcessId"))
export type ProcessId = typeof ProcessId.Type

// RootProcessId references the root attempt of the authorized tree.
export const RootProcessId = Schema.String.annotate({ identifier: "JobsIds.RootProcessId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.RootProcessId"))
export type RootProcessId = typeof RootProcessId.Type

// SessionId / ParentSessionId / RootSessionId — occurrence tree identity (FR1, FR21).
export const SessionId = Schema.String.annotate({ identifier: "JobsIds.SessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.SessionId"))
export type SessionId = typeof SessionId.Type

export const ParentSessionId = Schema.String.annotate({ identifier: "JobsIds.ParentSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.ParentSessionId"))
export type ParentSessionId = typeof ParentSessionId.Type

export const RootSessionId = Schema.String.annotate({ identifier: "JobsIds.RootSessionId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("Jobs.RootSessionId"))
export type RootSessionId = typeof RootSessionId.Type

// NotificationId identifies one notification envelope (FR22).
export const NotificationId = Schema.String.annotate({ identifier: "JobsIds.NotificationId" })
  .check(Schema.isPattern(notificationIdPattern))
  .pipe(Schema.brand("Jobs.NotificationId"))
export type NotificationId = typeof NotificationId.Type

// EventId is the EventV2 evt_ id assigned per published job.* event (C8).
export const EventId = Schema.String.annotate({ identifier: "JobsIds.EventId" })
  .check(Schema.isPattern(eventIdPattern))
  .pipe(Schema.brand("Jobs.EventId"))
export type EventId = typeof EventId.Type
```

Correlation, principal, and secure-reference ValueObjects keep opaque handles only;
secrets are OS-keychain-backed references, never raw values (Security 3, C10). Mirrors
`doc/arch/schemas/jobs/correlation.cue`.

```typescript
// packages/schema/src/jobs/correlation.ts (novo)

const decisionIdPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/

export const CorrelationId = Schema.String.annotate({ identifier: "JobsIds.CorrelationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Jobs.CorrelationId"))
export const CausationId = Schema.String.annotate({ identifier: "JobsIds.CausationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Jobs.CausationId"))
// DecisionId / TurnId — Feature 001 routing parity ids (C11).
export const DecisionId = Schema.String.annotate({ identifier: "JobsIds.DecisionId" })
  .check(Schema.isPattern(decisionIdPattern)).pipe(Schema.brand("Jobs.DecisionId"))
export const TurnId = Schema.String.annotate({ identifier: "JobsIds.TurnId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Jobs.TurnId"))
// Principal — operator/system principal (C10, C12). SecretRef / PayloadRef / OutputRef
// / ProjectRef / TodoRef — opaque non-empty references (Security 3, FR8, FR8a, C15).
export const Principal = Schema.String.annotate({ identifier: "JobsIds.Principal" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Jobs.Principal"))
export const SecretRef = Schema.String.annotate({ identifier: "JobsIds.SecretRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Jobs.SecretRef"))
export const PayloadRef = Schema.String.annotate({ identifier: "JobsIds.PayloadRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Jobs.PayloadRef"))
export const OutputRef = Schema.String.annotate({ identifier: "JobsIds.OutputRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Jobs.OutputRef"))
export const ProjectRef = Schema.String.annotate({ identifier: "JobsIds.ProjectRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Jobs.ProjectRef"))
export const TodoRef = Schema.String.annotate({ identifier: "JobsIds.TodoRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Jobs.TodoRef"))
```

Ordering, version, budget, and lag counters keep primitive obsession out of the
aggregates. Sequence/attempt/generation are carried, not authored, here — the
canonical Feature 002 executor owns them (C6). Mirrors
`doc/arch/schemas/jobs/values.cue`.

```typescript
// packages/schema/src/jobs/values.ts (novo)

// Per-aggregate order; no global order (FR10, FR12).
export const Sequence = Schema.Number.annotate({ identifier: "JobsValues.Sequence" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// 1-based executor-owned attempt (C6).
export const Attempt = Schema.Number.annotate({ identifier: "JobsValues.Attempt" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// Fencing generation carried in the idempotency tuple (C6).
export const Generation = Schema.Number.annotate({ identifier: "JobsValues.Generation" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// EventV2 durable.version counter (C8).
export const SchemaVersion = Schema.Number.annotate({ identifier: "JobsValues.SchemaVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// Job Definition CAS/optimistic-concurrency version (FR2, FR6).
export const Version = Schema.Number.annotate({ identifier: "JobsValues.Version" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// Deadline / timeout / retry budget / priority — provisional bounds (AC12).
export const DeadlineMs = Schema.Number.annotate({ identifier: "JobsValues.DeadlineMs" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const TimeoutMs = Schema.Number.annotate({ identifier: "JobsValues.TimeoutMs" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const RetryBudget = Schema.Number.annotate({ identifier: "JobsValues.RetryBudget" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const Priority = Schema.Number.annotate({ identifier: "JobsValues.Priority" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// Schedule lag measured from nominal due time (FR19, AC3, AC4).
export const ScheduleLagMs = Schema.Number.annotate({ identifier: "JobsValues.ScheduleLagMs" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
```

Bounded redacted text, flag, and permission ValueObjects exclude raw prompts,
results, spool paths, and secrets (FR22, FR32, Privacy). Mirrors
`doc/arch/schemas/jobs/text-values.cue`.

```typescript
// packages/schema/src/jobs/text-values.ts (novo)

export const JobName = Schema.String.annotate({ identifier: "JobsValues.JobName" }).check(Schema.isNonEmpty())
export const JobDescription = Schema.String.annotate({ identifier: "JobsValues.JobDescription" })
export const ActionTarget = Schema.String.annotate({ identifier: "JobsValues.ActionTarget" }).check(Schema.isNonEmpty())
export const BoundedSummary = Schema.String.annotate({ identifier: "JobsValues.BoundedSummary" })
export const Reason = Schema.String.annotate({ identifier: "JobsValues.Reason" })
export const TraceId = Schema.String.annotate({ identifier: "JobsValues.TraceId" }).check(Schema.isNonEmpty())
export const SpanId = Schema.String.annotate({ identifier: "JobsValues.SpanId" }).check(Schema.isNonEmpty())
export const Enabled = Schema.Boolean.annotate({ identifier: "JobsValues.Enabled" })
export const PermissionSet = Schema.Array(Schema.String).annotate({ identifier: "JobsValues.PermissionSet" })
```

Cron and IANA-timezone ValueObjects plus the composite `CronSchedule`. The canonical
stored form is an IANA timezone plus a 5-field cron expression; due instants are
normalized by an explicit occurrence layer over `Bun.cron.parse`, not by relying on
the runtime's UTC interpretation alone (C4). Mirrors
`doc/arch/schemas/jobs/schedule.cue`.

```typescript
// packages/schema/src/jobs/schedule.ts (novo)

const cronPattern = /^(@(annually|yearly|monthly|weekly|daily|hourly)|(\S+\s+){4}\S+)$/
const ianaPattern = /^(UTC|[A-Za-z_]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?)$/

// 5-field cron expression or supported nickname (FR7, C4).
export const CronExpression = Schema.String.annotate({ identifier: "JobsSchedule.CronExpression" })
  .check(Schema.isPattern(cronPattern)).pipe(Schema.brand("Jobs.CronExpression"))
// Requested IANA timezone; unsupported zones rejected pre-register (FR7, AC22).
export const IanaTimezone = Schema.String.annotate({ identifier: "JobsSchedule.IanaTimezone" })
  .check(Schema.isPattern(ianaPattern)).pipe(Schema.brand("Jobs.IanaTimezone"))
// Minimum accepted interval; provisional constant (AC4).
export const MinimumIntervalMs = Schema.Number.annotate({ identifier: "JobsSchedule.MinimumIntervalMs" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// Nominal due instant — a canonical string key, not a decoded DateTime (FR19, C6).
export const NominalDueTime = Schema.String.annotate({ identifier: "JobsSchedule.NominalDueTime" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("Jobs.NominalDueTime"))

export const CronSchedule = Schema.Struct({
  expression: CronExpression,
  timezone: IanaTimezone,
})
export type CronSchedule = typeof CronSchedule.Type
```

---

## Enumerations

Core scheduling enums mirror `doc/arch/schemas/jobs/enums.cue`; the event/envelope
enums mirror `enums-event.cue`; the notification enums mirror `enums-notification.cue`;
the closed `job.*` vocabulary mirrors `event-types.cue`.

```typescript
// packages/schema/src/jobs/enums.ts (novo)

// Registration boundary between durable authority and external effect (FR6, C5).
export const RegistrationState = Schema.Literals([
  "pending", "registered", "unregistered", "unknown", "reconciled",
]).annotate({ identifier: "JobsEnums.RegistrationState" })

// Durable intent preceding the external effect (C5).
export const RegistrationIntent = Schema.Literals(["register", "unregister"])
  .annotate({ identifier: "JobsEnums.RegistrationIntent" })

// The occurrence state machine due -> claimed -> admitted -> executing -> terminal,
// plus branch outcomes (FR11, C6).
export const OccurrenceState = Schema.Literals([
  "due", "claimed", "admitted", "executing",
  "completed", "failed", "cancelled", "timed_out",
  "skipped", "coalesced", "misfired", "overlap_rejected", "overlap_replaced",
  "reconciled", "unknown",
]).annotate({ identifier: "JobsEnums.OccurrenceState" })

// Misfire without infinite catch-up (FR15, C19).
export const MisfirePolicy = Schema.Literals(["skip", "fire_once", "bounded_catch_up", "coalesce"])
  .annotate({ identifier: "JobsEnums.MisfirePolicy" })

// Overlap defaults to forbid; non-default values are capability-gated (FR16, C3).
export const OverlapPolicy = Schema.Literals(["allow", "forbid", "queue", "replace"])
  .annotate({ identifier: "JobsEnums.OverlapPolicy" })

// Target/action categories (FR28).
export const ActionType = Schema.Literals([
  "native_maintenance", "operator_notification", "main_context_wake",
  "smart_routing_dispatch", "approved_workflow",
]).annotate({ identifier: "JobsEnums.ActionType" })

// Definition scope; default project (C12).
export const Scope = Schema.Literals(["global", "project", "root", "session"])
  .annotate({ identifier: "JobsEnums.Scope" })

// In-process vs deferred OS-level Bun.cron form (C1, C2).
export const CapabilitySurface = Schema.Literals(["in_process", "os_level"])
  .annotate({ identifier: "JobsEnums.CapabilitySurface" })

// Reconciliation without claiming past execution (FR14, C5).
export const ReconcileOutcome = Schema.Literals(["reconciled", "unknown"])
  .annotate({ identifier: "JobsEnums.ReconcileOutcome" })

// Durable (replayable) vs live (no sequence) job.* events (C8).
export const EventClass = Schema.Literals(["durable", "live"])
  .annotate({ identifier: "JobsEnums.EventClass" })
```

```typescript
// packages/schema/src/jobs/enums-event.ts (novo)

export const JobSource = Schema.Literals(["runtime", "scheduler", "executor", "reconciler", "operator"])
  .annotate({ identifier: "JobsEnums.JobSource" })
// No LLM ever administers (FR28, AC17).
export const ActorKind = Schema.Literals(["runtime", "operator", "executor"])
  .annotate({ identifier: "JobsEnums.ActorKind" })
// Authorization scope enforced before delivery/projection (FR21, C10).
export const Visibility = Schema.Literals(["session", "tree", "project", "global_privileged"])
  .annotate({ identifier: "JobsEnums.Visibility" })
```

```typescript
// packages/schema/src/jobs/enums-notification.ts (novo)

export const NotificationType = Schema.Literals([
  "occurrence_settled", "occurrence_failed", "occurrence_cancelled",
  "occurrence_timed_out", "misfire", "reconciled", "operator_advisory",
]).annotate({ identifier: "JobsEnums.NotificationType" })
export const NotificationPriority = Schema.Literals(["low", "normal", "high", "urgent"])
  .annotate({ identifier: "JobsEnums.NotificationPriority" })
export const NotificationSource = Schema.Literals(["scheduler", "executor", "reconciler", "operator"])
  .annotate({ identifier: "JobsEnums.NotificationSource" })
export const DeliveryState = Schema.Literals(["enqueued", "queued", "coalesced", "delivered", "expired"])
  .annotate({ identifier: "JobsEnums.DeliveryState" })
export const AckState = Schema.Literals(["unacknowledged", "acknowledged", "expired"])
  .annotate({ identifier: "JobsEnums.AckState" })
// Operator-only default vs explicit wake/queue/child actions (FR24, C9).
export const DeliveryAction = Schema.Literals(["operator_only", "manager_wake", "input_queue", "child_session"])
  .annotate({ identifier: "JobsEnums.DeliveryAction" })
export const SafeBoundary = Schema.Literals(["safe", "unsafe"])
  .annotate({ identifier: "JobsEnums.SafeBoundary" })
```

```typescript
// packages/schema/src/jobs/event-types.ts (novo)

// The closed 30-member job.* event vocabulary (FR11). The job.* prefix is the
// Feature 003 lifecycle event namespace on EventV2; jobs.* is the distinct
// Feature 007 operator command domain; both are reserved (C13).
export const JobEventType = Schema.Literals([
  "job.definition_created", "job.definition_updated", "job.definition_enabled",
  "job.definition_disabled", "job.definition_deleted", "job.registered",
  "job.unregistered", "job.rescheduled", "job.trigger_due", "job.occurrence_claimed",
  "job.triggered", "job.misfired", "job.skipped", "job.coalesced", "job.queued",
  "job.admitted", "job.notification_enqueued", "job.notification_delivered",
  "job.notification_acknowledged", "job.notification_expired", "job.execution_started",
  "job.execution_completed", "job.execution_failed", "job.execution_cancelled",
  "job.execution_timed_out", "job.retry_scheduled", "job.overlap_rejected",
  "job.overlap_replaced", "job.reconciled", "job.unknown",
]).annotate({ identifier: "JobsEnums.JobEventType" })
export type JobEventType = typeof JobEventType.Type
```

---

## JobEnvelope (FR12)

The common carrier on every `job.*` event. Kept small by composing sub-objects, each
at most seven fields, so no aggregate exceeds the calisthenics bound. `event_id` is
held as a value assigned by EventV2; the identifiable message is the event member that
carries the envelope (C8). Feature 002 per-aggregate ordering remains authoritative
(FR12, C6). Mirrors `doc/arch/schemas/jobs/envelope.cue` and `envelope-parts.cue`.

```typescript
// packages/schema/src/jobs/envelope.ts (novo)

export const EventKind = Schema.Struct({
  event_type: JobEventType,
  schema_version: SchemaVersion,
  event_class: EventClass,
  source: JobSource,
  actor_kind: ActorKind,
  visibility: Visibility,
})

export const OccurrenceIdentity = Schema.Struct({
  job_definition_id: JobDefinitionId,
  schedule_id: ScheduleId,
  occurrence_id: OccurrenceId,
  process_id: Schema.NullOr(ProcessId),   // null before the Task Process associates (C16)
  attempt: Attempt,
  generation: Generation,
})

export const TreeIdentity = Schema.Struct({
  root_session_id: RootSessionId,
  session_id: Schema.NullOr(SessionId),
})

export const Ordering = Schema.Struct({
  sequence: Sequence,                     // per aggregate only; no global order (FR10, C6)
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
})

export const Delivery = Schema.Struct({
  visibility: Visibility,
  timestamp: DateTimeUtcFromMillis,
  // Redacted: no prompts, results, tool payloads, paths, or secrets (FR32).
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
})

export const JobEnvelope = Schema.Struct({
  event_id: EventId,
  kind: EventKind,
  occurrence: OccurrenceIdentity,
  tree: TreeIdentity,
  ordering: Ordering,
  delivery: Delivery,
})
export type JobEnvelope = Schema.Schema.Type<typeof JobEnvelope>
```

---

## JobDefinition aggregate (FR2, C5)

The durable scheduled-job aggregate root persisted in Config.Service and rehydrated at
startup (FR3). An in-process Bun registration is never the durable authority (FR3).
Mutations are atomic and idempotent within Config.Service with version/CAS; secrets are
secure references only (FR6, FR32, C10). Sub-objects each stay within the calisthenics
field bound. Mirrors `doc/arch/schemas/jobs/definition.cue` and `definition-parts.cue`.

```typescript
// packages/schema/src/jobs/definition.ts (novo)

export const SecretRefList = Schema.Array(SecretRef)   // secure references only (Security 3, C10)

export const DefinitionIdentity = Schema.Struct({
  name: JobName,
  description: JobDescription,
  owner: Principal,
  version: Version,                       // CAS version (FR2, FR6)
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
})

export const DefinitionSchedule = Schema.Struct({
  schedule_id: ScheduleId,
  schedule: CronSchedule,                 // cron expression + IANA timezone (FR7, C4)
  minimum_interval_ms: MinimumIntervalMs,
  enabled: Enabled,
})

export const DefinitionPolicy = Schema.Struct({
  misfire: MisfirePolicy,                 // no infinite catch-up (FR15, C19)
  overlap: OverlapPolicy,                 // default forbid; capability-gated (FR16, C3)
  capability_surface: CapabilitySurface,  // in_process | os_level (C1, C2)
})

export const DefinitionExecution = Schema.Struct({
  action_type: ActionType,
  target: ActionTarget,                   // redacted handle, never a shell literal (FR28, FR29)
  deadline_ms: DeadlineMs,
  timeout_ms: TimeoutMs,
  retry_budget: RetryBudget,              // no blind mutation retry (FR14, C11)
  priority: Priority,
})

export const DefinitionAuthorization = Schema.Struct({
  scope: Scope,
  project_ref: ProjectRef,
  root_session_id: Schema.NullOr(RootSessionId),
  principal: Principal,
  permissions: PermissionSet,
  secret_refs: SecretRefList,
  payload_ref: Schema.NullOr(PayloadRef),
})

export const JobDefinition = Schema.Struct({
  id: JobDefinitionId,                    // aggregate-root identity (FR1, FR2)
  identity: DefinitionIdentity,
  schedule: DefinitionSchedule,
  policy: DefinitionPolicy,
  execution: DefinitionExecution,
  authorization: DefinitionAuthorization,
})
export type JobDefinition = Schema.Schema.Type<typeof JobDefinition>
```

---

## ScheduleRegistration and reconciliation (FR6, FR14, C5, C7)

Durable intent plus registration state model the boundary between the persistent
authority and the external Bun/OS effect. Persistent transitions are atomic within
their authority; the registration is an idempotent external effect paired with
compensation. No transaction spans Config.Service and the scheduler. Reconciliation is
versioned and never re-executes an ambiguous mutation (FR14, AC19, AC23). Mirrors
`doc/arch/schemas/jobs/reconciliation.cue`.

```typescript
// packages/schema/src/jobs/reconciliation.ts (novo)

// Pinned false: reconciliation never re-executes effects (FR14, C11).
export const AutoRetryDisabled = Schema.Literal(false)

export const ScheduleRegistration = Schema.Struct({
  job_definition_id: JobDefinitionId,
  schedule_id: ScheduleId,
  state: RegistrationState,               // pending|registered|unregistered|unknown|reconciled
  intent: RegistrationIntent,             // register | unregister
  capability_surface: CapabilitySurface,
  updated_at: DateTimeUtcFromMillis,
})
export type ScheduleRegistration = Schema.Schema.Type<typeof ScheduleRegistration>

export const OccurrenceReconcile = Schema.Struct({
  occurrence_id: OccurrenceId,
  outcome: ReconcileOutcome,              // reconciled | unknown
  from_version: SchemaVersion,
  auto_retry: AutoRetryDisabled,          // never re-executes effects (FR14, AC19)
})
export type OccurrenceReconcile = Schema.Schema.Type<typeof OccurrenceReconcile>

export const RegistrationReconcile = Schema.Struct({
  job_definition_id: JobDefinitionId,
  schedule_id: ScheduleId,
  outcome: ReconcileOutcome,
  from_state: RegistrationState,
  auto_retry: AutoRetryDisabled,          // no cross-system atomic commit is claimed (AC23)
})
export type RegistrationReconcile = Schema.Schema.Type<typeof RegistrationReconcile>
```

### Registration state machine (C5)

`pending` is the initial durable intent before the external effect; `unregistered` and
`reconciled` are settled outcomes. No cross-system atomic commit is claimed.

```
[*] --> pending
pending --> registered | unknown
registered --> unregistered | unknown | [*]
unknown --> reconciled
reconciled --> registered | unregistered
unregistered --> [*]
```

---

## JobOccurrence aggregate (FR10, C6)

One logical trigger occurrence that executes as a canonical Feature 002 Task Process
(FR8, C16). The idempotency identity is the tuple `(job_definition_id, schedule_id,
nominal_due_time, generation)`; duplicate delivery resolves to a single execution with
an observable `duplicate_of` outcome (FR10, AC6). Sequence/attempt/generation authority
belongs to the Feature 002 executor, never the scheduler or a projection (C6). Each
executable occurrence owns exactly one Feature 002 Todo and, once admitted with output,
its own Feature 005 OutputGroup; a Job Definition never shares live work state (FR8,
FR8a, C14, C15). Mirrors `doc/arch/schemas/jobs/occurrence.cue` and
`occurrence-parts.cue`.

```typescript
// packages/schema/src/jobs/occurrence.ts (novo)

export const IdempotencyKey = Schema.Struct({
  job_definition_id: JobDefinitionId,
  schedule_id: ScheduleId,
  nominal_due_time: NominalDueTime,       // canonical string key, not a DateTime (C6)
  generation: Generation,
})

export const OccurrenceLineage = Schema.Struct({
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
  session_id: Schema.NullOr(SessionId),
  root_session_id: RootSessionId,
  process_id: Schema.NullOr(ProcessId),   // null until the Task Process associates (C16)
})

export const OccurrenceExecution = Schema.Struct({
  attempt: Attempt,                       // executor-owned (C6)
  generation: Generation,
  sequence: Sequence,
  todo_ref: Schema.NullOr(TodoRef),       // occurrence-owned Todo (FR8, C14)
  output_ref: Schema.NullOr(OutputRef),   // occurrence-owned OutputGroup ref (FR8a, C15)
})

export const OccurrenceStatus = Schema.Struct({
  state: OccurrenceState,
  reason: Reason,
  schedule_lag_ms: ScheduleLagMs,         // measured from nominal due (FR19, AC4)
  duplicate_of: Schema.NullOr(OccurrenceId),  // observable duplicate outcome (AC6)
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  terminal_at: Schema.NullOr(DateTimeUtcFromMillis),
})

export const JobOccurrence = Schema.Struct({
  id: OccurrenceId,                       // aggregate-root identity (FR1, FR10)
  idempotency: IdempotencyKey,
  lineage: OccurrenceLineage,
  execution: OccurrenceExecution,
  status: OccurrenceStatus,
})
export type JobOccurrence = Schema.Schema.Type<typeof JobOccurrence>
```

### Occurrence state machine (C6)

`due` is the initial trigger observation; `completed`, `failed`, `cancelled`,
`timed_out`, `skipped`, `coalesced`, `overlap_rejected`, and `unknown` are absorbing.
Any non-terminal state transitions to `unknown`/`reconciled` on crash or
reconciliation. Sequence/attempt/generation belong to the Feature 002 executor.

```
[*] --> due
due --> claimed | misfired | skipped | coalesced
claimed --> admitted | overlap_rejected | overlap_replaced | unknown
overlap_replaced --> admitted
admitted --> executing | reconciled
executing --> completed | failed | cancelled | timed_out | unknown
misfired | skipped | coalesced | overlap_rejected | reconciled --> [*]
completed | failed | cancelled | timed_out | unknown --> [*]
```

---

## NotificationEnvelope (FR22, C15)

The bounded, redacted async notification carried over the single EventV2 authority and
the Feature 002 observation seam; no second channel (FR20, C8). It is a ValueObject:
`notification_id` is held as a value. It carries only a bounded summary and an opaque
Feature 005 `OutputRef`, never full content, spool filesystem paths, or unbounded
payloads (FR22, C15, AC29). Cross-session/project leakage is rejected before delivery
(FR21, C10, AC9). Mirrors `doc/arch/schemas/jobs/notification.cue` and
`notification-parts.cue`.

```typescript
// packages/schema/src/jobs/notification.ts (novo)

export const NotificationRouting = Schema.Struct({
  event_id: EventId,
  occurrence_id: OccurrenceId,
  job_definition_id: JobDefinitionId,
  target_root_session_id: RootSessionId,
  target_session_id: Schema.NullOr(SessionId),
})

export const NotificationDescriptor = Schema.Struct({
  source: NotificationSource,
  type: NotificationType,
  priority: NotificationPriority,
  action: DeliveryAction,                 // operator_only default (FR24, C9)
})

export const NotificationTiming = Schema.Struct({
  created_at: DateTimeUtcFromMillis,
  expiry_at: DateTimeUtcFromMillis,       // TTL; bounded queue, no unbounded growth (AC8)
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
})

export const NotificationContent = Schema.Struct({
  summary: BoundedSummary,                // bounded; never full content (FR22, AC29)
  payload_ref: Schema.NullOr(PayloadRef),
  output_ref: Schema.NullOr(OutputRef),   // opaque Feature 005 ref (FR8a, C15)
})

export const NotificationState = Schema.Struct({
  delivery_state: DeliveryState,
  ack_state: AckState,
  safe_boundary: SafeBoundary,            // delivered only at a safe boundary (FR25, AC7)
  delivered_at: Schema.NullOr(DateTimeUtcFromMillis),
  acknowledged_at: Schema.NullOr(DateTimeUtcFromMillis),
})

export const NotificationEnvelope = Schema.Struct({
  notification_id: NotificationId,        // value, not aggregate id
  routing: NotificationRouting,
  descriptor: NotificationDescriptor,
  timing: NotificationTiming,
  content: NotificationContent,
  state: NotificationState,
})
export type NotificationEnvelope = Schema.Schema.Type<typeof NotificationEnvelope>
```

### Notification delivery lifecycle (C9)

```
enqueue (job.notification_enqueued)
  -> authorize + redact (scope: root/session/project; leakage rejected)
  -> safe active-turn boundary?
       yes -> deliver (job.notification_delivered) -> await ack or TTL
       no  -> queue | coalesce | expire per policy (never interrupt unsafe work)
  -> ack (job.notification_acknowledged) | TTL reached (job.notification_expired)
  -> default action = operator_only; wake/queue/child only if explicit + authorized + audited
```

---

## Job event vocabulary (FR11, FR12)

The 30 members form a closed tagged union. Every member carries the `envelope`; a
member with a distinct payload adds one `detail` sub-object so definition-mutation,
registration, misfire, overlap, execution-terminal, retry, notification, and
reconciliation stay distinct semantic events and are never collapsed into a generic
status update (FR11). Mirroring the Feature 001/002 pattern, each member is registered
as its own `EventV2.define` `Definition` on the `EventV2Bridge` (`dataFields(Member.fields)`)
and published through the new `publishJobEvent` boundary, so no raw tagged union is
wired to the bus (C8). Durable members carry the EventV2
`durable {version, aggregate: "root_session_id"}` annotation and replay through
`readAggregate`; live members omit it (C8). Mirrors `doc/arch/schemas/jobs/events.cue`,
`events-definition.cue`, `events-occurrence.cue`, `events-execution.cue`, and
`events-notification.cue`.

Detail sub-objects:

```typescript
// packages/schema/src/jobs/events.ts (novo)

export const DefinitionDetail = Schema.Struct({ version: Version, scope: Scope })
export const RegistrationDetail = Schema.Struct({
  state: RegistrationState, intent: RegistrationIntent, capability_surface: CapabilitySurface,
})
export const TriggerDetail = Schema.Struct({ schedule_lag_ms: ScheduleLagMs })
export const MisfireDetail = Schema.Struct({ policy: MisfirePolicy, outcome: OccurrenceState })
export const OverlapDetail = Schema.Struct({ policy: OverlapPolicy, outcome: OccurrenceState })
export const ExecutionDetail = Schema.Struct({ outcome: OccurrenceState, reason: Reason })
export const RetryDetail = Schema.Struct({ retry_budget: RetryBudget, reason: Reason })
export const NotificationDetail = Schema.Struct({ delivery_state: DeliveryState, ack_state: AckState })
export const ReconcileDetail = Schema.Struct({ outcome: ReconcileOutcome, from_version: SchemaVersion })
```

Member and union shape (durable example carries the annotation; envelope-only members
omit `detail`):

```typescript
// Durable (C8): definition_created/updated/enabled/disabled/deleted, registered,
// unregistered, rescheduled, occurrence_claimed, triggered, admitted, execution_completed,
// execution_failed, execution_cancelled, execution_timed_out, reconciled.
export const JobDefinitionCreatedEvent = Schema.Struct({
  type: Schema.Literal("job.definition_created"),
  envelope: JobEnvelope,
  detail: DefinitionDetail,
})

// Live (C8): trigger_due, misfired, skipped, coalesced, queued, overlap_rejected,
// overlap_replaced, notification_enqueued/delivered/acknowledged/expired,
// execution_started, retry_scheduled, unknown.
export const JobTriggerDueEvent = Schema.Struct({
  type: Schema.Literal("job.trigger_due"),
  envelope: JobEnvelope,
  detail: TriggerDetail,
})

export const JobOccurrenceClaimedEvent = Schema.Struct({
  type: Schema.Literal("job.occurrence_claimed"),
  envelope: JobEnvelope,                  // envelope-only durable checkpoint
})
// ...one Struct per FR11 vocabulary entry, across events-definition.ts,
// events-occurrence.ts, events-execution.ts, and events-notification.ts.

export const JobEvent = Schema.TaggedUnion("type", [
  JobDefinitionCreatedEvent, JobTriggerDueEvent, JobOccurrenceClaimedEvent,
  // ...the remaining 27 members.
])
export type JobEvent = Schema.Schema.Type<typeof JobEvent>
```

Durable definitions join the canonical inventory in
`packages/schema/src/durable-event-manifest.ts` through `Event.durable([...])` (C5), so
terminal and definition-mutation events are preserved across bounded-queue overflow and
restart by the durable aggregate, never by a projection. Terminal and definition-mutation
events are never coalesced or dropped (FR12).

---

## Parameters

Every numeric contract is declared here as a provisional plan constant with a named
acceptance hook; ADR-0004 and the tasks phase fix final values (plan Non-goals; C4, C5,
C11, C19, C20). No value is a hidden default: each is an explicit, overridable data
constant on the domain module, never inlined into an algorithm. IDs never appear as
metric labels; over-budget dynamic values map to `other` (C18, AC16).

| Parameter | Provisional default | Scope | Acceptance hook |
| --------- | ------------------- | ----- | --------------- |
| `minimum_interval_ms` | 60_000 ms (1 min) | per definition | AC4 |
| `clock_skew_tolerance_ms` | 2_000 ms | occurrence layer | AC4 |
| `catch_up_ceiling` | 16 coalesced occurrences max (never infinite) | per definition | AC3, AC21 |
| `schedule_lag_warn_ms` | 30_000 ms | per occurrence | AC3, AC4 |
| `occurrence_deadline_ms` | 900_000 ms (15 min) | per occurrence | AC12 |
| `occurrence_timeout_ms` | 600_000 ms (10 min) | per occurrence | AC12 |
| `retry_budget` | 0 attempts (no retry absent a mutation-safe policy) | per occurrence | AC20 |
| `trigger_queue_capacity` | 256 pending triggers | per definition | AC12, AC21 |
| `trigger_overflow_policy` | reject (explicit misfire, no unbounded queue) | per definition | AC21 |
| `notification_queue_capacity` | 512 envelopes | per target scope | AC8, AC21 |
| `notification_overflow_policy` | coalesce-then-expire | per target scope | AC8, AC21 |
| `notification_ttl_ms` | 300_000 ms (5 min) | per notification | AC8 |
| `notification_coalesce_window_ms` | 1_000 ms | per target scope | AC7, AC21 |
| `notification_summary_max_bytes` | 512 bytes | per envelope | AC29 |
| `default_overlap_policy` | `forbid` | per definition | AC5 |
| `default_misfire_policy` | `skip` | per definition | AC3 |
| `default_scope` | `project` | per definition | (C12) |
| `registration_reconcile_interval_ms` | 5_000 ms (single shared sweeper) | global | AC2, AC23 |
| `definition_retention` | all durable (compaction deferred) | Config.Service | AC15 |
| `occurrence_history_retention` | 200 terminal occurrences per definition | per definition | AC15 |
| `retention_prune_older_than_ms` | 2_592_000_000 ms (30 d) | durable aggregate | AC15 |
| `cardinality_budget` | 64 distinct dynamic ids -> `other` | metric labels | AC16, reuses Feature 001 |

Feature 001 telemetry queue/cardinality-allowlist/budget-policy constants and Feature
002 admission ceilings are reused unchanged and are not re-declared here (C11, C18).

---

## Cross-artifact traceability

| Entity | CUE mirror | TS module | Requirements |
| ------ | ---------- | --------- | ------------ |
| identifiers | `jobs/ids.cue`, `jobs/correlation.cue` | `jobs/ids.ts`, `jobs/correlation.ts` | FR1, FR12 |
| counters / text | `jobs/values.cue`, `jobs/text-values.cue` | `jobs/values.ts`, `jobs/text-values.ts` | FR2, FR19, FR22 |
| schedule | `jobs/schedule.cue` | `jobs/schedule.ts` | FR7, C4 |
| enums | `jobs/enums.cue`, `enums-event.cue`, `enums-notification.cue`, `event-types.cue` | `jobs/enums.ts`, `enums-event.ts`, `enums-notification.ts`, `event-types.ts` | FR6, FR11, FR15, FR16, FR28 |
| JobEnvelope | `jobs/envelope.cue`, `envelope-parts.cue` | `jobs/envelope.ts` | FR12 |
| JobDefinition | `jobs/definition.cue`, `definition-parts.cue` | `jobs/definition.ts` | FR2, C5 |
| ScheduleRegistration / reconcile | `jobs/reconciliation.cue` | `jobs/reconciliation.ts` | FR6, FR14, C5 |
| JobOccurrence | `jobs/occurrence.cue`, `occurrence-parts.cue` | `jobs/occurrence.ts` | FR10, C6 |
| NotificationEnvelope | `jobs/notification.cue`, `notification-parts.cue` | `jobs/notification.ts` | FR22, C15 |
| JobEvent vocabulary | `jobs/events.cue`, `events-definition.cue`, `events-occurrence.cue`, `events-execution.cue`, `events-notification.cue` | `jobs/events.ts` + member files | FR11, FR12, C8 |
