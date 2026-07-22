import { describe, expect, test } from "bun:test"
import {
  CatalogAdapter,
  createCatalogAdapter,
  createCatalogModelValidator,
  createCandidateSource,
  toCapabilityCatalogRecord,
  type CatalogCandidateService,
  type CatalogModelSnapshot,
} from "@/routing/adapters/outbound/catalog-adapter"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"

function fakeCatalog(models: ReadonlyArray<CatalogModelSnapshot>): CatalogCandidateService {
  return { listModels: async () => models }
}

const GPT: CatalogModelSnapshot = {
  modelId: "gpt-5",
  providerId: "openai",
  status: "active",
  enabled: true,
  tools: true,
}
const CLAUDE: CatalogModelSnapshot = {
  modelId: "claude-sonnet-5",
  providerId: "anthropic",
  status: "active",
  enabled: true,
  tools: true,
}
const OLD: CatalogModelSnapshot = {
  modelId: "gpt-3",
  providerId: "openai",
  status: "deprecated",
  enabled: true,
  tools: false,
}
const OFF: CatalogModelSnapshot = {
  modelId: "beta-model",
  providerId: "openai",
  status: "beta",
  enabled: false,
  tools: true,
}

describe("CatalogAdapter.createCatalogAdapter", () => {
  test("exports the namespace object", () => {
    expect(typeof CatalogAdapter.createCatalogAdapter).toBe("function")
  })

  test("resolveCandidates never invents a model id absent from the live catalog", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([GPT]) })
    const snapshot = await adapter.resolveCandidates(["gpt-5", "does-not-exist"])
    expect(snapshot.candidates).toEqual([
      { modelId: "gpt-5", providerId: "openai", status: "active", healthy: true, reason: null, tools: true },
      { modelId: "does-not-exist", providerId: null, status: null, healthy: false, reason: "not_found_in_catalog", tools: false },
    ])
  })

  test("classifies disabled and deprecated models as unhealthy with a reason", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([OLD, OFF]) })
    const snapshot = await adapter.resolveCandidates(["gpt-3", "beta-model"])
    expect(snapshot.candidates[0]).toMatchObject({ healthy: false, reason: "deprecated" })
    expect(snapshot.candidates[1]).toMatchObject({ healthy: false, reason: "disabled" })
  })

  test("resolveCandidates only ever returns requested ids, listAll returns everything", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([GPT, CLAUDE, OLD]) })
    const scoped = await adapter.resolveCandidates(["gpt-5"])
    expect(scoped.candidates).toHaveLength(1)
    const all = await adapter.listAll()
    expect(all.candidates.map((c) => c.modelId).sort()).toEqual(["claude-sonnet-5", "gpt-3", "gpt-5"])
  })

  test("catalogVersion is a deterministic content hash independent of listModels() iteration order", async () => {
    const a = createCatalogAdapter({ catalog: fakeCatalog([GPT, CLAUDE]) })
    const b = createCatalogAdapter({ catalog: fakeCatalog([CLAUDE, GPT]) })
    expect(await a.catalogVersion()).toBe(await b.catalogVersion())
  })

  test("catalogVersion changes when the live catalog set changes", async () => {
    const before = createCatalogAdapter({ catalog: fakeCatalog([GPT]) })
    const after = createCatalogAdapter({ catalog: fakeCatalog([GPT, CLAUDE]) })
    expect(await before.catalogVersion()).not.toBe(await after.catalogVersion())
  })
})

// Feature 038 — a faithful two-provider catalog: openai serves the bare
// `gpt-5.6-sol-fast`, openrouter re-exposes an openai model as the within-provider
// id `openai/gpt-oss-120b` (its bare id contains a slash).
const SOL: CatalogModelSnapshot = {
  modelId: "gpt-5.6-sol-fast",
  providerId: "openai",
  status: "active",
  enabled: true,
  tools: true,
}
const OSS_ROUTED: CatalogModelSnapshot = {
  modelId: "openai/gpt-oss-120b",
  providerId: "openrouter",
  status: "active",
  enabled: true,
  tools: true,
}

describe("CatalogAdapter — Feature 038 provider-qualified id resolution", () => {
  test("a provider-qualified id resolves to the SAME candidate as its bare id", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([SOL, CLAUDE]) })
    const bare = await adapter.resolveCandidates(["gpt-5.6-sol-fast"])
    const qualified = await adapter.resolveCandidates(["openai/gpt-5.6-sol-fast"])
    // The qualified id NORMALISES to the same bare model id + provider, so the
    // resolved candidate (identity + executor_model source) is identical.
    expect(qualified.candidates[0]).toEqual(bare.candidates[0])
    expect(qualified.candidates[0]).toEqual({
      modelId: "gpt-5.6-sol-fast",
      providerId: "openai",
      status: "active",
      healthy: true,
      reason: null,
      tools: true,
    })
  })

  test("the nested case strips only the first known-provider segment", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([SOL, OSS_ROUTED]) })
    const snapshot = await adapter.resolveCandidates(["openrouter/openai/gpt-oss-120b"])
    // provider `openrouter`, model `openai/gpt-oss-120b` — never provider `openai`.
    expect(snapshot.candidates[0]).toMatchObject({
      modelId: "openai/gpt-oss-120b",
      providerId: "openrouter",
      healthy: true,
    })
  })

  test("a bare within-provider id that contains a slash keeps resolving as bare (back-compat precedence)", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([OSS_ROUTED]) })
    const snapshot = await adapter.resolveCandidates(["openai/gpt-oss-120b"])
    // Bare-first: this matches openrouter's within-provider id, NOT openai — even
    // though the head `openai` is a plausible provider name.
    expect(snapshot.candidates[0]).toMatchObject({ modelId: "openai/gpt-oss-120b", providerId: "openrouter" })
  })

  test("a plain bare id still resolves identically (no regression)", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([SOL]) })
    const snapshot = await adapter.resolveCandidates(["gpt-5.6-sol-fast"])
    expect(snapshot.candidates[0]).toMatchObject({ modelId: "gpt-5.6-sol-fast", providerId: "openai", healthy: true })
  })

  test("a provider-qualified id under an UNKNOWN provider stays unresolved", async () => {
    const adapter = createCatalogAdapter({ catalog: fakeCatalog([SOL]) })
    const snapshot = await adapter.resolveCandidates(["unknown-provider/nope"])
    expect(snapshot.candidates[0]).toMatchObject({ providerId: null, reason: "not_found_in_catalog" })
  })

  test("createCandidateSource resolves a provider-qualified role pool to the same candidate as the bare pool", async () => {
    const cfg = (models: ReadonlyArray<string>): RoutingConfig.Info => ({
      ...CONFIG,
      models: { ...CONFIG.models, decision_model: { pool: ["worker"] }, role_pools: { worker: [...models] } },
    })
    const build = () =>
      createCandidateSource({
        catalog: createCatalogAdapter({ catalog: fakeCatalog([SOL]) }),
        agents: { resolveAgents: async () => [{ agentId: "w", skills: [], effort: "medium", reasoningEffort: "medium" }] },
        now: () => "2026-01-01T00:00:00.000Z",
      })
    const bare = await build().resolve({ routingProfile: "direct_worker", taskClass: "medium", scope: "session", config: cfg(["gpt-5.6-sol-fast"]) })
    const qualified = await build().resolve({ routingProfile: "direct_worker", taskClass: "medium", scope: "session", config: cfg(["openai/gpt-5.6-sol-fast"]) })
    expect(qualified.candidates[0]?.identity).toEqual({ agent_id: "w", model_id: "gpt-5.6-sol-fast" })
    expect(qualified.candidates[0]?.identity).toEqual(bare.candidates[0]?.identity)
    // The normalised decision pool matches the bare candidate id too.
    expect(qualified.decisionPoolModelIds).toEqual(["gpt-5.6-sol-fast"])
  })
})

describe("CatalogAdapter.createCatalogModelValidator — Feature 038", () => {
  test("flags ids that resolve to no catalog model, passes bare + provider-qualified ids that do", async () => {
    const validator = createCatalogModelValidator(createCatalogAdapter({ catalog: fakeCatalog([SOL, OSS_ROUTED]) }))
    const unknown = await validator.unknownModelIds([
      "gpt-5.6-sol-fast",
      "openai/gpt-5.6-sol-fast",
      "openrouter/openai/gpt-oss-120b",
      "unknown-provider/nope",
      "totally-not-a-model",
    ])
    expect(unknown).toEqual(["unknown-provider/nope", "totally-not-a-model"])
  })

  test("a disabled or deprecated model is a KNOWN id and passes validation", async () => {
    const validator = createCatalogModelValidator(createCatalogAdapter({ catalog: fakeCatalog([OLD, OFF]) }))
    expect(await validator.unknownModelIds(["gpt-3", "beta-model"])).toEqual([])
  })

  test("an EMPTY catalog (successful but zero models) degrades: unknownModelIds THROWS, never flags every id", async () => {
    // The bug: a cold/loading provider read returns `{}` (SUCCESS, empty), so every
    // id resolves `not_found_in_catalog`. The validator must NOT report them as
    // unknown (that false-rejects a valid write) — it throws so the caller degrades
    // to `unavailable`, matching a real catalog outage.
    const validator = createCatalogModelValidator(createCatalogAdapter({ catalog: fakeCatalog([]) }))
    await expect(validator.unknownModelIds(["gpt-5", "claude-sonnet-5"])).rejects.toThrow(/empty|unavailable/i)
  })

  test("a POPULATED catalog missing the id STILL reports it as unknown (does not throw)", async () => {
    const validator = createCatalogModelValidator(createCatalogAdapter({ catalog: fakeCatalog([GPT]) }))
    expect(await validator.unknownModelIds(["gpt-5", "totally-not-a-model"])).toEqual(["totally-not-a-model"])
  })
})

describe("CatalogAdapter.toCapabilityCatalogRecord", () => {
  test("only tool_call_present is knowable from catalog metadata — the other six dimensions stay null", () => {
    const record = toCapabilityCatalogRecord({ modelId: "gpt-5", providerId: "openai", tools: true }, "2026-01-01T00:00:00.000Z")
    expect(record.assessment.dimensions).toEqual({
      tool_call_present: true,
      max_calls_per_turn: null,
      same_turn_multiple_calls: null,
      serial_runner_execution: null,
      parallel_calls: null,
      continuation_after_tool_result: null,
      multi_turn_cycles: null,
    })
    expect(record.assessment.source).toBe("catalog")
    expect(record.identity).toEqual({ provider: "openai", model: "gpt-5", variant: "default", api: "native" })
  })
})

const CONFIG: RoutingConfig.Info = {
  activation: { enabled: true, mode: "always", strict_gates: true },
  models: {
    decision_model: { pool: ["architect"] },
    role_pools: {
      architect: ["gpt-5"],
      "worker-fast-large": ["claude-sonnet-5"],
      "worker-fast-small": ["gpt-3"],
    },
    fallback: { floor_role: "worker-fast-small" },
  },
  enforcement: {
    capability: { metadata_source: "catalog", unknown_policy: "deny", probing_enabled: false },
    budget: {
      limits: { max_turns: 10, max_context_tokens: 1000, max_context_bytes: 1000, max_output_tokens: 1000, max_output_bytes: 1000 },
      concurrency: { max_workers: 2, max_delegation_depth: 2 },
      retrieval: { retrieval_top_k: 4, rerank_top_k: 2, max_skill_chunks: 4, max_skill_tokens: 400 },
      cost: { time_budget_ms: 1000, cost_budget_usd: 1, token_budget: 1000 },
      resilience: { retry_depth: 1, validation_depth: 1, escalation_threshold: "manual_review" },
    },
    hierarchy: { max_depth: 1, orchestration_only: true },
  },
}

describe("CatalogAdapter.createCandidateSource", () => {
  test("resolve() cross-products the injected agent pool with the healthy worker-role model pool, never a hardcoded id", async () => {
    const source = createCandidateSource({
      catalog: createCatalogAdapter({ catalog: fakeCatalog([GPT, CLAUDE, OLD]) }),
      agents: {
        resolveAgents: async () => [{ agentId: "general-worker", skills: [], effort: "medium", reasoningEffort: "medium" }],
      },
      now: () => "2026-01-01T00:00:00.000Z",
    })
    const resolution = await source.resolve({
      routingProfile: "direct_worker",
      taskClass: "medium",
      scope: "session",
      config: CONFIG,
    })
    // "worker-fast-large" (claude-sonnet-5, healthy) and "worker-fast-small" (gpt-3, deprecated -> unhealthy, excluded)
    expect(resolution.candidates).toHaveLength(1)
    expect(resolution.candidates[0]?.identity).toEqual({ agent_id: "general-worker", model_id: "claude-sonnet-5" })
    expect(resolution.decisionPoolModelIds).toEqual(["gpt-5"])
  })

  test("manager profile resolves against the architect/manager role pools", async () => {
    const source = createCandidateSource({
      catalog: createCatalogAdapter({ catalog: fakeCatalog([GPT]) }),
      agents: { resolveAgents: async () => [{ agentId: "architect-agent", skills: [], effort: "high", reasoningEffort: "high" }] },
    })
    const resolution = await source.resolve({
      routingProfile: "manager",
      taskClass: "large",
      scope: "project",
      config: {
        ...CONFIG,
        models: { ...CONFIG.models, role_pools: { manager: ["gpt-5"] } },
      },
    })
    expect(resolution.candidates.map((c) => c.identity.model_id)).toEqual(["gpt-5"])
  })

  test("inspect() with no modelId reports the full catalog; with a modelId reports only that candidate", async () => {
    const source = createCandidateSource({
      catalog: createCatalogAdapter({ catalog: fakeCatalog([GPT, CLAUDE]) }),
      agents: { resolveAgents: async () => [] },
    })
    const all = await source.inspect()
    expect(all).toHaveLength(2)
    const one = await source.inspect("gpt-5")
    expect(one).toHaveLength(1)
    expect(one[0]?.identity.model).toBe("gpt-5")
  })

  test("status() reports ok health and a stable catalogVersion", async () => {
    const source = createCandidateSource({
      catalog: createCatalogAdapter({ catalog: fakeCatalog([GPT]) }),
      agents: { resolveAgents: async () => [] },
    })
    const status = await source.status()
    expect(status.health).toBe("ok")
    expect(status.offline).toBe(false)
    expect(status.catalogVersion.length).toBeGreaterThan(0)
  })

  test("status() degrades to unavailable when the catalog read throws", async () => {
    const source = createCandidateSource({
      catalog: {
        resolveCandidates: async () => ({ catalogVersion: "x", candidates: [] }),
        listAll: async () => ({ catalogVersion: "x", candidates: [] }),
        catalogVersion: async () => {
          throw new Error("catalog offline")
        },
      },
      agents: { resolveAgents: async () => [] },
    })
    const status = await source.status()
    expect(status.health).toBe("unavailable")
    expect(status.offline).toBe(true)
    expect(status.reason).toContain("catalog offline")
  })
})
