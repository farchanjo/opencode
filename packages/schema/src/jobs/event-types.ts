export * as EventTypes from "./event-types"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/event-types.cue (package jobs.enums) for the
// closed 30-member job.* event vocabulary (FR11). The job.* prefix is the
// Feature 003 lifecycle event namespace on EventV2, distinct from the Feature
// 007 jobs.* operator command domain; both are reserved (C13).

// JobEventType is the closed job.* vocabulary registered through EventV2.define (FR11, C8).
export const JobEventType = Schema.Literals([
  "job.definition_created",
  "job.definition_updated",
  "job.definition_enabled",
  "job.definition_disabled",
  "job.definition_deleted",
  "job.registered",
  "job.unregistered",
  "job.rescheduled",
  "job.trigger_due",
  "job.occurrence_claimed",
  "job.triggered",
  "job.misfired",
  "job.skipped",
  "job.coalesced",
  "job.queued",
  "job.admitted",
  "job.notification_enqueued",
  "job.notification_delivered",
  "job.notification_acknowledged",
  "job.notification_expired",
  "job.execution_started",
  "job.execution_completed",
  "job.execution_failed",
  "job.execution_cancelled",
  "job.execution_timed_out",
  "job.retry_scheduled",
  "job.overlap_rejected",
  "job.overlap_replaced",
  "job.reconciled",
  "job.unknown",
]).annotate({ identifier: "JobsEnums.JobEventType" })
export type JobEventType = typeof JobEventType.Type
