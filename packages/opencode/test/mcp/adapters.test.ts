import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { McpSdkProbe } from "@/mcp/sdk-probe"
import { McpProgressSink } from "@/mcp/progress-sink"
import { McpSpoolBridge } from "@/mcp/spool-bridge"
import type { SpoolPort } from "@opencode-ai/protocol/mcp/ports"

describe("sdk-probe (T024)", () => {
  test("the installed SDK exposes the required client surface and routes through the SDK", () => {
    const report = McpSdkProbe.probeInstalledSdk()
    expect(report.findings.length).toBe(
      McpSdkProbe.REQUIRED_CLIENT_METHODS.length + McpSdkProbe.REQUIRED_SCHEMAS.length,
    )
    // Every finding is typed present/gap; a present surface has no gap.
    for (const f of report.findings) {
      if (f.present) expect(f.gap).toBeNull()
      else expect(f.gap).not.toBe("none")
    }
  })

  test("a missing surface records a typed capability gap, never a hard failure (C1)", () => {
    const report = McpSdkProbe.probeSurface({}) // nothing present
    expect(report.degraded).toBe(true)
    expect(report.complete).toBe(false)
    expect(report.findings.every((f) => !f.present && f.gap === "feature_unsupported")).toBe(true)
  })
})

describe("progress-sink (T026)", () => {
  test("wire progress is monotonic; a decrease is rejected and never invents a value", () => {
    const seen: number[] = []
    const sink = McpProgressSink.createProgressSink({ nowMillis: () => 0, minDisplayIntervalMs: 0, onAccepted: (e) => seen.push(e.progress) })
    expect(sink.handle({ progressToken: "t", progress: 1 }).kind).toBe("accepted")
    expect(sink.handle({ progressToken: "t", progress: 3 }).kind).toBe("accepted")
    const down = sink.handle({ progressToken: "t", progress: 2 })
    expect(down.kind).toBe("rejected")
    expect(down.resetTimeout).toBe(false)
    expect(seen).toEqual([1, 3]) // the rejected frame never reached the sink
  })

  test("display frames are rate-limited (coalesced) but wire values still process + reset the timeout", () => {
    let now = 0
    const sink = McpProgressSink.createProgressSink({ nowMillis: () => now, minDisplayIntervalMs: 100 })
    expect(sink.handle({ progressToken: "t", progress: 1 }).display).toBe(true)
    now = 50
    const coalesced = sink.handle({ progressToken: "t", progress: 2 })
    expect(coalesced.kind).toBe("coalesced")
    expect(coalesced.resetTimeout).toBe(true) // preserves resetTimeoutOnProgress
    now = 200
    expect(sink.handle({ progressToken: "t", progress: 3 }).display).toBe(true)
  })
})

function fakeSpool(receipt: { outputRef: string; byteLength: number; previewBytes: number }): SpoolPort {
  return { spool: () => Effect.succeed({ ...receipt, kind: "text", provenance: "untrusted" } as never) }
}

describe("spool-bridge (T028)", () => {
  test("describeContent measures a base64/data-URL body without inlining it", () => {
    const dataUrl = McpSpoolBridge.describeContent({ type: "image", data: "data:image/png;base64,iVBORw0KGgo=" })
    expect(dataUrl.kind).toBe("image")
    expect(dataUrl.mimeType).toBe("image/png")
    expect(dataUrl.byteLength).toBeGreaterThan(0)
    const text = McpSpoolBridge.describeContent({ type: "text", text: "hello" })
    expect(text.byteLength).toBe(5)
  })

  test("spoolContent yields a bounded preview + OutputRef, an honest ram spill, and never a path", async () => {
    const bridge = McpSpoolBridge.createSpoolBridge({ spool: fakeSpool({ outputRef: "out_abc", byteLength: 52_000_000, previewBytes: 4096 }) })
    const env = await Effect.runPromise(bridge.spoolContent("srv", { kind: "text", mimeType: "text/plain", byteLength: 52_000_000 }))
    expect(env.outputRef).toBe("out_abc")
    expect(env.previewBytes).toBe(4096)
    expect(env.ramSpillApplied).toBe(true)
    expect(env.outputRef).not.toContain("/") // the OutputRef is an opaque handle, never a filesystem path
    expect(env).not.toHaveProperty("path")
  })

  test("a size/MIME/decompression cap in the spool port surfaces as a typed error, not a body", async () => {
    const capped: SpoolPort = { spool: () => Effect.fail({ type: "size_limit_exceeded", bytes: 99 }) }
    const bridge = McpSpoolBridge.createSpoolBridge({ spool: capped })
    const exit = await Effect.runPromiseExit(bridge.spoolContent("srv", { kind: "text", byteLength: 99 }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
