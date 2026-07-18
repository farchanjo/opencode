/**
 * Feature 003 / T024 (S13) — the bounded async notification service.
 *
 * Implements the `NotificationPort` (`@opencode-ai/protocol/jobs/ports`, T012)
 * over the Feature 002 bounded observation seam (Effect `Stream`/`PubSub`),
 * segmented by root/session/project (FR20–FR26, C8, C9, C15). It introduces no
 * second event channel: every state transition publishes one
 * `job.notification_*` event through the injected publisher (the composition
 * root wires it to `EventV2Bridge.publishJobEvent`), and observation reads the
 * single EventV2 authority through the injected subscribe seam.
 *
 * Delivery is safe-boundary only (C9, AC7): `deliverAtBoundary` delivers a
 * notification only when the target reports a safe active-turn boundary;
 * otherwise it queues or coalesces or expires it per policy and NEVER interrupts
 * unsafe work. Every per-scope queue is bounded (`queueCapacity`,
 * `notification_queue_capacity`); on overflow the oldest envelope is expired
 * (coalesce-then-expire), so no queue ever grows unbounded (C19, AC8). The
 * default delivery action is operator-only; wake/queue/child actions are
 * explicit, validated, and audited (FR24). Delivery never depends on an LLM, and
 * the envelope carries only a bounded summary plus an opaque Feature 005
 * `outputRef` — never full content or spool paths (FR22, C15, AC29).
 *
 * All I/O is an injected seam (publisher, subscribe, clock, id generator) so the
 * service is unit-testable in-process with no live runtime, and the real
 * composition root wires the canonical EventV2 publish boundary and the Feature
 * 002 observation seam exactly once (documented wiring points).
 */
export * as NotificationService from "./notification-service"

import { Effect, Stream } from "effect"
import type { Scope } from "effect"
import type {
  AckState,
  DeliveryState,
  NotificationAckInput,
  NotificationAckOutput,
  NotificationAuditInput,
  NotificationAuditOutput,
  NotificationDeliverInput,
  NotificationDeliverOutput,
  NotificationEnqueueInput,
  NotificationEnqueueOutput,
  NotificationEnvelope,
  NotificationError,
  NotificationExpireInput,
  NotificationExpireOutput,
  NotificationObserveInput,
  NotificationTargetPrincipal,
} from "@opencode-ai/protocol/jobs/commands"
import type { NotificationPort } from "@opencode-ai/protocol/jobs/ports"
import { Authorization } from "./authorization"

// =============================================================================
// Injected seams (documented wiring points, C8, C9)
// =============================================================================

/** The four notification lifecycle members this service publishes (C8). */
export type NotificationEventType =
  | "job.notification_enqueued"
  | "job.notification_delivered"
  | "job.notification_acknowledged"
  | "job.notification_expired"

export interface NotificationPublishInput {
  readonly eventType: NotificationEventType
  readonly envelope: NotificationEnvelope
}

export interface NotificationPublishOutput {
  /** The EventV2 `evt_` id assigned to the published event, held on the envelope (C8). */
  readonly eventId: string
}

/**
 * Publishes one `job.notification_*` event through the single EventV2 authority.
 * The composition root builds the schema `JobEnvelope` from the bounded envelope
 * and calls `EventV2Bridge.publishJobEvent`; this service never wires a second
 * channel (C8). Kept as a seam so the queue/TTL logic stays unit-testable.
 */
export interface NotificationPublisher {
  readonly publish: (input: NotificationPublishInput) => Effect.Effect<NotificationPublishOutput, NotificationError>
}

/**
 * A scoped bounded notification subscription, projected onto the protocol
 * envelope. The composition root supplies it from the Feature 002 observation
 * seam (`EventBus.subscribeBounded` filtered to `job.notification_*`), so the
 * finalizer is owned by the caller's `Scope` and a slow consumer only loses live
 * signals to the bounded queue overflow policy, never blocks a Task (C8, AC8).
 */
export type NotificationSubscribe = Effect.Effect<Stream.Stream<NotificationEnvelope>, never, Scope.Scope>

export interface NotificationServiceDeps {
  readonly publisher: NotificationPublisher
  readonly subscribe: NotificationSubscribe
  /** Monotonic millisecond clock for created/expiry timestamps (default Date.now). */
  readonly clock?: () => number
  /** Notification id generator (default a Crockford-base32 `ntf_` id). */
  readonly newNotificationId?: () => string
  /** Bounded per-scope queue capacity; overflow expires the oldest (default 512, AC8). */
  readonly queueCapacity?: number
  /** Bounded summary byte budget (default `NOTIFICATION_SUMMARY_MAX_BYTES`, AC29). */
  readonly summaryMaxBytes?: number
}

/** Provisional bounded per-scope queue capacity (data-model `notification_queue_capacity`, AC8, AC21). */
export const DEFAULT_QUEUE_CAPACITY = 512 as const

/** The valid explicit delivery actions; a raw prompt injection is never a valid action (FR24). */
const VALID_ACTIONS: ReadonlySet<string> = new Set([
  "operator_only",
  "manager_wake",
  "structured_input_queue",
  "new_child_session",
])

// =============================================================================
// Internal state
// =============================================================================

interface NotificationRecord {
  envelope: NotificationEnvelope
  readonly scopeKey: string
  readonly target: NotificationTargetPrincipal
}

/** Resolve a target principal to its tree/session addressing and bounded per-scope queue key. */
function resolveTarget(target: NotificationTargetPrincipal): {
  readonly rootSessionId: string
  readonly sessionId: string | null
  readonly scopeKey: string
} {
  switch (target.kind) {
    case "main-context":
      return { rootSessionId: target.rootSessionId, sessionId: null, scopeKey: `root:${target.rootSessionId}` }
    case "agent":
      // A session-directed notification keys its bounded queue on the session id;
      // the composition root supplies the true tree root when it builds the
      // durable schema envelope (documented wiring point, C16).
      return { rootSessionId: target.sessionId, sessionId: target.sessionId, scopeKey: `session:${target.sessionId}` }
    default:
      // An operator advisory is scoped to the operator principal (no session tree).
      return { rootSessionId: target.id, sessionId: null, scopeKey: `operator:${target.id}` }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createNotificationService(deps: NotificationServiceDeps): NotificationPort {
  const clock = deps.clock ?? Date.now
  const newId = deps.newNotificationId ?? defaultNotificationId
  const capacity = deps.queueCapacity ?? DEFAULT_QUEUE_CAPACITY
  const summaryMaxBytes = deps.summaryMaxBytes ?? Authorization.NOTIFICATION_SUMMARY_MAX_BYTES

  // Per-notification records and the bounded per-scope FIFO queue of ids.
  const byId = new Map<string, NotificationRecord>()
  const queues = new Map<string, string[]>()

  const setDelivery = (record: NotificationRecord, deliveryState: DeliveryState): void => {
    record.envelope = { ...record.envelope, deliveryState }
  }

  const publishExpiry = (record: NotificationRecord): Effect.Effect<void, NotificationError> =>
    Effect.gen(function* () {
      setDelivery(record, "expired")
      yield* deps.publisher.publish({ eventType: "job.notification_expired", envelope: record.envelope })
    })

  // Coalesce-then-expire: keep the bounded per-scope queue at or below capacity by
  // expiring the oldest envelope before enqueuing a new one (C19, AC8).
  const enforceCapacity = (scopeKey: string): Effect.Effect<void, NotificationError> =>
    Effect.gen(function* () {
      const queue = queues.get(scopeKey) ?? []
      while (queue.length >= capacity) {
        const oldestId = queue.shift()
        if (oldestId === undefined) break
        const oldest = byId.get(oldestId)
        if (oldest !== undefined) yield* publishExpiry(oldest)
      }
      queues.set(scopeKey, queue)
    })

  const enqueue = (input: NotificationEnqueueInput): Effect.Effect<NotificationEnqueueOutput, NotificationError> =>
    Effect.gen(function* () {
      const { rootSessionId, sessionId, scopeKey } = resolveTarget(input.target)
      const now = clock()
      const notificationId = newId()
      const summary = Authorization.boundSummary(input.summary, summaryMaxBytes)
      const envelope: NotificationEnvelope = {
        notificationId,
        eventId: "",
        occurrenceId: input.occurrenceId,
        jobDefinitionId: input.jobDefinitionId,
        targetRootSessionId: rootSessionId,
        targetSessionId: sessionId,
        source: "scheduler",
        type: input.type,
        priority: "normal",
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + input.ttlSeconds * 1000).toISOString(),
        correlationId: input.occurrenceId,
        causationId: null,
        summary,
        outputRef: input.outputRef,
        deliveryState: "pending",
        ackState: "unacknowledged",
      }

      yield* enforceCapacity(scopeKey)
      const published = yield* deps.publisher.publish({ eventType: "job.notification_enqueued", envelope })
      const stored = { ...envelope, eventId: published.eventId }
      byId.set(notificationId, { envelope: stored, scopeKey, target: input.target })
      const queue = queues.get(scopeKey) ?? []
      queue.push(notificationId)
      queues.set(scopeKey, queue)

      return { envelope: stored }
    })

  const deliverAtBoundary = (
    input: NotificationDeliverInput,
  ): Effect.Effect<NotificationDeliverOutput, NotificationError> =>
    Effect.gen(function* () {
      const record = byId.get(input.notificationId)
      if (record === undefined) {
        return yield* Effect.fail<NotificationError>({ type: "not_found", notificationId: input.notificationId })
      }
      // Absorbing terminal states are idempotent — never re-deliver an expired one.
      if (record.envelope.deliveryState === "expired") return { deliveryState: "expired" }
      if (record.envelope.deliveryState === "delivered") return { deliveryState: "delivered" }

      // An unsafe/busy target queues rather than interrupting unsafe work (C9, AC7).
      if (!input.targetSafeBoundary) {
        setDelivery(record, "queued")
        return { deliveryState: "queued" }
      }

      setDelivery(record, "delivered")
      yield* deps.publisher.publish({ eventType: "job.notification_delivered", envelope: record.envelope })
      return { deliveryState: "delivered" }
    })

  const ack = (input: NotificationAckInput): Effect.Effect<NotificationAckOutput, NotificationError> =>
    Effect.gen(function* () {
      const record = byId.get(input.notificationId)
      if (record === undefined) {
        return yield* Effect.fail<NotificationError>({ type: "not_found", notificationId: input.notificationId })
      }
      const decision = Authorization.authorizeEnvelope(input.principal, record.envelope)
      if (!decision.allowed) {
        return yield* Effect.fail<NotificationError>({
          type: "cross_scope_leak_rejected",
          reason: `principal may not acknowledge notification ${input.notificationId}`,
        })
      }
      // TTL reached before acknowledgement — the ack no longer applies (C9, AC8).
      if (record.envelope.deliveryState === "expired") return { ackState: "not_applicable" as AckState }

      record.envelope = { ...record.envelope, ackState: "acknowledged" }
      yield* deps.publisher.publish({ eventType: "job.notification_acknowledged", envelope: record.envelope })
      return { ackState: "acknowledged" }
    })

  const expire = (input: NotificationExpireInput): Effect.Effect<NotificationExpireOutput, NotificationError> =>
    Effect.gen(function* () {
      const record = byId.get(input.notificationId)
      if (record === undefined) {
        return yield* Effect.fail<NotificationError>({ type: "not_found", notificationId: input.notificationId })
      }
      if (record.envelope.deliveryState !== "expired") yield* publishExpiry(record)
      const queue = queues.get(record.scopeKey)
      if (queue !== undefined) queues.set(record.scopeKey, queue.filter((id) => id !== input.notificationId))
      return { deliveryState: "expired" }
    })

  const audit = (input: NotificationAuditInput): Effect.Effect<NotificationAuditOutput, NotificationError> =>
    Effect.gen(function* () {
      // A raw prompt injection is never a valid action; only the four explicit
      // categories are auditable (FR24, Security 9).
      if (!VALID_ACTIONS.has(input.action)) {
        return yield* Effect.fail<NotificationError>({
          type: "invalid_action",
          reason: `unknown notification action ${input.action}`,
        })
      }
      return { auditId: `aud_${input.notificationId}_${clock()}` }
    })

  const observe = (
    input: NotificationObserveInput,
  ): Effect.Effect<Stream.Stream<NotificationEnvelope, never>, NotificationError, Scope.Scope> =>
    Effect.gen(function* () {
      const gate = Authorization.authorizeObserveScope(input.principal, input.scope, input.scopeId)
      if (!gate.authorized) return yield* Effect.fail<NotificationError>(gate.error)
      const redact = (envelope: NotificationEnvelope): NotificationEnvelope | null => {
        const decision = Authorization.authorizeEnvelope(input.principal, envelope)
        return decision.allowed ? decision.envelope : null
      }
      return yield* Effect.map(deps.subscribe, (stream) =>
        stream.pipe(
          Stream.map(redact),
          Stream.filter((envelope): envelope is NotificationEnvelope => envelope !== null),
        ),
      )
    })

  return { enqueue, deliverAtBoundary, ack, expire, audit, observe }
}

// Crockford-base32 `ntf_` id for the injected default; the real composition root
// may pass a monotonic generator so ids sort by creation order.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function defaultNotificationId(): string {
  let rand = ""
  for (let i = 0; i < 20; i++) rand += CROCKFORD[Math.floor(Math.random() * 32)]
  return `ntf_${rand}`
}
