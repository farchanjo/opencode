export * as Envelope from "./envelope"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { CorrelationIds } from "./correlation-ids"
import { Enums } from "./enums"
import { EnumsObservation } from "./enums-observation"
import { Ids } from "./ids"
import { Values } from "./values"

// Mirrors doc/arch/schemas/lifecycle/envelope.cue, envelope-parts.cue and
// envelope-hierarchy.cue (package lifecycle.envelope) one-to-one. The
// LifecycleEnvelope is a ValueObject: the identifiable message is the lifecycle
// event member that carries it; the envelope holds only the EventV2-assigned
// event_id as a value (C8, FR9). Cohesive sub-objects keep every definition at
// most seven fields to stay within the calisthenics bound.
//
// HierarchyContext follows the CUE structure (nested delegation and correlation
// sub-objects), which is the 1:1 field-parity source of truth. This differs
// from data-model.md's flattened delegation_depth/delegation_path draft form;
// the CUE nests them under a Delegation ValueObject. hierarchy is present on the
// envelope only when Smart hierarchical routing is active, and its fields are
// reused verbatim from the Feature 001 routing/hierarchy schemas (C15).

// EventKind carries the event type, schema version, class, actor and runtime.
export const EventKind = Schema.Struct({
  event_type: Enums.LifecycleEventType,
  schema_version: Values.SchemaVersion,
  event_class: Enums.EventClass,
  agent_kind: Enums.AgentKind,
  actor_kind: Enums.ActorKind,
  runtime_instance_id: Ids.RuntimeInstanceId,
}).annotate({ identifier: "LifecycleEnvelope.EventKind" })
export type EventKind = Schema.Schema.Type<typeof EventKind>

// TreeIdentity carries root/session/parent-session identity.
export const TreeIdentity = Schema.Struct({
  root_session_id: Ids.RootSessionId,
  session_id: Ids.SessionId,
  parent_session_id: Schema.NullOr(Ids.ParentSessionId),
}).annotate({ identifier: "LifecycleEnvelope.TreeIdentity" })
export type TreeIdentity = Schema.Schema.Type<typeof TreeIdentity>

// ProcessIdentity carries task/process/parent-process/root-process identity.
export const ProcessIdentity = Schema.Struct({
  task_id: Ids.TaskId,
  process_id: Ids.ProcessId,
  parent_process_id: Schema.NullOr(Ids.ParentProcessId),
  root_process_id: Ids.RootProcessId,
}).annotate({ identifier: "LifecycleEnvelope.ProcessIdentity" })
export type ProcessIdentity = Schema.Schema.Type<typeof ProcessIdentity>

// Ordering carries per-aggregate sequence, correlation and attempt/generation.
// sequence is per aggregate only; no global order is implied (C8).
export const Ordering = Schema.Struct({
  sequence: Values.Sequence,
  correlation_id: CorrelationIds.CorrelationId,
  causation_id: Schema.NullOr(CorrelationIds.CausationId),
  attempt: Values.Attempt,
  generation: Values.Generation,
}).annotate({ identifier: "LifecycleEnvelope.Ordering" })
export type Ordering = Schema.Schema.Type<typeof Ordering>

// Delivery carries visibility, timestamp and bounded redacted metadata. The
// metadata map holds no prompts, results, tool payloads, paths, or secrets
// (FR13, FR28).
export const Delivery = Schema.Struct({
  visibility: Enums.Visibility,
  timestamp: DateTimeUtcFromMillis,
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "LifecycleEnvelope.Delivery" })
export type Delivery = Schema.Schema.Type<typeof Delivery>

// Delegation carries delegation depth and the delegation path (C15).
export const Delegation = Schema.Struct({
  depth: Values.DelegationDepth,
  path: Schema.Array(Ids.SessionId),
}).annotate({ identifier: "LifecycleEnvelope.Delegation" })
export type Delegation = Schema.Schema.Type<typeof Delegation>

// HierarchyCorrelation carries the routing decision and turn correlation ids.
export const HierarchyCorrelation = Schema.Struct({
  decision_id: CorrelationIds.DecisionId,
  turn_id: CorrelationIds.TurnId,
}).annotate({ identifier: "LifecycleEnvelope.HierarchyCorrelation" })
export type HierarchyCorrelation = Schema.Schema.Type<typeof HierarchyCorrelation>

// HierarchyContext projects role, delegation, fanout and validation for a node.
export const HierarchyContext = Schema.Struct({
  role: EnumsObservation.HierarchyRole,
  delegation: Delegation,
  fanout: Schema.Struct({ requested: Values.FanoutCount, granted: Values.FanoutCount }),
  validation_outcome: Schema.NullOr(EnumsObservation.ValidationOutcome),
  correlation: HierarchyCorrelation,
}).annotate({ identifier: "LifecycleEnvelope.HierarchyContext" })
export type HierarchyContext = Schema.Schema.Type<typeof HierarchyContext>

// LifecycleEnvelope is the common context bundle carried on every lifecycle
// event (FR9). hierarchy is present only when Smart routing is active (C15).
export const LifecycleEnvelope = Schema.Struct({
  event_id: Ids.EventId,
  kind: EventKind,
  tree: TreeIdentity,
  process: ProcessIdentity,
  ordering: Ordering,
  delivery: Delivery,
  hierarchy: Schema.NullOr(HierarchyContext),
}).annotate({ identifier: "LifecycleEnvelope.LifecycleEnvelope" })
export type LifecycleEnvelope = Schema.Schema.Type<typeof LifecycleEnvelope>
