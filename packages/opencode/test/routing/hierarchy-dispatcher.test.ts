import { describe, expect, test } from "bun:test"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { Events } from "@opencode-ai/schema/routing/events"
import {
  admitDispatchFanout,
  isOrchestrationOnly,
  MAX_DELEGATION_DEPTH,
  planDispatch,
  planEscalation,
  validationEvent,
  type DispatchRequest,
} from "@/routing/domain/hierarchy-dispatcher"

function policy(overrides?: { maxWorkers?: number }): Budget.Policy {
  return {
    limits: {
      max_turns: 10,
      max_context_tokens: 100_000,
      max_context_bytes: 400_000,
      max_output_tokens: 8_000,
      max_output_bytes: 32_000,
    },
    concurrency: { max_workers: overrides?.maxWorkers ?? 4, max_delegation_depth: 2 },
    retrieval: { retrieval_top_k: 10, rerank_top_k: 5, max_skill_chunks: 8, max_skill_tokens: 4_000 },
    cost: { time_budget_ms: 60_000, cost_budget_usd: 10, token_budget: 1_000_000 },
    resilience: { retry_depth: 2, validation_depth: 2, escalation_threshold: "confidence_floor" },
  }
}

const TODO: Events.TodoPointer = { todo_ref: "todo-1", todo_version: "v1" }

function request(overrides: {
  parentRole?: Enums.HierarchyRole
  childRole?: Enums.HierarchyRole
  parentDepth?: number
  requestedFanout?: number
  maxWorkers?: number
  headroom?: { costUsd: number; tokens: number }
  perWorker?: { costUsd: number; tokens: number }
}): DispatchRequest {
  return {
    parent: {
      sessionId: "parent-sess",
      role: overrides.parentRole ?? "architect",
      depth: overrides.parentDepth ?? 0,
    },
    child: { sessionId: "child-sess", role: overrides.childRole ?? "worker" },
    todo: TODO,
    requestedFanout: overrides.requestedFanout ?? 1,
    policy: policy({ maxWorkers: overrides.maxWorkers }),
    headroom: overrides.headroom ?? { costUsd: 10, tokens: 1_000_000 },
    perWorker: overrides.perWorker ?? { costUsd: 0, tokens: 0 },
  }
}

describe("T023 hierarchy — role and depth invariants", () => {
  test("only architect and manager are orchestration-only roles", () => {
    expect(isOrchestrationOnly("architect")).toBe(true)
    expect(isOrchestrationOnly("manager")).toBe(true)
    expect(isOrchestrationOnly("worker")).toBe(false)
  })

  test("architect -> manager -> worker chain reaches exactly depth 2", () => {
    const toManager = planDispatch(request({ parentRole: "architect", childRole: "manager", parentDepth: 0 }))
    expect(toManager.ok).toBe(true)
    if (toManager.ok) expect(toManager.envelope.childDepth).toBe(1)

    const toWorker = planDispatch(request({ parentRole: "manager", childRole: "worker", parentDepth: 1 }))
    expect(toWorker.ok).toBe(true)
    if (toWorker.ok) {
      expect(toWorker.envelope.childDepth).toBe(MAX_DELEGATION_DEPTH)
      expect(toWorker.envelope.fanout.delegation_depth).toBe(2)
    }
  })

  test("a third delegation edge (depth 3) is rejected", () => {
    const out = planDispatch(request({ parentRole: "manager", childRole: "worker", parentDepth: 2 }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.rejection.reason).toBe("depth_exceeded")
  })

  test("Manager MUST NOT create Manager", () => {
    const out = planDispatch(request({ parentRole: "manager", childRole: "manager", parentDepth: 1 }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.rejection.reason).toBe("illegal_transition")
  })

  test("Worker cannot dispatch anything (orchestration-only violation)", () => {
    const out = planDispatch(request({ parentRole: "worker", childRole: "worker", parentDepth: 2 }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.rejection.reason).toBe("parent_not_orchestrator")
  })

  test("only a Worker child carries execution authority", () => {
    const worker = planDispatch(request({ parentRole: "architect", childRole: "worker" }))
    const manager = planDispatch(request({ parentRole: "architect", childRole: "manager" }))
    expect(worker.ok && worker.envelope.executionAllowed).toBe(true)
    expect(manager.ok && manager.envelope.executionAllowed).toBe(false)
  })
})

describe("T023 hierarchy — admission-controlled fanout", () => {
  test("granted = min(requested, max_workers, cost, token)", () => {
    const result = admitDispatchFanout(
      policy({ maxWorkers: 5 }),
      8, // requested
      { costUsd: 3, tokens: 1_000 }, // headroom
      { costUsd: 1, tokens: 100 }, // per worker -> byCost 3, byToken 10
    )
    expect(result.factors).toEqual({ requested: 8, byMaxWorkers: 5, byCostBudget: 3, byTokenBudget: 10 })
    expect(result.granted).toBe(3)
    expect(result.outcome).toBe("ok")
  })

  test("non-positive per-worker estimate does not throttle that dimension", () => {
    const result = admitDispatchFanout(policy({ maxWorkers: 6 }), 4, { costUsd: 0, tokens: 0 }, { costUsd: 0, tokens: 0 })
    expect(result.granted).toBe(4)
    expect(result.factors.byCostBudget).toBe(4)
    expect(result.factors.byTokenBudget).toBe(4)
  })

  test("zero cost headroom for one worker blocks admission", () => {
    const result = admitDispatchFanout(policy(), 2, { costUsd: 0.5, tokens: 1_000_000 }, { costUsd: 1, tokens: 1 })
    expect(result.granted).toBe(0)
    expect(result.outcome).toBe("blocked")
    expect(result.reason).toContain("cost_budget")
  })

  test("planDispatch rejects a fully-denied admission", () => {
    const out = planDispatch(
      request({
        requestedFanout: 3,
        headroom: { costUsd: 0, tokens: 1_000_000 },
        perWorker: { costUsd: 1, tokens: 1 },
      }),
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.rejection.reason).toBe("admission_denied")
  })

  test("envelope carries lineage, fanout counters and the dispatch event", () => {
    const out = planDispatch(
      request({
        parentRole: "manager",
        childRole: "worker",
        parentDepth: 1,
        requestedFanout: 10,
        maxWorkers: 3,
      }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.envelope.event.type).toBe("hierarchy.dispatch")
    expect(out.envelope.lineage).toEqual({
      parent_session_id: "parent-sess",
      child_session_id: "child-sess",
      parent_role: "manager",
      child_role: "worker",
    })
    expect(out.envelope.fanout).toEqual({ delegation_depth: 2, fanout_requested: 10, fanout_granted: 3 })
    expect(out.envelope.event.todo).toEqual(TODO)
  })
})

describe("T023 hierarchy — escalation reuses evidence / OutputRefs / lineage", () => {
  const lineage: Events.DispatchLineage = {
    parent_session_id: "arch",
    child_session_id: "worker-1",
    parent_role: "architect",
    child_role: "worker",
  }

  test("escalation reclassifies to manager and carries the Worker's work forward unchanged", () => {
    const evidence = ["ev-1", "ev-2"]
    const outputs = ["spool-1"]
    const plan = planEscalation({
      workerSessionId: "worker-1",
      reason: "low confidence result",
      evidenceRefs: evidence,
      outputRefs: outputs,
      lineage,
    })
    expect(plan.event.type).toBe("hierarchy.escalation")
    expect(plan.event.reclassified_to).toBe("manager")
    expect(plan.event.evidence_refs).toBe(evidence)
    expect(plan.reusedEvidence).toBe(evidence)
    expect(plan.reusedOutputRefs).toBe(outputs)
    expect(plan.lineage).toBe(lineage)
  })
})

describe("T023 hierarchy — validation events", () => {
  test("builds a hierarchy.validation event for a chain link", () => {
    const event = validationEvent({ sessionId: "mgr-1", role: "manager", outcome: "passed", reason: "synthesis ok" })
    expect(event).toEqual({
      type: "hierarchy.validation",
      session_id: "mgr-1",
      role: "manager",
      outcome: "passed",
      validation_reason: "synthesis ok",
    })
  })
})
