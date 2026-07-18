/**
 * Feature 002 — in-process test fixtures for the lifecycle application layer
 * (T025–T029). Pure builders and in-memory fakes: no database, HTTP server, or
 * live runtime, so the adapter, observation service, handoff coordinator, and
 * cancel service exercise their real logic against injected seams.
 */
import { DateTime, Effect } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import type { EmitEnvelope } from "@opencode-ai/protocol/lifecycle/commands"
import type { LifecycleBridge } from "@/lifecycle/eventv2-adapter"
import { DURABLE_TYPES, DETAIL_TYPES } from "@/lifecycle/eventv2-adapter"

export interface EnvelopeOver {
  readonly eventType: string
  readonly processId?: string
  readonly rootProcessId?: string
  readonly sessionId?: string
  readonly rootSessionId?: string
  readonly parentSessionId?: string | null
  readonly agentKind?: string
  readonly metadata?: Record<string, string>
}

/** Build a caller-supplied emit envelope (no event_id/sequence/timestamp). */
export function emitEnvelope(over: EnvelopeOver): EmitEnvelope {
  const durable = DURABLE_TYPES.has(over.eventType as never)
  return {
    kind: {
      event_type: over.eventType,
      schema_version: 1,
      event_class: durable ? "durable" : "live",
      agent_kind: over.agentKind ?? "worker",
      actor_kind: "runtime",
      runtime_instance_id: "rt_1",
    },
    tree: {
      root_session_id: over.rootSessionId ?? "ses_root",
      session_id: over.sessionId ?? "ses_1",
      parent_session_id: over.parentSessionId ?? null,
    },
    process: {
      task_id: "task_1",
      process_id: over.processId ?? "proc_1",
      parent_process_id: null,
      root_process_id: over.rootProcessId ?? "proc_root",
    },
    ordering: { correlation_id: "corr_1", causation_id: null, attempt: 1, generation: 0 },
    delivery: { visibility: "session", redacted_metadata: over.metadata ?? {} },
    hierarchy: null,
  } as unknown as EmitEnvelope
}

/** Build a full decoded lifecycle envelope (as an EventV2 payload carries it). */
export function fullEnvelope(over: EnvelopeOver, eventId = "evt_x", nowMs = 1_721_260_800_000): unknown {
  const base = emitEnvelope(over) as unknown as Record<string, unknown>
  const ordering = base.ordering as Record<string, unknown>
  const delivery = base.delivery as Record<string, unknown>
  return {
    ...base,
    event_id: eventId,
    ordering: { ...ordering, sequence: 0 },
    delivery: { ...delivery, timestamp: DateTime.makeUnsafe(nowMs) },
  }
}

/** Build an EventV2 payload as delivered by the lifecycle bus. */
export function payload(over: EnvelopeOver, opts?: { id?: string; seq?: number; detail?: Record<string, unknown> }): EventV2.Payload {
  const durable = DURABLE_TYPES.has(over.eventType as never)
  const data: Record<string, unknown> = { envelope: fullEnvelope(over, opts?.id ?? "evt_x") }
  if (over.eventType && DETAIL_TYPES.has(over.eventType as never)) data.detail = opts?.detail ?? {}
  return {
    id: (opts?.id ?? "evt_x") as EventV2.Payload["id"],
    type: over.eventType,
    ...(durable ? { durable: { aggregateID: over.rootProcessId ?? "proc_root", seq: opts?.seq ?? 0, version: 1 } } : {}),
    data,
  } as unknown as EventV2.Payload
}

/**
 * An in-memory `LifecycleBridge` that assigns EventV2 ids, a monotonic
 * per-aggregate durable sequence, and fires `options.commit(seq)` for durable
 * members exactly like the real bridge (C4). Records every published event.
 */
export function fakeBridge() {
  const published: Array<{ type: string; data: unknown; durable: boolean }> = []
  const seqByAggregate = new Map<string, number>()
  let counter = 0

  const bridge: LifecycleBridge = {
    publishLifecycleEvent: (event, options) =>
      Effect.gen(function* () {
        const anyEvent = event as unknown as { type: string; envelope: { process: { root_process_id: string } } }
        const id = (options?.id ?? `evt_${counter++}`) as EventV2.Payload["id"]
        const durable = DURABLE_TYPES.has(anyEvent.type as never)
        published.push({ type: anyEvent.type, data: (event as unknown as { detail?: unknown }).detail ?? null, durable })
        if (!durable) {
          return { id, type: anyEvent.type, data: event } as unknown as EventV2.Payload
        }
        const aggregateID = anyEvent.envelope.process.root_process_id
        const seq = (seqByAggregate.get(aggregateID) ?? -1) + 1
        seqByAggregate.set(aggregateID, seq)
        if (options?.commit) yield* options.commit(seq)
        return {
          id,
          type: anyEvent.type,
          durable: { aggregateID, seq, version: 1 },
          data: event,
        } as unknown as EventV2.Payload
      }),
  }

  return { bridge, published }
}
