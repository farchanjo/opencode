import { describe, expect, test } from "bun:test"
import {
  decodeBoundedText,
  MAX_PREVIEW_BYTES,
  renderExport,
  renderFollowFrame,
  renderPage,
  renderQuota,
  renderRefAudit,
  renderRetention,
  renderShare,
  renderStat,
} from "./render"

describe("output renderers", () => {
  test("renders the content-free OutputStat read model with no path field", () => {
    const out = renderStat({
      outputRef: "outref_abc123",
      channel: "stdout",
      state: "sealed",
      committedBytes: 4096,
      fsyncTier: "durable",
      languageTag: "en-US",
      updatedAt: "2026-07-18T00:00:00.000Z",
    })
    expect(out).toContain("output outref_abc123: stdout")
    expect(out).toContain("state: sealed  durability: durable")
    expect(out).toContain("committed bytes: 4096")
    expect(out).toContain("language: en-US")
    expect(out).not.toContain("/")
  })

  test("decodeBoundedText decodes a Uint8Array to UTF-8 text", () => {
    const bytes = new TextEncoder().encode("hello output")
    expect(decodeBoundedText(bytes)).toEqual({ text: "hello output", truncated: false })
  })

  test("decodeBoundedText tolerates a plain numeric array and a numeric-keyed record", () => {
    const bytes = Array.from(new TextEncoder().encode("hi"))
    expect(decodeBoundedText(bytes).text).toBe("hi")
    const record = Object.fromEntries(bytes.map((value, index) => [String(index), value]))
    expect(decodeBoundedText(record).text).toBe("hi")
  })

  test("decodeBoundedText bounds the preview and reports truncation", () => {
    const oversized = new Uint8Array(MAX_PREVIEW_BYTES + 10).fill(97)
    const { text, truncated } = decodeBoundedText(oversized)
    expect(text.length).toBe(MAX_PREVIEW_BYTES)
    expect(truncated).toBe(true)
  })

  test("renders a read page with resume offset, committed length, and no path", () => {
    const out = renderPage({
      page: {
        bytes: new TextEncoder().encode("line one\n"),
        nextOffset: 9,
        committedBytes: 9,
        caughtUp: true,
        eof: false,
      },
    })
    expect(out).toContain("line one")
    expect(out).toContain("next offset: 9  committed: 9  caught up: yes  eof: no")
    expect(out).not.toContain("/tmp")
    expect(out).not.toContain("path")
  })

  test("renders a follow frame carrying the resume cursor", () => {
    const out = renderFollowFrame({
      page: { bytes: new TextEncoder().encode("tail"), nextOffset: 4, committedBytes: 4, caughtUp: false, eof: false },
      cursor: "cursor-opaque-token",
    })
    expect(out).toContain("tail")
    expect(out).toContain("cursor: cursor-opaque-token")
  })

  test("renders a ref+audit admin result (release/delete/purge)", () => {
    const out = renderRefAudit({ outputRef: "outref_xyz", auditId: "audit-1" })
    expect(out).toContain("output: outref_xyz")
    expect(out).toContain("audit id: audit-1")
  })

  test("renders a bounded content-free export preview", () => {
    const out = renderExport({
      preview: { outputRef: "outref_1", headSlice: "first bytes", truncated: true, secretRefs: [] },
      auditId: "audit-2",
    })
    expect(out).toContain("output: outref_1")
    expect(out).toContain("first bytes")
    expect(out).toContain("truncated")
    expect(out).toContain("audit id: audit-2")
  })

  test("renders a share result", () => {
    const out = renderShare({ shareRef: "outref_share", auditId: "audit-3" })
    expect(out).toContain("share ref: outref_share")
  })

  test("renders retention and quota mutation results", () => {
    const retention = renderRetention({
      retention: { ttlSeconds: 3600, hasLiveLease: false, hasActiveReaderOrWriter: false, referenceEdgeKinds: [], legalHold: true },
      auditId: "audit-4",
    })
    expect(retention).toContain("ttl seconds: 3600")
    expect(retention).toContain("legal hold: yes")

    const quota = renderQuota({
      quota: { scope: "global", scopeId: "", maxBytes: 1024, maxQueueDepthBytes: 256 },
      auditId: "audit-5",
    })
    expect(quota).toContain("max bytes: 1024  max queue depth bytes: 256")
  })
})
