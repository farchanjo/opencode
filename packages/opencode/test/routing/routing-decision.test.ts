import { describe, expect, test } from "bun:test"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import {
  buildRoutingDecision,
  commitDecision,
  deserialize,
  idempotencyKey,
  keyString,
  loadDecision,
  pathsFor,
  recoverPending,
  safeKey,
  serialize,
  type DecisionStorePort,
} from "@/routing/domain/routing-decision"

const NOW = "2026-07-18T00:00:00.000Z"

function makeDecision(overrides?: {
  id?: string
  sessionId?: string
  turnId?: string
  fingerprint?: string
  agent?: string
}): Decision.RoutingDecision {
  const context: Decision.DecisionContext = {
    version: 1,
    session_id: overrides?.sessionId ?? "sess-1",
    turn_id: overrides?.turnId ?? "turn-1",
    task_fingerprint: overrides?.fingerprint ?? "fp-abc",
  }
  const classification: Decision.DecisionClassification = {
    task_class: "small",
    routing_profile: "direct_worker",
    task_effort: "low",
    reasoning_effort: "low",
  }
  const selection: Decision.DecisionSelection = {
    specialist_agent: overrides?.agent ?? "worker",
    executor_model: "claude-sonnet-5",
    selected_skills: [],
    provider_variant: "default",
  }
  const evaluation: Decision.DecisionEvaluation = {
    gates: [],
    candidates: [],
    ranking: [],
    tie_break: null,
    decision_model_id: null,
    decision_inputs: null,
    decision_output: null,
  }
  const accounting: Decision.DecisionAccounting = {
    budget: {
      policy: {
        limits: {
          max_turns: 10,
          max_context_tokens: 100_000,
          max_context_bytes: 400_000,
          max_output_tokens: 8_000,
          max_output_bytes: 32_000,
        },
        concurrency: { max_workers: 4, max_delegation_depth: 2 },
        retrieval: { retrieval_top_k: 10, rerank_top_k: 5, max_skill_chunks: 8, max_skill_tokens: 4_000 },
        cost: { time_budget_ms: 60_000, cost_budget_usd: 1, token_budget: 200_000 },
        resilience: { retry_depth: 2, validation_depth: 2, escalation_threshold: "confidence_floor" },
      },
      applied_at: NOW,
      scope: "session",
      routing_profile: "direct_worker",
      task_class: "small",
      role: "worker",
    },
    budget_consumed: {
      throughput: { turns_used: 0, context_tokens_used: 0, output_tokens_used: 0 },
      concurrency: { workers_requested: 0, workers_granted: 0, delegation_depth_used: 0 },
      retrieval: { retrieval_chunks_used: 0, skill_tokens_used: 0 },
      cost: { time_ms_used: 0, cost_usd_used: 0 },
      resilience: { retry_count: 0, validation_count: 0, escalation_count: 0 },
    },
    catalog_version: "cat-v1",
    policy_version: "pol-v1",
    auth_context: { permission_mode: "default", policy_version: "pol-v1", hard_gates_authoritative: true },
  }
  const lifecycle: Decision.DecisionLifecycle = {
    execution_boundary: "safe",
    fallback_attempted: false,
    fallback_reason: null,
    fallback_candidates: null,
    created_at: NOW,
    decision_latency_ms: 3,
    offline: false,
  }
  return buildRoutingDecision({
    id: overrides?.id ?? "01J000000000000000000DEC01",
    context,
    classification,
    selection,
    evaluation,
    accounting,
    lifecycle,
  })
}

// In-memory fake store; `rename` is atomic (put-then-delete under one call).
function memoryStore(): DecisionStorePort & { readonly files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    exists: async (p) => files.has(p),
    readText: async (p) => files.get(p) ?? null,
    writeText: async (p, c) => {
      files.set(p, c)
    },
    rename: async (from, to) => {
      const v = files.get(from)
      if (v === undefined) throw new Error(`rename: missing ${from}`)
      files.set(to, v)
      files.delete(from)
    },
    remove: async (p) => {
      files.delete(p)
    },
  }
}

describe("T020 routing-decision — construction", () => {
  test("buildRoutingDecision deep-freezes the aggregate", () => {
    const d = makeDecision()
    expect(Object.isFrozen(d)).toBe(true)
    expect(Object.isFrozen(d.context)).toBe(true)
    expect(Object.isFrozen(d.accounting.budget.policy.limits)).toBe(true)
    expect(() => {
      ;(d as { id: string }).id = "mutated"
    }).toThrow()
  })

  test("serialize/deserialize round-trip", () => {
    const d = makeDecision()
    expect(deserialize(serialize(d))).toEqual(d)
    expect(deserialize(null)).toBeNull()
    expect(deserialize("{not json")).toBeNull()
  })

  test("idempotency key derives from the (session, turn, fingerprint) tuple", () => {
    const d = makeDecision({ sessionId: "s", turnId: "t", fingerprint: "f" })
    const key = idempotencyKey(d.context)
    expect(key).toEqual({ sessionId: "s", turnId: "t", taskFingerprint: "f" })
    expect(keyString(key)).toBe("s::t::f")
    expect(safeKey({ sessionId: "s/1", turnId: "t 2", taskFingerprint: "f" })).toBe("s_1__t_2__f")
  })
})

describe("T020 routing-decision — atomic commit", () => {
  const BASE = "/decisions"

  test("first commit writes the committed page and clears temp + journal", async () => {
    const store = memoryStore()
    const d = makeDecision()
    const paths = pathsFor(BASE, idempotencyKey(d.context))

    const result = await commitDecision(store, BASE, d)
    expect(result.outcome).toBe("committed")
    expect(result.recovered).toBe(false)
    expect(store.files.has(paths.committed)).toBe(true)
    expect(store.files.has(paths.temp)).toBe(false)
    expect(store.files.has(paths.journal)).toBe(false)
    expect(deserialize(store.files.get(paths.committed)!)).toEqual(d)
  })

  test("re-commit of the same key is an idempotent hit and never overwrites", async () => {
    const store = memoryStore()
    const first = makeDecision({ id: "01J000000000000000000DEC01" })
    await commitDecision(store, BASE, first)

    // Same idempotency tuple, different decision id/agent — must return the original.
    const replay = makeDecision({ id: "01J000000000000000000DEC02", agent: "other" })
    const result = await commitDecision(store, BASE, replay)
    expect(result.outcome).toBe("idempotent_hit")
    expect(result.decision.id).toBe("01J000000000000000000DEC01")
    expect(result.decision.selection.specialist_agent).toBe("worker")
  })

  test("distinct keys commit independently", async () => {
    const store = memoryStore()
    const a = makeDecision({ turnId: "turn-1", fingerprint: "fp-a" })
    const b = makeDecision({ turnId: "turn-2", fingerprint: "fp-b" })
    expect((await commitDecision(store, BASE, a)).outcome).toBe("committed")
    expect((await commitDecision(store, BASE, b)).outcome).toBe("committed")
    expect(store.files.size).toBe(2)
  })
})

describe("T020 routing-decision — crash recovery", () => {
  const BASE = "/decisions"

  test("recovers a rename that crashed after the journal flag (temp present)", async () => {
    const store = memoryStore()
    const d = makeDecision()
    const key = idempotencyKey(d.context)
    const paths = pathsFor(BASE, key)

    // Simulate a crash: temp page written + journal marker set, rename never ran.
    await store.writeText(paths.temp, serialize(d))
    await store.writeText(paths.journal, JSON.stringify({ from: paths.temp, to: paths.committed, key: keyString(key) }))

    const recovery = await recoverPending(store, paths)
    expect(recovery).toBe("recovered")
    expect(store.files.has(paths.committed)).toBe(true)
    expect(store.files.has(paths.temp)).toBe(false)
    expect(store.files.has(paths.journal)).toBe(false)
    expect(await loadDecision(store, BASE, key)).toEqual(d)
  })

  test("clears a stale journal when the rename already completed (temp absent)", async () => {
    const store = memoryStore()
    const d = makeDecision()
    const key = idempotencyKey(d.context)
    const paths = pathsFor(BASE, key)

    // Crash after rename, before journal cleared: committed present, temp gone.
    await store.writeText(paths.committed, serialize(d))
    await store.writeText(paths.journal, JSON.stringify({ from: paths.temp, to: paths.committed, key: keyString(key) }))

    expect(await recoverPending(store, paths)).toBe("recovered")
    expect(store.files.has(paths.journal)).toBe(false)
    expect(store.files.has(paths.committed)).toBe(true)
  })

  test("commit replays a pending recovery before its idempotency check", async () => {
    const store = memoryStore()
    const d = makeDecision()
    const key = idempotencyKey(d.context)
    const paths = pathsFor(BASE, key)

    // Leave a crashed prior attempt for this key in the store.
    await store.writeText(paths.temp, serialize(d))
    await store.writeText(paths.journal, JSON.stringify({ from: paths.temp, to: paths.committed, key: keyString(key) }))

    const result = await commitDecision(store, BASE, makeDecision({ id: "01J000000000000000000DEC99" }))
    expect(result.recovered).toBe(true)
    expect(result.outcome).toBe("idempotent_hit")
    expect(result.decision.id).toBe(d.id)
  })

  test("recoverPending on a clean key is a no-op", async () => {
    const store = memoryStore()
    const paths = pathsFor(BASE, { sessionId: "s", turnId: "t", taskFingerprint: "f" })
    expect(await recoverPending(store, paths)).toBe("clean")
    expect(store.files.size).toBe(0)
  })
})
