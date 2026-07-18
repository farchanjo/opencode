export * as Retention from "./retention"

import { Schema } from "effect"
import { DateTimeUtcFromMillis } from "../schema"
import { Enums } from "./enums"
import { Ids } from "./ids"

// Mirrors doc/arch/schemas/outputspool/retention.cue one-to-one. Retention is
// reference-aware, never mtime-only, replacing the ToolOutputStore mtime cleanup.
// A group is reclaimable only when its TTL has elapsed AND it holds no live
// lease, no active reader/writer, no inbound reference edge (transcript, Todo,
// handoff, NotificationEnvelope, RowTelemetry) AND no legal/privacy hold applies
// (FR28, AC16). `release` drops one holder edge; `cleanup` reclaims only fully
// unreferenced expired groups in bounded batches (FR30, AC17).

// TtlMs bounds the retention TTL for a group; provisional plan constant (FR28, C5, AC16).
export const TtlMs = Schema.Number.annotate({ identifier: "OutputSpoolValues.TtlMs" }).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
export type TtlMs = typeof TtlMs.Type

// RetentionLease is one live holder lease that blocks reclamation while held (FR28, C5, AC16).
export const RetentionLease = Schema.Struct({
  lease_id: Ids.LeaseId,
  holder_ref: Ids.HolderRef,
  granted_at: DateTimeUtcFromMillis,
  expires_at: Schema.NullOr(DateTimeUtcFromMillis),
}).annotate({ identifier: "OutputSpoolRetention.RetentionLease" })
export type RetentionLease = Schema.Schema.Type<typeof RetentionLease>

// ReferenceEdge is one inbound reference that gates cleanup (FR28, C5, AC16).
export const ReferenceEdge = Schema.Struct({
  kind: Enums.RetentionEdgeKind,
  holder_ref: Ids.HolderRef,
}).annotate({ identifier: "OutputSpoolRetention.ReferenceEdge" })
export type ReferenceEdge = Schema.Schema.Type<typeof ReferenceEdge>

// ReferenceEdgeSet is the first-class collection of inbound reference edges (FR28, C5).
export const ReferenceEdgeSet = Schema.Array(ReferenceEdge)
export type ReferenceEdgeSet = Schema.Schema.Type<typeof ReferenceEdgeSet>

// RetentionDescriptor binds TTL, legal hold, optional lease and the inbound edge set (FR28-FR30, C5, AC16).
export const RetentionDescriptor = Schema.Struct({
  ttl_ms: TtlMs,
  legal_hold: Enums.LegalHoldState,
  lease: Schema.NullOr(RetentionLease),
  edges: ReferenceEdgeSet,
}).annotate({ identifier: "OutputSpoolRetention.RetentionDescriptor" })
export type RetentionDescriptor = Schema.Schema.Type<typeof RetentionDescriptor>
