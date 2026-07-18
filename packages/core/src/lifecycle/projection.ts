/**
 * Feature 002 / T016 (S6) — the idempotent lifecycle projector.
 *
 * A projection over the single EventV2 authority (C2), never a second bus: it
 * consumes lifecycle event records already read from the EventV2 stream/aggregate
 * and classifies each one into exactly one outcome, keyed on the event id plus
 * the durable `(aggregateID, seq)` pair (C6, C9). It surfaces the four projection
 * anomalies — `duplicate`, `out_of_order`, `unknown_process`, and `unreconciled`
 * — as observable `Observation.AnomalyRecord` values (schema `AnomalyKind`:
 * `duplicate | out_of_order | unknown_event | unreconciled`) WITHOUT throwing and
 * WITHOUT inventing terminal state (FR23, FR29). The legal state transition is
 * delegated to the sibling state machine (T017); an illegal transition is a
 * `unreconciled` anomaly rather than a thrown error.
 *
 * The projector is a small stateful ledger — the idempotency key sets and the
 * per-aggregate high-water sequence — but every decision is pure and total. The
 * current Process Table state for the event's process is supplied by the caller
 * (T018 owns the rows), so this module never holds a second copy of row state.
 * Hot path: `classify` performs O(1) set/map lookups and never blocks (AC7).
 */
export * as Projection from "./projection"

import type { AnomalyRecord } from "@opencode-ai/schema/lifecycle/observation"
import type { AnomalyKind } from "@opencode-ai/schema/lifecycle/enums-observation"
import type { LifecycleEnvelope } from "@opencode-ai/schema/lifecycle/envelope"
import type { EventId, ProcessId, RootProcessId } from "@opencode-ai/schema/lifecycle/ids"
import type { LifecycleEventType, ProcessState } from "@opencode-ai/schema/lifecycle/enums"
import * as StateMachine from "./state-machine"

export type { AnomalyRecord, AnomalyKind }

/**
 * A lifecycle event normalized for projection. The adapter (T025) maps an
 * EventV2 `Payload` onto this shape: the stable EventV2 event id, the bare
 * lifecycle `type`, the carried `LifecycleEnvelope`, and the durable EventV2
 * sequence (`durable.seq`) — `null` for the fifteen live members that carry no
 * sequence and never replay (C4).
 */
export interface LifecycleEventRecord {
  readonly id: EventId
  readonly type: LifecycleEventType
  readonly envelope: LifecycleEnvelope
  /** Durable EventV2 sequence for the aggregate, or `null` for a live member. */
  readonly seq: number | null
}

/** The four `AnomalyKind` literals surfaced by the projector (C9, FR29). */
export const ANOMALY_KINDS = ["duplicate", "out_of_order", "unknown_event", "unreconciled"] as const satisfies ReadonlyArray<AnomalyKind>

/**
 * The classification of one lifecycle event against the projection ledger and the
 * caller-supplied current process state.
 *   - `created`: a `process_created` event established a new `created` row.
 *   - `applied`: a legal transition or in-state observation advanced or preserved
 *     the row state.
 *   - `duplicate`: the event id was already applied (idempotent redelivery, C9).
 *   - `out_of_order`: a durable sequence gap or a stale/replayed lower sequence.
 *   - `unknown_process`: an event referencing a process with no `created` row
 *     (`AnomalyKind` `unknown_event`).
 *   - `unreconciled`: the event cannot be reconciled with the current state (an
 *     illegal state-machine transition or a duplicate creation); surfaced without
 *     inventing terminal state.
 */
export type ProjectionOutcome =
  | { readonly kind: "created"; readonly process_id: ProcessId; readonly state: ProcessState }
  | {
      readonly kind: "applied"
      readonly process_id: ProcessId
      readonly transition: StateMachine.TransitionResult
      readonly state: ProcessState
    }
  | { readonly kind: "duplicate"; readonly process_id: ProcessId; readonly anomaly: AnomalyRecord }
  | { readonly kind: "out_of_order"; readonly process_id: ProcessId; readonly anomaly: AnomalyRecord }
  | { readonly kind: "unknown_process"; readonly process_id: ProcessId; readonly anomaly: AnomalyRecord }
  | { readonly kind: "unreconciled"; readonly process_id: ProcessId; readonly anomaly: AnomalyRecord }

const anomaly = (kind: AnomalyKind, process_id: ProcessId, reason: string): AnomalyRecord =>
  Object.freeze({ kind, process_id, reason } as AnomalyRecord)

/**
 * The projector's ledger: the set of already-applied event ids (the primary
 * idempotency key) and the per-aggregate high-water durable sequence (the
 * ordering key). Both are bounded by the process-table retention that prunes an
 * aggregate; the projector never grows an unbounded universal buffer (C10).
 */
export interface Projector {
  /**
   * Classify one lifecycle event against the ledger and the current state of its
   * process (`null` when no `created` row exists yet). Pure and total: it returns
   * exactly one `ProjectionOutcome` and never throws (FR29). The ledger is
   * advanced as a side effect: the event id is recorded once seen, and an
   * in-order durable sequence is consumed even when the resulting transition is
   * illegal — the durable log position is real regardless of state legality.
   */
  readonly classify: (record: LifecycleEventRecord, currentState: ProcessState | null) => ProjectionOutcome
  /** The highest durable sequence applied for an aggregate, or `-1` if none. */
  readonly appliedSeq: (aggregateID: RootProcessId) => number
  /** True once the event id has been seen (for external idempotency probes). */
  readonly seen: (id: EventId) => boolean
  /** Reset the ledger — used to rebuild a fresh projection before an aggregate replay. */
  readonly reset: () => void
}

/** Construct a fresh idempotent projector with an empty ledger (C6, C9). */
export const createProjector = (): Projector => {
  const seenIds = new Set<string>()
  const highWater = new Map<string, number>()

  const classify = (record: LifecycleEventRecord, currentState: ProcessState | null): ProjectionOutcome => {
    const process_id = record.envelope.process.process_id
    const aggregateID = record.envelope.process.root_process_id

    // 1. Idempotency keyed on the stable EventV2 event id (C9, at-least-once).
    if (seenIds.has(record.id)) {
      return { kind: "duplicate", process_id, anomaly: anomaly("duplicate", process_id, "duplicate_event_id") }
    }
    seenIds.add(record.id)

    // 2. Durable ordering keyed on (aggregateID, seq). Live members omit seq.
    if (record.seq !== null) {
      const last = highWater.get(aggregateID) ?? -1
      if (record.seq <= last) {
        return {
          kind: "out_of_order",
          process_id,
          anomaly: anomaly("out_of_order", process_id, `seq_${record.seq}_not_after_${last}`),
        }
      }
      if (record.seq > last + 1) {
        return {
          kind: "out_of_order",
          process_id,
          anomaly: anomaly("out_of_order", process_id, `seq_gap_expected_${last + 1}_got_${record.seq}`),
        }
      }
      // In order: consume the durable position now, regardless of the state
      // legality decided below (the log entry exists either way).
      highWater.set(aggregateID, record.seq)
    }

    // 3. Creation establishes the row; a creation over an existing row cannot be
    // reconciled (it never regresses or duplicates a process, C9).
    if (record.type === StateMachine.CREATION_EVENT) {
      if (currentState !== null) {
        return {
          kind: "unreconciled",
          process_id,
          anomaly: anomaly("unreconciled", process_id, "duplicate_creation"),
        }
      }
      return { kind: "created", process_id, state: "created" }
    }

    // 4. Any non-creation event for a process with no created row is unknown.
    if (currentState === null) {
      return {
        kind: "unknown_process",
        process_id,
        anomaly: anomaly("unknown_event", process_id, "no_process_created"),
      }
    }

    // 5. Delegate the transition legality to the state machine (T017). An illegal
    // edge is surfaced as unreconciled — never a thrown error, never invented
    // terminal state (FR29, C9).
    const transition = StateMachine.apply(currentState, record.type)
    if (transition.kind === "illegal") {
      return {
        kind: "unreconciled",
        process_id,
        anomaly: anomaly("unreconciled", process_id, `illegal_${currentState}_via_${record.type}`),
      }
    }
    const state = transition.kind === "transition" ? transition.to : currentState
    return { kind: "applied", process_id, transition, state }
  }

  return {
    classify,
    appliedSeq: (aggregateID) => highWater.get(aggregateID) ?? -1,
    seen: (id) => seenIds.has(id),
    reset: () => {
      seenIds.clear()
      highWater.clear()
    },
  }
}
