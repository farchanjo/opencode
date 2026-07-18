import { describe, expect, test } from "bun:test"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import {
  classify,
  DEFAULT_CLASSIFIER_THRESHOLDS,
  type ClassifierThresholds,
} from "../../src/routing/domain/classifier"

function inputs(overrides: Partial<Decision.DecisionInputs> = {}): Decision.DecisionInputs {
  return {
    structure: { domain_count: 1, independent_units: 1, context_size: 0 },
    risk: { mutation_risk: 0, ambiguity: 0, security_migration: 0, external_effects: 0 },
    concurrency: { expected_tools: [], parallelism: 0 },
    ...overrides,
  }
}

describe("routing.domain.classifier", () => {
  test("bottom-of-scale signals classify as small + direct_worker", () => {
    const result = classify(inputs())

    expect(result.taskClass).toBe("small")
    expect(result.routingProfile).toBe("direct_worker")
    expect(result.complexityScore).toBeLessThan(DEFAULT_CLASSIFIER_THRESHOLDS.taskClassBoundaries.medium)
  })

  test("top-of-scale signals classify as complex + manager", () => {
    const result = classify(
      inputs({
        structure: { domain_count: 8, independent_units: 8, context_size: 200_000 },
        risk: { mutation_risk: 1, ambiguity: 1, security_migration: 1, external_effects: 1 },
        concurrency: { expected_tools: ["read", "write", "bash", "grep", "edit", "test"], parallelism: 1 },
      }),
    )

    expect(result.taskClass).toBe("complex")
    expect(result.routingProfile).toBe("manager")
    expect(result.complexityScore).toBe(1)
  })

  test("is a pure function of its inputs (deterministic, no model call)", () => {
    const sample = inputs({
      structure: { domain_count: 2, independent_units: 3, context_size: 12_000 },
      risk: { mutation_risk: 0.4, ambiguity: 0.2, security_migration: 0.1, external_effects: 0.05 },
      concurrency: { expected_tools: ["read", "edit"], parallelism: 0.3 },
    })

    const first = classify(sample)
    const second = classify(sample)

    expect(second).toEqual(first)
  })

  test("external_effects folds into the security/migration signal via max()", () => {
    const securityDriven = classify(
      inputs({ risk: { mutation_risk: 0, ambiguity: 0, security_migration: 0.9, external_effects: 0 } }),
    )
    const externalDriven = classify(
      inputs({ risk: { mutation_risk: 0, ambiguity: 0, security_migration: 0, external_effects: 0.9 } }),
    )

    expect(securityDriven.signals.securityMigration).toBe(externalDriven.signals.securityMigration)
    expect(securityDriven.complexityScore).toBe(externalDriven.complexityScore)
  })

  test("decomposable-but-small tasks still route manager when domain/unit thresholds are met", () => {
    // Low complexity score overall (small task_class) but explicitly
    // decomposable across >=2 domains with >=2 independent units and high
    // parallelism forces the Manager fanout path per hierarchy-flow.md.
    const result = classify(
      inputs({
        structure: { domain_count: 2, independent_units: 2, context_size: 0 },
        concurrency: { expected_tools: [], parallelism: 0.6 },
      }),
    )

    expect(result.routingProfile).toBe("manager")
  })

  test("large task_class without decomposability or parallelism stays direct_worker", () => {
    const thresholds: ClassifierThresholds = {
      ...DEFAULT_CLASSIFIER_THRESHOLDS,
      managerDomainCount: 100,
      managerIndependentUnits: 100,
      managerParallelism: 100,
    }
    const result = classify(
      inputs({
        structure: { domain_count: 1, independent_units: 1, context_size: 50_000 },
        risk: { mutation_risk: 1, ambiguity: 1, security_migration: 1, external_effects: 1 },
      }),
      thresholds,
    )

    expect(result.taskClass).toBe("large")
    expect(result.routingProfile).toBe("direct_worker")
  })

  test("custom thresholds change the classification boundary deterministically", () => {
    const lenient: ClassifierThresholds = {
      ...DEFAULT_CLASSIFIER_THRESHOLDS,
      taskClassBoundaries: { medium: 0.9, large: 0.95, complex: 0.99 },
    }
    const sample = inputs({
      structure: { domain_count: 2, independent_units: 2, context_size: 20_000 },
      risk: { mutation_risk: 0.3, ambiguity: 0.2, security_migration: 0.1, external_effects: 0.1 },
    })

    const strictResult = classify(sample)
    const lenientResult = classify(sample, lenient)

    expect(strictResult.taskClass).not.toBe("small")
    expect(lenientResult.taskClass).toBe("small")
  })

  test("reason string reports task_class, routing_profile and score", () => {
    const result = classify(inputs())

    expect(result.reason).toContain("task_class=small")
    expect(result.reason).toContain("routing_profile=direct_worker")
    expect(result.reason).toContain("complexity_score=")
  })
})
