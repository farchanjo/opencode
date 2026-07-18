export * as Group from "./group"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Correlation } from "./correlation"
import { Enums } from "./enums"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/group.cue and group-parts.cue one-to-one.
// OutputGroup is the aggregate root of the content plane, keyed to one process/
// attempt/generation subtree (FR14, C1, C18, C21). Its identity is `id`; the
// composite OutputGroupRef is the fencing key so a new attempt/generation never
// overwrites a predecessor's committed content (FR27). The producer that owns the
// Feature 002 Process owns its group; Feature 005 introduces no second executor
// or store authority (FR3, C21). Each sub-object stays within the calisthenics
// field bound.

// OutputGroupRef is the composite identity key scoped to project/root-session/process/attempt/generation (FR14, C1, C18).
export const OutputGroupRef = Schema.Struct({
  project_id: Ids.ProjectId,
  root_session_id: Ids.RootSessionId,
  process_id: Ids.ProcessId,
  attempt: Values.Attempt,
  generation: Values.Generation,
}).annotate({ identifier: "OutputSpoolGroup.OutputGroupRef" })
export type OutputGroupRef = Schema.Schema.Type<typeof OutputGroupRef>

// GroupLineage carries correlation/causation and session/root identity of the producer (C21).
export const GroupLineage = Schema.Struct({
  correlation_id: Correlation.CorrelationId,
  causation_id: Schema.NullOr(Correlation.CausationId),
  session_id: Schema.NullOr(Ids.SessionId),
  root_session_id: Ids.RootSessionId,
}).annotate({ identifier: "OutputSpoolGroup.GroupLineage" })
export type GroupLineage = Schema.Schema.Type<typeof GroupLineage>

// GroupDurability selects the tiered fsync posture and disposable eligibility (FR8, C2).
export const GroupDurability = Schema.Struct({
  tier: Enums.DurabilityTier,
  disposable: TextValues.Disposable,
}).annotate({ identifier: "OutputSpoolGroup.GroupDurability" })
export type GroupDurability = Schema.Schema.Type<typeof GroupDurability>

// GroupSettlement carries the state, committed-length authority, reason and timestamps (FR23, FR25, C12, C13).
export const GroupSettlement = Schema.Struct({
  state: Enums.GroupState,
  committed_bytes: Values.CommittedBytes,
  reason: TextValues.Reason,
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  sealed_at: Schema.NullOr(DateTimeUtcFromMillis),
}).annotate({ identifier: "OutputSpoolGroup.GroupSettlement" })
export type GroupSettlement = Schema.Schema.Type<typeof GroupSettlement>

// ChannelRefSet is the first-class collection of OutputRefs the group owns (FR15, FR17).
export const ChannelRefSet = Schema.Array(Ids.OutputRef)
export type ChannelRefSet = Schema.Schema.Type<typeof ChannelRefSet>

// OutputGroup is the aggregate root of a producer's output; id is the group_id (FR14, C18).
export const OutputGroup = Schema.Struct({
  id: Ids.GroupId,
  key: OutputGroupRef,
  lineage: GroupLineage,
  durability: GroupDurability,
  settlement: GroupSettlement,
  channels: ChannelRefSet,
}).annotate({ identifier: "OutputSpoolGroup.OutputGroup" })
export type OutputGroup = Schema.Schema.Type<typeof OutputGroup>
