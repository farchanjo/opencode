import { describe, expect, test } from "bun:test"
import { Overlap } from "@opencode-ai/core/jobs/overlap"

// Feature 003 / T031 (S18) — overlap policy matrix over
// `allow | forbid(default) | queue | replace`. Pure, total, zero I/O. Two
// load-bearing invariants: capability gating rejects an unenforceable policy
// BEFORE registration (FR5, AC22), and `replace` NEVER silently stops or kills a
// mutating handler/process (C17, AC25).

const caps = (overrides: Partial<Overlap.OverlapCapabilities> = {}): Overlap.OverlapCapabilities => ({
  allow: true,
  queue: true,
  replace: true,
  ...overrides,
})

const input = (overrides: Partial<Overlap.OverlapInput> = {}): Overlap.OverlapInput => ({
  policy: "forbid",
  running: false,
  runningIsMutating: false,
  capabilities: caps(),
  ...overrides,
})

describe("Overlap — default is forbid (AC5)", () => {
  test("DEFAULT_OVERLAP_POLICY is forbid (no overlap)", () => {
    expect(Overlap.DEFAULT_OVERLAP_POLICY).toBe("forbid")
  })
})

describe("Overlap.evaluateOverlap — capability gating (FR5, C3, AC22)", () => {
  test("forbid is always enforceable regardless of declared capabilities", () => {
    const decision = Overlap.evaluateOverlap(
      input({ policy: "forbid", running: true, capabilities: caps({ allow: false, queue: false, replace: false }) }),
    )
    expect(decision.kind).toBe("reject")
  })

  test("a non-forbid policy the adapter cannot enforce fails validation with a capability_gap", () => {
    for (const policy of ["allow", "queue", "replace"] as const) {
      const decision = Overlap.evaluateOverlap(
        input({ policy, running: true, capabilities: caps({ allow: false, queue: false, replace: false }) }),
      )
      expect(decision.kind).toBe("capability_gap")
      if (decision.kind === "capability_gap") expect(decision.capability).toBe(policy)
    }
  })

  test("the capability gap is detected even when no sibling is running (pre-registration validation)", () => {
    const decision = Overlap.evaluateOverlap(
      input({ policy: "queue", running: false, capabilities: caps({ queue: false }) }),
    )
    expect(decision.kind).toBe("capability_gap")
  })
})

describe("Overlap.evaluateOverlap — no running sibling admits under every supported policy", () => {
  test("no overlap to resolve → admit", () => {
    for (const policy of ["allow", "forbid", "queue", "replace"] as const) {
      const decision = Overlap.evaluateOverlap(input({ policy, running: false }))
      expect(decision.kind).toBe("admit")
    }
  })
})

describe("Overlap.evaluateOverlap — running sibling", () => {
  test("allow + running → admit (overlap permitted)", () => {
    expect(Overlap.evaluateOverlap(input({ policy: "allow", running: true })).kind).toBe("admit")
  })

  test("forbid + running → reject (overlap_rejected, the default)", () => {
    const decision = Overlap.evaluateOverlap(input({ policy: "forbid", running: true }))
    expect(decision.kind).toBe("reject")
    if (decision.kind === "reject") expect(decision.outcome).toBe("overlap_rejected")
  })

  test("queue + running → queue (defer behind the sibling)", () => {
    expect(Overlap.evaluateOverlap(input({ policy: "queue", running: true })).kind).toBe("queue")
  })
})

describe("Overlap.evaluateOverlap — replace is mutation-safe (C17, AC25)", () => {
  test("replace + running non-mutating sibling → replace (overlap_replaced, mutationSafe true)", () => {
    const decision = Overlap.evaluateOverlap(
      input({ policy: "replace", running: true, runningIsMutating: false }),
    )
    expect(decision.kind).toBe("replace")
    if (decision.kind === "replace") {
      expect(decision.outcome).toBe("overlap_replaced")
      expect(decision.mutationSafe).toBe(true)
    }
  })

  test("replace + running MID-MUTATION sibling → never kill: degrade to queue when queueing is supported", () => {
    const decision = Overlap.evaluateOverlap(
      input({ policy: "replace", running: true, runningIsMutating: true, capabilities: caps({ queue: true }) }),
    )
    expect(decision.kind).toBe("queue")
  })

  test("replace + running MID-MUTATION sibling with no queue capability → reject, never a silent kill", () => {
    const decision = Overlap.evaluateOverlap(
      input({ policy: "replace", running: true, runningIsMutating: true, capabilities: caps({ queue: false }) }),
    )
    expect(decision.kind).toBe("reject")
    if (decision.kind === "reject") expect(decision.outcome).toBe("overlap_rejected")
  })
})

describe("Overlap.resolveLongHandler — long-running handler past next nominal due (ADR-0004)", () => {
  test("forbid + a previous handler still pending → explicit misfired (never a second overlapping invocation)", () => {
    expect(Overlap.resolveLongHandler("forbid", true)).toBe("misfired")
  })

  test("forbid + no pending handler → null (normal evaluation applies)", () => {
    expect(Overlap.resolveLongHandler("forbid", false)).toBeNull()
  })

  test("a concurrency-permitting policy yields null so the caller runs normal overlap evaluation", () => {
    for (const policy of ["allow", "queue", "replace"] as const) {
      expect(Overlap.resolveLongHandler(policy, true)).toBeNull()
    }
  })
})
