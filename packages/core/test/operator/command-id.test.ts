import { describe, expect, test } from "bun:test"
import {
  commandDomain,
  commandOperation,
  commandSegments,
  normalizeCommandIdInput,
  parseCommandId,
} from "../../src/operator"

describe("operator command id (T006)", () => {
  test("accepts dotted domain.operation and nested", () => {
    expect(parseCommandId("langlock.status").ok).toBe(true)
    expect(parseCommandId("semantic.embedding.cutover").ok).toBe(true)
    expect(parseCommandId("mcp.resource.admin.policy.set").ok).toBe(true)
    expect(parseCommandId("jobs.run-now").ok).toBe(true)
  })

  test("normalizes case to lowercase", () => {
    const r = parseCommandId("LangLock.Status")
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.value)).toBe("langlock.status")
  })

  test("rejects spaces, empty, empty segments, single segment", () => {
    expect(parseCommandId("").ok).toBe(false)
    expect(parseCommandId("   ").ok).toBe(false)
    expect(parseCommandId("langlock status").ok).toBe(false)
    expect(parseCommandId("langlock..status").ok).toBe(false)
    expect(parseCommandId(".langlock.status").ok).toBe(false)
    expect(parseCommandId("langlock.status.").ok).toBe(false)
    expect(parseCommandId("langlock").ok).toBe(false)
    expect(parseCommandId(" langlock.status").ok).toBe(false)
  })

  test("rejects ambiguous/invalid segment characters", () => {
    expect(parseCommandId("lang_lock.status").ok).toBe(false)
    expect(parseCommandId("langlock.Status!").ok).toBe(false)
    expect(parseCommandId("1lang.lock").ok).toBe(false)
  })

  test("domain/operation helpers", () => {
    const r = parseCommandId("semantic.embedding.cutover")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(commandDomain(r.value)).toBe("semantic")
    expect(commandOperation(r.value)).toBe("embedding.cutover")
    expect(commandSegments(r.value)).toEqual(["semantic", "embedding", "cutover"])
  })

  test("normalizeCommandIdInput trims and lowercases", () => {
    expect(normalizeCommandIdInput("  FOO.Bar  ")).toBe("foo.bar")
  })
})
