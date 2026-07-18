/**
 * Feature 002 / T025 (S5) — the lifecycle-to-EventV2 application adapter.
 *
 * The bounded adaptation layer that sits BESIDE the canonical EventV2 bridge
 * (`packages/opencode/src/event-v2-bridge.ts`) and implements the Feature 002
 * `LifecyclePort` (`@opencode-ai/protocol/lifecycle`, T013) over the single
 * EventV2 authority (C2, C3). It never introduces a second event system,
 * executor, runtime, or SessionRunner (FR6, AC22): every publish goes through
 * `EventV2Bridge.publishLifecycleEvent`, and every projection folds through the
 * committed core domain engine (projector + state machine + Process Table,
 * T016–T018).
 *
 * Three responsibilities, matching the tasks.md T025 text:
 *   1. `normalizeRecord` maps one EventV2 `Payload` (data shape
 *      `{ envelope, detail?, root_process_id? }`, established by T015) onto the
 *      core `Projection.LifecycleEventRecord` contract `{ id, type, envelope,
 *      seq }`, taking the durable `seq` from `payload.durable?.seq` and `null`
 *      for the fifteen live members that never replay (C4).
 *   2. `emit` reconstructs a full `LifecycleEnvelope` from the caller-supplied
 *      `EmitEnvelope` (EventV2 assigns the id/seq/timestamp seam), publishes
 *      through the bridge, commits durable events atomically via
 *      `EventV2.PublishOptions.commit(seq)` and publishes live events without a
 *      sequence (C4), projecting each committed event onto the Process Table.
 *   3. `replay` wires `EventV2.readAggregate` -> `ProcessTable.rebuild` on
 *      startup, reconciles restarted rows against durable Sessions (C6, C13),
 *      and hands the resulting `RetentionAudit` to `EventV2.pruneDurable`
 *      through the injected pruner (FR4, FR27).
 *
 * All seams (bridge, table, aggregate reader, pruner, reconcile resolver, clock,
 * id generator) are injected so the adapter is unit-testable in-process with no
 * database, HTTP server, or live runtime, and so the real composition root wires
 * the canonical EventV2 service exactly once.
 */
export * as EventV2Adapter from "./eventv2-adapter"

import { DateTime, Effect } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import { EventBus } from "@opencode-ai/core/lifecycle/event-bus"
import type { ProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import type { Projection } from "@opencode-ai/core/lifecycle/projection"
import type { Reconciliation } from "@opencode-ai/core/lifecycle/reconciliation"
import type { Envelope } from "@opencode-ai/schema/lifecycle/envelope"
import type { Enums } from "@opencode-ai/schema/lifecycle/enums"
import type { Events as LifecycleEvents } from "@opencode-ai/schema/lifecycle/events"
import type { TodoEvents } from "@opencode-ai/schema/lifecycle/todo-events"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"
import type {
  EmitEnvelope,
  LifecycleEmitInput,
  LifecycleEmitOutput,
  LifecycleError,
  LifecycleProjectInput,
  LifecycleProjectOutput,
  LifecycleReplayInput,
  LifecycleReplayOutput,
  ProjectionAnomaly,
} from "@opencode-ai/protocol/lifecycle/commands"
import type { LifecyclePort } from "@opencode-ai/protocol/lifecycle/ports"

// =============================================================================
// Durable/detail membership (mirrors event-definitions + events.ts, C4)
// =============================================================================

/** The eleven durable member type strings; durable events commit a sequence (C4, C5). */
export const DURABLE_TYPES: ReadonlySet<Enums.LifecycleEventType> = new Set([
  "lifecycle.admitted",
  "lifecycle.parent_attached",
  "lifecycle.process_created",
  "lifecycle.started",
  "lifecycle.handoff",
  "lifecycle.reconciled",
  "lifecycle.completed",
  "lifecycle.failed",
  "lifecycle.cancelled",
  "lifecycle.zombie_detected",
  "lifecycle.owner_lost",
] as ReadonlyArray<Enums.LifecycleEventType>)

/**
 * The fifteen members that carry a `detail` sub-object (events.ts). The eleven
 * envelope-only members (`parent_attached`, `process_created`, `started`,
 * `queued`, `waiting`, `promoted`, `extended`, `turn_*`, `unknown`) publish the
 * envelope alone — attaching an empty `detail` would violate their closed
 * `Definition` schema, so `emit` omits it for them.
 */
export const DETAIL_TYPES: ReadonlySet<Enums.LifecycleEventType> = new Set([
  "lifecycle.admitted",
  "lifecycle.handoff",
  "lifecycle.reconciled",
  "lifecycle.completed",
  "lifecycle.failed",
  "lifecycle.cancelled",
  "lifecycle.zombie_detected",
  "lifecycle.owner_lost",
  "lifecycle.steer_requested",
  "lifecycle.steer_accepted",
  "lifecycle.steer_rejected",
  "lifecycle.cancel_requested",
  "lifecycle.cancelling",
  "lifecycle.tool_called",
  "lifecycle.tool_settled",
] as ReadonlyArray<Enums.LifecycleEventType>)

// =============================================================================
// Injected seams
// =============================================================================

/** The narrow slice of `EventV2Bridge` the adapter needs (C2, C3). */
export interface LifecycleBridge {
  readonly publishLifecycleEvent: (
    event: LifecycleEvents.LifecycleEvent,
    options?: EventV2.PublishOptions,
  ) => Effect.Effect<EventV2.Payload>
}

/** One page of durable aggregate records already normalized onto the core contract. */
export interface AggregatePage {
  readonly records: ReadonlyArray<Projection.LifecycleEventRecord>
  readonly hasMore: boolean
  /** The highest durable `seq` in this page, or `null` for an empty page. */
  readonly cursor: number | null
}

/**
 * Reads a bounded page of the durable EventV2 aggregate (a thin wrapper over
 * `EventV2.readAggregate` at the composition root). Kept as a seam so `replay`
 * has no direct database dependency and stays unit-testable (C6).
 */
export type AggregateReader = (input: {
  readonly aggregateID: string
  readonly after?: number
  readonly limit: number
}) => Effect.Effect<AggregatePage, LifecycleError>

/** Hands a planned `RetentionAudit` to `EventV2.pruneDurable`, returning the pruned count (FR27). */
export type DurablePruner = (audit: ProcessTable.RetentionAudit) => Effect.Effect<number, LifecycleError>

/** Resolves a restarted row's owner/version for reconciliation against durable Sessions (C13). */
export type ReconcileResolver = (
  row: ProcessTable.ProcessTableRow,
) => Pick<Reconciliation.ReconciliationInput, "owner_present" | "from_version" | "durable_version">

/**
 * Publishes one Feature 002 session-owned `todo.*` event (T032). Kept as an
 * injected seam so the adapter never hard-wires a Todo bus: the composition root
 * supplies the real publisher (its own `Definition`s), and `emitTodoEvent` stays
 * unit-testable in-process. When absent, `emitTodoEvent` still projects but
 * surfaces `not_implemented` for the publish leg.
 */
export type TodoEventPublisher = (event: TodoEvents.TodoEvent) => Effect.Effect<unknown, LifecycleError>

export interface EventV2AdapterDeps {
  readonly bridge: LifecycleBridge
  readonly table: ProcessTable.ProcessTable
  /** Required only by `replay`; a `not_implemented` failure is surfaced when absent. */
  readonly readAggregate?: AggregateReader
  /** Optional durable-prune sink; when absent `replay` skips retention pruning. */
  readonly pruner?: DurablePruner
  /** Optional restart reconciliation resolver; when absent `replay` skips reconciliation. */
  readonly reconcile?: ReconcileResolver
  /** Optional Feature 002 session-owned `todo.*` publisher used by `emitTodoEvent` (T032). */
  readonly publishTodoEvent?: TodoEventPublisher
  /** Monotonic millisecond clock for the synthetic delivery timestamp (default Date.now). */
  readonly clock?: () => number
  /** EventId generator; also passed as `PublishOptions.id` so the projection key matches (C8). */
  readonly newEventId?: () => string
}

// =============================================================================
// Settlement seam (T030, C20, FR64) — Feature 005 reports terminal settlement
// =============================================================================

/** Bounded output reference projected onto a settled row; content bytes are never loaded (C20, FR58). */
export interface BoundedOutputRefInput {
  readonly ref: string
  readonly cursor: string | null
}

/**
 * A settlement report the adapter forwards from Feature 005 (the settlement
 * authority) onto the terminal row (C20). Feature 002 owns terminal STATUS but
 * never fabricates a settled verdict: only this seam moves a `settling` row to
 * `settled`/`unknown`/`corrupt`, projecting the bounded ref/cursor only (FR64).
 */
export interface LifecycleSettlementInput {
  readonly processId: Ids.ProcessId
  readonly settlement: Enums.SettlementState
  readonly outputRef?: BoundedOutputRefInput | null
}

export interface LifecycleSettlementOutput {
  /** False when the process is unknown or not yet terminal — no verdict invented. */
  readonly applied: boolean
  readonly settlement: Enums.SettlementState | null
}

// =============================================================================
// Todo projection seam (T032, FR58k, C23-C25) — read-only Todo observation
// =============================================================================

/** Feature 001 `todo.initialized`, consumed READ-ONLY (structural; no Todo is mutated). */
export interface TodoInitializedInput {
  readonly session_id: Ids.SessionId
  readonly todo_ref: string
  readonly todo_version: string
  readonly item_count: number
}

/** Feature 001 `todo.completion_blocked`, consumed READ-ONLY (no ref; merges onto the row). */
export interface TodoCompletionBlockedInput {
  readonly session_id: Ids.SessionId
  readonly reason: string
  readonly pending_items: number
}

/** The adapter surface: the `LifecyclePort` plus an internal rebuilt-row accessor. */
export interface EventV2Adapter extends LifecyclePort {
  /**
   * The in-memory rows rebuilt for a scope after `replay`. Exposed for the
   * operator/observation surfaces (T031/T026) and tests; the typed schema
   * `ProcessRow` projection with model/usage enrichment is layered later
   * (T030/T031), so the `LifecyclePort.replay` `rows` field stays bounded.
   */
  readonly rebuiltRows: (
    scope: LifecycleReplayInput["scope"],
    scopeId: string,
  ) => ReadonlyArray<ProcessTable.ProcessTableRow>

  /**
   * T030 (C20, FR64) — forward a Feature 005 settlement report onto the terminal
   * row. A `completed` row stays `settling` until this seam reports a verdict;
   * an unknown or non-terminal process is a no-op (`applied: false`). Projects
   * the bounded `OutputRef`/cursor only.
   */
  readonly reportSettlement: (
    input: LifecycleSettlementInput,
  ) => Effect.Effect<LifecycleSettlementOutput, LifecycleError>

  /** T032 — project Feature 001 `todo.initialized` READ-ONLY onto the Session's rows. */
  readonly projectTodoInitialized: (input: TodoInitializedInput) => Effect.Effect<{ readonly updated: number }>

  /** T032 — project Feature 001 `todo.completion_blocked` READ-ONLY (merges, no ref). */
  readonly projectTodoCompletionBlocked: (
    input: TodoCompletionBlockedInput,
  ) => Effect.Effect<{ readonly updated: number }>

  /** T032 — project one Feature 002 session-owned `todo.*` event onto the Session's rows. */
  readonly projectTodoEvent: (event: TodoEvents.TodoEvent) => Effect.Effect<{ readonly updated: number }>

  /**
   * T032 — publish one Feature 002 session-owned `todo.*` event through the
   * injected publisher AND project it (session-owned events are both authored and
   * observed here). Sibling isolation is enforced by the projection.
   */
  readonly emitTodoEvent: (event: TodoEvents.TodoEvent) => Effect.Effect<{ readonly updated: number }, LifecycleError>
}

// =============================================================================
// Normalization
// =============================================================================

interface LifecyclePayloadData {
  readonly envelope: Envelope.LifecycleEnvelope
  readonly detail?: Record<string, unknown>
}

/**
 * Map one EventV2 `Payload` onto the core `LifecycleEventRecord` contract. The
 * durable `seq` comes from `payload.durable?.seq`; live members carry no
 * sequence and never replay, so they normalize to `seq: null` (C4).
 */
export function normalizeRecord(payload: EventV2.Payload): Projection.LifecycleEventRecord {
  const data = payload.data as unknown as LifecyclePayloadData
  return {
    id: payload.id as unknown as Ids.EventId,
    type: payload.type as Enums.LifecycleEventType,
    envelope: data.envelope,
    seq: payload.durable?.seq ?? null,
  }
}

/** Extract the bounded `detail` record delivered alongside an event (never prompts/secrets, FR28). */
export function payloadDetail(payload: EventV2.Payload): Record<string, unknown> {
  const data = payload.data as unknown as LifecyclePayloadData
  return data.detail ?? {}
}

// =============================================================================
// Envelope reconstruction (EmitEnvelope -> LifecycleEnvelope)
// =============================================================================

function buildEnvelope(input: EmitEnvelope, eventId: string, nowMs: number): Envelope.LifecycleEnvelope {
  return {
    event_id: eventId as Ids.EventId,
    kind: input.kind,
    tree: input.tree,
    process: input.process,
    ordering: {
      // EventV2 assigns the authoritative per-aggregate durable sequence; the
      // envelope sequence is a placeholder overwritten by `durable.seq` on the
      // projection record (the projector orders on the record `seq`, C8).
      sequence: 0 as Envelope.LifecycleEnvelope["ordering"]["sequence"],
      correlation_id: input.ordering.correlation_id,
      causation_id: input.ordering.causation_id,
      attempt: input.ordering.attempt,
      generation: input.ordering.generation,
    },
    delivery: {
      visibility: input.delivery.visibility,
      timestamp: DateTime.makeUnsafe(nowMs),
      redacted_metadata: input.delivery.redacted_metadata,
    },
    hierarchy: input.hierarchy,
  }
}

function buildEvent(
  eventType: Enums.LifecycleEventType,
  envelope: Envelope.LifecycleEnvelope,
  data: Record<string, unknown>,
): LifecycleEvents.LifecycleEvent {
  const base = { type: eventType, envelope }
  const event = DETAIL_TYPES.has(eventType) ? { ...base, detail: data } : base
  return event as unknown as LifecycleEvents.LifecycleEvent
}

// =============================================================================
// Anomaly projection (core ProjectionOutcome -> protocol ProjectionAnomaly)
// =============================================================================

function toProtocolAnomaly(
  outcome: Projection.ProjectionOutcome,
  input: { readonly eventId: string; readonly aggregateID: string | null; readonly seq: number | null },
): ProjectionAnomaly | null {
  switch (outcome.kind) {
    case "created":
    case "applied":
      return null
    case "duplicate":
      return { kind: "duplicate", eventId: input.eventId as Ids.EventId }
    case "out_of_order":
      return {
        kind: "out_of_order",
        aggregateID: input.aggregateID ?? outcome.process_id,
        expectedSeq: 0,
        actualSeq: input.seq ?? 0,
      } as unknown as ProjectionAnomaly
    case "unknown_process":
      return { kind: "unknown_process", processId: outcome.process_id }
    case "unreconciled":
      return { kind: "unreconciled", processId: outcome.process_id }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createEventV2Adapter(deps: EventV2AdapterDeps): EventV2Adapter {
  const clock = deps.clock ?? Date.now
  const newEventId = deps.newEventId ?? defaultEventId

  const emit = (input: LifecycleEmitInput): Effect.Effect<LifecycleEmitOutput, LifecycleError> =>
    Effect.gen(function* () {
      const definition = EventBus.ByType.get(input.eventType)
      if (definition === undefined) {
        return yield* Effect.fail<LifecycleError>({ type: "unknown_event_type", eventType: input.eventType })
      }

      const eventId = newEventId()
      const envelope = buildEnvelope(input.envelope, eventId, clock())
      const event = buildEvent(input.eventType, envelope, input.data)
      const durable = DURABLE_TYPES.has(input.eventType)

      const applyRecord = (seq: number | null) =>
        Effect.sync(() => {
          deps.table.applyEvent({ id: eventId as Ids.EventId, type: input.eventType, envelope, seq })
        })

      // Durable events project atomically inside the EventV2 commit hook (C4);
      // live events project immediately after a best-effort publish (no seq).
      const options: EventV2.PublishOptions = durable
        ? { id: eventId as EventV2.ID, commit: (seq: number) => applyRecord(seq) }
        : { id: eventId as EventV2.ID }

      const payload = yield* deps.bridge.publishLifecycleEvent(event, options)
      if (!durable) yield* applyRecord(null)

      return {
        eventId: payload.id as unknown as Ids.EventId,
        durable: payload.durable
          ? {
              aggregateID: payload.durable.aggregateID,
              seq: payload.durable.seq,
              version: payload.durable.version,
            }
          : null,
      } as unknown as LifecycleEmitOutput
    })

  const project = (input: LifecycleProjectInput): Effect.Effect<LifecycleProjectOutput, LifecycleError> =>
    Effect.sync(() => {
      const record: Projection.LifecycleEventRecord = {
        id: input.eventId,
        type: input.eventType,
        envelope: input.envelope,
        seq: input.durable?.seq ?? null,
      }
      const { outcome } = deps.table.applyEvent(record)
      const anomaly = toProtocolAnomaly(outcome, {
        eventId: input.eventId,
        aggregateID: input.durable?.aggregateID ?? null,
        seq: input.durable?.seq ?? null,
      })
      return {
        applied: outcome.kind === "created" || outcome.kind === "applied",
        anomaly,
        // Typed `ProcessRow` enrichment (model/usage/profile) is layered by
        // T030/T031; the bounded in-memory row is exposed via `rebuiltRows`.
        row: null,
      }
    })

  const replay = (input: LifecycleReplayInput): Effect.Effect<LifecycleReplayOutput, LifecycleError> =>
    Effect.gen(function* () {
      const reader = deps.readAggregate
      if (reader === undefined) return yield* Effect.fail<LifecycleError>({ type: "not_implemented" })

      const page = yield* reader({ aggregateID: input.scopeId, after: input.after, limit: input.limit })
      deps.table.rebuild(page.records)

      let reconciledCount = 0
      let unreconciledCount = 0
      if (deps.reconcile !== undefined) {
        const records = deps.table.reconcileRestart(deps.reconcile)
        for (const record of records) {
          if (record.outcome === "unknown") unreconciledCount++
          else reconciledCount++
        }
      }

      if (deps.pruner !== undefined) {
        const audit = deps.table.planRetention(input.scopeId as Ids.RootProcessId)
        if (audit.pruned_count > 0) {
          yield* deps.pruner(audit)
          deps.table.applyRetention(audit)
        }
      }

      return {
        rows: [],
        hasMore: page.hasMore,
        cursor: page.cursor,
        reconciledCount,
        unreconciledCount,
      } as unknown as LifecycleReplayOutput
    })

  const rebuiltRows = (
    scope: LifecycleReplayInput["scope"],
    scopeId: string,
  ): ReadonlyArray<ProcessTable.ProcessTableRow> =>
    scope === "root"
      ? deps.table.rootProcesses(scopeId as Ids.RootProcessId)
      : deps.table.sessionProcesses(scopeId as Ids.SessionId)

  // ===========================================================================
  // T030 — settlement seam (Feature 005 owns the verdict; we only project it)
  // ===========================================================================
  const reportSettlement = (
    input: LifecycleSettlementInput,
  ): Effect.Effect<LifecycleSettlementOutput, LifecycleError> =>
    Effect.sync(() => {
      const { applied, row } = deps.table.applySettlement({
        process_id: input.processId,
        settlement: input.settlement,
        // Project the bounded ref/cursor only; content bytes are never loaded (FR58).
        output_ref: input.outputRef ? { ref: input.outputRef.ref, cursor: input.outputRef.cursor } : null,
      })
      return { applied, settlement: row?.status.settlement ?? null }
    })

  // ===========================================================================
  // T032 — read-only Todo projection (no Todo aggregate is ever mutated here)
  // ===========================================================================
  const projectTodoInitialized = (input: TodoInitializedInput) =>
    Effect.sync(() =>
      deps.table.applyTodoProjection({
        session_id: input.session_id,
        todo_ref: input.todo_ref,
        todo_version: input.todo_version,
        item_count: input.item_count,
        completed_count: 0,
        pending_count: input.item_count,
        consistency: "consistent",
        outcome: null,
      }),
    )

  const projectTodoCompletionBlocked = (input: TodoCompletionBlockedInput) =>
    Effect.sync(() =>
      // No ref/version on the Feature 001 completion-gate event: merge the
      // blocked consistency + pending count onto the existing row Todo (C24).
      deps.table.applyTodoProjection({
        session_id: input.session_id,
        pending_count: input.pending_items,
        consistency: "blocked",
      }),
    )

  const projectTodoEvent = (event: TodoEvents.TodoEvent) =>
    Effect.sync(() => deps.table.applyTodoProjection(todoEventToPatch(event)))

  const emitTodoEvent = (event: TodoEvents.TodoEvent): Effect.Effect<{ readonly updated: number }, LifecycleError> =>
    Effect.gen(function* () {
      const publisher = deps.publishTodoEvent
      if (publisher === undefined) return yield* Effect.fail<LifecycleError>({ type: "not_implemented" })
      yield* publisher(event)
      return deps.table.applyTodoProjection(todoEventToPatch(event))
    })

  return {
    emit,
    project,
    replay,
    rebuiltRows,
    reportSettlement,
    projectTodoInitialized,
    projectTodoCompletionBlocked,
    projectTodoEvent,
    emitTodoEvent,
  }
}

/**
 * Map one Feature 002 session-owned `todo.*` event onto a Process Table Todo
 * projection patch (T032). The consistency/outcome labels are derived from the
 * event class; the pointer/counts are copied verbatim. No text is ever carried.
 */
function todoEventToPatch(event: TodoEvents.TodoEvent): ProcessTable.TodoProjectionPatch {
  const base = {
    session_id: event.pointer.session_id,
    todo_ref: event.pointer.todo_ref as unknown as string,
    todo_version: event.pointer.todo_version as unknown as string,
    item_count: event.counts.item_count,
    completed_count: event.counts.completed_count,
    pending_count: event.counts.pending_count,
  } satisfies Partial<ProcessTable.TodoProjectionPatch> & { session_id: Ids.SessionId }

  switch (event.type) {
    case "todo.completed":
      return { ...base, consistency: "consistent", outcome: "completed" }
    case "todo.failed":
      return { ...base, consistency: "consistent", outcome: "failed" }
    case "todo.cancelled":
      return { ...base, consistency: "consistent", outcome: "cancelled" }
    case "todo.stale":
      return { ...base, consistency: "stale" }
    case "todo.updated":
    case "todo.rehydrated":
    case "todo.handoff_attached":
      return { ...base, consistency: "consistent" }
  }
}

// Crockford-base32 monotonic-ish event id for the injected default; the real
// composition root passes EventV2's own id generator so the projection key and
// the persisted event id are identical (C8).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function defaultEventId(): string {
  let rand = ""
  for (let i = 0; i < 20; i++) rand += CROCKFORD[Math.floor(Math.random() * 32)]
  return `evt_${rand}`
}
