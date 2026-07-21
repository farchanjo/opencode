import { describe, expect, test } from "bun:test"
import { RoutingState, createRoutingSessionStateStore, isDirectChildOf } from "@/session/routing-state"
import type { Events } from "@opencode-ai/schema/routing/events"
import type { SessionID } from "@/session/schema"

const ARCHITECT = "ses_architect" as SessionID
const WORKER = "ses_worker" as SessionID
const OTHER = "ses_other" as SessionID

function lineage(overrides?: Partial<Events.DispatchLineage>): Events.DispatchLineage {
  return {
    parent_session_id: ARCHITECT,
    child_session_id: WORKER,
    parent_role: "architect",
    child_role: "worker",
    ...overrides,
  }
}

describe("RoutingState — namespace + isDirectChildOf (FR: parent_session_id == current_session_id)", () => {
  test("exports the namespace object", () => {
    expect(typeof RoutingState.createRoutingSessionStateStore).toBe("function")
  })

  test("true iff the lineage names currentSessionId as the parent edge", () => {
    expect(isDirectChildOf(lineage(), ARCHITECT)).toBe(true)
    expect(isDirectChildOf(lineage(), WORKER)).toBe(false)
    expect(isDirectChildOf(lineage(), OTHER)).toBe(false)
  })
})

describe("RoutingSessionStateStore", () => {
  test("get() returns an empty state for a Session that was never recorded", () => {
    const store = createRoutingSessionStateStore()
    expect(store.get(WORKER)).toEqual({
      sessionId: WORKER,
      decision: null,
      hierarchyRole: null,
      parentSessionId: null,
      consumption: null,
      aggregate: null,
      narrowedSets: null,
      autoSkillInjected: null,
    })
  })

  test("recordDecision attaches the decision reference and hierarchy role", () => {
    const store = createRoutingSessionStateStore()
    const decision = { decisionId: "01HZZZZZZZZZZZZZZZZZZZZZZZ", catalogVersion: "cat_v1", policyVersion: "pol_v1" }
    const state = store.recordDecision(WORKER, decision, "worker")
    expect(state.decision).toEqual(decision)
    expect(state.hierarchyRole).toBe("worker")
    expect(store.get(WORKER)).toEqual(state)
  })

  test("recordDispatch accepts a lineage naming this Session as the child and sets parentSessionId + hierarchyRole", () => {
    const store = createRoutingSessionStateStore()
    const { state, correlation } = store.recordDispatch(WORKER, lineage())
    expect(correlation).toEqual({ ok: true, reason: null })
    expect(state.parentSessionId).toBe(ARCHITECT)
    expect(state.hierarchyRole).toBe("worker")
  })

  test("recordDispatch rejects (state unchanged) a lineage that does not name this Session as the child", () => {
    const store = createRoutingSessionStateStore()
    const { state, correlation } = store.recordDispatch(OTHER, lineage())
    expect(correlation.ok).toBe(false)
    expect(correlation.reason).toContain("child_session_id")
    expect(state).toEqual(store.get(OTHER))
    expect(state.parentSessionId).toBeNull()
  })

  test("recordConsumption attaches budget consumption without disturbing decision/role", () => {
    const store = createRoutingSessionStateStore()
    store.recordDecision(WORKER, { decisionId: "d1", catalogVersion: "c1", policyVersion: "p1" }, "worker")
    const consumption = {
      throughput: { turns_used: 1, context_tokens_used: 10, output_tokens_used: 5 },
      concurrency: { workers_requested: 1, workers_granted: 1, delegation_depth_used: 1 },
      retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
      cost: { time_ms_used: 100, cost_usd_used: 0.01 },
      resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
    }
    const state = store.recordConsumption(WORKER, consumption)
    expect(state.consumption).toEqual(consumption)
    expect(state.hierarchyRole).toBe("worker")
  })

  test("clear() removes the recorded state for a Session", () => {
    const store = createRoutingSessionStateStore()
    store.recordDecision(WORKER, { decisionId: "d1", catalogVersion: "c1", policyVersion: "p1" }, "worker")
    store.clear(WORKER)
    expect(store.get(WORKER).decision).toBeNull()
  })

  test("state for one Session never leaks into another", () => {
    const store = createRoutingSessionStateStore()
    store.recordDecision(WORKER, { decisionId: "d1", catalogVersion: "c1", policyVersion: "p1" }, "worker")
    expect(store.get(OTHER).decision).toBeNull()
  })
})

describe("RoutingSessionStateStore — autoSkillInjected (Feature 052, FR6)", () => {
  test("a fresh session reads autoSkillInjected null", () => {
    const store = createRoutingSessionStateStore()
    expect(store.get(WORKER).autoSkillInjected).toBeNull()
  })

  test("recordAutoSkillInjected lazily creates and merges the session dedup set", () => {
    const store = createRoutingSessionStateStore()
    store.recordAutoSkillInjected(WORKER, ["alpha", "beta"])
    store.recordAutoSkillInjected(WORKER, ["beta", "gamma"])
    expect([...(store.get(WORKER).autoSkillInjected ?? [])].sort()).toEqual(["alpha", "beta", "gamma"])
  })

  test("the dedup set is released with the session at clear()", () => {
    const store = createRoutingSessionStateStore()
    store.recordAutoSkillInjected(WORKER, ["alpha"])
    store.clear(WORKER)
    expect(store.get(WORKER).autoSkillInjected).toBeNull()
  })

  test("the dedup set coexists with the narrowedSets memo", () => {
    const store = createRoutingSessionStateStore()
    store.recordNarrowedSets(WORKER, "msg_1", { skills: ["s1"] })
    store.recordAutoSkillInjected(WORKER, ["alpha"])
    expect(store.get(WORKER).narrowedSets).toEqual({ key: "msg_1", sets: { skills: ["s1"] } })
    expect([...(store.get(WORKER).autoSkillInjected ?? [])]).toEqual(["alpha"])
  })
})
