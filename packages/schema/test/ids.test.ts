import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Ids } from "../src/routing/ids"

describe("Ids.SessionId / TurnId / ExecutionId", () => {
  test("accepts an alphanumeric id within the length bound", () => {
    expect(Schema.decodeUnknownSync(Ids.SessionId)("ses_abc-123")).toBe("ses_abc-123")
    expect(Schema.decodeUnknownSync(Ids.TurnId)("trn_abc-123")).toBe("trn_abc-123")
    expect(Schema.decodeUnknownSync(Ids.ExecutionId)("exe_abc-123")).toBe("exe_abc-123")
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Ids.SessionId)("")).toThrow()
  })

  test("rejects an id with characters outside the pattern", () => {
    expect(() => Schema.decodeUnknownSync(Ids.SessionId)("ses/abc:123")).toThrow()
  })

  test("rejects an id longer than 128 characters", () => {
    expect(() => Schema.decodeUnknownSync(Ids.SessionId)("a".repeat(129))).toThrow()
  })
})

describe("Ids.DecisionId", () => {
  test("accepts a valid ULID", () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
    expect(Schema.decodeUnknownSync(Ids.DecisionId)(ulid)).toBe(ulid)
  })

  test("rejects a non-ULID string", () => {
    expect(() => Schema.decodeUnknownSync(Ids.DecisionId)("not-a-ulid")).toThrow()
  })

  test("rejects a ULID using excluded Crockford characters", () => {
    // ULIDs exclude I, L, O and U from the Crockford base32 alphabet.
    expect(() => Schema.decodeUnknownSync(Ids.DecisionId)("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toThrow()
  })
})

describe("Ids.AgentId / ModelId / SkillName / ProviderName / VariantName / ApiFamily", () => {
  test("accepts a non-empty string", () => {
    expect(Schema.decodeUnknownSync(Ids.AgentId)("java-architect")).toBe("java-architect")
    expect(Schema.decodeUnknownSync(Ids.ModelId)("claude-sonnet-5")).toBe("claude-sonnet-5")
    expect(Schema.decodeUnknownSync(Ids.SkillName)("read")).toBe("read")
    expect(Schema.decodeUnknownSync(Ids.ProviderName)("anthropic")).toBe("anthropic")
    expect(Schema.decodeUnknownSync(Ids.VariantName)("default")).toBe("default")
    expect(Schema.decodeUnknownSync(Ids.ApiFamily)("anthropic")).toBe("anthropic")
  })

  test("rejects an empty string", () => {
    expect(() => Schema.decodeUnknownSync(Ids.AgentId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.ModelId)("")).toThrow()
  })
})

describe("Ids.Version", () => {
  test("accepts a positive integer", () => {
    expect(Schema.decodeUnknownSync(Ids.Version)(1)).toBe(1)
  })

  test("rejects zero and negative integers", () => {
    expect(() => Schema.decodeUnknownSync(Ids.Version)(0)).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.Version)(-1)).toThrow()
  })
})

describe("Ids.CatalogVersion / PolicyVersion / TodoRef / TodoVersion / Fingerprint", () => {
  test("accepts a non-empty string", () => {
    expect(Schema.decodeUnknownSync(Ids.CatalogVersion)("catalog-2026-07")).toBe("catalog-2026-07")
    expect(Schema.decodeUnknownSync(Ids.PolicyVersion)("policy-2026-07")).toBe("policy-2026-07")
    expect(Schema.decodeUnknownSync(Ids.TodoRef)("todo-1")).toBe("todo-1")
    expect(Schema.decodeUnknownSync(Ids.TodoVersion)("v1")).toBe("v1")
    expect(Schema.decodeUnknownSync(Ids.Fingerprint)("fp-abc123")).toBe("fp-abc123")
  })

  test("rejects an empty string", () => {
    expect(() => Schema.decodeUnknownSync(Ids.CatalogVersion)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.Fingerprint)("")).toThrow()
  })
})

describe("Ids.CapabilityDimension / Scope / PermissionMode / EscalationThreshold", () => {
  test("accepts a non-empty string", () => {
    expect(Schema.decodeUnknownSync(Ids.CapabilityDimension)("tool_call_present")).toBe("tool_call_present")
    expect(Schema.decodeUnknownSync(Ids.Scope)("provider/model/variant")).toBe("provider/model/variant")
    expect(Schema.decodeUnknownSync(Ids.PermissionMode)("default")).toBe("default")
    expect(Schema.decodeUnknownSync(Ids.EscalationThreshold)("budget_exceeded")).toBe("budget_exceeded")
  })

  test("rejects an empty string", () => {
    expect(() => Schema.decodeUnknownSync(Ids.CapabilityDimension)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.Scope)("")).toThrow()
  })
})

describe("Ids.Reason / Requirement", () => {
  test("mirrors the CUE #Reason/#Requirement unconstrained string — empty string is valid", () => {
    expect(Schema.decodeUnknownSync(Ids.Reason)("")).toBe("")
    expect(Schema.decodeUnknownSync(Ids.Requirement)("")).toBe("")
  })

  test("rejects a non-string value", () => {
    expect(() => Schema.decodeUnknownSync(Ids.Reason)(42)).toThrow()
  })
})
