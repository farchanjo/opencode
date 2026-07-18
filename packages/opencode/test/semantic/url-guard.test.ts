/**
 * Feature 006 / T029 (S18) — SSRF/DNS-rebinding guard acceptance.
 *
 * Covers a blocked metadata/link-local target, a rejected non-TLS remote, an
 * allowed local-insecure profile with a warning, and a post-redirect
 * DNS-rebinding rejection (FR33, C17, AC36, AC38).
 */
import { describe, expect, test } from "bun:test"
import { UrlGuard } from "@/semantic/url-guard"

const resolverTo = (map: Record<string, readonly string[]>): UrlGuard.DnsResolver => ({
  resolve: async (host) => map[host] ?? ["203.0.113.10"], // default public
})

const REMOTE: UrlGuard.UrlPolicy = { allowInsecureLocalProfile: false }
const LOCAL: UrlGuard.UrlPolicy = { allowInsecureLocalProfile: true }

describe("isBlockedAddress", () => {
  test("blocks metadata, link-local, loopback, and private ranges", () => {
    for (const ip of ["169.254.169.254", "169.254.1.1", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "::1", "fe80::1"]) {
      expect(UrlGuard.isBlockedAddress(ip)).toBe(true)
    }
  })
  test("allows ordinary public addresses", () => {
    expect(UrlGuard.isBlockedAddress("203.0.113.10")).toBe(false)
    expect(UrlGuard.isBlockedAddress("8.8.8.8")).toBe(false)
  })
})

describe("guard", () => {
  test("blocks a host that resolves to cloud metadata", async () => {
    const result = await UrlGuard.guard(
      { resolver: resolverTo({ "evil.example": ["169.254.169.254"] }) },
      { rawUrl: "https://evil.example/v1", policy: REMOTE },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.type).toBe("ssrf_blocked")
  })

  test("rejects a non-TLS remote endpoint", async () => {
    const result = await UrlGuard.guard({ resolver: resolverTo({}) }, { rawUrl: "http://api.example/v1", policy: REMOTE })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.type).toBe("tls_required")
  })

  test("allows an explicit local-insecure profile with a warning", async () => {
    const result = await UrlGuard.guard(
      { resolver: resolverTo({ localhost: ["127.0.0.1"] }) },
      { rawUrl: "http://localhost:19530/v1", policy: LOCAL },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.length).toBeGreaterThan(0)
  })

  test("accepts a TLS remote that resolves to a public address", async () => {
    const result = await UrlGuard.guard({ resolver: resolverTo({ "api.example": ["203.0.113.5"] }) }, { rawUrl: "https://api.example/v1", policy: REMOTE })
    expect(result.ok).toBe(true)
  })

  test("rejects a malformed URL", async () => {
    const result = await UrlGuard.guard({ resolver: resolverTo({}) }, { rawUrl: "not a url", policy: REMOTE })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.type).toBe("invalid_url")
  })
})

describe("guardRedirect (DNS rebinding)", () => {
  test("rejects a redirect target that resolves to a blocked address", async () => {
    // Original host resolved public, but the redirect Location rebinds to a private IP.
    const result = await UrlGuard.guardRedirect(
      { resolver: resolverTo({ "rebind.example": ["10.0.0.5"] }) },
      { redirectLocation: "https://rebind.example/internal", policy: REMOTE },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.type).toBe("ssrf_blocked")
  })
})
