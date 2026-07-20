/**
 * Feature 017 / T015 (FR11, FR12) — the jobs occurrence projection over the
 * durable `EventV2Bridge` seam, closing GAP F.
 *
 * Feature 014 left `jobs.history` / `jobs.show`'s occurrence list / `jobs.watch`
 * as typed capability gaps (`jobs/backend-live.ts:59-62`) even though the EventV2
 * durable read/subscribe seams are already wired for the lifecycle domain
 * (`lifecycle/stack-wiring.ts:180-259`). This module projects the durable
 * `job.*` occurrence vocabulary (`packages/schema/src/jobs/events.ts`) into the
 * bounded, content-free `Occurrence` / `NotificationEnvelope` read models the
 * operator surface returns, through the SAME `readDurablePage` +
 * `EventBus.subscribeBounded` seams the lifecycle wiring consumes — NO new store,
 * NO executor, and NO fabricated occurrence.
 *
 * Honesty invariants (FR14, FR18): a malformed or unrecognised durable event is
 * skipped, never crashed on; a bridge outage degrades every read to a typed
 * `unavailable`; `jobs.watch` opens a BOUNDED, closable subscription (the source
 * supplies the bounded window; the projection only filters + maps), so a slow
 * consumer cannot grow memory without bound. No prompt, payload, path, or secret
 * crosses the seam — only the bounded identity + redacted delivery metadata (C22,
 * FR32).
 *
 * Aggregate note: the durable read is keyed by the aggregate the injected source
 * resolves for a `jobDefinitionId`. The projection ALSO filters each event by
 * `job_definition_id` (defence in depth), so it can never return an occurrence
 * belonging to another definition, and it returns an honest EMPTY read when the
 * aggregate holds no matching durable event.
 */
export * as JobOccurrenceProjection from "./occurrence-projection"

import { Effect, Stream } from "effect"
import type { Scope } from "effect"
import type {
  JobEventType,
  JobsError,
  JobsHistoryInput,
  JobsHistoryOutput,
  JobsWatchEvent,
  JobsWatchInput,
  NotificationEnvelope,
  Occurrence,
  OccurrenceState,
} from "@opencode-ai/protocol/jobs/commands"

// =============================================================================
// Injected durable seam (the same shape lifecycle/stack-wiring resolves)
// =============================================================================

/** One durable EventV2 row as `readDurablePage` returns it (undecoded wire data). */
export interface RawDurableEvent {
  readonly id: string
  readonly type: string
  readonly data: unknown
  readonly durable?: { readonly seq: number }
}

/** A bounded durable page, mirroring `EventV2.readDurablePage` (event-v2-live.ts). */
export interface DurablePage {
  readonly events: readonly RawDurableEvent[]
  readonly hasMore: boolean
  readonly lastSeq: number
}

/**
 * The narrow durable seam the composition root binds over `EventV2Bridge`
 * (`readDurablePage` + `EventBus.subscribeBounded`). `readAggregate` reads the
 * bounded durable page for a job definition's aggregate; `subscribe` opens the
 * bounded live stream. An unbound bridge fails with a typed `unavailable`.
 */
export interface JobOccurrenceSource {
  readonly readAggregate: (input: {
    readonly aggregateID: string
    readonly after?: number
    readonly limit: number
  }) => Effect.Effect<DurablePage, JobsError>
  readonly subscribe: () => Effect.Effect<Stream.Stream<RawDurableEvent, never>, JobsError, Scope.Scope>
}

/** The projected occurrence read surface backing history / show / watch. */
export interface JobOccurrenceProjection {
  readonly history: (input: JobsHistoryInput) => Effect.Effect<JobsHistoryOutput, JobsError>
  readonly showOccurrences: (
    jobDefinitionId: string,
    limit: number,
  ) => Effect.Effect<readonly Occurrence[], JobsError>
  readonly watch: (
    input: JobsWatchInput,
  ) => Effect.Effect<Stream.Stream<JobsWatchEvent, never>, JobsError, Scope.Scope>
}

export interface JobOccurrenceProjectionOptions {
  /** Hard cap on durable rows scanned per read, defending against a runaway aggregate (default 2000). */
  readonly maxScan?: number
  /** Hard per-page read size (default 100). */
  readonly pageSize?: number
}

// =============================================================================
// Occurrence state machine — durable `job.*` type → OccurrenceState (C6, FR11)
// =============================================================================

/** Non-terminal → the observed lifecycle state; terminal → the absorbing outcome. */
const STATE_BY_TYPE: Readonly<Record<string, OccurrenceState>> = {
  "job.trigger_due": "due",
  "job.triggered": "due",
  "job.queued": "due",
  "job.occurrence_claimed": "claimed",
  "job.admitted": "admitted",
  "job.execution_started": "executing",
  "job.execution_completed": "completed",
  "job.execution_failed": "failed",
  "job.execution_cancelled": "cancelled",
  "job.execution_timed_out": "timed_out",
  "job.misfired": "misfired",
  "job.skipped": "skipped",
  "job.coalesced": "coalesced",
  "job.overlap_rejected": "overlap_rejected",
  "job.overlap_replaced": "overlap_replaced",
  "job.reconciled": "reconciled",
  "job.unknown": "unknown",
}

/** Terminal occurrence states are absorbing outcomes (FR11, C6). */
const TERMINAL_STATES: ReadonlySet<OccurrenceState> = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "misfired",
  "skipped",
  "coalesced",
  "overlap_rejected",
  "overlap_replaced",
  "reconciled",
  "unknown",
])

const NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "job.notification_enqueued",
  "job.notification_delivered",
  "job.notification_acknowledged",
  "job.notification_expired",
])

// =============================================================================
// Defensive envelope extraction (a malformed event is skipped, never crashed on)
// =============================================================================

interface ParsedEvent {
  readonly type: JobEventType
  readonly eventId: string
  readonly jobDefinitionId: string
  readonly scheduleId: string
  readonly occurrenceId: string
  readonly processId: string | null
  readonly attempt: number | null
  readonly generation: number
  readonly rootSessionId: string | null
  readonly sessionId: string | null
  readonly correlationId: string
  readonly causationId: string | null
  readonly timestamp: string
  readonly seq: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Coerce a wire timestamp (ISO string or epoch-millis number) into an ISO-8601 string. */
function toIso(value: unknown): string {
  const n = asNumber(value)
  if (n !== null) return new Date(n).toISOString()
  const s = asString(value)
  if (s !== null) return s
  return new Date(0).toISOString()
}

/** Parse one raw durable job event; returns null when it is not a well-formed job occurrence/notification event. */
function parseEvent(ev: RawDurableEvent): ParsedEvent | null {
  const type = ev.type
  if (!type.startsWith("job.")) return null
  const data = asObject(ev.data)
  if (data === null) return null
  const envelope = asObject(data.envelope)
  if (envelope === null) return null
  const occurrence = asObject(envelope.occurrence)
  const tree = asObject(envelope.tree)
  const ordering = asObject(envelope.ordering)
  const delivery = asObject(envelope.delivery)
  if (occurrence === null || ordering === null) return null
  const jobDefinitionId = asString(occurrence.job_definition_id)
  const occurrenceId = asString(occurrence.occurrence_id)
  const correlationId = asString(ordering.correlation_id)
  if (jobDefinitionId === null || occurrenceId === null || correlationId === null) return null
  return {
    type: type as JobEventType,
    eventId: asString(envelope.event_id) ?? ev.id,
    jobDefinitionId,
    scheduleId: asString(occurrence.schedule_id) ?? "",
    occurrenceId,
    processId: asString(occurrence.process_id),
    attempt: asNumber(occurrence.attempt),
    generation: asNumber(occurrence.generation) ?? 0,
    rootSessionId: tree ? asString(tree.root_session_id) : null,
    sessionId: tree ? asString(tree.session_id) : null,
    correlationId,
    causationId: ordering.causation_id === null ? null : asString(ordering.causation_id),
    timestamp: toIso(delivery?.timestamp),
    seq: ev.durable?.seq ?? asNumber(ordering.sequence) ?? 0,
  }
}

// =============================================================================
// Fold durable events → bounded Occurrence read models
// =============================================================================

interface OccurrenceFold {
  latest: ParsedEvent
  firstTimestamp: string
  state: OccurrenceState
  outcome: OccurrenceState | null
}

/** Fold the parsed events (for one definition) into one Occurrence per occurrence id (latest state wins). */
function foldOccurrences(parsed: readonly ParsedEvent[]): Occurrence[] {
  const byOccurrence = new Map<string, OccurrenceFold>()
  for (const ev of parsed) {
    const state = STATE_BY_TYPE[ev.type]
    if (state === undefined) continue // notification / definition-mutation events are not occurrences
    const existing = byOccurrence.get(ev.occurrenceId)
    if (existing === undefined) {
      byOccurrence.set(ev.occurrenceId, {
        latest: ev,
        firstTimestamp: ev.timestamp,
        state,
        outcome: TERMINAL_STATES.has(state) ? state : null,
      })
      continue
    }
    if (ev.seq >= existing.latest.seq) {
      existing.latest = ev
      existing.state = state
      if (TERMINAL_STATES.has(state)) existing.outcome = state
    }
    if (ev.timestamp < existing.firstTimestamp) existing.firstTimestamp = ev.timestamp
  }
  const out: Occurrence[] = []
  for (const fold of byOccurrence.values()) {
    const ev = fold.latest
    out.push({
      occurrenceId: ev.occurrenceId,
      jobDefinitionId: ev.jobDefinitionId,
      scheduleId: ev.scheduleId,
      nominalDueTime: fold.firstTimestamp,
      generation: ev.generation,
      correlationId: ev.correlationId,
      causationId: ev.causationId,
      sessionId: ev.sessionId,
      rootSessionId: ev.rootSessionId,
      processId: ev.processId,
      attempt: ev.attempt,
      state: fold.state,
      outcome: fold.outcome,
    })
  }
  // Most recent first (by the latest event sequence).
  out.sort((a, b) => {
    const sa = byOccurrence.get(a.occurrenceId)?.latest.seq ?? 0
    const sb = byOccurrence.get(b.occurrenceId)?.latest.seq ?? 0
    return sb - sa
  })
  return out
}

/** Project a notification durable event into the bounded, redacted envelope; null when not a notification. */
function toNotification(ev: ParsedEvent): NotificationEnvelope | null {
  if (!NOTIFICATION_TYPES.has(ev.type)) return null
  const type =
    ev.type === "job.notification_delivered"
      ? "occurrence_completed"
      : ev.type === "job.notification_acknowledged"
        ? "occurrence_completed"
        : ev.type === "job.notification_expired"
          ? "occurrence_timed_out"
          : "occurrence_completed"
  return {
    notificationId: ev.eventId,
    eventId: ev.eventId,
    occurrenceId: ev.occurrenceId,
    jobDefinitionId: ev.jobDefinitionId,
    targetRootSessionId: (ev.rootSessionId ?? "") as NotificationEnvelope["targetRootSessionId"],
    targetSessionId: ev.sessionId as NotificationEnvelope["targetSessionId"],
    source: "scheduler",
    type,
    priority: "normal",
    createdAt: ev.timestamp,
    expiresAt: ev.timestamp,
    correlationId: ev.correlationId,
    causationId: ev.causationId,
    summary: ev.type,
    outputRef: null,
    deliveryState: "delivered",
    ackState: "not_applicable",
  }
}

// =============================================================================
// Factory
// =============================================================================

const unavailable = (reason: string): JobsError => ({ type: "unavailable", reason })

/** Decode the opaque history cursor (a durable sequence) or start from the beginning. */
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return -1
  const n = Number.parseInt(cursor, 10)
  return Number.isSafeInteger(n) && n >= -1 ? n : -1
}

export function createJobOccurrenceProjection(
  source: JobOccurrenceSource,
  options: JobOccurrenceProjectionOptions = {},
): JobOccurrenceProjection {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 500))
  const maxScanDefault = Math.max(pageSize, options.maxScan ?? 2000)

  /** Bounded scan of the durable aggregate for one definition, collecting matching parsed events. */
  const scan = (
    jobDefinitionId: string,
    startAfter: number,
    scanBudget: number,
  ): Effect.Effect<{ readonly parsed: readonly ParsedEvent[]; readonly lastSeq: number; readonly hasMore: boolean }, JobsError> =>
    Effect.gen(function* () {
      const parsed: ParsedEvent[] = []
      let after = startAfter
      let scanned = 0
      let hasMore = false
      for (let guard = 0; guard < 100 && scanned < scanBudget; guard++) {
        const limit = Math.min(pageSize, scanBudget - scanned)
        const page = yield* source.readAggregate({ aggregateID: jobDefinitionId, after, limit })
        if (page.events.length === 0) break
        scanned += page.events.length
        for (const raw of page.events) {
          const ev = parseEvent(raw)
          if (ev === null) continue
          if (ev.jobDefinitionId !== jobDefinitionId) continue // defence in depth (aggregate note)
          parsed.push(ev)
        }
        after = page.lastSeq
        hasMore = page.hasMore
        if (!hasMore) break
      }
      return { parsed, lastSeq: after, hasMore }
    })

  const history = (input: JobsHistoryInput): Effect.Effect<JobsHistoryOutput, JobsError> =>
    Effect.gen(function* () {
      const limit = Math.max(0, input.limit)
      const scanBudget = Math.max(maxScanDefault, limit * 10)
      const { parsed, lastSeq, hasMore } = yield* scan(input.jobDefinitionId, decodeCursor(input.cursor), scanBudget)
      const occurrences = foldOccurrences(parsed).slice(0, limit)
      const notifications: NotificationEnvelope[] = []
      for (const ev of parsed) {
        const n = toNotification(ev)
        if (n !== null) notifications.push(n)
        if (notifications.length >= limit) break
      }
      return { occurrences, notifications, cursor: hasMore ? String(lastSeq) : null }
    })

  const showOccurrences = (jobDefinitionId: string, limit: number): Effect.Effect<readonly Occurrence[], JobsError> =>
    Effect.gen(function* () {
      const bounded = Math.max(0, limit)
      const scanBudget = Math.max(maxScanDefault, bounded * 10)
      const { parsed } = yield* scan(jobDefinitionId, -1, scanBudget)
      return foldOccurrences(parsed).slice(0, bounded)
    })

  const watch = (
    input: JobsWatchInput,
  ): Effect.Effect<Stream.Stream<JobsWatchEvent, never>, JobsError, Scope.Scope> =>
    Effect.gen(function* () {
      const stream = yield* source.subscribe()
      return stream.pipe(
        Stream.map(parseEvent),
        Stream.filter(
          (ev): ev is ParsedEvent => ev !== null && ev.jobDefinitionId === input.jobDefinitionId,
        ),
        Stream.map(
          (ev): JobsWatchEvent => ({
            eventType: ev.type,
            occurrenceId: ev.occurrenceId,
            timestamp: ev.timestamp,
            data: { state: STATE_BY_TYPE[ev.type] ?? "unknown", correlationId: ev.correlationId },
          }),
        ),
      )
    })

  return { history, showOccurrences, watch }
}
