export * as EnumsEvent from "./enums-event"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/jobs/enums-event.cue (package jobs.enums) for the
// event source, actor and visibility enums carried on the job.* envelope (FR12).
// Visibility is enforced before delivery or projection (FR21, Security 1).

// JobSource names the origin subsystem of a job.* event (FR12).
export const JobSource = Schema.Literals(["runtime", "scheduler", "executor", "reconciler", "operator"]).annotate({
  identifier: "JobsEnums.JobSource",
})
export type JobSource = typeof JobSource.Type

// ActorKind names who acted to produce the event; no LLM ever administers (FR28, AC17).
export const ActorKind = Schema.Literals(["runtime", "operator", "executor"]).annotate({
  identifier: "JobsEnums.ActorKind",
})
export type ActorKind = typeof ActorKind.Type

// Visibility is the authorization scope enforced before delivery/projection (FR21, C10).
export const Visibility = Schema.Literals(["session", "tree", "project", "global_privileged"]).annotate({
  identifier: "JobsEnums.Visibility",
})
export type Visibility = typeof Visibility.Type
