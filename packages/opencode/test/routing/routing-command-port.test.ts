/**
 * Feature 001 / T028 — Routing inbound command adapter tests.
 * Verifies local payload parsing, RoutingPort dispatch, and RoutingError →
 * operator FailureHandlerResult mapping through the DomainInvoke seam.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Budget } from "@opencode-ai/schema/routing/budget"
import type { HandlerContext } from "@/operator/application/handler"
import type { RoutingPort } from "@/routing/application/ports"
import { createRoutingDomainPort } from "@/routing/adapters/inbound/routing-command-port"

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

function ctx(id: string, payload?: unknown, scopeKind = "session"): HandlerContext {
  return {
    descriptor: { id } as HandlerContext["descriptor"],
    request: {
      id,
      payload,
      scope: { kind: scopeKind, ref: null },
      source: "cli",
    },
  } as unknown as HandlerContext
}

let lastTestScope: Budget.Scope | null = null

function fakeRouting(overrides?: Partial<RoutingPort>): RoutingPort {
  const base: RoutingPort = {
    status: () =>
      Effect.succeed({
        enabled: true,
        mode: "auto",
        strictGates: true,
        decisionModelPool: ["model-a"],
        rolePools: { worker: ["model-a"] },
        catalogVersion: "catalog_v1",
        policyVersion: "policy_v1",
        health: "ok",
        reason: null,
        recommendedAction: null,
        offline: false,
      }),
    test: (input) => {
      lastTestScope = input.scope
      return Effect.succeed({
        taskClass: "small",
        routingProfile: "direct_worker",
        authorizedCandidates: [],
        hardGateSummary: [],
        budgetPolicy: POLICY,
        noExternalModelCall: true,
        redacted: true,
      })
    },
    explain: (decisionId) =>
      decisionId === "known"
        ? Effect.succeed({
            decisionId,
            taskClass: "small",
            routingProfile: "direct_worker",
            gates: [],
            candidates: [],
            scoreBreakdown: {},
            decisionModelCalled: false,
            selectedAgent: "worker",
            selectedModel: "model-a",
            fallbackAttempted: false,
            fallbackReason: null,
            confidence: 1,
            redacted: true,
          })
        : Effect.fail({ type: "invalid_argument", field: "decisionId", reason: "unknown" }),
    capabilityInspect: () => Effect.succeed({ records: [], redacted: true }),
    evaluate: () => Effect.fail({ type: "not_implemented" }),
  }
  return { ...base, ...overrides }
}

describe("createRoutingDomainPort", () => {
  test("routing.status → query result", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.status"))
    expect(result.kind).toBe("query")
    if (result.kind === "query") {
      expect((result.effective as { enabled: boolean }).enabled).toBe(true)
    }
  })

  test("routing.test parses task description + scope and dispatches locally", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.test", { input: "do a thing", scope: "project" }))
    expect(result.kind).toBe("query")
    expect(lastTestScope).toBe("project")
  })

  test("routing.test without a description → invalid_argument", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.test", {}))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") {
      expect(result.code).toBe("invalid_argument")
      expect(result.details?.field).toBe("input")
    }
  })

  test("routing.explain dispatches by decision id", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const ok = await port.invoke(ctx("routing.explain", { decisionId: "known" }))
    expect(ok.kind).toBe("query")
    const missing = await port.invoke(ctx("routing.explain", {}))
    expect(missing.kind).toBe("failure")
    if (missing.kind === "failure") expect(missing.code).toBe("invalid_argument")
  })

  test("routing.capability.inspect → query", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.capability.inspect", { model: "model-a" }))
    expect(result.kind).toBe("query")
  })

  test("routing.configure → not_implemented (Config.Service mutation path)", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.configure"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })

  test("unknown routing command → not_implemented", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.bogus"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })

  test("RoutingError → operator failure code mapping (unavailable)", async () => {
    const port = createRoutingDomainPort(
      fakeRouting({ status: () => Effect.fail({ type: "unavailable", reason: "catalog down" }) }),
    )
    const result = await port.invoke(ctx("routing.status"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") {
      expect(result.code).toBe("unavailable")
      expect(result.message).toBe("catalog down")
    }
  })
})
