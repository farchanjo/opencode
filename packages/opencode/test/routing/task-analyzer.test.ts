/**
 * Feature 001 — deterministic TaskAnalyzer heuristics.
 * The raw description never reaches a model; the analysis is a pure, replay-
 * stable function of the description text + scope.
 */
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Decision } from "@opencode-ai/schema/routing/decision"
import { createTaskAnalyzer } from "@/routing/application/task-analyzer"

const analyzer = createTaskAnalyzer()
const decode = Schema.decodeUnknownSync(Decision.DecisionInputs)

describe("createTaskAnalyzer", () => {
  test("is deterministic — identical input yields identical analysis", () => {
    const input = { taskDescription: "Edit the API handler and run the tests", scope: "project" as const }
    const a = analyzer.analyze(input)
    const b = analyzer.analyze(input)
    expect(a).toEqual(b)
  })

  test("produces schema-valid DecisionInputs", () => {
    const { inputs } = analyzer.analyze({
      taskDescription: "Add an auth endpoint, migrate the database, then deploy",
      scope: "session",
    })
    expect(() => decode(inputs)).not.toThrow()
    expect(inputs.structure.domain_count).toBeGreaterThanOrEqual(1)
    expect(inputs.risk.mutation_risk).toBeGreaterThan(0)
    expect(inputs.risk.security_migration).toBeGreaterThan(0)
    expect(inputs.risk.external_effects).toBeGreaterThan(0)
  })

  test("derives expected tools + requires tool-call presence when tools are expected", () => {
    const { inputs, requirements, ranking } = analyzer.analyze({
      taskDescription: "search the repo and edit the file",
      scope: "project",
    })
    expect([...inputs.concurrency.expected_tools].sort()).toEqual(["edit", "grep"])
    expect(requirements.tool_call_present).toBe(true)
    expect([...ranking.requiredSkills].sort()).toEqual(["edit", "grep"])
  })

  test("a trivial description expects no tools and gates nothing extra", () => {
    const { inputs, requirements } = analyzer.analyze({ taskDescription: "hello", scope: "global" })
    expect(inputs.concurrency.expected_tools.length).toBe(0)
    expect(requirements.tool_call_present).toBeUndefined()
  })

  test("risk signals stay within the unit interval", () => {
    const { inputs } = analyzer.analyze({
      taskDescription: "delete drop remove destroy truncate reset overwrite deploy publish push migrate install",
      scope: "project",
    })
    expect(inputs.risk.mutation_risk).toBeLessThanOrEqual(1)
    expect(inputs.risk.mutation_risk).toBe(1)
  })
})
