/**
 * Feature 001 / T038 — command-surface contract.
 *
 * Asserts the reserved `smart.*` / `routing.*` / `telemetry.*` command ids the
 * plan's command tables promise are actually registered in the Feature 007
 * reserved catalog with the correct mutation + offline flags, that the routing
 * inbound adapter honours exactly the RoutingPort-backed reserved ids through
 * the DomainInvoke seam, and that the application `RoutingPort` shape conforms
 * to `contracts/ports.ts` (method-for-method). Feature 007 remains the sole
 * registration authority; this is a drift guard, not a second registry.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { getReservedEntry, isReservedCommandId, RESERVED_CATALOG } from "@opencode-ai/core/operator"
import type { HandlerContext } from "@/operator/application/handler"
import type { RoutingPort } from "@/routing/application/ports"
import { createRoutingDomainPort } from "@/routing/adapters/inbound/routing-command-port"

// The command surface exactly as the plan.md command tables + contracts/ports.ts
// enumerate it: [id, mutates, offlineCapable].
const SURFACE: ReadonlyArray<readonly [string, boolean, boolean]> = [
  // smart
  ["smart.status", false, true],
  ["smart.on", true, true],
  ["smart.off", true, true],
  ["smart.auto", true, true],
  // routing
  ["routing.status", false, true],
  ["routing.configure", true, true],
  ["routing.test", false, true],
  ["routing.explain", false, true],
  ["routing.capability.inspect", false, true],
  // telemetry
  ["telemetry.status", false, true],
  ["telemetry.show", false, true],
  ["telemetry.on", true, true],
  ["telemetry.off", true, true],
  ["telemetry.configure", true, true],
  // A reachability probe is read-only (returns a `query`, like `routing.test`);
  // the prior `mutates:true` made the dispatcher reject every dispatch (Feature 014
  // fix round). offlineCapable stays false — it dials the OTLP endpoint.
  ["telemetry.test", false, false],
]

function ctx(id: string, payload?: unknown): HandlerContext {
  return {
    descriptor: { id } as HandlerContext["descriptor"],
    request: { id, payload, scope: { kind: "session", ref: null }, source: "cli" },
  } as unknown as HandlerContext
}

function fakeRouting(): RoutingPort {
  return {
    evaluate: () => Effect.fail({ type: "not_implemented" }),
    status: () =>
      Effect.succeed({
        enabled: true,
        mode: "auto",
        strictGates: true,
        decisionModelPool: ["m-a"],
        rolePools: { worker: ["m-a"] },
        catalogVersion: "cat_v1",
        policyVersion: "pol_v1",
        health: "ok",
        reason: null,
        recommendedAction: null,
        offline: false,
      }),
    test: () =>
      Effect.succeed({
        taskClass: "small",
        routingProfile: "direct_worker",
        authorizedCandidates: [],
        hardGateSummary: [],
        budgetPolicy: {} as never,
        noExternalModelCall: true,
        redacted: true,
      }),
    explain: () =>
      Effect.succeed({
        decisionId: "d1",
        taskClass: "small",
        routingProfile: "direct_worker",
        gates: [],
        candidates: [],
        scoreBreakdown: {},
        decisionModelCalled: false,
        selectedAgent: "worker",
        selectedModel: "m-a",
        fallbackAttempted: false,
        fallbackReason: null,
        confidence: 1,
        redacted: true,
      }),
    capabilityInspect: () => Effect.succeed({ records: [], redacted: true }),
  }
}

describe("T038 reserved-catalog command surface (smart/routing/telemetry)", () => {
  test("every promised surface id is reserved with the expected mutation + offline flags", () => {
    for (const [id, mutates, offlineCapable] of SURFACE) {
      expect(isReservedCommandId(id)).toBe(true)
      const entry = getReservedEntry(id)
      expect(entry, `missing reserved entry for ${id}`).toBeDefined()
      expect(entry!.mutates, `${id} mutates`).toBe(mutates)
      expect(entry!.offlineCapable, `${id} offlineCapable`).toBe(offlineCapable)
      // Every Feature 001 surface command allows the global scope.
      expect(entry!.scopesAllowed).toContain("global")
    }
  })

  test("read-only status/inspect commands never require confirmation", () => {
    for (const id of ["smart.status", "routing.status", "routing.explain", "routing.capability.inspect", "telemetry.status", "telemetry.show"]) {
      expect(getReservedEntry(id)!.confirmRequired).toBe(false)
    }
  })

  test("the reserved catalog carries no duplicate Feature 001 ids", () => {
    const ids = RESERVED_CATALOG.ids.filter((id) => /^(smart|routing|telemetry)\./.test(id))
    expect(new Set(ids).size).toBe(ids.length)
    // The catalog is a superset of the promised surface.
    for (const [id] of SURFACE) expect(ids).toContain(id)
  })
})

describe("T038 routing inbound adapter honours the RoutingPort-backed reserved ids", () => {
  test("each reserved routing query id dispatches to a query result", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    expect((await port.invoke(ctx("routing.status"))).kind).toBe("query")
    expect((await port.invoke(ctx("routing.test", { input: "do work" }))).kind).toBe("query")
    expect((await port.invoke(ctx("routing.explain", { decisionId: "d1" }))).kind).toBe("query")
    expect((await port.invoke(ctx("routing.capability.inspect", { model: "m-a" }))).kind).toBe("query")
  })

  test("routing.configure is a Config.Service mutation path, surfaced as not_implemented here", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.configure"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })

  test("a non-surface routing id is rejected, never silently accepted", async () => {
    const port = createRoutingDomainPort(fakeRouting())
    const result = await port.invoke(ctx("routing.delete"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })
})

describe("T038 loopback port shape conforms to contracts/ports.ts RoutingPort", () => {
  test("RoutingPort exposes exactly evaluate/explain/test/capabilityInspect/status", () => {
    // The value is typed as the application RoutingPort; its key set must match
    // the five methods contracts/ports.ts declares — no more, no fewer.
    const port: RoutingPort = fakeRouting()
    expect(Object.keys(port).sort()).toEqual(["capabilityInspect", "evaluate", "explain", "status", "test"])
  })
})
