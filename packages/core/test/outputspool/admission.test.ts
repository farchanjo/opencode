import { describe, expect, test } from "bun:test"
import { Admission } from "@opencode-ai/core/outputspool/admission"

// Feature 005 / T020 (S10) — admission/fault classification + degrade-then-fence.
// Deterministic over injected raw signals and clock (FR10, C4, AC5, AC6, AC7).

describe("Admission — classification", () => {
  test("classifies each first-class fault", () => {
    expect(Admission.classify({ kind: "syscall", code: "ENOSPC" })).toBe("enospc")
    expect(Admission.classify({ kind: "syscall", code: "EMFILE" })).toBe("fd_exhaustion")
    expect(Admission.classify({ kind: "syscall", code: "ENFILE" })).toBe("fd_exhaustion")
    expect(Admission.classify({ kind: "syscall", code: "EACCES" })).toBe("permission")
    expect(Admission.classify({ kind: "quota" })).toBe("quota")
    expect(Admission.classify({ kind: "latency", latency_ms: 500, threshold_ms: 250 })).toBe("latency")
  })
  test("an unrecognized code or sub-threshold latency is none, never swallowed as an error", () => {
    expect(Admission.classify({ kind: "ok" })).toBe("none")
    expect(Admission.classify({ kind: "syscall", code: "EINTR" })).toBe("none")
    expect(Admission.classify({ kind: "latency", latency_ms: 10, threshold_ms: 250 })).toBe("none")
  })
})

describe("Admission — degrade-then-fence", () => {
  test("a persistent fault crosses the window and fences", () => {
    let s = Admission.observe(Admission.CLEAR, "enospc", 1000)
    expect(Admission.shouldFence(s, 1000, 500)).toBe(false) // just begun
    s = Admission.observe(s, "enospc", 1400) // still within window; since_ms preserved
    expect(Admission.shouldFence(s, 1400, 500)).toBe(false)
    expect(Admission.shouldFence(s, 1500, 500)).toBe(true) // 1500-1000 >= 500
  })
  test("a cleared fault resets the window", () => {
    let s = Admission.observe(Admission.CLEAR, "latency", 1000)
    s = Admission.observe(s, "none", 1200)
    expect(s).toEqual(Admission.CLEAR)
    expect(Admission.shouldFence(s, 5000, 500)).toBe(false)
  })
})

describe("Admission — fence and seal outcomes", () => {
  test("fences to aborted with bytes intact, corrupt on loss", () => {
    expect(Admission.fenceOutcome(false)).toBe("aborted")
    expect(Admission.fenceOutcome(true)).toBe("corrupt")
  })
  test("seal never lies: a short extent settles corrupt", () => {
    expect(Admission.sealOutcome(1000, 1000)).toBe("sealed")
    expect(Admission.sealOutcome(1000, 1200)).toBe("sealed")
    expect(Admission.sealOutcome(1000, 900)).toBe("corrupt")
  })
})
