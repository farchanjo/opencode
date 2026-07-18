export * as Ids from "./ids"

import { Schema } from "effect"

// Mirrors doc/arch/schemas/routing/ids.cue, versions.cue and descriptors.cue —
// all three CUE files share the `routing.shared` package, so their
// definitions merge into a single logical namespace. This module is the
// canonical TypeScript mirror of that namespace: shared identifier and
// descriptive ValueObjects reused across the routing.decision and
// routing.events schemas (decision.ts, events.ts).
//
// RECONCILIATION: packages/schema/src/routing/capability.ts and
// packages/schema/src/routing/budget.ts previously redefined a subset of these
// primitives (ProviderName, ModelId, VariantName, ApiFamily, Scope, Reason,
// Requirement, Timestamp, EscalationThreshold) under their own identifiers.
// They now import from this module and re-export under the same member names,
// so this file is the single owner of those ValueObjects.
//
// ANNOTATION ORDER: `Schema.String`/`Schema.Number` is annotated with its root
// identifier BEFORE `.check(...)` is applied. Annotating an already-checked
// schema (including `Schema.Int`, itself `Schema.Number.check(isInt)`) drops
// the root identifier from `.ast.annotations`, so the base-then-check order is
// load-bearing for contract hygiene (see test/contract-hygiene.test.ts).

// --- ids.cue ---

const idPattern = /^[A-Za-z0-9_-]{1,128}$/

// SessionId identifies a Session across the telemetry correlation chain.
export const SessionId = Schema.String.annotate({ identifier: "RoutingIds.SessionId" }).check(
  Schema.isPattern(idPattern),
)
export type SessionId = typeof SessionId.Type

// TurnId identifies a single turn within a Session.
export const TurnId = Schema.String.annotate({ identifier: "RoutingIds.TurnId" }).check(Schema.isPattern(idPattern))
export type TurnId = typeof TurnId.Type

// DecisionId is the ULID of a routing decision — sort order encodes creation time.
export const DecisionId = Schema.String.annotate({ identifier: "RoutingIds.DecisionId" }).check(Schema.isULID())
export type DecisionId = typeof DecisionId.Type

// ExecutionId identifies a task-execution span at full correlation depth.
export const ExecutionId = Schema.String.annotate({ identifier: "RoutingIds.ExecutionId" }).check(
  Schema.isPattern(idPattern),
)
export type ExecutionId = typeof ExecutionId.Type

// AgentId is a canonical specialist-agent identifier.
export const AgentId = Schema.String.annotate({ identifier: "RoutingIds.AgentId" }).check(Schema.isNonEmpty())
export type AgentId = typeof AgentId.Type

// ModelId is a canonical model identifier resolved from ModelsDev.
export const ModelId = Schema.String.annotate({ identifier: "RoutingIds.ModelId" }).check(Schema.isNonEmpty())
export type ModelId = typeof ModelId.Type

// SkillName names a single skill selected for a candidate.
export const SkillName = Schema.String.annotate({ identifier: "RoutingIds.SkillName" }).check(Schema.isNonEmpty())
export type SkillName = typeof SkillName.Type

// ProviderName names a model provider.
export const ProviderName = Schema.String.annotate({ identifier: "RoutingIds.ProviderName" }).check(
  Schema.isNonEmpty(),
)
export type ProviderName = typeof ProviderName.Type

// VariantName names a provider/model variant.
export const VariantName = Schema.String.annotate({ identifier: "RoutingIds.VariantName" }).check(Schema.isNonEmpty())
export type VariantName = typeof VariantName.Type

// ApiFamily is a normalised API family (e.g. "openai" | "anthropic").
export const ApiFamily = Schema.String.annotate({ identifier: "RoutingIds.ApiFamily" }).check(Schema.isNonEmpty())
export type ApiFamily = typeof ApiFamily.Type

// --- versions.cue ---

// Version is a monotonic schema/record version (integer >= 1). Declared as an
// annotated Schema.Number with an integer + lower-bound check so the root
// identifier survives (see ANNOTATION ORDER above); Schema.Int would drop it.
export const Version = Schema.Number.annotate({ identifier: "RoutingIds.Version" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
)
export type Version = typeof Version.Type

// CatalogVersion pins the capability catalog at decision time.
export const CatalogVersion = Schema.String.annotate({ identifier: "RoutingIds.CatalogVersion" }).check(
  Schema.isNonEmpty(),
)
export type CatalogVersion = typeof CatalogVersion.Type

// PolicyVersion pins the routing policy at decision time.
export const PolicyVersion = Schema.String.annotate({ identifier: "RoutingIds.PolicyVersion" }).check(
  Schema.isNonEmpty(),
)
export type PolicyVersion = typeof PolicyVersion.Type

// TodoRef references a Todo aggregate.
export const TodoRef = Schema.String.annotate({ identifier: "RoutingIds.TodoRef" }).check(Schema.isNonEmpty())
export type TodoRef = typeof TodoRef.Type

// TodoVersion pins a Todo aggregate revision.
export const TodoVersion = Schema.String.annotate({ identifier: "RoutingIds.TodoVersion" }).check(Schema.isNonEmpty())
export type TodoVersion = typeof TodoVersion.Type

// Timestamp is an ISO 8601 instant.
export const Timestamp = Schema.String.annotate({ identifier: "RoutingIds.Timestamp" }).check(Schema.isNonEmpty())
export type Timestamp = typeof Timestamp.Type

// Fingerprint is a deterministic hash of task inputs for cache/replay dedup.
export const Fingerprint = Schema.String.annotate({ identifier: "RoutingIds.Fingerprint" }).check(Schema.isNonEmpty())
export type Fingerprint = typeof Fingerprint.Type

// --- descriptors.cue ---
// Same `routing.shared` CUE package as ids.cue and versions.cue above —
// candidate.cue, ranking.cue and budget.cue reach these through their
// `import "routing/ids"` statement.

// CapabilityDimension names a single tool-capability dimension.
export const CapabilityDimension = Schema.String.annotate({ identifier: "RoutingIds.CapabilityDimension" }).check(
  Schema.isNonEmpty(),
)
export type CapabilityDimension = typeof CapabilityDimension.Type

// Scope is a granularity scope such as "provider/model/variant".
export const Scope = Schema.String.annotate({ identifier: "RoutingIds.Scope" }).check(Schema.isNonEmpty())
export type Scope = typeof Scope.Type

// Reason is a human-readable explanation string on a record.
export const Reason = Schema.String.annotate({ identifier: "RoutingIds.Reason" })
export type Reason = typeof Reason.Type

// Requirement describes what a task required from a candidate.
export const Requirement = Schema.String.annotate({ identifier: "RoutingIds.Requirement" })
export type Requirement = typeof Requirement.Type

// PermissionMode names the active permission mode.
export const PermissionMode = Schema.String.annotate({ identifier: "RoutingIds.PermissionMode" }).check(
  Schema.isNonEmpty(),
)
export type PermissionMode = typeof PermissionMode.Type

// EscalationThreshold is a named structured escalation signal.
export const EscalationThreshold = Schema.String.annotate({ identifier: "RoutingIds.EscalationThreshold" }).check(
  Schema.isNonEmpty(),
)
export type EscalationThreshold = typeof EscalationThreshold.Type
