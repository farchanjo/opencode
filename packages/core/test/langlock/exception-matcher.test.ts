import { describe, expect, test } from "bun:test"
import { ExceptionMatcher } from "@opencode-ai/core/langlock/exception-matcher"

// Feature 004 / T037 (S20) — pure deterministic exception-matcher tests (FR14,
// FR15, Security 6, C16, AC9, AC10, AC18). Zero I/O: the operator-owned manifest
// is injected. A non-match never invents an exemption; only an `operator`
// principal may create one — every untrusted actor (LLM/plugin/prompt/MCP/custom
// command) is rejected.

const manifestFrom = (match: ExceptionMatcher.ExceptionMatch | null): ExceptionMatcher.ManifestPort => ({
  match: () => match,
})

describe("ExceptionMatcher.matchException — manifest match (FR14, AC9)", () => {
  test("returns matched with the operator-registered category and scope", () => {
    const outcome = ExceptionMatcher.matchException(
      { key: "locales/pt-BR.json" },
      manifestFrom({ category: "i18n_resource", scope: "project" }),
    )
    expect(outcome.kind).toBe("matched")
    if (outcome.kind !== "matched") throw new Error("expected matched")
    expect(outcome.category).toBe("i18n_resource")
    expect(outcome.scope).toBe("project")
  })
})

describe("ExceptionMatcher.matchException — non-match deny (AC10)", () => {
  test("a non-match keeps the target under the lock and never invents an exemption", () => {
    const outcome = ExceptionMatcher.matchException({ key: "docs/guide.md" }, manifestFrom(null))
    expect(outcome.kind).toBe("denied")
    if (outcome.kind !== "denied") throw new Error("expected denied")
    expect(outcome.reason).toBe("no_match")
  })
})

describe("ExceptionMatcher.authorizeExceptionCreate — operator-owned only (Security 6, AC10, AC18)", () => {
  test("accepts an operator principal", () => {
    expect(ExceptionMatcher.authorizeExceptionCreate("operator").kind).toBe("accepted")
  })

  test("rejects every untrusted actor as untrusted_actor", () => {
    for (const actor of ["llm", "plugin", "prompt", "mcp", "custom_command"] as const) {
      const outcome = ExceptionMatcher.authorizeExceptionCreate(actor)
      expect(outcome.kind).toBe("rejected")
      if (outcome.kind !== "rejected") throw new Error("expected rejected")
      expect(outcome.reason).toBe("untrusted_actor")
      expect(outcome.actor).toBe(actor)
    }
  })
})
