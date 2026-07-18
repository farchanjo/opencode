import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Budget } from "../src/routing/budget"
import { Events } from "../src/routing/events"

const validBudgetSnapshot: Budget.PolicySnapshot = {
  policy: {
    limits: {
      max_turns: 10,
      max_context_tokens: 100_000,
      max_context_bytes: 400_000,
      max_output_tokens: 8_000,
      max_output_bytes: 32_000,
    },
    concurrency: { max_workers: 4, max_delegation_depth: 2 },
    retrieval: { retrieval_top_k: 20, rerank_top_k: 5, max_skill_chunks: 10, max_skill_tokens: 4_000 },
    cost: { time_budget_ms: 60_000, cost_budget_usd: 1.5, token_budget: 100_000 },
    resilience: { retry_depth: 2, validation_depth: 1, escalation_threshold: "budget_exceeded" },
  },
  applied_at: "2026-07-18T00:00:00Z",
  scope: "session",
  routing_profile: "direct_worker",
  task_class: "medium",
  role: "worker",
}

const routingDecisionEvent: Events.RoutingDecisionEvent = {
  type: "routing.decision",
  correlation: {
    session_id: "ses_abc123",
    turn_id: "trn_abc123",
    decision_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  },
  classification: { task_class: "medium", routing_profile: "direct_worker" },
  selection: { specialist_agent: "java-architect", executor_model: "claude-sonnet-5" },
  hierarchy_role: "worker",
  budget_snapshot: validBudgetSnapshot,
}

const routingFallbackEvent: Events.RoutingFallbackEvent = {
  type: "routing.fallback",
  decision_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  reason: "primary candidate rejected",
  execution_boundary: "retryable",
  candidate_selected: "claude-haiku-4-5",
}

const hierarchyDispatchEvent: Events.HierarchyDispatchEvent = {
  type: "hierarchy.dispatch",
  lineage: {
    parent_session_id: "ses_parent1",
    child_session_id: "ses_child1",
    parent_role: "manager",
    child_role: "worker",
  },
  fanout: { delegation_depth: 1, fanout_requested: 3, fanout_granted: 3 },
  todo: { todo_ref: "todo-1", todo_version: "v1" },
}

const hierarchyValidationEvent: Events.HierarchyValidationEvent = {
  type: "hierarchy.validation",
  session_id: "ses_abc123",
  role: "worker",
  outcome: "passed",
  validation_reason: "output matched schema",
}

const hierarchyEscalationEvent: Events.HierarchyEscalationEvent = {
  type: "hierarchy.escalation",
  worker_session_id: "ses_worker1",
  reason: "capability mismatch on tool_call_present",
  evidence_refs: ["gate:tool_call_present"],
  reclassified_to: "manager",
}

const capabilityMismatchEvent: Events.CapabilityMismatchEvent = {
  type: "capability.mismatch",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  dimension: "tool_call_present",
  requirement: "requires tool call support",
  outcome: "hard_gate_reject",
}

const todoInitializedEvent: Events.TodoInitializedEvent = {
  type: "todo.initialized",
  session_id: "ses_abc123",
  todo_ref: "todo-1",
  todo_version: "v1",
  item_count: 5,
}

const todoCompletionBlockedEvent: Events.TodoCompletionBlockedEvent = {
  type: "todo.completion_blocked",
  session_id: "ses_abc123",
  reason: "pending validation items",
  pending_items: 2,
}

const allEvents: Events.RoutingEvent[] = [
  routingDecisionEvent,
  routingFallbackEvent,
  hierarchyDispatchEvent,
  hierarchyValidationEvent,
  hierarchyEscalationEvent,
  capabilityMismatchEvent,
  todoInitializedEvent,
  todoCompletionBlockedEvent,
]

describe("Events.RoutingEvent", () => {
  test("decodes every closed-union member", () => {
    for (const value of allEvents) {
      expect(Schema.decodeUnknownSync(Events.RoutingEvent)(value)).toEqual(value)
    }
  })

  test("round-trips a routing.decision event through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(Events.RoutingEvent)(routingDecisionEvent)
    expect(Schema.encodeSync(Events.RoutingEvent)(decoded)).toEqual(routingDecisionEvent)
  })

  test("rejects an unknown type discriminant", () => {
    expect(() =>
      Schema.decodeUnknownSync(Events.RoutingEvent)({ ...todoInitializedEvent, type: "todo.unknown" }),
    ).toThrow()
  })

  test("rejects a member missing required fields for its type", () => {
    const { session_id: _session_id, ...incomplete } = todoInitializedEvent
    expect(() => Schema.decodeUnknownSync(Events.RoutingEvent)(incomplete)).toThrow()
  })

  test("rejects fields from a different member reused under another member's type", () => {
    expect(() =>
      Schema.decodeUnknownSync(Events.RoutingEvent)({
        ...todoInitializedEvent,
        type: "hierarchy.escalation",
      }),
    ).toThrow()
  })

  test("rejects a missing type discriminant entirely", () => {
    const { type: _type, ...untyped } = todoInitializedEvent
    expect(() => Schema.decodeUnknownSync(Events.RoutingEvent)(untyped)).toThrow()
  })
})

describe("Events.HierarchyRole", () => {
  test("is re-exported from ./enums and stays closed", () => {
    expect(Schema.decodeUnknownSync(Events.HierarchyRole)("architect")).toBe("architect")
    expect(() => Schema.decodeUnknownSync(Events.HierarchyRole)("owner")).toThrow()
  })
})

describe("Events.ValidationOutcome", () => {
  test("accepts every closed-union member", () => {
    for (const value of ["passed", "failed", "low_confidence", "escalated"] as const) {
      expect(Schema.decodeUnknownSync(Events.ValidationOutcome)(value)).toBe(value)
    }
  })

  test("rejects a value outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(Events.ValidationOutcome)("skipped")).toThrow()
  })
})

describe("Events.HierarchyEscalationEvent", () => {
  test("pins reclassified_to to the single literal \"manager\"", () => {
    expect(() =>
      Schema.decodeUnknownSync(Events.HierarchyEscalationEvent)({
        ...hierarchyEscalationEvent,
        reclassified_to: "worker",
      }),
    ).toThrow()
  })
})
