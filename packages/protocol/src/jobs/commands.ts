/**
 * Feature 003 — Jobs protocol payloads (T012).
 *
 * TypeScript mirror of the shared identifiers, closed enums, the 30-member
 * `job.*` event vocabulary (durable/live split), the request/response payloads,
 * and the typed `SchedulerError`/`NotificationError`/`JobsError` unions from
 * doc/arch/sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/contracts/ports.ts
 * (FR30, FR32, C9, C12, C13). The `SchedulerPort`/`NotificationPort`/`JobsPort`
 * interfaces live in ./ports — this file defines only the payload shapes they
 * consume.
 *
 * This mirror never redefines the `packages/schema/src/jobs/*` event payload
 * schemas (C8); the wire-shape source of truth for those remains
 * doc/arch/schemas/jobs/*.cue. The camelCase protocol shapes here are the
 * operator-surface projection consumed by Feature 007 adapters, distinct from
 * the persisted snake_case domain records.
 */

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/jobs/ids.cue)
// =============================================================================

/** Durable Job Definition identity (FR1, FR2). */
export type JobDefinitionId = string

/** Durable schedule identity within a Job Definition (FR1, FR7). */
export type ScheduleId = string

/** Logical occurrence identity; distinct from the resulting Feature 002 `ProcessId` (FR1, FR10). */
export type OccurrenceId = string

/**
 * Feature 002 execution attempt identity associated with an admitted
 * occurrence. NEVER an operating system PID (reused verbatim, FR8).
 */
export type ProcessId = string

export type SessionId = string
export type RootSessionId = string

/** Feature 002 executor-owned attempt counter; never assigned by the scheduler (C6). */
export type Attempt = number

/** Feature 002 executor-owned generation counter; never assigned by the scheduler (C6). */
export type Generation = number

// =============================================================================
// Closed enums (wire shape: doc/arch/schemas/jobs/enums.cue)
// =============================================================================

/**
 * The five permitted registration states (FR6, C5). `pending` is the initial
 * durable intent before the external Bun/OS effect; `unregistered` and
 * `reconciled` are settled outcomes. No cross-system atomic commit spanning
 * Config.Service and the scheduler is ever claimed.
 */
export type RegistrationState = "pending" | "registered" | "unregistered" | "unknown" | "reconciled"

/**
 * The occurrence state machine (FR10, FR11, C6): `due` is the initial trigger
 * observation; `completed`, `failed`, `cancelled`, `timed_out`, `misfired`,
 * `skipped`, `coalesced`, `overlap_rejected`, `reconciled`, and `unknown` are
 * absorbing. Sequence/attempt/generation authority belongs to the Feature 002
 * executor, never to the scheduler or a projection.
 */
export type OccurrenceState =
  | "due"
  | "claimed"
  | "admitted"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "misfired"
  | "skipped"
  | "coalesced"
  | "overlap_rejected"
  | "overlap_replaced"
  | "reconciled"
  | "unknown"

/** Misfire policy (FR15, C3, C19). No infinite catch-up is ever permitted. */
export type MisfirePolicy = "skip" | "fire_once" | "bounded_catch_up" | "coalesce"

/**
 * Overlap policy (FR16, C3). Default is `forbid`; `allow`/`queue`/`replace`
 * are honored only when the selected adapter/occurrence layer can enforce
 * them. `replace` MUST NOT silently stop or kill a mutating handler/process.
 */
export type OverlapPolicy = "allow" | "forbid" | "queue" | "replace"

/**
 * Target/action categories (FR28). Shell/mutating tool actions additionally
 * require the FR29 allowlist, permission, and secure secret references.
 */
export type ActionType =
  | "native_maintenance"
  | "operator_notification"
  | "wake_or_structured_input"
  | "smart_routing_dispatch"
  | "approved_workflow"

/**
 * Bounded notification type classification, drawn from the occurrence
 * branch outcomes worth surfacing to an authorized observer (FR22, C6, C9).
 */
export type NotificationType =
  | "occurrence_completed"
  | "occurrence_failed"
  | "occurrence_cancelled"
  | "occurrence_timed_out"
  | "occurrence_misfired"
  | "occurrence_overlap_rejected"
  | "occurrence_reconciled_unknown"

/** Notification delivery state (FR22, C9). `queued`/`coalesced`/`expired` never grow unbounded (C19). */
export type DeliveryState = "pending" | "delivered" | "queued" | "coalesced" | "expired"

/** Notification acknowledgement state (FR22, C9). */
export type AckState = "unacknowledged" | "acknowledged" | "not_applicable"

/**
 * Explicit notification action categories (FR24, C9). `operator_only` is the
 * default; the remaining three are per-definition, authorized, bounded, and
 * audited, never default. Raw prompt injection is never a valid action.
 */
export type NotificationAction = "operator_only" | "manager_wake" | "structured_input_queue" | "new_child_session"

// =============================================================================
// Job event vocabulary (wire shape: doc/arch/schemas/jobs/events.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and replay through `EventV2.readAggregate` (C8). Definition
 * mutations, registration/claim/execution checkpoints, and terminal
 * transitions; never coalesced or dropped.
 */
export const DURABLE_JOB_EVENT_TYPES = [
  "job.definition_created",
  "job.definition_updated",
  "job.definition_enabled",
  "job.definition_disabled",
  "job.definition_deleted",
  "job.registered",
  "job.unregistered",
  "job.rescheduled",
  "job.occurrence_claimed",
  "job.triggered",
  "job.admitted",
  "job.execution_started",
  "job.execution_completed",
  "job.execution_failed",
  "job.execution_cancelled",
  "job.execution_timed_out",
  "job.overlap_rejected",
  "job.overlap_replaced",
  "job.notification_enqueued",
  "job.notification_acknowledged",
  "job.notification_expired",
  "job.reconciled",
  "job.unknown",
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay). Deltas and
 * sampling/coalescing targets only (C8, C19).
 */
export const LIVE_JOB_EVENT_TYPES = [
  "job.trigger_due",
  "job.misfired",
  "job.skipped",
  "job.coalesced",
  "job.queued",
  "job.notification_delivered",
  "job.retry_scheduled",
] as const

export type DurableJobEventType = (typeof DURABLE_JOB_EVENT_TYPES)[number]
export type LiveJobEventType = (typeof LIVE_JOB_EVENT_TYPES)[number]

/** The 30-member closed `job.*` event vocabulary (FR11). */
export type JobEventType = DurableJobEventType | LiveJobEventType

// =============================================================================
// Job Definition and schedule (wire shape: doc/arch/schemas/jobs/definition.cue, schedule.cue)
// =============================================================================

/** Canonical stored schedule form: IANA timezone plus a 5-field cron expression (FR7, C4). */
export interface Schedule {
  readonly scheduleId: ScheduleId
  readonly cronExpression: string
  readonly ianaTimezone: string
}

/**
 * Redacted Job Definition fields returned to any operator query (FR2, FR32).
 * Full field set (permissions, owner, version) is defined in `definition.cue`;
 * this mirror carries only the fields consumed by the ports below.
 */
export interface JobDefinitionSummary {
  readonly jobDefinitionId: JobDefinitionId
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  readonly schedule: Schedule
  readonly actionType: ActionType
  readonly overlapPolicy: OverlapPolicy
  readonly misfirePolicy: MisfirePolicy
  readonly registrationState: RegistrationState
  readonly nextDueAt: string | null // ISO-8601; null when unregistered/unknown
  readonly lastOutcome: OccurrenceState | null
  readonly version: number
  readonly updatedAt: string
}

// =============================================================================
// Occurrence (wire shape: doc/arch/schemas/jobs/occurrence.cue)
// =============================================================================

/**
 * One canonical occurrence (FR10, C6). The idempotency identity is the tuple
 * `(jobDefinitionId, scheduleId, nominalDueTime, generation)`; duplicate
 * delivery resolves to one execution with an observable duplicate outcome.
 */
export interface Occurrence {
  readonly occurrenceId: OccurrenceId
  readonly jobDefinitionId: JobDefinitionId
  readonly scheduleId: ScheduleId
  readonly nominalDueTime: string // ISO-8601; lag is measured from this instant (FR19, C4)
  readonly generation: Generation
  readonly correlationId: string
  readonly causationId: string | null
  readonly sessionId: SessionId | null // present once admitted (C16)
  readonly rootSessionId: RootSessionId | null
  readonly processId: ProcessId | null // present once a Feature 002 Task Process is associated (FR8)
  readonly attempt: Attempt | null
  readonly state: OccurrenceState
  readonly outcome: OccurrenceState | null // terminal/branch outcome once settled
}

// =============================================================================
// Notification envelope (wire shape: doc/arch/schemas/jobs/notification.cue)
// =============================================================================

/** Opaque Feature 005 output reference; Feature 003 never resolves content through it (FR8a, FR22, C15). */
export interface JobOutputRef {
  readonly ref: string
}

/**
 * Bounded, redacted notification envelope (FR22, C15). Never full content,
 * spool filesystem paths, or unbounded payloads.
 */
export interface NotificationEnvelope {
  readonly notificationId: string
  readonly eventId: string // EventV2 evt_ id
  readonly occurrenceId: OccurrenceId
  readonly jobDefinitionId: JobDefinitionId
  readonly targetRootSessionId: RootSessionId
  readonly targetSessionId: SessionId | null
  readonly source: "scheduler"
  readonly type: NotificationType
  readonly priority: "low" | "normal" | "high"
  readonly createdAt: string // ISO-8601
  readonly expiresAt: string // ISO-8601; TTL boundary (C9, AC8)
  readonly correlationId: string
  readonly causationId: string | null
  readonly summary: string // bounded; never full occurrence content (FR22)
  readonly outputRef: JobOutputRef | null
  readonly deliveryState: DeliveryState
  readonly ackState: AckState
}

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principals permitted to mutate definitions or acknowledge notifications (C12). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

/** Authorized notification observer scope; leakage across trees is a failure before delivery (FR21, C10). */
export type NotificationTargetPrincipal =
  | { readonly kind: "main-context"; readonly rootSessionId: RootSessionId }
  | { readonly kind: "agent"; readonly sessionId: SessionId }
  | OperatorPrincipal

// =============================================================================
// SchedulerPort payloads (register / unregister / reconcile / tick)
// =============================================================================

export interface SchedulerRegisterInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly schedule: Schedule
  readonly misfirePolicy: MisfirePolicy
  readonly overlapPolicy: OverlapPolicy
  readonly principal: OperatorPrincipal
}

export interface SchedulerRegisterOutput {
  readonly registrationState: RegistrationState
  readonly nextDueAt: string | null
  readonly capabilityGap: string | null // typed gap surfaced instead of an invented API (FR5, C1)
}

export interface SchedulerUnregisterInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly scheduleId: ScheduleId
  readonly principal: OperatorPrincipal
}

export interface SchedulerUnregisterOutput {
  readonly registrationState: RegistrationState
}

export interface SchedulerReconcileInput {
  readonly scope: "startup" | "definition"
  readonly jobDefinitionId: JobDefinitionId | null // null for a full startup sweep
}

export interface SchedulerReconcileOutput {
  readonly reconciledCount: number
  readonly unknownCount: number
  readonly registeredCount: number
}

export interface SchedulerTickInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly scheduleId: ScheduleId
  readonly nominalDueTime: string // ISO-8601, computed by the NextOccurrencePort over Bun.cron.parse (C4)
  readonly runningOccurrenceId: OccurrenceId | null // set when overlap evaluation applies (C3)
}

export interface SchedulerTickOutput {
  readonly occurrence: Occurrence
  readonly misfireApplied: MisfirePolicy | null
  readonly overlapApplied: OverlapPolicy | null
}

export type SchedulerError =
  | { readonly type: "capability_unsupported"; readonly capability: string }
  | { readonly type: "invalid_schedule"; readonly reason: string }
  | { readonly type: "second_authority_rejected"; readonly reason: string } // guards FR3/FR6
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// NotificationPort payloads (enqueue / deliverAtBoundary / ack / expire / audit / observe)
// =============================================================================

export interface NotificationEnqueueInput {
  readonly occurrenceId: OccurrenceId
  readonly jobDefinitionId: JobDefinitionId
  readonly type: NotificationType
  readonly target: NotificationTargetPrincipal
  readonly summary: string
  readonly outputRef: JobOutputRef | null
  readonly ttlSeconds: number
}

export interface NotificationEnqueueOutput {
  readonly envelope: NotificationEnvelope
}

export interface NotificationDeliverInput {
  readonly notificationId: string
  readonly targetSafeBoundary: boolean // computed by SessionExecution; never bypassed (C9)
}

export interface NotificationDeliverOutput {
  readonly deliveryState: DeliveryState
}

export interface NotificationAckInput {
  readonly notificationId: string
  readonly principal: NotificationTargetPrincipal
}

export interface NotificationAckOutput {
  readonly ackState: AckState
}

export interface NotificationExpireInput {
  readonly notificationId: string
}

export interface NotificationExpireOutput {
  readonly deliveryState: DeliveryState
}

export interface NotificationAuditInput {
  readonly notificationId: string
  readonly action: NotificationAction
  readonly principal: OperatorPrincipal
  readonly reason: string | null
}

export interface NotificationAuditOutput {
  readonly auditId: string
}

export interface NotificationObserveInput {
  readonly principal: NotificationTargetPrincipal
  readonly scope: "root" | "session" | "project"
  readonly scopeId: string
}

export type NotificationError =
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "cross_scope_leak_rejected"; readonly reason: string } // guards FR21, AC9
  | { readonly type: "invalid_action"; readonly reason: string } // guards FR24 (no raw prompt injection)
  | { readonly type: "not_found"; readonly notificationId: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// JobsPort payloads (Feature 007 `jobs.*` operator command/query surface, C12)
// =============================================================================

export interface JobsListInput {
  readonly scope: "project" | "global"
  readonly scopeId: string
  readonly enabledOnly?: boolean
  readonly limit: number
  readonly cursor?: string
}

export interface JobsListOutput {
  readonly definitions: readonly JobDefinitionSummary[]
  readonly cursor: string | null
}

export interface JobsStatusInput {
  readonly jobDefinitionId: JobDefinitionId
}

export interface JobsStatusOutput {
  readonly definition: JobDefinitionSummary
}

export interface JobsShowInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly occurrenceLimit: number
}

export interface JobsShowOutput {
  readonly definition: JobDefinitionSummary
  readonly occurrences: readonly Occurrence[]
}

export interface JobsCreateInput {
  readonly name: string
  readonly description: string
  readonly schedule: Omit<Schedule, "scheduleId">
  readonly actionType: ActionType
  readonly overlapPolicy: OverlapPolicy
  readonly misfirePolicy: MisfirePolicy
  readonly scope: "project" | "global"
  readonly scopeId: string
  readonly payloadRef: string // secure reference only (FR32, Security 3)
  readonly principal: OperatorPrincipal
}

export interface JobsCreateOutput {
  readonly definition: JobDefinitionSummary
  readonly auditId: string
}

export interface JobsUpdateInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly expectedVersion: number
  readonly patch: Partial<Omit<JobsCreateInput, "principal">>
  readonly principal: OperatorPrincipal
}

export interface JobsUpdateOutput {
  readonly definition: JobDefinitionSummary
  readonly auditId: string
}

export interface JobsEnableInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface JobsEnableOutput {
  readonly definition: JobDefinitionSummary
  readonly auditId: string
}

export interface JobsDisableInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface JobsDisableOutput {
  readonly definition: JobDefinitionSummary
  readonly activeOccurrenceOutcome: "none_active" | "unconfirmed" | "unknown" // never a false kill (C17)
  readonly auditId: string
}

export interface JobsDeleteInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface JobsDeleteOutput {
  readonly deleted: true
  readonly auditId: string
}

export interface JobsRescheduleInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly expectedVersion: number
  readonly schedule: Omit<Schedule, "scheduleId">
  readonly principal: OperatorPrincipal
}

export interface JobsRescheduleOutput {
  readonly definition: JobDefinitionSummary
  readonly auditId: string
}

export interface JobsRunNowInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly principal: OperatorPrincipal
}

export interface JobsRunNowOutput {
  readonly occurrence: Occurrence
  readonly auditId: string
}

export interface JobsHistoryInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly limit: number
  readonly cursor?: string
}

export interface JobsHistoryOutput {
  readonly occurrences: readonly Occurrence[]
  readonly notifications: readonly NotificationEnvelope[]
  readonly cursor: string | null
}

export interface JobsWatchInput {
  readonly jobDefinitionId: JobDefinitionId
  readonly principal: OperatorPrincipal
}

export interface JobsWatchEvent {
  readonly eventType: JobEventType
  readonly occurrenceId: OccurrenceId | null
  readonly timestamp: string
  readonly data: Readonly<Record<string, unknown>> // redacted (FR32)
}

export type JobsError =
  | { readonly type: "not_found"; readonly jobDefinitionId: string }
  | { readonly type: "unauthorized"; readonly reason: string }
  | { readonly type: "version_conflict"; readonly expectedVersion: number; readonly actualVersion: number }
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "reserved_name"; readonly id: string } // guards C13 job.*/jobs.* collisions
  | { readonly type: "capability_unsupported"; readonly capability: string } // guards FR5, AC22
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
