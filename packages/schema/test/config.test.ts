import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Budget } from "../src/routing/budget"
import { RoutingConfig } from "../src/routing/config"

const validPolicy: Budget.Policy = {
  limits: {
    max_turns: 10,
    max_context_tokens: 100_000,
    max_context_bytes: 400_000,
    max_output_tokens: 8_000,
    max_output_bytes: 32_000,
  },
  concurrency: {
    max_workers: 4,
    max_delegation_depth: 2,
  },
  retrieval: {
    retrieval_top_k: 8,
    rerank_top_k: 4,
    max_skill_chunks: 6,
    max_skill_tokens: 4_000,
  },
  cost: {
    time_budget_ms: 60_000,
    cost_budget_usd: 0.5,
    token_budget: 200_000,
  },
  resilience: {
    retry_depth: 2,
    validation_depth: 1,
    escalation_threshold: "budget_exceeded",
  },
}

const validConfig = {
  activation: {
    enabled: true,
    mode: "auto",
    strict_gates: true,
  },
  models: {
    decision_model: {
      pool: ["architect"],
    },
    role_pools: {
      architect: ["claude-opus-4"],
      worker: ["claude-sonnet-5", "claude-haiku-4"],
    },
    fallback: {
      floor_role: "worker",
    },
  },
  enforcement: {
    capability: {
      metadata_source: "catalog",
      unknown_policy: "deny",
      probing_enabled: false,
    },
    budget: validPolicy,
    hierarchy: {
      max_depth: 2,
      orchestration_only: true,
    },
  },
} satisfies RoutingConfig.Info

describe("RoutingConfig.Info", () => {
  test("round-trips a valid config through decode and encode", () => {
    const decoded = Schema.decodeUnknownSync(RoutingConfig.Info)(validConfig)
    expect(decoded).toEqual(validConfig)
    expect(Schema.encodeSync(RoutingConfig.Info)(decoded)).toEqual(validConfig)
  })

  test("rejects an empty decision_model pool", () => {
    expect(() =>
      Schema.decodeUnknownSync(RoutingConfig.Info)({
        ...validConfig,
        models: { ...validConfig.models, decision_model: { pool: [] } },
      }),
    ).toThrow()
  })

  test("rejects a hierarchy.max_depth outside the 1-2 Architect->Manager->Worker range", () => {
    expect(() =>
      Schema.decodeUnknownSync(RoutingConfig.Info)({
        ...validConfig,
        enforcement: {
          ...validConfig.enforcement,
          hierarchy: { ...validConfig.enforcement.hierarchy, max_depth: 3 },
        },
      }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(RoutingConfig.Info)({
        ...validConfig,
        enforcement: {
          ...validConfig.enforcement,
          hierarchy: { ...validConfig.enforcement.hierarchy, max_depth: 0 },
        },
      }),
    ).toThrow()
  })

  test("rejects an empty role_pools RolePoolID candidate list entry", () => {
    expect(() =>
      Schema.decodeUnknownSync(RoutingConfig.Info)({
        ...validConfig,
        models: { ...validConfig.models, role_pools: { architect: [""] } },
      }),
    ).toThrow()
  })

  test("rejects an invalid nested budget policy", () => {
    expect(() =>
      Schema.decodeUnknownSync(RoutingConfig.Info)({
        ...validConfig,
        enforcement: {
          ...validConfig.enforcement,
          budget: { ...validPolicy, limits: { ...validPolicy.limits, max_turns: 0 } },
        },
      }),
    ).toThrow()
  })
})

describe("RoutingConfig.RoutingMode", () => {
  test("accepts every closed-union member", () => {
    for (const value of ["always", "auto", "never"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.RoutingMode)(value)).toBe(value)
    }
  })

  test("rejects a value outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(RoutingConfig.RoutingMode)("sometimes")).toThrow()
  })
})

describe("RoutingConfig.MetadataSource", () => {
  test("accepts every closed-union member", () => {
    for (const value of ["catalog", "override", "observed"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.MetadataSource)(value)).toBe(value)
    }
  })

  test("rejects a value outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(RoutingConfig.MetadataSource)("guessed")).toThrow()
  })
})

describe("RoutingConfig.UnknownPolicy", () => {
  test("accepts every closed-union member", () => {
    for (const value of ["deny", "allow"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.UnknownPolicy)(value)).toBe(value)
    }
  })

  test("rejects a value outside the closed union", () => {
    expect(() => Schema.decodeUnknownSync(RoutingConfig.UnknownPolicy)("ignore")).toThrow()
  })
})

describe("RoutingConfig re-exported enums (doc/arch/schemas/routing/enums.cue)", () => {
  test("TaskClass accepts every closed-union member", () => {
    for (const value of ["small", "medium", "large", "complex"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.TaskClass)(value)).toBe(value)
    }
    expect(() => Schema.decodeUnknownSync(RoutingConfig.TaskClass)("huge")).toThrow()
  })

  test("RoutingProfile accepts every closed-union member", () => {
    for (const value of ["direct_worker", "manager"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.RoutingProfile)(value)).toBe(value)
    }
    expect(() => Schema.decodeUnknownSync(RoutingConfig.RoutingProfile)("solo")).toThrow()
  })

  test("TaskEffort accepts every closed-union member", () => {
    for (const value of ["minimal", "low", "medium", "high", "massive"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.TaskEffort)(value)).toBe(value)
    }
    expect(() => Schema.decodeUnknownSync(RoutingConfig.TaskEffort)("extreme")).toThrow()
  })

  test("ReasoningEffort accepts every closed-union member", () => {
    for (const value of ["minimal", "low", "medium", "high"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.ReasoningEffort)(value)).toBe(value)
    }
    expect(() => Schema.decodeUnknownSync(RoutingConfig.ReasoningEffort)("extreme")).toThrow()
  })

  test("ExecutionBoundary accepts every closed-union member", () => {
    for (const value of ["safe", "retryable", "mutation_risky"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.ExecutionBoundary)(value)).toBe(value)
    }
    expect(() => Schema.decodeUnknownSync(RoutingConfig.ExecutionBoundary)("unsafe")).toThrow()
  })

  test("HierarchyRole accepts every closed-union member", () => {
    for (const value of ["architect", "manager", "worker"] as const) {
      expect(Schema.decodeUnknownSync(RoutingConfig.HierarchyRole)(value)).toBe(value)
    }
    expect(() => Schema.decodeUnknownSync(RoutingConfig.HierarchyRole)("observer")).toThrow()
  })
})
