export * as Events from "./events"

import { Schema } from "effect"
import { Enums } from "./enums"
import { EnumsEvent } from "./enums-event"
import { EnumsState } from "./enums-state"
import { Envelope } from "./envelope"
import { Ids } from "./ids"
import { TextValues } from "./text-values"
import { Values } from "./values"

// Mirrors doc/arch/schemas/semantic/events.cue, events-index.cue and events-live.cue
// one-to-one — the closed 12-member SemanticEvent tagged union plus the cohesive
// detail sub-objects distinct members carry (C22). Binding selection/cutover/
// rollback, index upsert/tombstone/reconcile and generation build/cutover/retire are
// the nine durable settlement members and replay through readAggregate; retrieval
// degradation, provider probe and binding state change are the three live signals
// and may be dropped under load (C12, C22). Content is never an event payload — only
// bounded enums, opaque ids and redacted metadata (FR17, FR42, C22).
//
// AUTHORITATIVE MODULE: every detail sub-object, all 12 member Structs, and the
// SemanticEvent union are defined here; the per-member EventV2.define Definitions
// (durable/live split) live in ./event-definitions and re-use these member fields,
// so there is exactly one copy of each wire shape (C22). Mirroring Feature
// 002/003/004/005, no raw tagged union is wired to the bus.

// --- events.cue: detail sub-objects ---

// BindingSelectionDetail carries the pinned slot and version staged by an operator (FR28, FR31, C12).
export const BindingSelectionDetail = Schema.Struct({
  slot: Enums.Slot,
  version: Values.BindingVersion,
}).annotate({ identifier: "SemanticEvent.BindingSelectionDetail" })
export type BindingSelectionDetail = Schema.Schema.Type<typeof BindingSelectionDetail>

// CutoverDetail carries the generation and the CAS outcome of an alias swap or rollback (FR12, C12, AC31).
export const CutoverDetail = Schema.Struct({
  generation_id: Ids.GenerationId,
  outcome: EnumsEvent.CutoverOutcome,
}).annotate({ identifier: "SemanticEvent.CutoverDetail" })
export type CutoverDetail = Schema.Schema.Type<typeof CutoverDetail>

// IndexMutationDetail carries the collection and content hash of an upsert/tombstone (FR13, AC10).
export const IndexMutationDetail = Schema.Struct({
  collection: EnumsState.Collection,
  content_hash: TextValues.ContentHash,
}).annotate({ identifier: "SemanticEvent.IndexMutationDetail" })
export type IndexMutationDetail = Schema.Schema.Type<typeof IndexMutationDetail>

// ReconcileDetail carries the collection and the reconcile outcome (FR13, AC10, AC13).
export const ReconcileDetail = Schema.Struct({
  collection: EnumsState.Collection,
  outcome: EnumsEvent.CutoverOutcome,
}).annotate({ identifier: "SemanticEvent.ReconcileDetail" })
export type ReconcileDetail = Schema.Schema.Type<typeof ReconcileDetail>

// GenerationDetail carries the generation and its lifecycle state (FR12, C12).
export const GenerationDetail = Schema.Struct({
  generation_id: Ids.GenerationId,
  state: EnumsState.GenerationState,
}).annotate({ identifier: "SemanticEvent.GenerationDetail" })
export type GenerationDetail = Schema.Schema.Type<typeof GenerationDetail>

// DegradationDetail carries the typed capability gap and the ladder mode (FR24, C20, AC29).
export const DegradationDetail = Schema.Struct({
  gap: EnumsState.DegradationGap,
  mode: EnumsState.RetrievalMode,
}).annotate({ identifier: "SemanticEvent.DegradationDetail" })
export type DegradationDetail = Schema.Schema.Type<typeof DegradationDetail>

// ProbeDetail carries the probed slot and its validation status (FR30, C16, AC22).
export const ProbeDetail = Schema.Struct({
  slot: Enums.Slot,
  status: Enums.ValidationStatus,
}).annotate({ identifier: "SemanticEvent.ProbeDetail" })
export type ProbeDetail = Schema.Schema.Type<typeof ProbeDetail>

// StateChangeDetail carries the slot and its new binding state (FR31, C20).
export const StateChangeDetail = Schema.Struct({
  slot: Enums.Slot,
  state: EnumsState.BindingState,
}).annotate({ identifier: "SemanticEvent.StateChangeDetail" })
export type StateChangeDetail = Schema.Schema.Type<typeof StateChangeDetail>

// --- events-index.cue: durable settlement members (nine; C22) ---

// binding_selected — an operator staged a candidate binding version (FR28, FR31, C12).
export const SemanticBindingSelectedEvent = Schema.Struct({
  type: Schema.Literal("semantic.binding_selected"),
  envelope: Envelope.SemanticEnvelope,
  detail: BindingSelectionDetail,
}).annotate({ identifier: "SemanticEvent.SemanticBindingSelectedEvent" })
export type SemanticBindingSelectedEvent = Schema.Schema.Type<typeof SemanticBindingSelectedEvent>

// binding_cutover — an atomic CAS alias swap activated a binding generation (FR12, C12, AC31).
export const SemanticBindingCutoverEvent = Schema.Struct({
  type: Schema.Literal("semantic.binding_cutover"),
  envelope: Envelope.SemanticEnvelope,
  detail: CutoverDetail,
}).annotate({ identifier: "SemanticEvent.SemanticBindingCutoverEvent" })
export type SemanticBindingCutoverEvent = Schema.Schema.Type<typeof SemanticBindingCutoverEvent>

// binding_rolled_back — a cutover was reversed under policy (FR32, C12).
export const SemanticBindingRolledBackEvent = Schema.Struct({
  type: Schema.Literal("semantic.binding_rolled_back"),
  envelope: Envelope.SemanticEnvelope,
  detail: CutoverDetail,
}).annotate({ identifier: "SemanticEvent.SemanticBindingRolledBackEvent" })
export type SemanticBindingRolledBackEvent = Schema.Schema.Type<typeof SemanticBindingRolledBackEvent>

// index_upserted — a content-hash incremental upsert reflected core state (FR13, AC10).
export const SemanticIndexUpsertedEvent = Schema.Struct({
  type: Schema.Literal("semantic.index_upserted"),
  envelope: Envelope.SemanticEnvelope,
  detail: IndexMutationDetail,
}).annotate({ identifier: "SemanticEvent.SemanticIndexUpsertedEvent" })
export type SemanticIndexUpsertedEvent = Schema.Schema.Type<typeof SemanticIndexUpsertedEvent>

// index_tombstoned — a removed document was tombstoned to reflect core state (FR13, AC10).
export const SemanticIndexTombstonedEvent = Schema.Struct({
  type: Schema.Literal("semantic.index_tombstoned"),
  envelope: Envelope.SemanticEnvelope,
  detail: IndexMutationDetail,
}).annotate({ identifier: "SemanticEvent.SemanticIndexTombstonedEvent" })
export type SemanticIndexTombstonedEvent = Schema.Schema.Type<typeof SemanticIndexTombstonedEvent>

// index_reconciled — a scheduled reconcile aligned the projection with core (FR13, AC13).
export const SemanticIndexReconciledEvent = Schema.Struct({
  type: Schema.Literal("semantic.index_reconciled"),
  envelope: Envelope.SemanticEnvelope,
  detail: ReconcileDetail,
}).annotate({ identifier: "SemanticEvent.SemanticIndexReconciledEvent" })
export type SemanticIndexReconciledEvent = Schema.Schema.Type<typeof SemanticIndexReconciledEvent>

// generation_built — a blue/green generation finished building (FR12, C12).
export const SemanticGenerationBuiltEvent = Schema.Struct({
  type: Schema.Literal("semantic.generation_built"),
  envelope: Envelope.SemanticEnvelope,
  detail: GenerationDetail,
}).annotate({ identifier: "SemanticEvent.SemanticGenerationBuiltEvent" })
export type SemanticGenerationBuiltEvent = Schema.Schema.Type<typeof SemanticGenerationBuiltEvent>

// generation_cutover — a generation became live via an atomic alias swap (FR12, C12, AC31).
export const SemanticGenerationCutoverEvent = Schema.Struct({
  type: Schema.Literal("semantic.generation_cutover"),
  envelope: Envelope.SemanticEnvelope,
  detail: GenerationDetail,
}).annotate({ identifier: "SemanticEvent.SemanticGenerationCutoverEvent" })
export type SemanticGenerationCutoverEvent = Schema.Schema.Type<typeof SemanticGenerationCutoverEvent>

// generation_retired — a superseded generation retired after the dual-write window (FR12, C12).
export const SemanticGenerationRetiredEvent = Schema.Struct({
  type: Schema.Literal("semantic.generation_retired"),
  envelope: Envelope.SemanticEnvelope,
  detail: GenerationDetail,
}).annotate({ identifier: "SemanticEvent.SemanticGenerationRetiredEvent" })
export type SemanticGenerationRetiredEvent = Schema.Schema.Type<typeof SemanticGenerationRetiredEvent>

// --- events-live.cue: live signal members (three; C22) ---

// retrieval_degraded — retrieval dropped to a lower ladder rung with a typed gap (FR24, C20, AC29).
export const SemanticRetrievalDegradedEvent = Schema.Struct({
  type: Schema.Literal("semantic.retrieval_degraded"),
  envelope: Envelope.SemanticEnvelope,
  detail: DegradationDetail,
}).annotate({ identifier: "SemanticEvent.SemanticRetrievalDegradedEvent" })
export type SemanticRetrievalDegradedEvent = Schema.Schema.Type<typeof SemanticRetrievalDegradedEvent>

// provider_probed — a native probe/eval updated a model's validation status (FR30, C16, AC22).
export const SemanticProviderProbedEvent = Schema.Struct({
  type: Schema.Literal("semantic.provider_probed"),
  envelope: Envelope.SemanticEnvelope,
  detail: ProbeDetail,
}).annotate({ identifier: "SemanticEvent.SemanticProviderProbedEvent" })
export type SemanticProviderProbedEvent = Schema.Schema.Type<typeof SemanticProviderProbedEvent>

// binding_state_changed — a pinned slot moved between active/degraded/unavailable (FR31, C20).
export const SemanticBindingStateChangedEvent = Schema.Struct({
  type: Schema.Literal("semantic.binding_state_changed"),
  envelope: Envelope.SemanticEnvelope,
  detail: StateChangeDetail,
}).annotate({ identifier: "SemanticEvent.SemanticBindingStateChangedEvent" })
export type SemanticBindingStateChangedEvent = Schema.Schema.Type<typeof SemanticBindingStateChangedEvent>

// --- events.cue: the closed tagged union of every vocabulary member ---

// SemanticEvent is the closed 12-member tagged union discriminated on `type` (C22).
export const SemanticEvent = Schema.Union([
  SemanticBindingSelectedEvent,
  SemanticBindingCutoverEvent,
  SemanticBindingRolledBackEvent,
  SemanticIndexUpsertedEvent,
  SemanticIndexTombstonedEvent,
  SemanticIndexReconciledEvent,
  SemanticGenerationBuiltEvent,
  SemanticGenerationCutoverEvent,
  SemanticGenerationRetiredEvent,
  SemanticRetrievalDegradedEvent,
  SemanticProviderProbedEvent,
  SemanticBindingStateChangedEvent,
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SemanticEvent.SemanticEvent" })
export type SemanticEvent = Schema.Schema.Type<typeof SemanticEvent>
