export * as EventBus from "./event-bus"

import { Effect, Queue, Stream } from "effect"
import type { Scope } from "effect"
import type { Definition, Interface, Payload } from "../event"
import { EventDefinitions } from "@opencode-ai/schema/jobs/event-definitions"
import type { JobEnvelope } from "@opencode-ai/schema/jobs/envelope"
import type { OccurrenceId, RootSessionId } from "@opencode-ai/schema/jobs/ids"
import * as OccurrenceStateMachine from "./occurrence-state-machine"
import type { JobEventType, OccurrenceState } from "./occurrence-state-machine"

// Feature 003 / T017 (S12) — the job.* EventV2 bus and its idempotent projector.
//
// One `EventV2.define` Definition per job.* member (FR11) is registered at the
// SCHEMA layer (`@opencode-ai/schema/jobs/event-definitions`) rather than
// declared here, because the twenty-three durable members must also join the
// canonical `Durable` inventory in `packages/schema/src/durable-event-manifest.ts`
// (T018, C5) — and the schema package can never depend on `packages/core` (core
// depends on schema, never the reverse; see `packages/core/package.json`). This
// module re-exports the single canonical copy of those Definitions for the domain
// engine and the `EventV2Bridge.publishJobEvent` boundary, so no raw `JobEvent`
// tagged union is ever wired to the bus directly (C8). It mirrors
// `packages/core/src/lifecycle/event-bus.ts` (definitions + bounded subscription)
// and `packages/core/src/lifecycle/projection.ts` (idempotent projector), folded
// into one module because the jobs barrel scope note reserves exactly one file.

/** The twenty-three durable member Definitions, in vocabulary order (C8). */
export const DurableDefinitions: ReadonlyArray<Definition> = EventDefinitions.DurableDefinitions

/** The seven live member Definitions, in vocabulary order (C8). */
export const LiveDefinitions: ReadonlyArray<Definition> = EventDefinitions.LiveDefinitions

/** All thirty job.* member Definitions (durable then live). */
export const Definitions: ReadonlyArray<Definition> = EventDefinitions.Definitions

/** Definition lookup keyed by the bare (unversioned) `type` string. */
export const ByType: ReadonlyMap<string, Definition> = EventDefinitions.ByType

// Re-export the individual Definitions under their own names for callers that
// want a statically-typed publish call (e.g. the bridge) instead of the dynamic
// `ByType` lookup.
export const {
  JobDefinitionCreatedDefinition,
  JobDefinitionUpdatedDefinition,
  JobDefinitionEnabledDefinition,
  JobDefinitionDisabledDefinition,
  JobDefinitionDeletedDefinition,
  JobRegisteredDefinition,
  JobUnregisteredDefinition,
  JobRescheduledDefinition,
  JobOccurrenceClaimedDefinition,
  JobTriggeredDefinition,
  JobAdmittedDefinition,
  JobExecutionStartedDefinition,
  JobExecutionCompletedDefinition,
  JobExecutionFailedDefinition,
  JobExecutionCancelledDefinition,
  JobExecutionTimedOutDefinition,
  JobOverlapRejectedDefinition,
  JobOverlapReplacedDefinition,
  JobNotificationEnqueuedDefinition,
  JobNotificationAcknowledgedDefinition,
  JobNotificationExpiredDefinition,
  JobReconciledDefinition,
  JobUnknownDefinition,
  JobTriggerDueDefinition,
  JobMisfiredDefinition,
  JobSkippedDefinition,
  JobCoalescedDefinition,
  JobQueuedDefinition,
  JobNotificationDeliveredDefinition,
  JobRetryScheduledDefinition,
} = EventDefinitions

// =============================================================================
// Bounded subscription surface (C8)
// =============================================================================
//
// Every observer subscribes to the job.* members over the single EventV2
// authority via `EventV2.Service.listen` (C8). This seam wraps that listen in a
// bounded queue so a slow subscriber never blocks the trigger, executor, or the
// producer hot path (AC15). The bus itself is not a second event system and holds
// no unbounded universal PubSub.

/** The thirty registered job.* event type strings (bare, unversioned). */
export const JobEventTypes: ReadonlyArray<string> = Object.freeze(Array.from(ByType.keys()))

const jobTypeSet = new Set<string>(JobEventTypes)

/**
 * Terminal, definition-mutation, and reconciliation events are priority and are
 * never dropped or coalesced (FR12, AC18). Their durable preservation is
 * guaranteed by the EventV2 durable aggregate (C8) and enforced by the projector;
 * this bounded seam only guarantees a slow subscriber never blocks the producer.
 */
export const PRIORITY_EVENT_TYPES: ReadonlyArray<string> = Object.freeze([
  "job.definition_created",
  "job.definition_updated",
  "job.definition_enabled",
  "job.definition_disabled",
  "job.definition_deleted",
  "job.execution_completed",
  "job.execution_failed",
  "job.execution_cancelled",
  "job.execution_timed_out",
  "job.reconciled",
])

const prioritySet = new Set<string>(PRIORITY_EVENT_TYPES)

/** True when the payload is one of the thirty registered job.* members. */
export const isJobEvent = (payload: Payload): boolean => jobTypeSet.has(payload.type)

/** True when the payload is a priority (terminal/definition-mutation/reconcile) member. */
export const isPriorityEvent = (payload: Payload): boolean => prioritySet.has(payload.type)

/**
 * Bounded-queue overflow policy, reusing the Feature 001/002 posture (C8):
 * `backpressure` evicts the oldest buffered live signal to admit the newest;
 * `drop` rejects the incoming live signal. Neither ever blocks the producer.
 */
export type OverflowPolicy = "backpressure" | "drop"

export interface BoundedSubscriptionOptions {
  readonly capacity: number
  /** Defaults to `drop`. */
  readonly overflow?: OverflowPolicy
}

/**
 * Subscribe to the job.* members over `EventV2.Service.listen` (C8) behind a
 * bounded queue. Non-job events are filtered out before the queue. The
 * subscription is scoped: the returned Stream's finalizer unsubscribes the
 * listener and shuts the queue down, leaving no leak (AC15). A slow consumer of
 * the returned Stream can only lose live signals to the overflow policy — it can
 * never apply backpressure to the producer.
 */
export const subscribeBounded = (
  events: Interface,
  options: BoundedSubscriptionOptions,
): Effect.Effect<Stream.Stream<Payload>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const overflow = options.overflow ?? "drop"
    const queue = yield* (overflow === "backpressure"
      ? Queue.sliding<Payload>(options.capacity)
      : Queue.dropping<Payload>(options.capacity))
    const unsubscribe = yield* events.listen((event) =>
      jobTypeSet.has(event.type) ? Queue.offer(queue, event).pipe(Effect.asVoid) : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid))
    return Stream.fromQueue(queue)
  })

// =============================================================================
// Idempotent projector (FR11, FR12, C8, AC18)
// =============================================================================
//
// A projection over the single EventV2 authority (C8), never a second bus: it
// consumes job.* event records already read from the EventV2 stream/aggregate and
// classifies each one into exactly one outcome, keyed on the event id plus the
// durable `(aggregateID, seq)` pair, reusing the Feature 002 dedupe posture. It
// surfaces the projection anomalies as observable values WITHOUT throwing and
// WITHOUT inventing terminal state (FR12), so terminal and definition-mutation
// events are never coalesced or dropped (AC18). Occurrence transitions delegate to
// the sibling state machine (T014); a non-occurrence member (definition,
// registration, notification) is recorded as an accepted observation rather than
// forced through the occurrence table.

/**
 * A job.* event normalized for projection. The bridge/adapter maps an EventV2
 * `Payload` onto this shape: the stable EventV2 event id, the bare job `type`, the
 * carried `JobEnvelope`, and the durable EventV2 sequence (`durable.seq`) — `null`
 * for the seven live members that carry no sequence and never replay (C8).
 */
export interface JobEventRecord {
  readonly id: string
  readonly type: JobEventType
  readonly envelope: JobEnvelope
  /** Durable EventV2 sequence for the aggregate, or `null` for a live member. */
  readonly seq: number | null
}

/** The projection anomaly reasons surfaced by the projector (FR12). */
export type JobAnomalyKind = "duplicate" | "out_of_order" | "unknown_occurrence" | "unreconciled"

/** A bounded, observable projection anomaly (never thrown; never invents state). */
export interface JobAnomalyRecord {
  readonly kind: JobAnomalyKind
  readonly occurrence_id: OccurrenceId
  readonly reason: string
}

/**
 * The classification of one job.* event against the projection ledger and the
 * caller-supplied current occurrence state.
 *   - `created`: a `job.trigger_due` event established a new `due` occurrence.
 *   - `applied`: a legal occurrence transition or in-state redelivery advanced or
 *     preserved the occurrence state.
 *   - `observed`: a non-occurrence member (definition/registration/notification)
 *     was accepted and is never dropped, without an occurrence transition.
 *   - `duplicate`: the event id was already applied (idempotent redelivery, C8).
 *   - `out_of_order`: a durable sequence gap or a stale/replayed lower sequence.
 *   - `unknown_occurrence`: an occurrence event with no `due` row yet.
 *   - `unreconciled`: an illegal occurrence transition or a duplicate creation;
 *     surfaced without inventing terminal state.
 */
export type ProjectionOutcome =
  | { readonly kind: "created"; readonly occurrence_id: OccurrenceId; readonly state: OccurrenceState }
  | {
      readonly kind: "applied"
      readonly occurrence_id: OccurrenceId
      readonly transition: OccurrenceStateMachine.TransitionResult
      readonly state: OccurrenceState
    }
  | { readonly kind: "observed"; readonly occurrence_id: OccurrenceId; readonly type: JobEventType }
  | { readonly kind: "duplicate"; readonly occurrence_id: OccurrenceId; readonly anomaly: JobAnomalyRecord }
  | { readonly kind: "out_of_order"; readonly occurrence_id: OccurrenceId; readonly anomaly: JobAnomalyRecord }
  | { readonly kind: "unknown_occurrence"; readonly occurrence_id: OccurrenceId; readonly anomaly: JobAnomalyRecord }
  | { readonly kind: "unreconciled"; readonly occurrence_id: OccurrenceId; readonly anomaly: JobAnomalyRecord }

/** The job.* members the occurrence state machine drives (creation plus transitions). */
const OCCURRENCE_EVENT_TYPES = new Set<JobEventType>([
  OccurrenceStateMachine.CREATION_EVENT,
  "job.occurrence_claimed",
  "job.misfired",
  "job.skipped",
  "job.coalesced",
  "job.admitted",
  "job.overlap_rejected",
  "job.overlap_replaced",
  "job.execution_started",
  "job.execution_completed",
  "job.execution_failed",
  "job.execution_cancelled",
  "job.execution_timed_out",
  "job.reconciled",
  "job.unknown",
])

const anomaly = (kind: JobAnomalyKind, occurrence_id: OccurrenceId, reason: string): JobAnomalyRecord =>
  Object.freeze({ kind, occurrence_id, reason })

/**
 * The projector's ledger: the set of already-applied event ids (the primary
 * idempotency key) and the per-aggregate high-water durable sequence (the
 * ordering key). Both are bounded by the durable retention that prunes an
 * aggregate; the projector never grows an unbounded universal buffer.
 */
export interface Projector {
  /**
   * Classify one job.* event against the ledger and the current state of its
   * occurrence (`null` when no `due` row exists yet). Pure and total: it returns
   * exactly one `ProjectionOutcome` and never throws (FR12). The ledger is
   * advanced as a side effect: the event id is recorded once seen, and an in-order
   * durable sequence is consumed even when the resulting transition is illegal —
   * the durable log position is real regardless of state legality.
   */
  readonly classify: (record: JobEventRecord, currentState: OccurrenceState | null) => ProjectionOutcome
  /** The highest durable sequence applied for an aggregate, or `-1` if none. */
  readonly appliedSeq: (aggregateID: RootSessionId) => number
  /** True once the event id has been seen (for external idempotency probes). */
  readonly seen: (id: string) => boolean
  /** Reset the ledger — used to rebuild a fresh projection before an aggregate replay. */
  readonly reset: () => void
}

/** Construct a fresh idempotent projector with an empty ledger (C8, AC18). */
export const createProjector = (): Projector => {
  const seenIds = new Set<string>()
  const highWater = new Map<string, number>()

  const classify = (record: JobEventRecord, currentState: OccurrenceState | null): ProjectionOutcome => {
    const occurrence_id = record.envelope.occurrence.occurrence_id
    const aggregateID = record.envelope.tree.root_session_id

    // 1. Idempotency keyed on the stable EventV2 event id (C8, at-least-once).
    if (seenIds.has(record.id)) {
      return { kind: "duplicate", occurrence_id, anomaly: anomaly("duplicate", occurrence_id, "duplicate_event_id") }
    }
    seenIds.add(record.id)

    // 2. Durable ordering keyed on (aggregateID, seq). Live members omit seq.
    if (record.seq !== null) {
      const last = highWater.get(aggregateID) ?? -1
      if (record.seq <= last) {
        return {
          kind: "out_of_order",
          occurrence_id,
          anomaly: anomaly("out_of_order", occurrence_id, `seq_${record.seq}_not_after_${last}`),
        }
      }
      if (record.seq > last + 1) {
        return {
          kind: "out_of_order",
          occurrence_id,
          anomaly: anomaly("out_of_order", occurrence_id, `seq_gap_expected_${last + 1}_got_${record.seq}`),
        }
      }
      // In order: consume the durable position now, regardless of the state
      // legality decided below (the log entry exists either way).
      highWater.set(aggregateID, record.seq)
    }

    // 3. A non-occurrence member (definition/registration/notification) is a real
    // observation on the aggregate. It is accepted and never dropped or coalesced;
    // it drives no occurrence transition (FR12, AC18).
    if (!OCCURRENCE_EVENT_TYPES.has(record.type)) {
      return { kind: "observed", occurrence_id, type: record.type }
    }

    // 4. Creation (`job.trigger_due`) establishes the `due` occurrence; a creation
    // over an existing occurrence cannot be reconciled (never regresses/duplicates).
    if (record.type === OccurrenceStateMachine.CREATION_EVENT) {
      if (currentState !== null) {
        return {
          kind: "unreconciled",
          occurrence_id,
          anomaly: anomaly("unreconciled", occurrence_id, "duplicate_creation"),
        }
      }
      return { kind: "created", occurrence_id, state: "due" }
    }

    // 5. Any other occurrence event for an occurrence with no `due` row is unknown.
    if (currentState === null) {
      return {
        kind: "unknown_occurrence",
        occurrence_id,
        anomaly: anomaly("unknown_occurrence", occurrence_id, "no_occurrence_due"),
      }
    }

    // 6. Delegate the transition legality to the state machine (T014). An illegal
    // edge is surfaced as unreconciled — never a thrown error, never invented
    // terminal state (FR12, AC18).
    const transition = OccurrenceStateMachine.apply(currentState, record.type)
    if (transition.kind === "illegal") {
      return {
        kind: "unreconciled",
        occurrence_id,
        anomaly: anomaly("unreconciled", occurrence_id, `illegal_${currentState}_via_${record.type}`),
      }
    }
    const state = transition.kind === "transition" ? transition.to : currentState
    return { kind: "applied", occurrence_id, transition, state }
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
