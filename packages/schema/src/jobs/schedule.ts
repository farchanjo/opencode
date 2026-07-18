export * as Schedule from "./schedule"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/schedule.cue (package jobs.schedule) one-to-one.
// The canonical stored form is an IANA timezone plus a 5-field cron expression;
// due instants are normalized by an explicit occurrence layer over
// Bun.cron.parse, not by relying on the runtime's UTC interpretation alone (C4).
//
// ANNOTATION ORDER: see ids.ts — annotate before check, brand after check.

const cronPattern = /^(@(annually|yearly|monthly|weekly|daily|hourly)|(\S+\s+){4}\S+)$/
const ianaPattern = /^(UTC|[A-Za-z_]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?)$/

// CronExpression is a 5-field cron expression or a supported nickname (FR7, C4).
export const CronExpression = Schema.String.annotate({ identifier: "JobsSchedule.CronExpression" })
  .check(Schema.isPattern(cronPattern))
  .pipe(Schema.brand("Jobs.CronExpression"))
export type CronExpression = typeof CronExpression.Type

// IanaTimezone is a requested IANA timezone; unsupported zones are rejected pre-register (FR7, AC22).
export const IanaTimezone = Schema.String.annotate({ identifier: "JobsSchedule.IanaTimezone" })
  .check(Schema.isPattern(ianaPattern))
  .pipe(Schema.brand("Jobs.IanaTimezone"))
export type IanaTimezone = typeof IanaTimezone.Type

// MinimumIntervalMs bounds the minimum accepted interval; provisional constant with hook AC4.
export const MinimumIntervalMs = Schema.Number.annotate({ identifier: "JobsSchedule.MinimumIntervalMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type MinimumIntervalMs = typeof MinimumIntervalMs.Type

// NominalDueTime is the computed nominal due instant — a canonical string key,
// never a decoded DateTime, so the idempotency tuple keeps a stable identity
// (FR19, C6).
export const NominalDueTime = Schema.String.annotate({ identifier: "JobsSchedule.NominalDueTime" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("Jobs.NominalDueTime"))
export type NominalDueTime = typeof NominalDueTime.Type

// CronSchedule pairs the cron expression with its requested timezone (FR7, C4).
export const CronSchedule = Schema.Struct({
  expression: CronExpression,
  timezone: IanaTimezone,
}).annotate({ identifier: "JobsSchedule.CronSchedule" })
export type CronSchedule = Schema.Schema.Type<typeof CronSchedule>
