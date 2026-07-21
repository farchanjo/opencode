/**
 * Feature 042 / Phase 2 — session-local hierarchy dispatch resolver tests.
 *
 * Drives `createHierarchyDispatchResolver` over fake Config / Provider / Auth
 * service interfaces (each method returns a plain `Effect`, so the resolver's
 * captured-context runner executes on the default runtime — no `InstanceRef`
 * needed) and the REAL pure `HierarchyDispatcher` engine. Proves: the activation
 * gate (disabled default → undefined, back-compat), a fresh per-spawn decision
 * (role + authenticated model, NOT parent inheritance), the classifier boundary
 * (single-domain → Worker; cross-domain fan-out → Manager), the legality /
 * depth blocks (typed outcomes), the `orchestration_only` execution boundary,
 * the `recordDispatch` lineage correlation, the unauthenticated-model fallback,
 * the explicit/agent-pinned short-circuit guard, and the hang-proof timeout.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import {
  createHierarchyDispatchResolver,
  classifyChildRole,
  poolModelsForRole,
  resolveRoleModel,
  parentRoleForSpawn,
  recordHierarchyDispatch,
  escalateWorkerToManager,
  shouldConsultHierarchy,
  type HierarchyResolveDeps,
  type ResolveHierarchyDispatchInput,
} from "@/session/routing-hierarchy"
import type { ResolvedRoutingModel } from "@/session/routing-resolve"
import {
  isOrchestrationAllowedTool,
  orchestrationChildToolRules,
  reconcileDepthCeiling,
} from "@/tool/task"
import { Permission } from "@/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { createRoutingSessionStateStore } from "@/session/routing-state"
import type { SessionID } from "@/session/schema"

function routingConfig(overrides: {
  readonly enabled: boolean
  readonly mode: RoutingConfig.Info["activation"]["mode"]
  readonly rolePools: Record<string, ReadonlyArray<string>>
  readonly maxDepth?: 1 | 2
  readonly orchestrationOnly?: boolean
  readonly decisionPool?: ReadonlyArray<string>
  readonly floorRole?: string
}): RoutingConfig.Info {
  return {
    activation: { enabled: overrides.enabled, mode: overrides.mode, strict_gates: true },
    models: {
      decision_model: { pool: (overrides.decisionPool ?? ["architect"]) as never },
      role_pools: overrides.rolePools as never,
      fallback: { floor_role: overrides.floorRole ?? "worker" },
    },
    enforcement: {
      capability: { metadata_source: "catalog", unknown_policy: "deny", probing_enabled: false },
      budget: {
        limits: {
          max_turns: 10,
          max_context_tokens: 200_000,
          max_context_bytes: 800_000,
          max_output_tokens: 8_000,
          max_output_bytes: 32_000,
        },
        concurrency: { max_workers: 4, max_delegation_depth: 2 },
        retrieval: { retrieval_top_k: 8, rerank_top_k: 4, max_skill_chunks: 8, max_skill_tokens: 4_000 },
        cost: { time_budget_ms: 60_000, cost_budget_usd: 10, token_budget: 1_000_000 },
        resilience: { retry_depth: 2, validation_depth: 1, escalation_threshold: "manual_review" },
      },
      hierarchy: { max_depth: overrides.maxDepth ?? 2, orchestration_only: overrides.orchestrationOnly ?? true },
    },
  }
}

function configRoot(config: RoutingConfig.Info | null): Record<string, unknown> {
  if (!config) return { operator: { authorities: {} } }
  return { operator: { authorities: { routing: { version: "cas_v1", payload: config, updatedAtMs: 1 } } } }
}

interface Fakes {
  readonly authProviders?: ReadonlyArray<string>
  readonly providerModels?: Record<
    string,
    ReadonlyArray<{ readonly id: string; readonly status?: string; readonly tools?: boolean; readonly enabled?: boolean }>
  >
}

function deps(config: RoutingConfig.Info | null, fakes: Fakes = {}): HierarchyResolveDeps {
  const authed = new Set(fakes.authProviders ?? ["anthropic"])
  const providerModels = fakes.providerModels ?? { anthropic: [{ id: "worker-model" }, { id: "manager-model" }] }
  const providers = Object.fromEntries(
    Object.entries(providerModels).map(([providerID, models]) => [
      providerID,
      {
        models: Object.fromEntries(
          models.map((m) => [
            m.id,
            {
              id: m.id,
              providerID,
              status: m.status ?? "active",
              enabled: m.enabled ?? true,
              capabilities: { toolcall: m.tools ?? true },
            },
          ]),
        ),
      },
    ]),
  )
  return {
    config: {
      get: () => Effect.succeed(configRoot(config)),
      getGlobal: () => Effect.succeed({ operator: { authorities: {} } }),
    },
    provider: { list: () => Effect.succeed(providers) },
    auth: { get: (providerID) => Effect.succeed(authed.has(providerID) ? { type: "api", key: "x" } : undefined) },
  }
}

let spawnSeq = 0
function input(overrides: Partial<ResolveHierarchyDispatchInput> = {}): ResolveHierarchyDispatchInput {
  return {
    parentSessionId: "ses_parent",
    parentRole: "architect",
    parentDepth: 0,
    taskText: "add a small helper function",
    scope: "session",
    spawnKey: `spawn_${spawnSeq++}`,
    ...overrides,
  }
}

const CROSS_DOMAIN = "add an api endpoint and a database migration"

describe("createHierarchyDispatchResolver — activation gate (back-compat)", () => {
  test("disabled default (mode never) → undefined (parent inheritance unchanged)", async () => {
    const resolve = createHierarchyDispatchResolver(deps(routingConfig({ enabled: false, mode: "never", rolePools: {} })))
    expect(await Effect.runPromise(resolve(input()))).toBeUndefined()
  })

  test("enabled but not auto (mode never) → undefined", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "never", rolePools: { worker: ["worker-model"] } })),
    )
    expect(await Effect.runPromise(resolve(input()))).toBeUndefined()
  })

  test("no config document at all → undefined (safe default)", async () => {
    const resolve = createHierarchyDispatchResolver(deps(null))
    expect(await Effect.runPromise(resolve(input()))).toBeUndefined()
  })
})

describe("createHierarchyDispatchResolver — fresh per-spawn decision", () => {
  test("enabled + auto, architect parent, single-domain → direct Worker + authenticated model", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"] } })),
    )
    const out = await Effect.runPromise(resolve(input()))
    expect(out?.kind).toBe("route")
    if (out?.kind !== "route") throw new Error("expected route")
    expect(out.childRole).toBe("worker")
    expect(out.childDepth).toBe(1)
    expect(out.executionAllowed).toBe(true) // a Worker leaf carries execution authority
    expect(out.model).toEqual({ providerID: "anthropic", modelID: "worker-model" } as never)
    expect(out.lineageStub).toEqual({ parent_session_id: "ses_parent", parent_role: "architect", child_role: "worker" })
  })

  test("cross-domain fan-out → Manager child from role_pools.manager (orchestration-only)", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"], manager: ["manager-model"] } })),
    )
    const out = await Effect.runPromise(resolve(input({ taskText: CROSS_DOMAIN })))
    if (out?.kind !== "route") throw new Error("expected route")
    expect(out.childRole).toBe("manager")
    expect(out.model).toEqual({ providerID: "anthropic", modelID: "manager-model" } as never)
    expect(out.executionAllowed).toBe(false) // orchestration_only: a Manager child cannot mutate
  })

  test("orchestration_only=false → a Manager child still carries execution authority", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(
        routingConfig({
          enabled: true,
          mode: "auto",
          orchestrationOnly: false,
          rolePools: { worker: ["worker-model"], manager: ["manager-model"] },
        }),
      ),
    )
    const out = await Effect.runPromise(resolve(input({ taskText: CROSS_DOMAIN })))
    if (out?.kind !== "route") throw new Error("expected route")
    expect(out.childRole).toBe("manager")
    expect(out.executionAllowed).toBe(true)
  })

  test("a Manager parent forces a Worker child (never Manager→Manager) and is a legal edge", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"] } })),
    )
    const out = await Effect.runPromise(resolve(input({ parentRole: "manager", parentDepth: 1, taskText: CROSS_DOMAIN })))
    if (out?.kind !== "route") throw new Error("expected route")
    expect(out.childRole).toBe("worker")
    expect(out.childDepth).toBe(2)
  })
})

describe("createHierarchyDispatchResolver — legality + depth blocks (typed outcomes)", () => {
  test("a Worker parent delegates to a PEER Worker → undefined, model-pinning independent (fix #4)", async () => {
    // Leaf-delegation legality no longer depends on whether a model is pinned. A
    // Worker parent never hard-throws: it degrades to ordinary parent-model
    // inheritance (a peer Worker), the SAME outcome a pinned spawn reaches by
    // skipping the resolver — so the gate is identical with and without a model.
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"] } })),
    )
    const unpinned = await Effect.runPromise(resolve(input({ parentRole: "worker", parentDepth: 1 })))
    expect(unpinned).toBeUndefined()
    // A pinned spawn skips the resolver via the consult guard — the same result.
    expect(shouldConsultHierarchy(false, true)).toBe(false)
  })

  test("depth over the engine invariant → depth_exceeded block (Manager at depth 2 → child depth 3)", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"] } })),
    )
    const out = await Effect.runPromise(resolve(input({ parentRole: "manager", parentDepth: 2 })))
    if (out?.kind !== "blocked") throw new Error("expected blocked")
    expect(out.rejection.reason).toBe("depth_exceeded")
  })

  test("config max_depth=1 is the stricter ceiling → depth_exceeded at child depth 2 (FR-B3)", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", maxDepth: 1, rolePools: { worker: ["worker-model"] } })),
    )
    const out = await Effect.runPromise(resolve(input({ parentRole: "architect", parentDepth: 1 })))
    if (out?.kind !== "blocked") throw new Error("expected blocked")
    expect(out.rejection.reason).toBe("depth_exceeded")
  })
})

describe("createHierarchyDispatchResolver — model resolution fallbacks", () => {
  test("unauthenticated routed model → undefined (parent inheritance, never a block)", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"] } }), { authProviders: [] }),
    )
    expect(await Effect.runPromise(resolve(input()))).toBeUndefined()
  })

  test("empty role pool for the classified child role → undefined", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: {} })),
    )
    expect(await Effect.runPromise(resolve(input()))).toBeUndefined()
  })

  test("model absent from the live catalog → undefined", async () => {
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["ghost-model"] } })),
    )
    expect(await Effect.runPromise(resolve(input()))).toBeUndefined()
  })
})

describe("createHierarchyDispatchResolver — hang-proofing", () => {
  test("a config read that never settles → undefined within the timeout (never hangs)", async () => {
    const base = deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"] } }))
    const hanging: HierarchyResolveDeps = {
      ...base,
      config: { get: () => Effect.promise(() => new Promise<never>(() => {})), getGlobal: base.config.getGlobal },
    }
    const resolve = createHierarchyDispatchResolver(hanging)
    const start = Date.now()
    const out = await Effect.runPromise(resolve(input()))
    const elapsed = Date.now() - start
    expect(out).toBeUndefined()
    expect(elapsed).toBeGreaterThanOrEqual(1000)
    expect(elapsed).toBeLessThan(4000)
  }, 8000)
})

describe("classifyChildRole — the Architect classifier boundary", () => {
  test("single-domain, low-parallelism task → direct Worker", () => {
    expect(classifyChildRole("architect", "add a small helper function", "session").childRole).toBe("worker")
  })

  test("≥2 work-units across ≥2 domains → Manager", () => {
    expect(classifyChildRole("architect", CROSS_DOMAIN, "session").childRole).toBe("manager")
  })

  test("a non-architect (manager) parent always forces a Worker child", () => {
    expect(classifyChildRole("manager", CROSS_DOMAIN, "session").childRole).toBe("worker")
  })
})

describe("poolModelsForRole — role → pool mapping (Decision #2)", () => {
  const cfg = routingConfig({
    enabled: true,
    mode: "auto",
    decisionPool: ["architect"],
    rolePools: { architect: ["arch-model"], manager: ["mgr-model"], worker: ["wk-model"] },
  })
  test("worker → role_pools.worker; manager → role_pools.manager", () => {
    expect(poolModelsForRole(cfg, "worker")).toEqual(["wk-model"])
    expect(poolModelsForRole(cfg, "manager")).toEqual(["mgr-model"])
  })
  test("architect POOL FALLBACK → role_pools[decision_model.pool[0]] (below the main-context model)", () => {
    // The architect pool is the CONFIGURABLE FALLBACK tier only (Feature 042 /
    // ADR-0042). The primary tier — the main-context model — is applied above this
    // in `resolveRoleModel`, not here. This asserts only the fallback pool mapping.
    expect(poolModelsForRole(cfg, "architect")).toEqual(["arch-model"])
  })
  test("missing pool falls back to the floor role", () => {
    const floored = routingConfig({ enabled: true, mode: "auto", floorRole: "worker", rolePools: { worker: ["wk-model"] } })
    expect(poolModelsForRole(floored, "manager")).toEqual(["wk-model"])
  })
  test("role_pools is a GENERIC record — architect is not special-cased vs an arbitrary role", () => {
    // `architect` resolves through the same generic `role_pools[role]` lookup as
    // any other configurable role (e.g. a hypothetical custom role), proving it is
    // a first-class, settable role pool — not a hard-coded name.
    const generic = routingConfig({
      enabled: true,
      mode: "auto",
      decisionPool: ["architect"],
      floorRole: "worker",
      rolePools: { architect: ["arch-model"], worker: ["wk-model"] },
    })
    expect(poolModelsForRole(generic, "architect")).toEqual(["arch-model"])
    // A role with no pool of its own falls through to the floor role, identical
    // handling regardless of the role name.
    expect(poolModelsForRole(generic, "manager")).toEqual(["wk-model"])
  })
})

describe("resolveRoleModel — Architect precedence (main-context ▶ pool ▶ floor, ADR-0042)", () => {
  // Drive the exported model-resolution helper directly over the same Provider /
  // Auth fakes as the resolver. `run` executes each fake Effect on the default
  // runtime (the fakes need no InstanceRef). This is a DELIBERATE, documented
  // behavior change: the Architect is the main-context selected model FIRST; the
  // routing engine never overrides it, and role_pools.architect is a fallback only.
  const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromise(effect)
  const MAIN_CONTEXT: ResolvedRoutingModel = { providerID: "anthropic", modelID: "main-ctx-model" } as never

  const cfg = routingConfig({
    enabled: true,
    mode: "auto",
    decisionPool: ["architect"],
    floorRole: "worker",
    rolePools: { architect: ["arch-model"], manager: ["mgr-model"], worker: ["wk-model"] },
  })
  const fakes = {
    providerModels: {
      anthropic: [
        { id: "main-ctx-model" },
        { id: "arch-model" },
        { id: "mgr-model" },
        { id: "wk-model" },
      ],
    },
  }

  test("Architect WITH a main-context model → that model is used, NOT role_pools.architect", async () => {
    const d = deps(cfg, fakes)
    const out = await resolveRoleModel(cfg, "architect", MAIN_CONTEXT, d, run)
    expect(out).toEqual(MAIN_CONTEXT)
    // Proven distinct from the pool: the architect pool would have yielded arch-model.
    expect(out?.modelID).not.toBe("arch-model")
  })

  test("Architect with NO main-context model → falls back to role_pools.architect", async () => {
    const d = deps(cfg, fakes)
    const out = await resolveRoleModel(cfg, "architect", undefined, d, run)
    expect(out).toEqual({ providerID: "anthropic", modelID: "arch-model" } as never)
  })

  test("Architect with NO main-context model AND no architect pool → falls back to the floor role", async () => {
    const floored = routingConfig({
      enabled: true,
      mode: "auto",
      decisionPool: ["architect"],
      floorRole: "worker",
      rolePools: { worker: ["wk-model"] },
    })
    const out = await resolveRoleModel(floored, "architect", undefined, deps(floored, fakes), run)
    expect(out).toEqual({ providerID: "anthropic", modelID: "wk-model" } as never)
  })

  test("Manager / Worker IGNORE the main-context model → resolve from their own pools (unchanged)", async () => {
    const d = deps(cfg, fakes)
    // Even when a main-context model is passed, Manager/Worker take their own pool.
    expect(await resolveRoleModel(cfg, "manager", MAIN_CONTEXT, d, run)).toEqual({
      providerID: "anthropic",
      modelID: "mgr-model",
    } as never)
    expect(await resolveRoleModel(cfg, "worker", MAIN_CONTEXT, d, run)).toEqual({
      providerID: "anthropic",
      modelID: "wk-model",
    } as never)
  })

  test("Architect main-context model is returned even if its provider is UNauthenticated (it is the live running model)", async () => {
    // The main-context model is the model the primary session is already running
    // as — it is trusted and never re-verified, so an unauthenticated-provider
    // read cannot demote the Architect to the pool.
    const out = await resolveRoleModel(cfg, "architect", MAIN_CONTEXT, deps(cfg, { ...fakes, authProviders: [] }), run)
    expect(out).toEqual(MAIN_CONTEXT)
  })

  test("Manager/Worker pool model with NO provider auth → undefined (parent inheritance, unchanged)", async () => {
    const out = await resolveRoleModel(cfg, "worker", undefined, deps(cfg, { ...fakes, authProviders: [] }), run)
    expect(out).toBeUndefined()
  })
})

describe("recordHierarchyDispatch — lineage correlation (FR-D1)", () => {
  test("records the parent↔child correlation on the shared store with the child role", () => {
    const store = createRoutingSessionStateStore()
    recordHierarchyDispatch(store, "ses_child", {
      parent_session_id: "ses_parent",
      parent_role: "architect",
      child_role: "worker",
    })
    const state = store.get("ses_child" as SessionID)
    expect(state.parentSessionId).toBe("ses_parent" as SessionID)
    expect(state.hierarchyRole).toBe("worker")
  })

  test("a mismatched child lineage is a no-op (state unchanged)", () => {
    const store = createRoutingSessionStateStore()
    const { correlation } = store.recordDispatch("ses_x" as SessionID, {
      parent_session_id: "ses_parent" as never,
      child_session_id: "ses_other" as never,
      parent_role: "architect",
      child_role: "worker",
    })
    expect(correlation.ok).toBe(false)
    expect(store.get("ses_x" as SessionID).parentSessionId).toBeNull()
  })

  test("a recorded child role is read back as the parent role of ITS next spawn", () => {
    const store = createRoutingSessionStateStore()
    recordHierarchyDispatch(store, "ses_mgr", {
      parent_session_id: "ses_root",
      parent_role: "architect",
      child_role: "manager",
    })
    const nextParentRole: Enums.HierarchyRole = store.get("ses_mgr" as SessionID).hierarchyRole ?? "architect"
    expect(nextParentRole).toBe("manager")
  })
})

describe("spawn-seam precedence + escalation + tool-gating", () => {
  test("shouldConsultHierarchy: explicit or agent-pinned model short-circuits the resolver", () => {
    expect(shouldConsultHierarchy(true, false)).toBe(false) // explicit task.model wins
    expect(shouldConsultHierarchy(false, true)).toBe(false) // agent-pinned model wins
    expect(shouldConsultHierarchy(false, false)).toBe(true) // implicit default → consult
  })

  test("escalateWorkerToManager reuses lineage/evidence/OutputRefs (planEscalation call site)", () => {
    const lineage = {
      parent_session_id: "ses_parent" as never,
      child_session_id: "ses_worker" as never,
      parent_role: "architect" as const,
      child_role: "worker" as const,
    }
    const plan = escalateWorkerToManager({
      workerSessionId: "ses_worker",
      reason: "needs coordination",
      evidenceRefs: ["ev1"],
      outputRefs: ["out1"],
      lineage,
    })
    expect(plan.event.reclassified_to).toBe("manager")
    expect(plan.reusedEvidence).toEqual(["ev1"])
    expect(plan.reusedOutputRefs).toEqual(["out1"])
    expect(plan.lineage).toBe(lineage)
  })

  test("isOrchestrationAllowedTool allows read-only/planning/delegation, denies everything else", () => {
    for (const allowed of ["read", "grep", "glob", "lsp", "webfetch", "websearch", "question", "skill", "task", "todowrite"]) {
      expect(isOrchestrationAllowedTool(allowed)).toBe(true)
    }
    for (const denied of ["edit", "write", "apply_patch", "bash", "execute"]) {
      expect(isOrchestrationAllowedTool(denied)).toBe(false)
    }
  })
})

describe("orchestration-only tool boundary — FAIL CLOSED via allowlist (fix #1)", () => {
  // The child session's effective ruleset is `merge(agentPermission, sessionPermission)`
  // (see session/tools.ts); `Permission.evaluate` is last-match-wins with an "ask"
  // default. The orchestration rules are appended LAST so they win.
  const childRuleset = (agentPermission: PermissionV1.Rule[] = []) =>
    Permission.merge(agentPermission, orchestrationChildToolRules() as PermissionV1.Rule[])

  test("an allowlisted tool (read / task) is permitted for a non-Worker child", () => {
    const ruleset = childRuleset()
    expect(Permission.evaluate("read", "*", ruleset).action).toBe("allow")
    expect(Permission.evaluate("task", "sub-agent", ruleset).action).toBe("allow")
    expect(Permission.evaluate("todowrite", "*", ruleset).action).toBe("allow")
  })

  test("a builtin mutating tool (edit / bash / execute) is denied for a non-Worker child", () => {
    const ruleset = childRuleset()
    for (const tool of ["edit", "write", "apply_patch", "bash", "execute"]) {
      expect(Permission.evaluate(tool, "*", ruleset).action).toBe("deny")
    }
  })

  test("a SAMPLED MCP / custom / dynamic mutating tool NOT in the 10-id list is denied BY CONSTRUCTION", () => {
    const ruleset = childRuleset()
    // None of these are enumerated anywhere — they fall through to the catch-all deny.
    for (const tool of ["mcp_github_create_issue", "customplugin_delete_repo", "some_future_write_tool", "postgres_execute_sql"]) {
      expect(Permission.evaluate(tool, "*", ruleset).action).toBe("deny")
    }
  })

  test("a self-granted mutating permission on the child agent cannot re-open the boundary", () => {
    // Even if the agent grants itself `edit`, the trailing catch-all deny wins.
    const ruleset = childRuleset([{ permission: "edit", pattern: "*", action: "allow" }])
    expect(Permission.evaluate("edit", "*", ruleset).action).toBe("deny")
  })
})

describe("parentRoleForSpawn — role mis-seeding fix (#2)", () => {
  test("the genuine root session (no parent) with no recorded role → architect", () => {
    expect(parentRoleForSpawn(null, true)).toBe("architect")
  })

  test("an intermediate session (has a parent) with no recorded role → SAFE LEAF worker, never architect", () => {
    // A pinned-model / explicit-`task.model` child skips the resolver and is never
    // recorded; its own implicit spawn must NOT treat it as a fresh Architect root.
    expect(parentRoleForSpawn(null, false)).toBe("worker")
  })

  test("a recorded role always wins over the default (root or not)", () => {
    expect(parentRoleForSpawn("manager", true)).toBe("manager")
    expect(parentRoleForSpawn("worker", false)).toBe("worker")
  })

  test("a pinned-model child that spawns implicitly is gated as a worker-descendant, not a fresh tree", async () => {
    // The pinned child was never recorded on the store → its next implicit spawn
    // seeds parentRole=worker (fix #2), and a Worker parent degrades to a peer
    // Worker (fix #4) instead of re-opening the whole delegation tree.
    const store = createRoutingSessionStateStore()
    const parentRole = parentRoleForSpawn(store.get("ses_pinned_child" as SessionID).hierarchyRole, false)
    expect(parentRole).toBe("worker")
    const resolve = createHierarchyDispatchResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["worker-model"] } })),
    )
    const grandchild = await Effect.runPromise(resolve(input({ parentRole, parentDepth: 1 })))
    expect(grandchild).toBeUndefined() // peer-worker inheritance, not a new orchestration tree
  })
})

describe("reconcileDepthCeiling — legacy backstop ⋀ hierarchy max_depth (FR-E3, FR-B3)", () => {
  test("hierarchy inactive (undefined) → the legacy ceiling is unchanged", () => {
    expect(reconcileDepthCeiling(1, undefined)).toBe(1)
    expect(reconcileDepthCeiling(5, undefined)).toBe(5)
  })

  test("hierarchy active → the MIN of the two (a config can never widen delegation)", () => {
    expect(reconcileDepthCeiling(5, 2)).toBe(2)
    expect(reconcileDepthCeiling(1, 2)).toBe(1)
    expect(reconcileDepthCeiling(2, 2)).toBe(2)
  })
})
