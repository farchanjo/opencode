import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  EventAdapter,
  createEventAdapter,
  RoutingEventDefinitions,
  type RoutingEventV2ServiceLike,
} from "@/routing/adapters/outbound/event-adapter"
import type { Events } from "@opencode-ai/schema/routing/events"

function fakeEvents(overrides?: Partial<RoutingEventV2ServiceLike>) {
  const published: Array<{ type: string; data: Record<string, unknown> }> = []
  const svc: RoutingEventV2ServiceLike = {
    publish: (definition, data) =>
      Effect.sync(() => {
        published.push({ type: definition.type, data })
        return { id: "evt_1", type: definition.type, data }
      }),
    ...overrides,
  }
  return { svc, published }
}

const DECISION_EVENT: Events.RoutingEvent = {
  type: "routing.decision",
  correlation: { session_id: "ses_1", turn_id: "trn_1", decision_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ" },
  classification: { task_class: "medium", routing_profile: "direct_worker" },
  selection: { specialist_agent: "general-worker", executor_model: "gpt-5" },
  hierarchy_role: "worker",
  budget_snapshot: {
    policy: {
      limits: { max_turns: 10, max_context_tokens: 1000, max_context_bytes: 1000, max_output_tokens: 1000, max_output_bytes: 1000 },
      concurrency: { max_workers: 2, max_delegation_depth: 2 },
      retrieval: { retrieval_top_k: 4, rerank_top_k: 2, max_skill_chunks: 4, max_skill_tokens: 400 },
      cost: { time_budget_ms: 1000, cost_budget_usd: 1, token_budget: 1000 },
      resilience: { retry_depth: 1, validation_depth: 1, escalation_threshold: "manual_review" },
    },
    applied_at: "2026-01-01T00:00:00.000Z",
    scope: "session",
    routing_profile: "direct_worker",
    task_class: "medium",
    role: "worker",
  },
}

const FALLBACK_EVENT: Events.RoutingEvent = {
  type: "routing.fallback",
  decision_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  reason: "primary candidate unavailable",
  execution_boundary: "retryable",
  candidate_selected: "gpt-5",
}

describe("EventAdapter — RoutingEventDefinitions", () => {
  test("exports the namespace object", () => {
    expect(typeof EventAdapter.createEventAdapter).toBe("function")
  })

  test("defines exactly the 8 RoutingEvent union members, non-durable", () => {
    expect(RoutingEventDefinitions).toHaveLength(8)
    const types: string[] = RoutingEventDefinitions.map((d) => d.type)
    types.sort()
    expect(types).toEqual(
      [
        "capability.mismatch",
        "hierarchy.dispatch",
        "hierarchy.escalation",
        "hierarchy.validation",
        "routing.decision",
        "routing.fallback",
        "todo.completion_blocked",
        "todo.initialized",
      ].sort(),
    )
    for (const d of RoutingEventDefinitions) expect(d.durable).toBeUndefined()
  })
})

describe("EventAdapter.createEventAdapter", () => {
  test("publish() forwards the matching Definition and strips the `type` discriminant from data", async () => {
    const { svc, published } = fakeEvents()
    const adapter = createEventAdapter({ useEvents: (fn) => Effect.runPromise(fn(svc)) })

    const result = await adapter.publish(DECISION_EVENT)
    expect(result).toEqual({ ok: true, id: "evt_1", type: "routing.decision" })
    expect(published).toHaveLength(1)
    expect(published[0]?.type).toBe("routing.decision")
    expect(published[0]?.data).not.toHaveProperty("type")
    expect(published[0]?.data.correlation).toEqual(DECISION_EVENT.correlation)
  })

  test("publish() routes each RoutingEvent variant to its own Definition", async () => {
    const { svc, published } = fakeEvents()
    const adapter = createEventAdapter({ useEvents: (fn) => Effect.runPromise(fn(svc)) })

    await adapter.publish(DECISION_EVENT)
    await adapter.publish(FALLBACK_EVENT)

    expect(published.map((p) => p.type)).toEqual(["routing.decision", "routing.fallback"])
  })

  test("publish() reports ok:false without throwing when the EventV2 publish fails", async () => {
    const { svc } = fakeEvents({
      publish: () => Effect.fail(new Error("EventV2 unavailable")) as never,
    })
    const adapter = createEventAdapter({ useEvents: (fn) => Effect.runPromise(fn(svc) as never) })

    const result = await adapter.publish(DECISION_EVENT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("EventV2 unavailable")
  })

  test("publish() rejects an unknown event type without touching EventV2", async () => {
    const { svc, published } = fakeEvents()
    const adapter = createEventAdapter({ useEvents: (fn) => Effect.runPromise(fn(svc)) })

    const bogus = { type: "routing.unknown" } as unknown as Events.RoutingEvent
    const result = await adapter.publish(bogus)
    expect(result).toEqual({ ok: false, reason: "unknown routing event type: routing.unknown" })
    expect(published).toHaveLength(0)
  })
})
