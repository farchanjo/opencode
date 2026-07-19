/**
 * Feature 013 / T007 + T015 — budget domain stack acceptance.
 *
 * The `budget.*` operator surface reads and mutates `RoutingConfig.Enforcement.budget`
 * over the SAME Config.Service seam langlock uses. Asserts: `show` projects the
 * effective bounded limits view; `planSet`/`planReset` VALIDATE and return an
 * `OperatorMutationPlan` (scoped routing authority + pure transform) the dispatcher
 * commits — the backend never self-commits; `validate` mutates nothing; a
 * config-unreachable read/plan degrades to `unavailable`; and the default ceiling is
 * never silently relaxed (FR4, FR7, FR8). End-to-end CAS commit + conflict is proved
 * through the full dispatcher in `feature013-wire.test.ts`.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createMemoryConfigPort } from "@/operator/adapters"
import { INITIAL_CONFIG_VERSION, type ConfigPort } from "@/operator/application/ports/config-port"
import { DEFAULT_ROUTING_CONFIG } from "@/routing/adapters/outbound/config-adapter"
import { BudgetBackendLive } from "@/operator/budget/backend-live"
import { BudgetStackWiring } from "@/operator/budget/stack-wiring"
import type { BudgetLimitsView } from "@opencode-ai/protocol/budget/commands"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

const DEFAULT_BUDGET = DEFAULT_ROUTING_CONFIG.enforcement.budget
const CEILING: BudgetLimitsView = {
  maxTurns: DEFAULT_BUDGET.limits.max_turns,
  maxContextTokens: DEFAULT_BUDGET.limits.max_context_tokens,
  maxOutputTokens: DEFAULT_BUDGET.limits.max_output_tokens,
  maxWorkers: DEFAULT_BUDGET.concurrency.max_workers,
  tokenBudget: DEFAULT_BUDGET.cost.token_budget,
}

/** A limits view strictly tighter than the default ceiling. */
const tighter: BudgetLimitsView = {
  maxTurns: 5,
  maxContextTokens: 100_000,
  maxOutputTokens: 4_000,
  maxWorkers: 2,
  tokenBudget: 500_000,
}

const principal = { kind: "operator", id: "op-1" } as const

const backendOf = (config: ConfigPort) => BudgetBackendLive.createLiveBudgetBackend({ config })

const budgetOf = (payload: unknown) => (payload as RoutingConfig.Info).enforcement.budget

/** Run an effect expected to fail and return its typed error. */
const runError = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff))

/** A ConfigPort whose reads/writes always reject — simulates a Config.Service outage. */
const brokenConfigPort = (): ConfigPort => ({
  get: () => Promise.reject(new Error("config unreachable")),
  compareAndSet: () => Promise.reject(new Error("config unreachable")),
  snapshot: () => Promise.reject(new Error("config unreachable")),
  listSnapshots: () => Promise.reject(new Error("config unreachable")),
  pruneSnapshots: () => Promise.reject(new Error("config unreachable")),
  restoreSnapshot: () => Promise.reject(new Error("config unreachable")),
})

describe("budget backend — reads", () => {
  test("show projects the effective default ceiling and reports an unconfigured scope", async () => {
    const backend = backendOf(createMemoryConfigPort())
    const summary = await Effect.runPromise(backend.resolve({ scope: "project" }))
    expect(summary.limits).toEqual(CEILING)
    expect(summary.configured).toBe(false)
    expect(summary.available).toBe(true)
    expect(summary.valid).toBe(true)
    expect(summary.version).toBe(INITIAL_CONFIG_VERSION)
  })
})

describe("budget backend — mutation plans", () => {
  test("planSet targets the project routing authority and its apply tightens the budget (nothing persisted)", async () => {
    const config = createMemoryConfigPort()
    const backend = backendOf(config)
    const plan = await Effect.runPromise(
      backend.planSet({ scope: "project", limits: tighter, expectedVersion: INITIAL_CONFIG_VERSION, principal }),
    )
    expect(plan.authority).toBe("routing")
    expect(await config.get("routing")).toBeNull()
    expect(budgetOf(plan.apply(null)).limits.max_turns).toBe(tighter.maxTurns)
    expect(budgetOf(plan.apply(null)).concurrency.max_workers).toBe(tighter.maxWorkers)
  })

  test("planReset apply reverts the budget to the default ceiling", async () => {
    const backend = backendOf(createMemoryConfigPort())
    const plan = await Effect.runPromise(backend.planReset({ scope: "project", expectedVersion: INITIAL_CONFIG_VERSION, principal }))
    expect(budgetOf(plan.apply(null)).limits.max_turns).toBe(CEILING.maxTurns)
  })
})

describe("budget backend — ceiling never relaxed", () => {
  test("a set that exceeds the default ceiling degrades to invalid_argument without a plan or write", async () => {
    const config = createMemoryConfigPort()
    const backend = backendOf(config)
    const relaxed: BudgetLimitsView = { ...tighter, maxTurns: CEILING.maxTurns + 1 }
    const error = await runError(
      backend.planSet({ scope: "project", limits: relaxed, expectedVersion: INITIAL_CONFIG_VERSION, principal }),
    )
    expect(error.type).toBe("invalid_argument")
    if (error.type === "invalid_argument") expect(error.field).toBe("maxTurns")
    expect(await config.get("routing")).toBeNull()
  })

  test("a non-positive limit degrades to invalid_argument", async () => {
    const backend = backendOf(createMemoryConfigPort())
    const exit = await Effect.runPromiseExit(
      backend.planSet({ scope: "project", limits: { ...tighter, maxWorkers: 0 }, expectedVersion: INITIAL_CONFIG_VERSION, principal }),
    )
    expect(exit._tag).toBe("Failure")
  })
})

describe("budget backend — validate is non-mutating", () => {
  test("validate reports validity and leaves the scope untouched", async () => {
    const config = createMemoryConfigPort()
    const backend = backendOf(config)
    const result = await Effect.runPromise(backend.validate({ scope: "project" }))
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.limits).toEqual(CEILING)

    const summary = await Effect.runPromise(backend.resolve({ scope: "project" }))
    expect(summary.configured).toBe(false)
  })
})

describe("budget backend — honest degradation", () => {
  test("a config-unreachable read degrades to unavailable", async () => {
    const error = await runError(backendOf(brokenConfigPort()).resolve({ scope: "project" }))
    expect(error.type).toBe("unavailable")
  })

  test("a config-unreachable mutation plan degrades to unavailable", async () => {
    const error = await runError(
      backendOf(brokenConfigPort()).planSet({ scope: "project", limits: tighter, expectedVersion: INITIAL_CONFIG_VERSION, principal }),
    )
    expect(error.type).toBe("unavailable")
  })
})

describe("budget command port — full stack dispatch", () => {
  const audited: string[] = []
  const wiring = BudgetStackWiring.createBudgetDomainWiring({
    backend: backendOf(createMemoryConfigPort()),
    audit: { record: (e) => Effect.sync(() => { audited.push(`${e.commandId}:${e.outcome}`) }) },
  })
  const invoke = wiring.ports.budget.invoke
  const ctx = (id: string, payload: Record<string, unknown> = {}) =>
    ({
      request: { payload, principal: { kind: "operator", subject: "op-1" }, scope: { kind: "project", ref: "proj-1" }, source: "cli" },
      descriptor: { id, domain: "budget" },
    }) as never

  test("status and show dispatch to a query result", async () => {
    const status = await invoke(ctx("budget.status"))
    expect(status.kind).toBe("query")
    const show = await invoke(ctx("budget.show"))
    expect(show.kind).toBe("query")
  })

  test("set with a complete limits payload returns a mutation_plan (no phantom success audit)", async () => {
    audited.length = 0
    const result = await invoke(ctx("budget.set", { limits: tighter, expectedVersion: INITIAL_CONFIG_VERSION }))
    expect(result.kind).toBe("mutation_plan")
    if (result.kind === "mutation_plan") expect(result.authority).toBe("routing")
    expect(audited).toEqual([])
  })

  test("set without limits is invalid_argument", async () => {
    const result = await invoke(ctx("budget.set", { expectedVersion: INITIAL_CONFIG_VERSION }))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("invalid_argument")
  })

  test("an unknown budget verb is not_implemented", async () => {
    const result = await invoke(ctx("budget.bogus"))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("not_implemented")
  })
})
