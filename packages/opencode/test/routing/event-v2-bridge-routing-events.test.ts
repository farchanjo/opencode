/**
 * Feature 001 / T031 — bridges the `Events.RoutingEvent` members (routing,
 * hierarchy, capability, todo-authority) onto the real EventV2 bus through
 * `EventV2Bridge.Service.publishRoutingEvent`. Verifies every union member
 * round-trips through its own wire `Definition` (no drift from the schema
 * owner, packages/schema/src/routing/events.ts) and that a bus subscriber
 * observes the bridged event.
 */
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { Events } from "@opencode-ai/schema/routing/events"
import { EventV2Bridge, RoutingEventDefinitions } from "@/event-v2-bridge"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([EventV2Bridge.node])))

const SAMPLE_EVENTS: ReadonlyArray<Events.RoutingEvent> = [
  {
    type: "routing.decision",
    correlation: { session_id: "ses_1", turn_id: "turn_1", decision_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
    classification: { task_class: "small", routing_profile: "direct_worker" },
    selection: { specialist_agent: "build", executor_model: "anthropic/claude" },
    hierarchy_role: "worker",
    budget_snapshot: {
      policy: {
        limits: {
          max_turns: 10,
          max_context_tokens: 1000,
          max_context_bytes: 4000,
          max_output_tokens: 100,
          max_output_bytes: 400,
        },
        concurrency: { max_workers: 2, max_delegation_depth: 2 },
        retrieval: { retrieval_top_k: 5, rerank_top_k: 3, max_skill_chunks: 4, max_skill_tokens: 1000 },
        cost: { time_budget_ms: 1000, cost_budget_usd: 1, token_budget: 1000 },
        resilience: { retry_depth: 1, validation_depth: 1, escalation_threshold: "confidence_floor" },
      },
      applied_at: "2026-07-18T00:00:00.000Z",
      scope: "session",
      routing_profile: "direct_worker",
      task_class: "small",
      role: "worker",
    },
  },
  {
    type: "routing.fallback",
    decision_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    reason: "candidate timed out",
    execution_boundary: "retryable",
    candidate_selected: "anthropic/claude-fallback",
  },
  {
    type: "hierarchy.dispatch",
    lineage: {
      parent_session_id: "ses_parent",
      child_session_id: "ses_child",
      parent_role: "architect",
      child_role: "worker",
    },
    fanout: { delegation_depth: 1, fanout_requested: 1, fanout_granted: 1 },
    todo: { todo_ref: "todo_ses_child", todo_version: "v1" },
  },
  {
    type: "hierarchy.validation",
    session_id: "ses_child",
    role: "worker",
    outcome: "passed",
    validation_reason: "output matched acceptance criteria",
  },
  {
    type: "hierarchy.escalation",
    worker_session_id: "ses_child",
    reason: "task exceeded direct-worker bound",
    evidence_refs: ["ref_1", "ref_2"],
    reclassified_to: "manager",
  },
  {
    type: "capability.mismatch",
    provider: "anthropic",
    model: "claude-haiku",
    dimension: "parallel_calls",
    requirement: "required",
    outcome: "unmet",
  },
  {
    type: "todo.initialized",
    session_id: "ses_child",
    todo_ref: "todo_ses_child",
    todo_version: "v1",
    item_count: 0,
  },
  {
    type: "todo.completion_blocked",
    session_id: "ses_child",
    reason: "required items are not all completed",
    pending_items: 2,
  },
]

describe("T031 EventV2Bridge routing/hierarchy/capability event bridging", () => {
  it.instance("defines exactly the eight Events.RoutingEvent members, keyed by type", () =>
    Effect.gen(function* () {
      expect(Object.keys(RoutingEventDefinitions).sort()).toEqual(
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
      for (const [type, definition] of Object.entries(RoutingEventDefinitions)) {
        expect(String(definition.type)).toBe(type)
      }
    }),
  )

  for (const event of SAMPLE_EVENTS) {
    it.instance(`publishRoutingEvent round-trips a "${event.type}" event with type + data intact`, () =>
      Effect.gen(function* () {
        const bridge = yield* EventV2Bridge.Service
        const payload = yield* bridge.publishRoutingEvent(event)
        expect(payload.type).toBe(event.type)
        const { type: _drop, ...expectedData } = event
        expect(payload.data).toEqual(expectedData)
      }),
    )
  }

  it.instance("a bus subscriber observes a bridged routing.decision event", () =>
    Effect.gen(function* () {
      const bridge = yield* EventV2Bridge.Service
      const seen: unknown[] = []
      const unsub = yield* bridge.listen((event) => {
        if (event.type === "routing.decision") seen.push(event.data)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsub)

      const decisionEvent = SAMPLE_EVENTS.find((event) => event.type === "routing.decision")!
      yield* bridge.publishRoutingEvent(decisionEvent)

      expect(seen).toHaveLength(1)
    }),
  )
})
