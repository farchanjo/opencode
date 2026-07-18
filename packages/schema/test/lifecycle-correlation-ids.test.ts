import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CorrelationIds } from "../src/lifecycle/correlation-ids"

describe("CorrelationIds.CorrelationId / CausationId / TurnId", () => {
  test("accepts an alphanumeric id within the length bound", () => {
    expect(Schema.decodeUnknownSync(CorrelationIds.CorrelationId)("cor_abc-123")).toBe(
      CorrelationIds.CorrelationId.make("cor_abc-123"),
    )
    expect(Schema.decodeUnknownSync(CorrelationIds.CausationId)("cau_abc-123")).toBe(
      CorrelationIds.CausationId.make("cau_abc-123"),
    )
    expect(Schema.decodeUnknownSync(CorrelationIds.TurnId)("trn_abc-123")).toBe(
      CorrelationIds.TurnId.make("trn_abc-123"),
    )
  })

  test("round-trips through encode", () => {
    const decoded = Schema.decodeUnknownSync(CorrelationIds.CorrelationId)("cor_abc-123")
    expect(Schema.encodeSync(CorrelationIds.CorrelationId)(decoded)).toBe("cor_abc-123")
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(CorrelationIds.CorrelationId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(CorrelationIds.CausationId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(CorrelationIds.TurnId)("")).toThrow()
  })

  test("rejects an id with characters outside the pattern", () => {
    expect(() => Schema.decodeUnknownSync(CorrelationIds.CorrelationId)("cor/abc:123")).toThrow()
  })
})

describe("CorrelationIds.DecisionId", () => {
  test("accepts a valid ULID", () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
    expect(Schema.decodeUnknownSync(CorrelationIds.DecisionId)(ulid)).toBe(CorrelationIds.DecisionId.make(ulid))
  })

  test("rejects a non-ULID string", () => {
    expect(() => Schema.decodeUnknownSync(CorrelationIds.DecisionId)("not-a-ulid")).toThrow()
  })

  test("rejects a ULID using excluded Crockford characters", () => {
    // ULIDs exclude I, L, O and U from the Crockford base32 alphabet.
    expect(() => Schema.decodeUnknownSync(CorrelationIds.DecisionId)("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toThrow()
  })
})

describe("CorrelationIds.AgentName / ModelId / ProviderName / VariantName", () => {
  test("accepts a non-empty string", () => {
    expect(Schema.decodeUnknownSync(CorrelationIds.AgentName)("java-architect")).toBe(
      CorrelationIds.AgentName.make("java-architect"),
    )
    expect(Schema.decodeUnknownSync(CorrelationIds.ModelId)("claude-sonnet-5")).toBe(
      CorrelationIds.ModelId.make("claude-sonnet-5"),
    )
    expect(Schema.decodeUnknownSync(CorrelationIds.ProviderName)("anthropic")).toBe(
      CorrelationIds.ProviderName.make("anthropic"),
    )
    expect(Schema.decodeUnknownSync(CorrelationIds.VariantName)("default")).toBe(
      CorrelationIds.VariantName.make("default"),
    )
  })

  test("rejects an empty string", () => {
    expect(() => Schema.decodeUnknownSync(CorrelationIds.AgentName)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(CorrelationIds.ModelId)("")).toThrow()
  })
})

describe("CorrelationIds.TodoRef / TodoVersion", () => {
  test("accepts a non-empty string", () => {
    expect(Schema.decodeUnknownSync(CorrelationIds.TodoRef)("todo-1")).toBe(CorrelationIds.TodoRef.make("todo-1"))
    expect(Schema.decodeUnknownSync(CorrelationIds.TodoVersion)("v1")).toBe(CorrelationIds.TodoVersion.make("v1"))
  })

  test("rejects an empty string", () => {
    expect(() => Schema.decodeUnknownSync(CorrelationIds.TodoRef)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(CorrelationIds.TodoVersion)("")).toThrow()
  })
})
