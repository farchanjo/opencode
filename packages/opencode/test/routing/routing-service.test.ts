/**
 * Feature 001 / T026 — Routing application service tests (in-process fixtures).
 * Deterministic, no I/O beyond an in-memory fs fake; zero model calls.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { Capability } from "@opencode-ai/schema/routing/capability"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { RoutingError } from "@opencode-ai/protocol/routing/index"
import type { EvaluationCandidate } from "@/routing/domain/routing-evaluator"
import type { DecisionStorePort } from "@/routing/domain/routing-decision"
import { createRoutingService, resolveDecisionModelPool } from "@/routing/application/routing-service"
import { createDomainDecisionStore } from "@/routing/application/decision-store"
import type {
  RoutingConfigSource,
  CandidateSource,
  CandidateResolution,
  TaskAnalyzer,
} from "@/routing/application/ports"

const NOW = "2026-07-18T00:00:00.000Z"

const POLICY: Budget.Policy = {
  limits: {
    max_turns: 10,
    max_context_tokens: 100_000,
    max_context_bytes: 400_000,
    max_output_tokens: 8_000,
    max_output_bytes: 32_000,
  },
  concurrency: { max_workers: 4, max_delegation_depth: 2 },
  retrieval: { retrieval_top_k: 20, rerank_top_k: 10, max_skill_chunks: 8, max_skill_tokens: 4_000 },
  cost: { time_budget_ms: 60_000, cost_budget_usd: 1, token_budget: 200_000 },
  resilience: { retry_depth: 2, validation_depth: 2, escalation_threshold: "escalate" },
}

const CONFIG: RoutingConfig.Info = {
  activation: { enabled: true, mode: "auto", strict_gates: true },
  models: {
    decision_model: { pool: ["decider"] },
    role_pools: { decider: ["model-a", "model-b"], worker: ["model-a", "model-b"] },
    fallback: { floor_role: "worker" },
  },
  enforcement: {
    capability: { metadata_source: "catalog", unknown_policy: "deny", probing_enabled: false },
    budget: POLICY,
    hierarchy: { max_depth: 2, orchestration_only: true },
  },
}

function capabilityRecord(model: string, toolCallPresent: boolean | null): Capability.Record {
  return {
    identity: { provider: "anthropic", model, variant: "default", api: "anthropic" },
    assessment: {
      source: "catalog",
      confidence: 1,
      dimensions: {
        tool_call_present: toolCallPresent,
        max_calls_per_turn: null,
        same_turn_multiple_calls: null,
        serial_runner_execution: null,
        parallel_calls: null,
        continuation_after_tool_result: null,
        multi_turn_cycles: null,
      },
    },
    freshness: { timestamp: NOW, ttl_ms: 3_600_000, scope: `anthropic/${model}/default` },
  }
}

function candidate(model: string, skills: ReadonlyArray<string>, toolCallPresent: boolean | null): EvaluationCandidate {
  return {
    identity: { agent_id: "worker", model_id: model },
    profile: { skills, effort: "medium", reasoning_effort: "medium" },
    capability: { catalog: capabilityRecord(model, toolCallPresent), overlays: [] },
    healthy: true,
  }
}

const ANALYZER: TaskAnalyzer = {
  analyze: () => ({
    inputs: {
      structure: { domain_count: 1, independent_units: 1, context_size: 1_000 },
      risk: { mutation_risk: 0.1, ambiguity: 0.2, security_migration: 0, external_effects: 0 },
      concurrency: { expected_tools: [], parallelism: 0 },
    },
    requirements: { tool_call_present: true },
    ranking: { requiredSkills: ["typescript"], desiredEffort: "medium", desiredReasoning: "medium" },
  }),
}

const CONFIG_SOURCE: RoutingConfigSource = {
  resolve: async () => ({ config: CONFIG, policyVersion: "policy_v1", origin: "project" }),
}

function candidateSource(candidates: ReadonlyArray<EvaluationCandidate>): CandidateSource {
  return {
    resolve: async (): Promise<CandidateResolution> => ({
      candidates,
      decisionPoolModelIds: ["model-a", "model-b"],
      catalogVersion: "catalog_v1",
    }),
    inspect: async (modelId?: string) => [capabilityRecord(modelId ?? "model-a", true)],
    status: async () => ({
      catalogVersion: "catalog_v1",
      health: "ok",
      offline: false,
      reason: null,
      recommendedAction: null,
    }),
  }
}

// Two authorized candidates: model-a owns the required skill (rank 1), model-b does not.
const CANDIDATES: ReadonlyArray<EvaluationCandidate> = [
  candidate("model-a", ["typescript"], true),
  candidate("model-b", [], true),
]

function memFs(): DecisionStorePort {
  const files = new Map<string, string>()
  return {
    exists: async (p) => files.has(p),
    readText: async (p) => files.get(p) ?? null,
    writeText: async (p, c) => {
      files.set(p, c)
    },
    rename: async (from, to) => {
      const v = files.get(from)
      if (v !== undefined) {
        files.set(to, v)
        files.delete(from)
      }
    },
    remove: async (p) => {
      files.delete(p)
    },
  }
}

function service(candidates: ReadonlyArray<EvaluationCandidate> = CANDIDATES) {
  return createRoutingService({
    config: CONFIG_SOURCE,
    candidates: candidateSource(candidates),
    analyzer: ANALYZER,
    decisions: createDomainDecisionStore(memFs(), "/decisions"),
    clock: () => 1_700_000_000_000,
    nowIso: () => NOW,
  })
}

type Outcome<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: RoutingError }

function run<A>(effect: Effect.Effect<A, RoutingError>): Promise<Outcome<A>> {
  return Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value): Outcome<A> => ({ ok: true, value }),
        onFailure: (error): Outcome<A> => ({ ok: false, error }),
      }),
    ),
  )
}

const EVAL_INPUT = {
  sessionId: "ses_1",
  turnId: "turn_1",
  taskDescription: "add a small helper",
  taskFingerprint: "fp_1",
  scope: "session" as Budget.Scope,
}

describe("createRoutingService.evaluate", () => {
  test("selects the top-ranked authorized candidate and persists a decision", async () => {
    const out = await run(service().evaluate(EVAL_INPUT))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const d = out.value
    expect(d.selection.specialist_agent).toBe("worker")
    expect(d.selection.executor_model).toBe("model-a")
    expect(d.selection.selected_skills).toEqual(["typescript"])
    expect(d.classification.task_class).toBe("small")
    expect(d.evaluation.candidates.length).toBe(2)
    expect(d.accounting.catalog_version).toBe("catalog_v1")
    expect(d.accounting.policy_version).toBe("policy_v1")
    expect(d.accounting.auth_context.hard_gates_authoritative).toBe(true)
    expect(d.lifecycle.execution_boundary).toBe("safe")
  })

  test("is idempotent on the (session, turn, fingerprint) key", async () => {
    const svc = service()
    const first = await run(svc.evaluate(EVAL_INPUT))
    const second = await run(svc.evaluate(EVAL_INPUT))
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.value.id).toBe(first.value.id)
  })

  test("no authorized candidate → typed no_authorized_candidate error", async () => {
    // Both candidates report tool_call_present=null; under unknown_policy "deny" the required gate fails.
    const denied = [candidate("model-a", ["typescript"], null), candidate("model-b", [], null)]
    const out = await run(service(denied).evaluate(EVAL_INPUT))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error.type).toBe("no_authorized_candidate")
  })
})

describe("createRoutingService.explain", () => {
  test("reads back the persisted decision by id (redacted)", async () => {
    const svc = service()
    const evaluated = await run(svc.evaluate(EVAL_INPUT))
    expect(evaluated.ok).toBe(true)
    if (!evaluated.ok) return
    const out = await run(svc.explain(evaluated.value.id))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.decisionId).toBe(evaluated.value.id)
    expect(out.value.selectedAgent).toBe("worker")
    expect(out.value.selectedModel).toBe("model-a")
    expect(out.value.gates.length).toBeGreaterThan(0)
    expect(out.value.redacted).toBe(true)
  })

  test("unknown decision id → invalid_argument", async () => {
    const out = await run(service().explain("01JCNQZWXOF7Z9EGAA8FW9YE00"))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error.type).toBe("invalid_argument")
  })
})

describe("createRoutingService.test", () => {
  test("deterministic dry run reports no external model call and persists nothing", async () => {
    const svc = service()
    const out = await run(svc.test({ taskDescription: "small task", scope: "session" }))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.noExternalModelCall).toBe(true)
    expect(out.value.redacted).toBe(true)
    expect(out.value.authorizedCandidates.length).toBe(2)
    expect(out.value.taskClass).toBe("small")
    // Nothing was committed: a lookup for a never-created id stays null.
    const explained = await run(svc.explain("01JCNQZWXOF7Z9EGAA8FW9YE00"))
    expect(explained.ok).toBe(false)
  })
})

describe("createRoutingService.status + capabilityInspect", () => {
  test("status reflects config activation and resolved decision-model pool", async () => {
    const out = await run(service().status())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.enabled).toBe(true)
    expect(out.value.mode).toBe("auto")
    expect(out.value.decisionModelPool).toEqual(["model-a", "model-b"])
    expect(out.value.catalogVersion).toBe("catalog_v1")
    expect(out.value.health).toBe("ok")
    expect(out.value.offline).toBe(false)
  })

  test("capabilityInspect returns redacted records", async () => {
    const out = await run(service().capabilityInspect("model-a"))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.value.redacted).toBe(true)
    expect(out.value.records[0]?.identity.model).toBe("model-a")
  })
})

describe("resolveDecisionModelPool", () => {
  test("flattens decision-model role pools into ordered, de-duplicated model ids", () => {
    expect(resolveDecisionModelPool(CONFIG)).toEqual(["model-a", "model-b"])
  })
})
