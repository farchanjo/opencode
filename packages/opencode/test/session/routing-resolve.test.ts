/**
 * Feature 037 / Phase 1 — session-local Smart Routing resolver tests.
 *
 * Drives `createRoutingResolver` over fake Config / Provider / Agent / Auth
 * service interfaces (each method returns a plain `Effect`, so the resolver's
 * captured-context runner executes on the default runtime — no `InstanceRef`
 * needed for the fakes). Proves the gate, the end-to-end engine selection, the
 * unauthenticated-provider fallback, the empty-role-pool fallback, provider
 * re-resolution determinism, and the per-session drift cache.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import {
  createRoutingResolver,
  createRoutingActivationReader,
  shouldConsultRouting,
  sessionConfigReadPort,
  createBoundedLru,
  type RoutingResolveDeps,
} from "@/session/routing-resolve"
import { createConfigAdapter, AUTHORITY } from "@/routing/adapters/outbound/config-adapter"
import type { DecisionStore } from "@/routing/application/ports"
import type { Decision } from "@opencode-ai/schema/routing/decision"

// In-memory decision store so the resolver never touches the filesystem.
function memoryDecisionStore(): DecisionStore {
  const byId = new Map<string, Decision.RoutingDecision>()
  return {
    commit: async (decision) => {
      byId.set(decision.id, decision)
      return decision
    },
    findById: async (id) => byId.get(id) ?? null,
  }
}

function routingConfig(overrides: {
  readonly enabled: boolean
  readonly mode: RoutingConfig.Info["activation"]["mode"]
  readonly rolePools: Record<string, ReadonlyArray<string>>
}): RoutingConfig.Info {
  return {
    activation: { enabled: overrides.enabled, mode: overrides.mode, strict_gates: true },
    models: {
      decision_model: { pool: ["worker"] },
      role_pools: overrides.rolePools as never,
      fallback: { floor_role: "worker" },
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
      hierarchy: { max_depth: 2, orchestration_only: true },
    },
  }
}

// A config root shaped like the operator durable document
// (`config.operator.authorities["routing"]`).
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

function deps(config: RoutingConfig.Info | null, fakes: Fakes = {}): RoutingResolveDeps {
  const authed = new Set(fakes.authProviders ?? ["anthropic"])
  const providerModels = fakes.providerModels ?? { anthropic: [{ id: "model-a" }] }
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
    agents: { listSpecialists: () => Effect.succeed([{ name: "worker" }]) },
    auth: { get: (providerID) => Effect.succeed(authed.has(providerID) ? { type: "api", key: "x" } : undefined) },
    decisions: memoryDecisionStore(),
  }
}

const INPUT = {
  sessionID: "ses_test_1",
  turnID: "turn_1",
  taskText: "add a small helper function",
  scope: "session" as const,
}

describe("createRoutingResolver — smart routing gate", () => {
  test("smart OFF (disabled, mode never, empty pool) → undefined (back-compat)", async () => {
    const resolve = createRoutingResolver(deps(routingConfig({ enabled: false, mode: "never", rolePools: {} })))
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toBeUndefined()
  })

  test("smart ON (enabled + auto) with a populated pool → routes to the pool model", async () => {
    const resolve = createRoutingResolver(deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["model-a"] } })))
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toEqual({ providerID: "anthropic", modelID: "model-a" } as never)
  })

  test("enabled but mode not auto (enabled + never) → undefined", async () => {
    const resolve = createRoutingResolver(deps(routingConfig({ enabled: true, mode: "never", rolePools: { worker: ["model-a"] } })))
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toBeUndefined()
  })
})

describe("createRoutingResolver — fallbacks", () => {
  test("empty role pool (enabled + auto, no candidates) → undefined (safe fallback)", async () => {
    const resolve = createRoutingResolver(deps(routingConfig({ enabled: true, mode: "auto", rolePools: {} })))
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toBeUndefined()
  })

  test("routed model with NO provider auth → undefined (falls back to static default)", async () => {
    const resolve = createRoutingResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["model-a"] } }), { authProviders: [] }),
    )
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toBeUndefined()
  })

  test("routed model absent from the live catalog → undefined", async () => {
    const resolve = createRoutingResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["ghost-model"] } })),
    )
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toBeUndefined()
  })
})

describe("createRoutingResolver — determinism + drift cache", () => {
  test("multiple providers expose the model → smallest providerID wins (deterministic)", async () => {
    const resolve = createRoutingResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["model-a"] } }), {
        authProviders: ["anthropic", "zed"],
        providerModels: { zed: [{ id: "model-a" }], anthropic: [{ id: "model-a" }] },
      }),
    )
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toEqual({ providerID: "anthropic", modelID: "model-a" } as never)
  })

  test("first resolution is cached and reused for later messages in the same session", async () => {
    let listCalls = 0
    const base = deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["model-a"] } }))
    const counted: RoutingResolveDeps = {
      ...base,
      provider: {
        list: () =>
          Effect.sync(() => {
            listCalls++
            return {
              anthropic: {
                models: { "model-a": { id: "model-a", providerID: "anthropic", status: "active", capabilities: { toolcall: true } } },
              },
            }
          }),
      },
    }
    const resolve = createRoutingResolver(counted)
    const first = await Effect.runPromise(resolve(INPUT))
    const callsAfterFirst = listCalls
    const second = await Effect.runPromise(resolve({ ...INPUT, taskText: "a completely different task" }))
    expect(first).toEqual(second as never)
    expect(listCalls).toBe(callsAfterFirst) // no re-evaluation on the second message
  })
})

describe("createRoutingResolver — hang-proofing (DEFECT 1)", () => {
  // A decision store whose `commit` never settles simulates a stuck/locked
  // `Global.Path.state` filesystem. The resolver must degrade to `undefined`
  // within the timeout instead of blocking the prompt path forever.
  test("a hanging decision commit resolves to undefined within the timeout (never hangs)", async () => {
    const base = deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["model-a"] } }))
    const hanging: RoutingResolveDeps = {
      ...base,
      decisions: {
        commit: () => new Promise<never>(() => {}), // never settles
        findById: async () => null,
      },
    }
    const resolve = createRoutingResolver(hanging)
    const start = Date.now()
    const out = await Effect.runPromise(resolve(INPUT))
    const elapsed = Date.now() - start
    expect(out).toBeUndefined() // degraded to the static default
    expect(elapsed).toBeGreaterThanOrEqual(1000) // actually exercised the timeout race
    expect(elapsed).toBeLessThan(4000) // …but settled — did NOT hang
  }, 8000)
})

describe("createRoutingResolver — bounded retention (DEFECT 2)", () => {
  // Count fresh evaluations via provider.list() calls: a cache HIT short-circuits
  // before any provider.list(), a cache MISS re-runs the full engine. With a cap
  // of 2 we prove the LRU evicts the oldest, an evicted session re-resolves
  // fresh, and a still-cached session is NOT re-evaluated.
  test("drift cache is LRU-bounded: overflow evicts LRU, evicted session re-resolves, cached session does not", async () => {
    let listCalls = 0
    const base = deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["model-a"] } }))
    const counted: RoutingResolveDeps = {
      ...base,
      driftCacheCap: 2,
      provider: {
        list: () =>
          Effect.sync(() => {
            listCalls++
            return {
              anthropic: {
                models: { "model-a": { id: "model-a", providerID: "anthropic", status: "active", capabilities: { toolcall: true } } },
              },
            }
          }),
      },
    }
    const resolve = createRoutingResolver(counted)
    const run = (sessionID: string) => Effect.runPromise(resolve({ ...INPUT, sessionID }))

    await run("ses_a") // miss → cache [a]
    await run("ses_b") // miss → cache [a,b]
    await run("ses_a") // hit → bump a → cache [b,a]

    const beforeCacheHit = listCalls
    await run("ses_a") // still cached → NO new evaluation
    expect(listCalls).toBe(beforeCacheHit)

    await run("ses_c") // miss → insert c, evict LRU (b) → cache [a,c]

    const beforeEvicted = listCalls
    await run("ses_b") // b was evicted → MUST re-resolve fresh
    expect(listCalls).toBeGreaterThan(beforeEvicted)

    const beforeCachedA = listCalls
    // After inserting b, cache is [c,b]; a was evicted when b re-inserted, so a is
    // now also fresh — assert the still-cached MRU entry (b) does not re-evaluate.
    await run("ses_b") // b now cached (MRU) → NO new evaluation
    expect(listCalls).toBe(beforeCachedA)
  })
})

describe("createRoutingResolver — provider eligibility (DEFECT 3)", () => {
  // model-a is served by `aaa` (sorts first, but tools=false + enabled=false → the
  // capability gate would reject it) and by `zzz` (tools=true + enabled=true → the
  // provider that actually backed the authorized candidate). Re-resolution must
  // return `zzz`, not the lexicographically-first `aaa`.
  test("prefers the enabled, tool-capable provider over the lexicographically-first ineligible one", async () => {
    const resolve = createRoutingResolver(
      deps(routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["model-a"] } }), {
        authProviders: ["aaa", "zzz"],
        providerModels: {
          aaa: [{ id: "model-a", tools: false, enabled: false }],
          zzz: [{ id: "model-a", tools: true, enabled: true }],
        },
      }),
    )
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toEqual({ providerID: "zzz", modelID: "model-a" } as never)
  })
})

// =============================================================================
// Feature 045 — always-mode activation. `always` re-evaluates routing on EVERY
// turn (bypasses the drift-cache short-circuit `auto` keeps), so a role/pool
// change takes effect next turn without a new session. `auto`/`never` keep their
// pre-045 behavior; disabled/`never` stay byte-identical to no routing.
// =============================================================================

// A resolver whose provider.list() is counted, so a fresh evaluation (cache MISS
// or an always-mode re-eval) is observable while a cache HIT is not.
function countedResolver(mode: RoutingConfig.Info["activation"]["mode"]) {
  let listCalls = 0
  const base = deps(routingConfig({ enabled: true, mode, rolePools: { worker: ["model-a"] } }))
  const counted: RoutingResolveDeps = {
    ...base,
    provider: {
      list: () =>
        Effect.sync(() => {
          listCalls++
          return {
            anthropic: {
              models: { "model-a": { id: "model-a", providerID: "anthropic", status: "active", capabilities: { toolcall: true } } },
            },
          }
        }),
    },
  }
  return { resolve: createRoutingResolver(counted), calls: () => listCalls }
}

describe("createRoutingResolver — always mode (Feature 045)", () => {
  test("always mode RE-EVALUATES every turn in the same session (no drift-cache short-circuit)", async () => {
    const { resolve, calls } = countedResolver("always")
    const first = await Effect.runPromise(resolve(INPUT))
    const afterFirst = calls()
    const second = await Effect.runPromise(resolve({ ...INPUT, taskText: "a completely different task" }))
    expect(first).toEqual({ providerID: "anthropic", modelID: "model-a" } as never)
    expect(second).toEqual({ providerID: "anthropic", modelID: "model-a" } as never)
    expect(calls()).toBeGreaterThan(afterFirst) // re-evaluated — NOT served from cache
  })

  test("auto mode still SHORT-CIRCUITS on the persisted decision (contrast to always)", async () => {
    const { resolve, calls } = countedResolver("auto")
    await Effect.runPromise(resolve(INPUT))
    const afterFirst = calls()
    await Effect.runPromise(resolve({ ...INPUT, taskText: "a completely different task" }))
    expect(calls()).toBe(afterFirst) // no re-evaluation on the second message
  })

  test("always mode routes like auto on the first turn (superset of auto's aggressiveness)", async () => {
    const resolve = createRoutingResolver(deps(routingConfig({ enabled: true, mode: "always", rolePools: { worker: ["model-a"] } })))
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toEqual({ providerID: "anthropic", modelID: "model-a" } as never)
  })

  test("disabled + always is byte-identical to no routing (enabled:false wins over any mode)", async () => {
    const resolve = createRoutingResolver(deps(routingConfig({ enabled: false, mode: "always", rolePools: { worker: ["model-a"] } })))
    const out = await Effect.runPromise(resolve(INPUT))
    expect(out).toBeUndefined()
  })

  test("always mode inherits the hang-safety fallback (a stuck decision commit degrades to undefined)", async () => {
    const base = deps(routingConfig({ enabled: true, mode: "always", rolePools: { worker: ["model-a"] } }))
    const hanging: RoutingResolveDeps = {
      ...base,
      decisions: { commit: () => new Promise<never>(() => {}), findById: async () => null },
    }
    const resolve = createRoutingResolver(hanging)
    const start = Date.now()
    const out = await Effect.runPromise(resolve(INPUT))
    const elapsed = Date.now() - start
    expect(out).toBeUndefined()
    expect(elapsed).toBeGreaterThanOrEqual(1000)
    expect(elapsed).toBeLessThan(4000)
  }, 8000)
})

describe("createRoutingActivationReader — hang-safe mode read (Feature 045)", () => {
  test("reads the effective activation mode (enabled + always → \"always\")", async () => {
    const read = createRoutingActivationReader({
      config: {
        get: () => Effect.succeed(configRoot(routingConfig({ enabled: true, mode: "always", rolePools: {} }))),
        getGlobal: () => Effect.succeed({ operator: { authorities: {} } }),
      },
    })
    expect(await Effect.runPromise(read())).toBe("always")
  })

  test("a disabled engine collapses to \"never\" regardless of the stored mode", async () => {
    const read = createRoutingActivationReader({
      config: {
        get: () => Effect.succeed(configRoot(routingConfig({ enabled: false, mode: "always", rolePools: {} }))),
        getGlobal: () => Effect.succeed({ operator: { authorities: {} } }),
      },
    })
    expect(await Effect.runPromise(read())).toBe("never")
  })

  test("a config read that DIES degrades to \"never\" (never crashes the prompt path)", async () => {
    const read = createRoutingActivationReader({
      config: {
        get: () => Effect.die(new Error("config unavailable")),
        getGlobal: () => Effect.succeed({ operator: { authorities: {} } }),
      },
    })
    expect(await Effect.runPromise(read())).toBe("never")
  })
})

describe("shouldConsultRouting — session-seam decision (Feature 045)", () => {
  test("an explicit --model / agent-pinned model ALWAYS wins — routing never consulted, even in always mode", () => {
    expect(shouldConsultRouting({ explicitModel: true, hasPersistedModel: false, mode: "always" })).toBe(false)
    expect(shouldConsultRouting({ explicitModel: true, hasPersistedModel: true, mode: "always" })).toBe(false)
    expect(shouldConsultRouting({ explicitModel: true, hasPersistedModel: false, mode: "auto" })).toBe(false)
  })

  test("auto mode: consult on the first turn (no persisted), short-circuit on later turns (persisted)", () => {
    expect(shouldConsultRouting({ explicitModel: false, hasPersistedModel: false, mode: "auto" })).toBe(true)
    expect(shouldConsultRouting({ explicitModel: false, hasPersistedModel: true, mode: "auto" })).toBe(false)
  })

  test("always mode: consult EVERY turn — re-evaluates even when a model is persisted", () => {
    expect(shouldConsultRouting({ explicitModel: false, hasPersistedModel: false, mode: "always" })).toBe(true)
    expect(shouldConsultRouting({ explicitModel: false, hasPersistedModel: true, mode: "always" })).toBe(true)
  })

  test("never mode keeps the persisted-model short-circuit (byte-identical to pre-045)", () => {
    expect(shouldConsultRouting({ explicitModel: false, hasPersistedModel: false, mode: "never" })).toBe(true)
    expect(shouldConsultRouting({ explicitModel: false, hasPersistedModel: true, mode: "never" })).toBe(false)
  })
})

// =============================================================================
// Feature 043 follow-up — the SessionProcessor effective-enforcement memo keys on
// the routing authorities' CAS VERSIONS, not config-object identity. Under the
// deployed global-profile model `Config.getGlobal()` returns a FRESH merged object
// on every call, so an identity guard never hits and `resolveEffective` (schema
// decode + contentHash) would run on every step. This drives the exact resolver
// pattern (real `sessionConfigReadPort` + `createConfigAdapter` + `createBoundedLru`
// + `AUTHORITY`) with a fresh-but-equal getGlobal to prove the memo now hits.
// =============================================================================

describe("SessionProcessor enforcement memo keys on CAS version, not object identity", () => {
  const globalRoot = (version: string) => ({
    operator: {
      authorities: {
        "global:routing": {
          version,
          updatedAtMs: 1,
          payload: routingConfig({ enabled: true, mode: "auto", rolePools: { worker: ["m"] } }),
        },
      },
    },
  })

  // Mirrors SessionProcessor.resolveRoutingEnforcement verbatim (version-keyed memo).
  function makeResolver(getGlobal: () => Record<string, unknown>, onResolve: () => void) {
    const memo = createBoundedLru<{ readonly enabled: boolean }>(1, () => {})
    const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e)
    const readPort = sessionConfigReadPort(
      { get: () => Effect.succeed({ operator: { authorities: {} } }), getGlobal: () => Effect.succeed(getGlobal()) },
      run,
    )
    return async () => {
      const project = await readPort.get(AUTHORITY.project)
      const global = await readPort.get(AUTHORITY.global)
      const key = `${project?.version ?? ""}|${global?.version ?? ""}`
      const cached = memo.get(key)
      if (cached) return cached
      onResolve()
      const effective = await createConfigAdapter({ config: readPort }).resolveEffective()
      const value = { enabled: effective.config.activation.enabled }
      memo.set(key, value)
      return value
    }
  }

  test("a fresh-but-equal global object on each call still HITS the memo (resolveEffective runs once)", async () => {
    let resolves = 0
    let getGlobalCalls = 0
    const resolve = makeResolver(
      () => {
        getGlobalCalls++
        return globalRoot("cas_v1") // a NEW object literal every call (the profile-merge model)
      },
      () => resolves++,
    )
    let last: { enabled: boolean } | undefined
    for (let i = 0; i < 5; i++) last = await resolve()
    expect(getGlobalCalls).toBeGreaterThanOrEqual(5) // getGlobal genuinely returned a fresh object each call
    expect(resolves).toBe(1) // …yet the expensive resolveEffective ran exactly ONCE
    expect(last?.enabled).toBe(true) // and it resolved the operator config correctly
  })

  test("a config change (new CAS version) INVALIDATES the memo (never serves a stale value)", async () => {
    let resolves = 0
    let version = "cas_v1"
    const resolve = makeResolver(() => globalRoot(version), () => resolves++)
    await resolve()
    await resolve()
    expect(resolves).toBe(1) // stable version → one resolve across two calls
    version = "cas_v2" // operator changed the routing config → new CAS version
    await resolve()
    expect(resolves).toBe(2) // invalidated → recomputed exactly once
  })
})
