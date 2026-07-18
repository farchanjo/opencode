export * as EventBus from "./event-bus"

import type { Definition, Payload } from "../event"
import { EventDefinitions } from "@opencode-ai/schema/langlock/event-definitions"
import type { LangLockEventType } from "@opencode-ai/schema/langlock/event-types"

// Feature 004 / T021 (S15) — the langlock.* EventV2 bus and its idempotent
// projector.
//
// One `EventV2.define` Definition per langlock.* member (C8) is registered at the
// SCHEMA layer (`@opencode-ai/schema/langlock/event-definitions`) rather than
// declared here, because the six durable audit members must also join the
// canonical `Durable` inventory in `packages/schema/src/durable-event-manifest.ts`
// (T014, C8) — and the schema package can never depend on `packages/core` (core
// depends on schema, never the reverse; see `packages/core/package.json`). This
// module re-exports the single canonical copy of those Definitions for the domain
// engine and the `EventV2Bridge.publishLangLockEvent` boundary (T022), so no raw
// `LangLockEvent` tagged union is ever wired to the bus directly (C8). It mirrors
// `packages/core/src/jobs/event-bus.ts` (definitions + idempotent projector),
// folded into one module because the langlock barrel scope note reserves exactly
// one file for the bus.

/** The six durable audit member Definitions, in vocabulary order (C8). */
export const DurableDefinitions: ReadonlyArray<Definition> = EventDefinitions.DurableDefinitions

/** The nine live member Definitions, in vocabulary order (C8). */
export const LiveDefinitions: ReadonlyArray<Definition> = EventDefinitions.LiveDefinitions

/** All fifteen langlock.* member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = EventDefinitions.Definitions

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = EventDefinitions.ByType

// Re-export the individual Definitions under their own names for callers that want
// a statically-typed publish call (e.g. the bridge) instead of the dynamic `ByType`
// lookup.
export const {
  PolicySetDefinition,
  PolicyResetDefinition,
  OverrideAuthorizedDefinition,
  OverrideDeniedDefinition,
  ExceptionRegisteredDefinition,
  ExceptionRevokedDefinition,
  PolicyInjectedDefinition,
  PolicyReappliedDefinition,
  EnvelopeStampedDefinition,
  AdvisoryFlaggedDefinition,
  AdvisoryAcknowledgedDefinition,
  AdvisorySuppressedDefinition,
  DetectorUnknownDefinition,
  ResolutionRetainedDefinition,
  UnknownDefinition,
} = EventDefinitions

// =============================================================================
// Event-class membership (C8)
// =============================================================================

/** The fifteen registered langlock.* event type strings (bare, unversioned). */
export const LangLockEventTypes: ReadonlyArray<string> = Object.freeze(Array.from(ByType.keys()))

const langLockTypeSet = new Set<string>(LangLockEventTypes)

/**
 * The six durable audit members (C8). They carry the EventV2 `durable {version,
 * aggregate}` annotation and replay through `readAggregate`; the nine live
 * advisory/injection/resolution members omit it and commit no sequence. Audit and
 * advisory events are distinct semantic classes and are never collapsed (FR27, AC14).
 */
export const DURABLE_LANGLOCK_EVENT_TYPES: ReadonlyArray<string> = Object.freeze([
  "langlock.policy_set",
  "langlock.policy_reset",
  "langlock.override_authorized",
  "langlock.override_denied",
  "langlock.exception_registered",
  "langlock.exception_revoked",
])

const durableTypeSet = new Set<string>(DURABLE_LANGLOCK_EVENT_TYPES)

/** True when the payload is one of the fifteen registered langlock.* members. */
export const isLangLockEvent = (payload: Payload): boolean => langLockTypeSet.has(payload.type)

/** True when the payload is one of the six durable audit members (C8). */
export const isDurableEvent = (payload: Payload): boolean => durableTypeSet.has(payload.type)

// =============================================================================
// Idempotent projector (FR27, C8, AC14)
// =============================================================================
//
// A projection over the single EventV2 authority (C8), never a second bus: it
// consumes langlock.* event records already read from the EventV2 stream/aggregate
// and classifies each one into exactly one outcome, keyed on the event id (primary
// idempotency key) plus the durable `(aggregate, seq)` pair — the aggregate being
// the content-free envelope's `correlation_id` (the same key EventV2 groups the
// durable sequence by). It reuses the Feature 002 dedupe posture so audit and
// advisory events are never coalesced or dropped (FR27, AC14). It surfaces anomalies
// as observable values WITHOUT throwing and WITHOUT inventing state.

/**
 * A langlock.* event normalized for projection. The bridge/adapter maps an EventV2
 * `Payload` onto this shape: the stable EventV2 event id, the bare langlock `type`,
 * the aggregate `correlation_id` (from `envelope.ordering.correlation_id`), and the
 * durable EventV2 sequence — `null` for the nine live members that carry no sequence
 * and never replay (C8).
 */
export interface LangLockEventRecord {
  readonly id: string
  readonly type: LangLockEventType
  /** The durable aggregate id, i.e. `envelope.ordering.correlation_id` (C8). */
  readonly correlation_id: string
  /** Durable EventV2 sequence for the aggregate, or `null` for a live member. */
  readonly seq: number | null
}

/** The projection anomaly reasons surfaced by the projector (never thrown). */
export type LangLockAnomalyKind = "duplicate" | "out_of_order"

/** A bounded, observable projection anomaly (never thrown; never invents state). */
export interface LangLockAnomalyRecord {
  readonly kind: LangLockAnomalyKind
  readonly correlation_id: string
  readonly reason: string
}

/**
 * The classification of one langlock.* event against the projection ledger.
 *   - `applied`: an in-order durable audit member advanced the aggregate sequence.
 *   - `observed`: a live advisory/injection/resolution member was accepted and is
 *     never dropped or coalesced; it drives no sequence (C8, AC14).
 *   - `duplicate`: the event id was already applied (idempotent redelivery, C8).
 *   - `out_of_order`: a durable sequence gap or a stale/replayed lower sequence.
 */
export type ProjectionOutcome =
  | { readonly kind: "applied"; readonly correlation_id: string; readonly seq: number; readonly type: LangLockEventType }
  | { readonly kind: "observed"; readonly correlation_id: string; readonly type: LangLockEventType }
  | { readonly kind: "duplicate"; readonly correlation_id: string; readonly anomaly: LangLockAnomalyRecord }
  | { readonly kind: "out_of_order"; readonly correlation_id: string; readonly anomaly: LangLockAnomalyRecord }

const anomaly = (kind: LangLockAnomalyKind, correlation_id: string, reason: string): LangLockAnomalyRecord =>
  Object.freeze({ kind, correlation_id, reason })

/**
 * The projector's ledger: the set of already-applied event ids (the primary
 * idempotency key) and the per-aggregate high-water durable sequence (the ordering
 * key). Both are bounded by the durable retention that prunes an aggregate; the
 * projector never grows an unbounded universal buffer.
 */
export interface Projector {
  /**
   * Classify one langlock.* event against the ledger. Pure and total: it returns
   * exactly one `ProjectionOutcome` and never throws. The ledger is advanced as a
   * side effect: the event id is recorded once seen, and an in-order durable sequence
   * is consumed. A live member (no sequence) is always an accepted `observed`.
   */
  readonly classify: (record: LangLockEventRecord) => ProjectionOutcome
  /** The highest durable sequence applied for an aggregate, or `-1` if none. */
  readonly appliedSeq: (correlation_id: string) => number
  /** True once the event id has been seen (for external idempotency probes). */
  readonly seen: (id: string) => boolean
  /** Reset the ledger — used to rebuild a fresh projection before an aggregate replay. */
  readonly reset: () => void
}

/** Construct a fresh idempotent projector with an empty ledger (C8, AC14). */
export const createProjector = (): Projector => {
  const seenIds = new Set<string>()
  const highWater = new Map<string, number>()

  const classify = (record: LangLockEventRecord): ProjectionOutcome => {
    const { correlation_id } = record

    // 1. Idempotency keyed on the stable EventV2 event id (C8, at-least-once).
    if (seenIds.has(record.id)) {
      return { kind: "duplicate", correlation_id, anomaly: anomaly("duplicate", correlation_id, "duplicate_event_id") }
    }
    seenIds.add(record.id)

    // 2. A live member carries no sequence: it is an accepted observation on the
    //    aggregate, never dropped or coalesced (C8, AC14).
    if (record.seq === null) {
      return { kind: "observed", correlation_id, type: record.type }
    }

    // 3. Durable ordering keyed on (correlation_id, seq).
    const last = highWater.get(correlation_id) ?? -1
    if (record.seq <= last) {
      return {
        kind: "out_of_order",
        correlation_id,
        anomaly: anomaly("out_of_order", correlation_id, `seq_${record.seq}_not_after_${last}`),
      }
    }
    if (record.seq > last + 1) {
      return {
        kind: "out_of_order",
        correlation_id,
        anomaly: anomaly("out_of_order", correlation_id, `seq_gap_expected_${last + 1}_got_${record.seq}`),
      }
    }
    highWater.set(correlation_id, record.seq)
    return { kind: "applied", correlation_id, seq: record.seq, type: record.type }
  }

  return {
    classify,
    appliedSeq: (correlation_id) => highWater.get(correlation_id) ?? -1,
    seen: (id) => seenIds.has(id),
    reset: () => {
      seenIds.clear()
      highWater.clear()
    },
  }
}
