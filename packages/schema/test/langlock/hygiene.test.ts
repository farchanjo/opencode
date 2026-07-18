import { describe, expect, test } from "bun:test"
import { Ids } from "../../src/langlock/ids"
import { Values } from "../../src/langlock/values"
import { Enums } from "../../src/langlock/enums"
import { EventTypes } from "../../src/langlock/event-types"

// Feature 004 / T038 (S20) — contract hygiene for the langlock.* corpus
// (annotate-before-check identifiers). The branded ids and counters carry their
// `identifier` annotation on the PLAIN base BEFORE any `.check(...)` filter, so the
// identifier survives on the schema AST and stays unique across the langlock
// namespace (mirrors the global contract-hygiene registration for langlock).

const identified: ReadonlyArray<{ readonly ast: { readonly annotations?: { readonly identifier?: unknown } } }> = [
  Ids.LanguageTag,
  Ids.PolicyId,
  Ids.ExceptionId,
  Ids.ExecutionId,
  Ids.EventId,
  Values.PolicyVersion,
  Values.ConfigVersion,
  Values.SchemaVersion,
  Values.Sequence,
  Enums.Scope,
  Enums.Origin,
  Enums.EnforcementMode,
  Enums.Axis,
  Enums.PathKind,
  Enums.ConfidenceBucket,
  Enums.DetectorProvenance,
  Enums.RemediationStatus,
  Enums.ExceptionCategory,
  EventTypes.LangLockEventType,
]

describe("langlock.* contract hygiene — annotate-before-check identifiers", () => {
  test("every listed schema exposes a stable string identifier on its AST", () => {
    for (const schema of identified) {
      expect(typeof schema.ast.annotations?.identifier).toBe("string")
    }
  })

  test("identifiers are unique across the sampled langlock namespace", () => {
    const identifiers = identified.map((schema) => schema.ast.annotations?.identifier as string)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })

  test("every identifier is namespaced under a LangLock* prefix", () => {
    for (const schema of identified) {
      expect(String(schema.ast.annotations?.identifier)).toStartWith("LangLock")
    }
  })
})
