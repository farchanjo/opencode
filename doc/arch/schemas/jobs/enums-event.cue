// DDD role: ValueObject
// Package: jobs.enums
// Event source, actor and visibility enums carried on the job.* event envelope
// (FR12). Visibility is enforced before delivery or projection (FR21, Security 1).

package jobs.enums

// JobSource names the origin subsystem of a job.* event (FR12).
#JobSource: "runtime" | "scheduler" | "executor" | "reconciler" | "operator"

// ActorKind names who acted to produce the event; no LLM ever administers (FR28, AC17).
#ActorKind: "runtime" | "operator" | "executor"

// Visibility is the authorization scope enforced before delivery/projection (FR21, C10).
#Visibility: "session" | "tree" | "project" | "global_privileged"
