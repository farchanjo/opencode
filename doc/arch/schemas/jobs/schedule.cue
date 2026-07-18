// DDD role: ValueObject
// Package: jobs.schedule
// Cron and IANA-timezone ValueObjects plus the composite CronSchedule (FR7, C4).
// The canonical stored form is an IANA timezone plus a 5-field cron expression;
// due instants are normalized by an explicit occurrence layer over Bun.cron.parse,
// not by relying on the runtime's UTC interpretation alone (research.md, C4).

package jobs.schedule

// CronExpression is a 5-field cron expression or a supported nickname (FR7, C4).
#CronExpression: string & =~"^(@(annually|yearly|monthly|weekly|daily|hourly)|(\\S+\\s+){4}\\S+)$"

// IanaTimezone is a requested IANA timezone; unsupported zones are rejected pre-register (FR7, AC22).
#IanaTimezone: string & =~"^(UTC|[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?)$"

// MinimumIntervalMs bounds the minimum accepted interval; provisional constant with hook AC4.
#MinimumIntervalMs: uint & >=0

// NominalDueTime is the computed nominal due instant; lag is measured from it (FR19, C6).
#NominalDueTime: string & !~"^$"

// CronSchedule pairs the cron expression with its requested timezone (FR7, C4).
#CronSchedule: {
	expression: #CronExpression
	timezone:   #IanaTimezone
}
