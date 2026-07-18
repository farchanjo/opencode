/**
 * Feature 005 / T031 (S19) — the durable `output.*` settlement projection.
 *
 * Builds the seven durable content-plane settlement events (channel sealed /
 * aborted, settlement recorded, reconciled, generation fenced, group released /
 * reclaimed) as fully-typed `OutputSpoolEvents.OutputEvent` members and projects
 * them through the new `publishOutputEvent` boundary on the existing
 * `EventV2Bridge` (T031), mirroring `publishLangLockEvent`/`publishJobEvent`:
 * one publish boundary, no second bus, no raw tagged union wired to the bus
 * (C20). The four live append/backpressure/admission/unknown signals ride the
 * bounded live channel and are droppable under `allBounded` load. Every payload
 * is content-free — an OutputRef and bounded metadata only, never a content
 * chunk or a filesystem path (FR4, FR5, C20, C22, AC9, AC18).
 *
 * The `publish` seam is injected as a plain `(event) => void | Promise<void>`
 * function so this module carries no Effect-runtime dependency; the composition
 * root adapts `EventV2Bridge.publishOutputEvent` (an `Effect`) into it. Building
 * a member decodes a plain snake_case fact object through the schema union, so
 * the wire shape can never drift from `packages/schema/src/outputspool/*` (C20).
 */
export * as DurableEvents from "./durable-events"

import { Schema } from "effect"
import { Events as OutputSpoolEvents } from "@opencode-ai/schema/outputspool/events"
import type { SettlementOutcome } from "@opencode-ai/schema/outputspool/enums-event"
import type { RetentionEdgeKind, QuotaScope } from "@opencode-ai/schema/outputspool/enums"

const decodeEvent = Schema.decodeUnknownSync(OutputSpoolEvents.OutputEvent)

/** The content-free settlement facts every durable projection carries (never content/path). */
export interface SettlementFacts {
  readonly group_id: string
  readonly output_ref: string | null
  readonly channel: string | null
  readonly generation: number
  readonly correlation_id: string
  readonly committed_bytes: number
  readonly timestamp_ms: number
  readonly sequence?: number
}

const envelope = (type: string, facts: SettlementFacts, event_class: "durable" | "live", source: string) => ({
  event_id: `evt_output_${facts.correlation_id}_${facts.sequence ?? 0}`,
  kind: {
    event_type: type,
    schema_version: 1,
    event_class,
    source,
    actor_kind: "runtime",
    visibility: "session",
  },
  subject: {
    group_id: facts.group_id,
    output_ref: facts.output_ref,
    channel: facts.channel,
    generation: facts.generation,
  },
  ordering: {
    sequence: facts.sequence ?? 0,
    correlation_id: facts.correlation_id,
    causation_id: null,
  },
  delivery: {
    visibility: "session",
    timestamp: facts.timestamp_ms,
    redacted_metadata: {},
  },
})

/** Project `output.channel_sealed` — committed bytes finalized for a generation (FR24, C2, AC8). */
export const channelSealed = (facts: SettlementFacts, integrity_tag: string): OutputSpoolEvents.OutputEvent =>
  decodeEvent({
    type: "output.channel_sealed",
    envelope: envelope("output.channel_sealed", facts, "durable", "writer"),
    detail: { committed_bytes: facts.committed_bytes, integrity_tag },
  })

/** Project `output.channel_aborted` — append stopped, committed bytes preserved (FR24, C4, AC10). */
export const channelAborted = (facts: SettlementFacts, outcome: SettlementOutcome): OutputSpoolEvents.OutputEvent =>
  decodeEvent({
    type: "output.channel_aborted",
    envelope: envelope("output.channel_aborted", facts, "durable", "writer"),
    detail: { committed_bytes: facts.committed_bytes, outcome },
  })

/** Project `output.settlement_recorded` — content-plane outcome preceding terminal status (FR23, C13, AC9). */
export const settlementRecorded = (facts: SettlementFacts, outcome: SettlementOutcome): OutputSpoolEvents.OutputEvent =>
  decodeEvent({
    type: "output.settlement_recorded",
    envelope: envelope("output.settlement_recorded", facts, "durable", "producer"),
    detail: { outcome, committed_bytes: facts.committed_bytes },
  })

/** Project `output.reconciled` — crash recovery reconciled the group (FR25, C12, AC8, AC9). */
export const reconciled = (facts: SettlementFacts, outcome: SettlementOutcome): OutputSpoolEvents.OutputEvent =>
  decodeEvent({
    type: "output.reconciled",
    envelope: envelope("output.reconciled", facts, "durable", "reconciler"),
    detail: { outcome, committed_bytes: facts.committed_bytes },
  })

/** Project `output.generation_fenced` — a superseded writer's append/seal was rejected (FR27, C18, AC11). */
export const generationFenced = (facts: SettlementFacts, outcome: SettlementOutcome): OutputSpoolEvents.OutputEvent =>
  decodeEvent({
    type: "output.generation_fenced",
    envelope: envelope("output.generation_fenced", facts, "durable", "writer"),
    detail: { generation: facts.generation, outcome },
  })

/** Project `output.group_released` — one holder reference edge was dropped (FR30, C5). */
export const groupReleased = (
  facts: SettlementFacts,
  edge_kind: RetentionEdgeKind,
  scope: QuotaScope,
): OutputSpoolEvents.OutputEvent =>
  decodeEvent({
    type: "output.group_released",
    envelope: envelope("output.group_released", facts, "durable", "retention"),
    detail: { edge_kind, scope },
  })

/** Project `output.group_reclaimed` — an unreferenced expired group was reclaimed (FR29, FR30, C5, AC17). */
export const groupReclaimed = (
  facts: SettlementFacts,
  edge_kind: RetentionEdgeKind,
  scope: QuotaScope,
): OutputSpoolEvents.OutputEvent =>
  decodeEvent({
    type: "output.group_reclaimed",
    envelope: envelope("output.group_reclaimed", facts, "durable", "retention"),
    detail: { edge_kind, scope },
  })

/** The injected publish seam; the composition root adapts `EventV2Bridge.publishOutputEvent`. */
export type PublishOutputEvent = (event: OutputSpoolEvents.OutputEvent) => void | Promise<void>

export interface DurableEventsProjector {
  readonly emit: (event: OutputSpoolEvents.OutputEvent) => Promise<void>
}

/** Build the projector over the injected single publish boundary (C20). */
export const createDurableEventsProjector = (publish: PublishOutputEvent): DurableEventsProjector => ({
  emit: async (event) => {
    await publish(event)
  },
})
