export * as Ids from "./ids"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

// Mirrors doc/arch/schemas/routing/ids.cue, versions.cue and descriptors.cue —
// all three CUE files share the `routing.shared` package, so their
// definitions merge into a single logical namespace. This module is the
// canonical TypeScript mirror of that namespace: shared identifier and
// descriptive ValueObjects reused across the routing.decision and
// routing.events schemas (decision.ts, events.ts).
//
// RECONCILIATION NOTE: packages/schema/src/routing/capability.ts and
// packages/schema/src/routing/budget.ts predate this module and locally
// redefine a subset of these primitives (ProviderName, ModelId, VariantName,
// ApiFamily, Scope, Reason, Requirement, Timestamp, EscalationThreshold)
// under their own identifiers pending this file's existence. Now that
// routing/ids.ts exists, a follow-up task should fold those local
// definitions into imports from this module.

// --- ids.cue ---

const idPattern = /^[A-Za-z0-9_-]{1,128}$/

// SessionId identifies a Session across the telemetry correlation chain.
export const SessionId = Schema.String.check(Schema.isPattern(idPattern)).annotate({
  identifier: "RoutingIds.SessionId",
})
export type SessionId = typeof SessionId.Type

// TurnId identifies a single turn within a Session.
export const TurnId = Schema.String.check(Schema.isPattern(idPattern)).annotate({
  identifier: "RoutingIds.TurnId",
})
export type TurnId = typeof TurnId.Type

// DecisionId is the ULID of a routing decision — sort order encodes creation time.
export const DecisionId = Schema.String.check(Schema.isULID()).annotate({
  identifier: "RoutingIds.DecisionId",
})
export type DecisionId = typeof DecisionId.Type

// ExecutionId identifies a task-execution span at full correlation depth.
export const ExecutionId = Schema.String.check(Schema.isPattern(idPattern)).annotate({
  identifier: "RoutingIds.ExecutionId",
})
export type ExecutionId = typeof ExecutionId.Type

// AgentId is a canonical specialist-agent identifier.
export const AgentId = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.AgentId",
})
export type AgentId = typeof AgentId.Type

// ModelId is a canonical model identifier resolved from ModelsDev.
export const ModelId = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.ModelId",
})
export type ModelId = typeof ModelId.Type

// SkillName names a single skill selected for a candidate.
export const SkillName = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.SkillName",
})
export type SkillName = typeof SkillName.Type

// ProviderName names a model provider.
export const ProviderName = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.ProviderName",
})
export type ProviderName = typeof ProviderName.Type

// VariantName names a provider/model variant.
export const VariantName = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.VariantName",
})
export type VariantName = typeof VariantName.Type

// ApiFamily is a normalised API family (e.g. "openai" | "anthropic").
export const ApiFamily = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.ApiFamily",
})
export type ApiFamily = typeof ApiFamily.Type

// --- versions.cue ---

// Version is a monotonic schema/record version.
export const Version = PositiveInt.annotate({ identifier: "RoutingIds.Version" })
export type Version = typeof Version.Type

// CatalogVersion pins the capability catalog at decision time.
export const CatalogVersion = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.CatalogVersion",
})
export type CatalogVersion = typeof CatalogVersion.Type

// PolicyVersion pins the routing policy at decision time.
export const PolicyVersion = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.PolicyVersion",
})
export type PolicyVersion = typeof PolicyVersion.Type

// TodoRef references a Todo aggregate.
export const TodoRef = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.TodoRef",
})
export type TodoRef = typeof TodoRef.Type

// TodoVersion pins a Todo aggregate revision.
export const TodoVersion = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.TodoVersion",
})
export type TodoVersion = typeof TodoVersion.Type

// Timestamp is an ISO 8601 instant.
export const Timestamp = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.Timestamp",
})
export type Timestamp = typeof Timestamp.Type

// Fingerprint is a deterministic hash of task inputs for cache/replay dedup.
export const Fingerprint = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.Fingerprint",
})
export type Fingerprint = typeof Fingerprint.Type

// --- descriptors.cue ---
// Same `routing.shared` CUE package as ids.cue and versions.cue above —
// candidate.cue, ranking.cue and budget.cue reach these through their
// `import "routing/ids"` statement.

// CapabilityDimension names a single tool-capability dimension.
export const CapabilityDimension = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.CapabilityDimension",
})
export type CapabilityDimension = typeof CapabilityDimension.Type

// Scope is a granularity scope such as "provider/model/variant".
export const Scope = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.Scope",
})
export type Scope = typeof Scope.Type

// Reason is a human-readable explanation string on a record.
export const Reason = Schema.String.annotate({ identifier: "RoutingIds.Reason" })
export type Reason = typeof Reason.Type

// Requirement describes what a task required from a candidate.
export const Requirement = Schema.String.annotate({ identifier: "RoutingIds.Requirement" })
export type Requirement = typeof Requirement.Type

// PermissionMode names the active permission mode.
export const PermissionMode = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.PermissionMode",
})
export type PermissionMode = typeof PermissionMode.Type

// EscalationThreshold is a named structured escalation signal.
export const EscalationThreshold = Schema.String.check(Schema.isNonEmpty()).annotate({
  identifier: "RoutingIds.EscalationThreshold",
})
export type EscalationThreshold = typeof EscalationThreshold.Type
