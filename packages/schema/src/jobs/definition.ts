export * as Definition from "./definition"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { Schedule } from "./schedule"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/jobs/definition.cue and definition-parts.cue (package
// jobs.definition) one-to-one. JobDefinition is the durable scheduled-job
// aggregate persisted in the Feature 007 Config.Service authority and rehydrated
// at startup (FR2, FR3, C5). An in-process Bun registration is never the durable
// authority (FR3). Mutations are atomic and idempotent within Config.Service with
// version/CAS; secrets are secure references only (FR6, FR32, C10). Cohesive
// sub-objects each stay within the calisthenics field bound.

// SecretRefList is the first-class collection of secure secret references (Security 3, C10).
export const SecretRefList = Schema.Array(Correlation.SecretRef).annotate({
  identifier: "JobsDefinition.SecretRefList",
})
export type SecretRefList = Schema.Schema.Type<typeof SecretRefList>

// DefinitionIdentity carries the label, description, owner, CAS version and timestamps.
export const DefinitionIdentity = Schema.Struct({
  name: TextValues.JobName,
  description: TextValues.JobDescription,
  owner: Correlation.Principal,
  version: Values.Version,
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
}).annotate({ identifier: "JobsDefinition.DefinitionIdentity" })
export type DefinitionIdentity = Schema.Schema.Type<typeof DefinitionIdentity>

// DefinitionSchedule carries the schedule id, cron/timezone, minimum interval and enabled flag.
export const DefinitionSchedule = Schema.Struct({
  schedule_id: Ids.ScheduleId,
  schedule: Schedule.CronSchedule,
  minimum_interval_ms: Schedule.MinimumIntervalMs,
  enabled: TextValues.Enabled,
}).annotate({ identifier: "JobsDefinition.DefinitionSchedule" })
export type DefinitionSchedule = Schema.Schema.Type<typeof DefinitionSchedule>

// DefinitionPolicy carries misfire, overlap and capability-surface policy (FR15, FR16, C1, C3, C19).
export const DefinitionPolicy = Schema.Struct({
  misfire: Enums.MisfirePolicy,
  overlap: Enums.OverlapPolicy,
  capability_surface: Enums.CapabilitySurface,
}).annotate({ identifier: "JobsDefinition.DefinitionPolicy" })
export type DefinitionPolicy = Schema.Schema.Type<typeof DefinitionPolicy>

// DefinitionExecution carries action type, target, deadline/timeout, retry budget and priority.
export const DefinitionExecution = Schema.Struct({
  action_type: Enums.ActionType,
  target: TextValues.ActionTarget,
  deadline_ms: Values.DeadlineMs,
  timeout_ms: Values.TimeoutMs,
  retry_budget: Values.RetryBudget,
  priority: Values.Priority,
}).annotate({ identifier: "JobsDefinition.DefinitionExecution" })
export type DefinitionExecution = Schema.Schema.Type<typeof DefinitionExecution>

// DefinitionAuthorization carries scope, project, principal, permissions and secure references (C10, C12).
export const DefinitionAuthorization = Schema.Struct({
  scope: Enums.Scope,
  project_ref: Correlation.ProjectRef,
  root_session_id: Schema.NullOr(Ids.RootSessionId),
  principal: Correlation.Principal,
  permissions: TextValues.PermissionSet,
  secret_refs: SecretRefList,
  payload_ref: Schema.NullOr(Correlation.PayloadRef),
}).annotate({ identifier: "JobsDefinition.DefinitionAuthorization" })
export type DefinitionAuthorization = Schema.Schema.Type<typeof DefinitionAuthorization>

// JobDefinition is the aggregate root of a scheduled job; id is job_definition_id (FR1, FR2).
export const JobDefinition = Schema.Struct({
  id: Ids.JobDefinitionId,
  identity: DefinitionIdentity,
  schedule: DefinitionSchedule,
  policy: DefinitionPolicy,
  execution: DefinitionExecution,
  authorization: DefinitionAuthorization,
}).annotate({ identifier: "JobsDefinition.JobDefinition" })
export type JobDefinition = Schema.Schema.Type<typeof JobDefinition>
