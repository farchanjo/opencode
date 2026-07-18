export * as Events from "./events"

import { Schema } from "effect"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { Envelope } from "./envelope"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/outputspool/events.cue, events-settlement.cue and
// events-live.cue one-to-one — the closed 11-member OutputEvent tagged union plus
// the cohesive detail sub-objects distinct members carry (FR4, C13, C20). Seal,
// abort, settlement, reconciliation, generation-fencing, retention and admission
// stay distinct semantic events and are never collapsed into a generic status
// update.
//
// AUTHORITATIVE MODULE: every detail sub-object, all 11 member Structs, and the
// OutputEvent union are defined here. events-settlement.ts and events-live.ts
// re-export the durable/live member subsets (with grouping arrays for the bus
// layer). Defining members in the split files while the union stays here would
// force an ESM circular initialization — the union needs the members and the
// members need these details — so the details and members share this one module
// and the split files are cycle-free re-export views (mirrors the Feature 002/003
// events.ts / events-durable.ts / events-live.ts pattern).
//
// Mirroring Feature 002/003/004, each member is registered as its own
// EventV2.define Definition on the EventV2Bridge (dataFields(Member.fields)); no
// raw tagged union is wired to the bus (C20). Durable settlement members carry
// the EventV2 durable {version, aggregate} annotation; live members omit it (C20).

// --- events.cue: detail sub-objects ---

// SealDetail carries the finalized committed length and its integrity tag (FR24, C2, C20).
export const SealDetail = Schema.Struct({
  committed_bytes: Values.CommittedBytes,
  integrity_tag: TextValues.IntegrityTag,
}).annotate({ identifier: "OutputSpoolEvent.SealDetail" })
export type SealDetail = Schema.Schema.Type<typeof SealDetail>

// AbortDetail carries the preserved committed length and the settlement outcome (FR24, C4, C20).
export const AbortDetail = Schema.Struct({
  committed_bytes: Values.CommittedBytes,
  outcome: EnumsEvent.SettlementOutcome,
}).annotate({ identifier: "OutputSpoolEvent.AbortDetail" })
export type AbortDetail = Schema.Schema.Type<typeof AbortDetail>

// SettlementDetail carries the content-plane settlement outcome and committed length (FR23, C13).
export const SettlementDetail = Schema.Struct({
  outcome: EnumsEvent.SettlementOutcome,
  committed_bytes: Values.CommittedBytes,
}).annotate({ identifier: "OutputSpoolEvent.SettlementDetail" })
export type SettlementDetail = Schema.Schema.Type<typeof SettlementDetail>

// ReconcileDetail carries the crash-reconciliation outcome and committed length (FR25, C12, AC8).
export const ReconcileDetail = Schema.Struct({
  outcome: EnumsEvent.SettlementOutcome,
  committed_bytes: Values.CommittedBytes,
}).annotate({ identifier: "OutputSpoolEvent.ReconcileDetail" })
export type ReconcileDetail = Schema.Schema.Type<typeof ReconcileDetail>

// FenceDetail carries the fencing generation that rejected a superseded writer (FR27, C18, AC11).
export const FenceDetail = Schema.Struct({
  generation: Values.Generation,
  outcome: EnumsEvent.SettlementOutcome,
}).annotate({ identifier: "OutputSpoolEvent.FenceDetail" })
export type FenceDetail = Schema.Schema.Type<typeof FenceDetail>

// RetentionEventDetail carries the reference-edge kind for a release/reclaim event (FR28-FR30, C5).
export const RetentionEventDetail = Schema.Struct({
  edge_kind: Enums.RetentionEdgeKind,
  scope: Enums.QuotaScope,
}).annotate({ identifier: "OutputSpoolEvent.RetentionEventDetail" })
export type RetentionEventDetail = Schema.Schema.Type<typeof RetentionEventDetail>

// AdmissionEventDetail carries the observable admission fault and its scope (FR10, C4, AC7).
export const AdmissionEventDetail = Schema.Struct({
  fault: Enums.AdmissionFault,
  scope: Enums.QuotaScope,
}).annotate({ identifier: "OutputSpoolEvent.AdmissionEventDetail" })
export type AdmissionEventDetail = Schema.Schema.Type<typeof AdmissionEventDetail>

// --- events-settlement.cue: durable settlement members (seven; C20) ---

// channel_sealed — committed bytes were finalized for a generation (FR24, C2, AC8).
export const OutputChannelSealedEvent = Schema.Struct({
  type: Schema.Literal("output.channel_sealed"),
  envelope: Envelope.OutputEnvelope,
  detail: SealDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputChannelSealedEvent" })
export type OutputChannelSealedEvent = Schema.Schema.Type<typeof OutputChannelSealedEvent>

// channel_aborted — append stopped while committed bytes are preserved (FR24, C4, AC10).
export const OutputChannelAbortedEvent = Schema.Struct({
  type: Schema.Literal("output.channel_aborted"),
  envelope: Envelope.OutputEnvelope,
  detail: AbortDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputChannelAbortedEvent" })
export type OutputChannelAbortedEvent = Schema.Schema.Type<typeof OutputChannelAbortedEvent>

// settlement_recorded — the content-plane settlement outcome preceding terminal status (FR23, C13, AC9).
export const OutputSettlementRecordedEvent = Schema.Struct({
  type: Schema.Literal("output.settlement_recorded"),
  envelope: Envelope.OutputEnvelope,
  detail: SettlementDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputSettlementRecordedEvent" })
export type OutputSettlementRecordedEvent = Schema.Schema.Type<typeof OutputSettlementRecordedEvent>

// reconciled — crash recovery reconciled the group into a settlement outcome (FR25, C12, AC8).
export const OutputReconciledEvent = Schema.Struct({
  type: Schema.Literal("output.reconciled"),
  envelope: Envelope.OutputEnvelope,
  detail: ReconcileDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputReconciledEvent" })
export type OutputReconciledEvent = Schema.Schema.Type<typeof OutputReconciledEvent>

// generation_fenced — a superseded writer's append/seal was rejected by fencing (FR27, C18, AC11).
export const OutputGenerationFencedEvent = Schema.Struct({
  type: Schema.Literal("output.generation_fenced"),
  envelope: Envelope.OutputEnvelope,
  detail: FenceDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputGenerationFencedEvent" })
export type OutputGenerationFencedEvent = Schema.Schema.Type<typeof OutputGenerationFencedEvent>

// group_released — one holder reference edge was dropped (FR30, C5).
export const OutputGroupReleasedEvent = Schema.Struct({
  type: Schema.Literal("output.group_released"),
  envelope: Envelope.OutputEnvelope,
  detail: RetentionEventDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputGroupReleasedEvent" })
export type OutputGroupReleasedEvent = Schema.Schema.Type<typeof OutputGroupReleasedEvent>

// group_reclaimed — a fully unreferenced expired group was reclaimed in a bounded batch (FR29, FR30, C5, AC17).
export const OutputGroupReclaimedEvent = Schema.Struct({
  type: Schema.Literal("output.group_reclaimed"),
  envelope: Envelope.OutputEnvelope,
  detail: RetentionEventDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputGroupReclaimedEvent" })
export type OutputGroupReclaimedEvent = Schema.Schema.Type<typeof OutputGroupReclaimedEvent>

// --- events-live.cue: live signal members (four; C20) ---

// chunk_appended — a bounded-queue chunk was committed; droppable live progress (FR8, AC2).
export const OutputChunkAppendedEvent = Schema.Struct({
  type: Schema.Literal("output.chunk_appended"),
  envelope: Envelope.OutputEnvelope,
}).annotate({ identifier: "OutputSpoolEvent.OutputChunkAppendedEvent" })
export type OutputChunkAppendedEvent = Schema.Schema.Type<typeof OutputChunkAppendedEvent>

// backpressure_signalled — the writer queue hit its bound; producer backpressured (FR8, C3, AC5).
export const OutputBackpressureSignalledEvent = Schema.Struct({
  type: Schema.Literal("output.backpressure_signalled"),
  envelope: Envelope.OutputEnvelope,
  detail: AdmissionEventDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputBackpressureSignalledEvent" })
export type OutputBackpressureSignalledEvent = Schema.Schema.Type<typeof OutputBackpressureSignalledEvent>

// admission_degraded — an observable admission fault degraded the channel (FR10, C4, AC6, AC7).
export const OutputAdmissionDegradedEvent = Schema.Struct({
  type: Schema.Literal("output.admission_degraded"),
  envelope: Envelope.OutputEnvelope,
  detail: AdmissionEventDetail,
}).annotate({ identifier: "OutputSpoolEvent.OutputAdmissionDegradedEvent" })
export type OutputAdmissionDegradedEvent = Schema.Schema.Type<typeof OutputAdmissionDegradedEvent>

// unknown — an envelope-only fallback member; never gates work (C20).
export const OutputUnknownEvent = Schema.Struct({
  type: Schema.Literal("output.unknown"),
  envelope: Envelope.OutputEnvelope,
}).annotate({ identifier: "OutputSpoolEvent.OutputUnknownEvent" })
export type OutputUnknownEvent = Schema.Schema.Type<typeof OutputUnknownEvent>

// --- events.cue: the closed tagged union of every vocabulary member ---

// OutputEvent is the closed 11-member tagged union discriminated on `type` (C20).
export const OutputEvent = Schema.Union([
  OutputChannelSealedEvent,
  OutputChannelAbortedEvent,
  OutputSettlementRecordedEvent,
  OutputReconciledEvent,
  OutputGenerationFencedEvent,
  OutputGroupReleasedEvent,
  OutputGroupReclaimedEvent,
  OutputChunkAppendedEvent,
  OutputBackpressureSignalledEvent,
  OutputAdmissionDegradedEvent,
  OutputUnknownEvent,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "OutputSpoolEvent.OutputEvent" })
export type OutputEvent = Schema.Schema.Type<typeof OutputEvent>
