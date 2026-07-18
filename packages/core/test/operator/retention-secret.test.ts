import { describe, expect, test } from "bun:test"
import {
  AUDIT_RETENTION_DAYS,
  findPlaintextSecretFields,
  parseSecretRef,
  selectAuditsToPrune,
  selectSnapshotsToPrune,
  SNAPSHOT_MAX_AGE_DAYS,
  SNAPSHOT_MAX_COUNT,
  auditIsSecretFree,
} from "../../src/operator"

describe("retention policy (T016/T024 constants)", () => {
  test("snapshot limits are 10 or 30 days", () => {
    expect(SNAPSHOT_MAX_COUNT).toBe(10)
    expect(SNAPSHOT_MAX_AGE_DAYS).toBe(30)
  })

  test("audit retention is 90 days", () => {
    expect(AUDIT_RETENTION_DAYS).toBe(90)
  })

  test("11th snapshot drops oldest", () => {
    const now = 1_000_000
    const entries = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      createdAtMs: now - i * 1000,
    }))
    const drop = selectSnapshotsToPrune(entries, now)
    expect(drop).toContain("s10")
    expect(drop.length).toBeGreaterThanOrEqual(1)
  })

  test("aged snapshots pruned beyond 30 days", () => {
    const now = 100 * 86_400_000
    const entries = [
      { id: "fresh", createdAtMs: now - 1000 },
      { id: "old", createdAtMs: now - 40 * 86_400_000 },
    ]
    const drop = selectSnapshotsToPrune(entries, now)
    expect(drop).toEqual(["old"])
  })

  test("audit prune selects older than 90 days", () => {
    const now = 200 * 86_400_000
    const entries = [
      { id: "keep", createdAtMs: now - 10 * 86_400_000 },
      { id: "drop", createdAtMs: now - 100 * 86_400_000 },
    ]
    expect(selectAuditsToPrune(entries, now)).toEqual(["drop"])
  })
})

describe("secret ref + plaintext detection (T018/T021)", () => {
  test("parses SecretRef", () => {
    const r = parseSecretRef({ backend: "keychain", name: "openai", version: 1 })
    expect(r.ok).toBe(true)
  })

  test("finds plaintext secret fields; allows SecretRef", () => {
    expect(findPlaintextSecretFields({ apiKey: "sk_live_abc" })).toEqual(["apiKey"])
    expect(
      findPlaintextSecretFields({
        apiKey: { backend: "keychain", name: "k", version: 1 },
      }),
    ).toEqual([])
  })

  test("auditIsSecretFree rejects secret-like keys", () => {
    expect(auditIsSecretFree({ source: "cli", commandId: "x" })).toBe(true)
    expect(auditIsSecretFree({ password: "x" })).toBe(false)
  })
})
