import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import * as TrustGate from "@opencode-ai/core/mcp/trust-gate"
import { McpSpoolBridge } from "@/mcp/spool-bridge"
import { McpSecretBridge } from "@/mcp/secret-bridge"
import { McpResourceAdapter } from "@/mcp/resource-adapter"
import type { SecretResolvePort, SpoolPort } from "@opencode-ai/protocol/mcp/ports"

// Feature 008 / T044 — the spool-integration and security/privacy matrix: an
// OutputGroup per call/read with a bounded preview + OutputRef never a path,
// base64/data-URL decode-to-spool under MIME/size caps with the honest post-parse
// spill; the SecretRef-only OAuth cutover (no plaintext); the URI allowlist + SSRF
// controls (metadata/link-local/private ranges blocked, cross-project fail-closed);
// untrusted-content/provenance labels; and decompression-bomb rejection pre-delivery.

function fakeSpool(receipt: { outputRef: string; byteLength: number; previewBytes: number }): SpoolPort {
  return { spool: () => Effect.succeed({ ...receipt, kind: "text", provenance: "untrusted" } as never) }
}

describe("spool OutputGroup (T044)", () => {
  test("a ~52MB result yields a bounded preview + OutputRef, honest spill, and no path", async () => {
    const bridge = McpSpoolBridge.createSpoolBridge({
      spool: fakeSpool({ outputRef: "out_big", byteLength: 52_000_000, previewBytes: 4096 }),
    })
    const env = await Effect.runPromise(
      bridge.spoolContent("srv", { kind: "text", mimeType: "text/plain", byteLength: 52_000_000 }),
    )
    expect(env.outputRef).toBe("out_big")
    expect(env.previewBytes).toBe(4096)
    expect(env.ramSpillApplied).toBe(true)
    expect(env.outputRef).not.toContain("/")
    expect(env).not.toHaveProperty("path")
  })

  test("a base64 data-URL body is measured without inlining and MIME-classified", () => {
    const described = McpSpoolBridge.describeContent({ type: "image", data: "data:image/png;base64,iVBORw0KGgo=" })
    expect(described.kind).toBe("image")
    expect(described.mimeType).toBe("image/png")
    expect(described.byteLength).toBeGreaterThan(0)
  })

  test("a spool-side size/MIME/decompression cap surfaces as a typed failure, never a body", async () => {
    const capped: SpoolPort = { spool: () => Effect.fail({ type: "size_limit_exceeded", bytes: 9_999 }) }
    const bridge = McpSpoolBridge.createSpoolBridge({ spool: capped })
    const exit = await Effect.runPromiseExit(bridge.spoolContent("srv", { kind: "text", byteLength: 9_999 }))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).not.toContain("iVBORw0")
  })
})

describe("SecretRef-only cutover (T044)", () => {
  test("the one-time migration mints an opaque ref per token-bearing entry, never plaintext", () => {
    const port: SecretResolvePort = { resolve: () => Effect.succeed({ handle: "h" }) }
    const bridge = McpSecretBridge.createSecretBridge({ secrets: port })
    const refs = bridge.migrateLegacyEntries([
      { server: "gh", hasTokens: true },
      { server: "empty", hasTokens: false },
    ])
    expect(refs).toEqual([{ server: "gh", secretRef: "mcp/oauth/gh" }])
    const serialized = JSON.stringify(refs)
    expect(serialized).not.toContain("token")
    expect(serialized).not.toContain("Bearer")
  })
})

describe("URI allowlist + SSRF controls (T044)", () => {
  const cfg = { schemes: new Set(["https"]), roots: ["/proj/a"] }

  test("https is allowed; a non-allowlisted scheme is deny-by-default", () => {
    expect(McpResourceAdapter.checkUriAllowed("https://example.com/x", cfg).allowed).toBe(true)
    const http = McpResourceAdapter.checkUriAllowed("http://example.com/x", cfg)
    expect(http.allowed).toBe(false)
    expect(http.allowed === false && http.reason).toBe("scheme_denied")
  })

  test("file is confined to authorized roots — cross-project fails closed", () => {
    expect(McpResourceAdapter.checkUriAllowed("file:///proj/a/doc.txt", cfg).allowed).toBe(true)
    const cross = McpResourceAdapter.checkUriAllowed("file:///etc/passwd", cfg)
    expect(cross.allowed).toBe(false)
    expect(cross.allowed === false && cross.reason).toBe("cross_root_denied")
  })

  test("the cloud metadata endpoint and private/link-local/loopback ranges are SSRF-blocked over https", () => {
    for (const host of ["169.254.169.254", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.9", "[::1]"]) {
      const decision = McpResourceAdapter.checkUriAllowed(`https://${host}/meta`, cfg)
      expect(decision.allowed).toBe(false)
      expect(decision.allowed === false && decision.reason).toBe("ssrf_blocked")
    }
  })

  test("a public DNS host passes; loopback is admitted only under an explicit allowLoopback config", () => {
    expect(McpResourceAdapter.checkUriAllowed("https://api.example.com/", cfg).allowed).toBe(true)
    const loopbackCfg = { schemes: new Set(["http"]), roots: [], allowLoopback: true }
    expect(McpResourceAdapter.checkUriAllowed("http://127.0.0.1:8976/callback", loopbackCfg).allowed).toBe(true)
    // Without allowLoopback, the same loopback host is blocked.
    const strictCfg = { schemes: new Set(["http"]), roots: [] }
    expect(McpResourceAdapter.checkUriAllowed("http://127.0.0.1:8976/callback", strictCfg).allowed).toBe(false)
  })
})

describe("trust gate (T044)", () => {
  test("server content is external/untrusted by default; only operator elevation is trusted", () => {
    expect(TrustGate.labelProvenance({ operatorElevated: false, untrustedFlag: false })).toBe("external")
    expect(TrustGate.labelProvenance({ operatorElevated: false, untrustedFlag: true })).toBe("untrusted")
    expect(TrustGate.labelProvenance({ operatorElevated: true, untrustedFlag: true })).toBe("trusted")
    expect(TrustGate.annotationsTrusted("untrusted")).toBe(false)
  })

  test("tolerant outputSchema delivers a warning; strict blocks as an isError-class failure", () => {
    expect(TrustGate.validateOutput("tolerant", false)).toMatchObject({ kind: "warning", deliver: true })
    expect(TrustGate.validateOutput("strict", false)).toMatchObject({ kind: "error", deliver: false })
    expect(TrustGate.validateOutput("strict", true).kind).toBe("valid")
  })

  test("an oversized payload and a decompression bomb are rejected before delivery", () => {
    const limits = { maxBytes: 1_000, maxDecompressionRatio: 100 }
    expect(TrustGate.checkSize({ decodedBytes: 2_000, encodedBytes: 1_500 }, limits)).toMatchObject({
      kind: "reject",
      reason: "size_limit_exceeded",
    })
    expect(TrustGate.checkSize({ decodedBytes: 900, encodedBytes: 1 }, limits)).toMatchObject({
      kind: "reject",
      reason: "decompression_bomb",
    })
    expect(TrustGate.checkSize({ decodedBytes: 500, encodedBytes: 250 }, limits).kind).toBe("accept")
  })
})
