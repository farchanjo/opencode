import { describe, expect, test } from "bun:test"
import { PolicyResolution } from "@opencode-ai/core/langlock/policy-resolution"

// Feature 004 / T037 (S20) — pure deterministic policy-resolution tests with the
// hard-policy-floor guard (FR5, FR24, C2, AC5, AC6). Zero I/O. A project override
// is `applied` only when authorized AND floor-preserving; otherwise the global
// value is `retained` with a typed `unauthorized` / `floor_violation` / `no_override`
// reason — never a silent relax (Security 1).

const globalBase = (overrides: Partial<PolicyResolution.PolicyView> = {}): PolicyResolution.PolicyView => ({
  enabled: true,
  tag: "en-US",
  enforcement_mode: "advisory",
  policy_version: 1,
  hard_floor: false,
  ...overrides,
})

const override = (
  overrides: Partial<PolicyResolution.ProjectOverride> = {},
): PolicyResolution.ProjectOverride => ({
  enabled: true,
  tag: "pt-BR",
  enforcement_mode: "advisory",
  policy_version: 2,
  override_authorized: true,
  ...overrides,
})

describe("PolicyResolution.resolve — no override (FR5)", () => {
  test("retains the global base with origin global when no override is present", () => {
    const outcome = PolicyResolution.resolve({ global: globalBase() })
    expect(outcome.kind).toBe("retained")
    if (outcome.kind !== "retained") throw new Error("expected retained")
    expect(outcome.reason).toBe("no_override")
    expect(outcome.resolved.tag).toBe("en-US")
    expect(outcome.resolved.origin).toBe("global")
  })
})

describe("PolicyResolution.resolve — authorized apply (AC6)", () => {
  test("applies an authorized, floor-preserving project override with origin project", () => {
    const outcome = PolicyResolution.resolve({ global: globalBase({ hard_floor: false }), override: override() })
    expect(outcome.kind).toBe("applied")
    if (outcome.kind !== "applied") throw new Error("expected applied")
    expect(outcome.resolved.tag).toBe("pt-BR")
    expect(outcome.resolved.origin).toBe("project")
    expect(outcome.resolved.policy_version).toBe(2)
  })

  test("applies a same-tag override even under a hard floor (floor-preserving)", () => {
    const outcome = PolicyResolution.resolve({
      global: globalBase({ hard_floor: true, tag: "en-US" }),
      override: override({ tag: "en-US" }),
    })
    expect(outcome.kind).toBe("applied")
  })
})

describe("PolicyResolution.resolve — unauthorized retain (Security 1, AC5)", () => {
  test("retains the global value when the override is not authorized", () => {
    const outcome = PolicyResolution.resolve({
      global: globalBase(),
      override: override({ override_authorized: false }),
    })
    expect(outcome.kind).toBe("retained")
    if (outcome.kind !== "retained") throw new Error("expected retained")
    expect(outcome.reason).toBe("unauthorized")
    expect(outcome.resolved.tag).toBe("en-US")
    expect(outcome.resolved.origin).toBe("global")
  })
})

describe("PolicyResolution.resolve — floor violation retain (FR5, AC5)", () => {
  test("retains the global value when an authorized override would change the floored tag", () => {
    const outcome = PolicyResolution.resolve({
      global: globalBase({ hard_floor: true, tag: "en-US" }),
      override: override({ tag: "pt-BR", override_authorized: true }),
    })
    expect(outcome.kind).toBe("retained")
    if (outcome.kind !== "retained") throw new Error("expected retained")
    expect(outcome.reason).toBe("floor_violation")
    expect(outcome.resolved.tag).toBe("en-US")
  })

  test("retains when an authorized override would disable a floored lock", () => {
    const outcome = PolicyResolution.resolve({
      global: globalBase({ hard_floor: true, tag: "en-US" }),
      override: override({ enabled: false, tag: "en-US", override_authorized: true }),
    })
    expect(outcome.kind).toBe("retained")
    if (outcome.kind !== "retained") throw new Error("expected retained")
    expect(outcome.reason).toBe("floor_violation")
  })

  test("authorization is checked before the floor — unauthorized floor-relaxing override is unauthorized", () => {
    const outcome = PolicyResolution.resolve({
      global: globalBase({ hard_floor: true, tag: "en-US" }),
      override: override({ tag: "pt-BR", override_authorized: false }),
    })
    if (outcome.kind !== "retained") throw new Error("expected retained")
    expect(outcome.reason).toBe("unauthorized")
  })
})
