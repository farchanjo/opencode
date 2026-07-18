import { describe, expect, test } from "bun:test"
import { CursorCodec } from "@opencode-ai/core/outputspool/cursor-codec"

// Feature 005 / T016 (S6) — opaque cursor codec + integrity tag. Deterministic
// over an injected MAC and clock reading (C14, C18, AC4).

// A deterministic MAC: a stable non-cryptographic digest of the payload string.
const mac: CursorCodec.MacPort = {
  sign: (material) => {
    let h = 2166136261
    for (let i = 0; i < material.length; i++) {
      h ^= material.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(16)
  },
}

const claims = (offset: number, generation: number, issued_at_ms: number): CursorCodec.CursorClaims => ({
  group_id: "grp_1" as unknown as CursorCodec.GroupId,
  generation: generation as unknown as CursorCodec.Generation,
  channel: "stdout" as unknown as CursorCodec.Channel,
  offset: offset as unknown as CursorCodec.ByteOffset,
  issued_at_ms,
})

describe("CursorCodec — encode/decode round-trip", () => {
  test("decodes back to the exact bound generation and offset", () => {
    const c = claims(4096, 2, 1000)
    const encoded = CursorCodec.encode(c, mac)
    const decoded = CursorCodec.decode(encoded.token, mac)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.claims.offset).toBe(c.offset)
      expect(decoded.claims.generation).toBe(c.generation)
      expect(decoded.claims.group_id).toBe(c.group_id)
    }
  })

  test("exposes the integrity tag on the encoded cursor", () => {
    const encoded = CursorCodec.encode(claims(0, 0, 0), mac)
    expect(encoded.integrity_tag.length).toBeGreaterThan(0)
    expect(encoded.token).toContain(String(encoded.integrity_tag))
  })
})

describe("CursorCodec — integrity tag tamper", () => {
  test("rejects a tampered payload with a stable invalid_cursor", () => {
    const encoded = CursorCodec.encode(claims(10, 1, 0), mac)
    const tampered = "AAAA" + encoded.token.slice(4)
    const decoded = CursorCodec.decode(tampered, mac)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error_code).toBe("invalid_cursor")
  })

  test("rejects a malformed token", () => {
    const decoded = CursorCodec.decode("not-a-cursor", mac)
    expect(decoded.ok).toBe(false)
  })
})

describe("CursorCodec — validation", () => {
  const ctx = (over: Partial<CursorCodec.ValidateContext>): CursorCodec.ValidateContext => ({
    active_generation: 1 as unknown as CursorCodec.Generation,
    group_released: false,
    sealed: false,
    now_ms: 1000,
    idle_ttl_ms: 5000,
    ...over,
  })

  test("an in-validity cursor is active", () => {
    expect(CursorCodec.validate(claims(0, 1, 500), ctx({})).state).toBe("active")
  })

  test("a superseded generation is invalidated as expired", () => {
    const status = CursorCodec.validate(claims(0, 0, 500), ctx({ active_generation: 2 as unknown as CursorCodec.Generation }))
    expect(status.state).toBe("invalidated")
    expect(status.error_code).toBe("expired")
  })

  test("a released group invalidates the cursor", () => {
    expect(CursorCodec.validate(claims(0, 1, 500), ctx({ group_released: true })).state).toBe("invalidated")
  })

  test("idle-TTL after seal expires the cursor", () => {
    const status = CursorCodec.validate(claims(0, 1, 0), ctx({ sealed: true, now_ms: 10000, idle_ttl_ms: 5000 }))
    expect(status.state).toBe("invalidated")
    expect(status.error_code).toBe("expired")
  })
})
