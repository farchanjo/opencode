/**
 * Feature 003 — Jobs application ports (T012).
 *
 * TypeScript mirror of the `SchedulerPort`, `NotificationPort` and `JobsPort`
 * inbound-port interfaces from
 * doc/arch/sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/contracts/ports.ts.
 * These interfaces are implemented by the jobs domain scheduler engine
 * (`packages/core/src/jobs/**`) and application adapters
 * (`packages/opencode/src/jobs/**`), and are consumed by Feature 007 operator
 * control-plane adapters (CLI/TUI/App) per ADR-0003 and the Feature 002
 * observation seam per ADR-0004. Feature 003 never registers a parallel command
 * registry (C12) and introduces no second scheduler, executor, event bus,
 * persistence store, or notification channel (ADR-0004).
 *
 * Request/response payloads and typed error unions live in ./commands — this
 * file defines only the port method signatures.
 */

import type { Effect, Scope, Stream } from "effect"
import type {
  JobsCreateInput,
  JobsCreateOutput,
  JobsDeleteInput,
  JobsDeleteOutput,
  JobsDisableInput,
  JobsDisableOutput,
  JobsEnableInput,
  JobsEnableOutput,
  JobsError,
  JobsHistoryInput,
  JobsHistoryOutput,
  JobsListInput,
  JobsListOutput,
  JobsRescheduleInput,
  JobsRescheduleOutput,
  JobsRunNowInput,
  JobsRunNowOutput,
  JobsShowInput,
  JobsShowOutput,
  JobsStatusInput,
  JobsStatusOutput,
  JobsUpdateInput,
  JobsUpdateOutput,
  JobsWatchEvent,
  JobsWatchInput,
  NotificationAckInput,
  NotificationAckOutput,
  NotificationAuditInput,
  NotificationAuditOutput,
  NotificationDeliverInput,
  NotificationDeliverOutput,
  NotificationEnqueueInput,
  NotificationEnqueueOutput,
  NotificationEnvelope,
  NotificationError,
  NotificationExpireInput,
  NotificationExpireOutput,
  NotificationObserveInput,
  SchedulerError,
  SchedulerReconcileInput,
  SchedulerReconcileOutput,
  SchedulerRegisterInput,
  SchedulerRegisterOutput,
  SchedulerTickInput,
  SchedulerTickOutput,
  SchedulerUnregisterInput,
  SchedulerUnregisterOutput,
} from "./commands"

// =============================================================================
// SchedulerPort — register / unregister / reconcile / tick
// =============================================================================

/**
 * Domain-internal port implemented by `BunCronAdapter` (application layer)
 * and consumed by the trigger service. Encapsulates native registration,
 * unregister, and reschedule operations behind a deterministic clock/next-
 * occurrence abstraction (FR4). Never executes business logic in the
 * callback and never polls (FR9, C1).
 */
export interface SchedulerPort {
  /**
   * Register (or re-register) a Job Definition's schedule with the adapter.
   * Idempotent external effect paired with compensation; never one
   * transaction spanning Config.Service and Bun/the OS (FR6, C5). Fails
   * validation before registration when the definition requests an overlap/
   * misfire/timezone/persistence capability the adapter cannot enforce
   * (FR5, FR7, AC22).
   */
  readonly register: (input: SchedulerRegisterInput) => Effect.Effect<SchedulerRegisterOutput, SchedulerError>

  /**
   * Unregister a previously registered schedule. Idempotent; never reported
   * as a confirmed remote kill of in-flight mutating work (FR16, C17, AC25).
   */
  readonly unregister: (input: SchedulerUnregisterInput) => Effect.Effect<SchedulerUnregisterOutput, SchedulerError>

  /**
   * Startup rehydration: replay persisted definitions, re-register enabled
   * ones, and reconcile registration state without claiming past execution
   * (FR3, C5, AC2, AC23). Also invoked for explicit operator-triggered
   * reconciliation of `unknown` registration state.
   */
  readonly reconcile: (input: SchedulerReconcileInput) => Effect.Effect<SchedulerReconcileOutput, SchedulerError>

  /**
   * Entry point invoked by the in-process `Bun.cron` callback when a due
   * time fires (C16). Claims the occurrence under its idempotency tuple,
   * evaluates misfire/overlap policy, and returns the resulting occurrence
   * state without executing business logic itself (FR9, FR10, C3, C6, C19).
   */
  readonly tick: (input: SchedulerTickInput) => Effect.Effect<SchedulerTickOutput, SchedulerError>
}

// =============================================================================
// NotificationPort — enqueue / deliverAtBoundary / ack / expire / audit / observe
// =============================================================================

/**
 * Bounded async notification delivery over the Feature 002 observation seam
 * (FR20, C8). Introduces no second channel authority. Data-plane observation
 * is read-only; control-plane wake/queue/steer uses native
 * SessionInput/SessionExecution, never a raw prompt injection (FR23, FR24).
 */
export interface NotificationPort {
  /** Publish `job.notification_enqueued`; authorization and redaction run before enqueue (FR21, C10). */
  readonly enqueue: (input: NotificationEnqueueInput) => Effect.Effect<NotificationEnqueueOutput, NotificationError>

  /**
   * Attempt delivery only at a safe active-turn boundary (C9). A busy or
   * unsafe target queues, coalesces, or expires the notification per policy
   * and never interrupts unsafe work (FR25, AC7).
   */
  readonly deliverAtBoundary: (
    input: NotificationDeliverInput,
  ) => Effect.Effect<NotificationDeliverOutput, NotificationError>

  /** Record `job.notification_acknowledged` for a delivered notification. */
  readonly ack: (input: NotificationAckInput) => Effect.Effect<NotificationAckOutput, NotificationError>

  /** Record `job.notification_expired` on TTL boundary; never grows an unbounded queue (C19, AC8). */
  readonly expire: (input: NotificationExpireInput) => Effect.Effect<NotificationExpireOutput, NotificationError>

  /**
   * Record an auditable outcome for a non-default notification action
   * (manager wake, structured input queue, new child session). The default
   * `operator_only` action requires no separate audit call beyond enqueue
   * (FR24, Security 9).
   */
  readonly audit: (input: NotificationAuditInput) => Effect.Effect<NotificationAuditOutput, NotificationError>

  /** Bounded, scoped observation stream for an authorized principal (FR20, FR23). */
  readonly observe: (
    input: NotificationObserveInput,
  ) => Effect.Effect<Stream.Stream<NotificationEnvelope, never>, NotificationError, Scope.Scope>
}

// =============================================================================
// JobsPort — Feature 007 `jobs.*` operator command/query surface (C12)
// =============================================================================

/**
 * Operator-facing port backing the Feature 007 `jobs.*` command IDs (C12).
 * Feature 003 supplies only these typed domain implementations; Feature 007
 * owns registration, palette/slash/CLI naming, authorization, CAS,
 * idempotency, and audit (ADR-0003). `run-now` starts no LLM turn solely for
 * administration (FR31, AC14).
 */
export interface JobsPort {
  /** `jobs.list` — redacted definitions, enabled + registration state. Zero LLM calls. */
  readonly list: (input: JobsListInput) => Effect.Effect<JobsListOutput, JobsError>

  /** `jobs.status` — definition status, next due, last outcome. */
  readonly status: (input: JobsStatusInput) => Effect.Effect<JobsStatusOutput, JobsError>

  /** `jobs.show` — full redacted definition plus occurrence history. */
  readonly show: (input: JobsShowInput) => Effect.Effect<JobsShowOutput, JobsError>

  /** `jobs.create` — create definition (CAS, scope, audit). */
  readonly create: (input: JobsCreateInput) => Effect.Effect<JobsCreateOutput, JobsError>

  /** `jobs.update` — update definition (version/CAS). */
  readonly update: (input: JobsUpdateInput) => Effect.Effect<JobsUpdateOutput, JobsError>

  /** `jobs.enable` — enable and register (idempotent). */
  readonly enable: (input: JobsEnableInput) => Effect.Effect<JobsEnableOutput, JobsError>

  /** `jobs.disable` — disable and unregister; never a silent kill of mutating work (C17, AC25). */
  readonly disable: (input: JobsDisableInput) => Effect.Effect<JobsDisableOutput, JobsError>

  /** `jobs.delete` — delete definition plus compensating unregister. */
  readonly delete: (input: JobsDeleteInput) => Effect.Effect<JobsDeleteOutput, JobsError>

  /** `jobs.reschedule` — change schedule; re-register intent. */
  readonly reschedule: (input: JobsRescheduleInput) => Effect.Effect<JobsRescheduleOutput, JobsError>

  /** `jobs.run-now` — create a normal occurrence through admission/routing (FR31, AC14). */
  readonly runNow: (input: JobsRunNowInput) => Effect.Effect<JobsRunNowOutput, JobsError>

  /** `jobs.history` — redacted occurrence/notification history. */
  readonly history: (input: JobsHistoryInput) => Effect.Effect<JobsHistoryOutput, JobsError>

  /** `jobs.watch` — live `job.*` stream over the observation seam. */
  readonly watch: (
    input: JobsWatchInput,
  ) => Effect.Effect<Stream.Stream<JobsWatchEvent, never>, JobsError, Scope.Scope>
}
