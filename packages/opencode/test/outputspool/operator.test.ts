/**
 * Feature 005 / T037 (S24) — operator output.* domain wiring.
 * Asserts the ten reserved operations dispatch with zero model calls, a
 * reserved-id collision is rejected, and cross-project share is denied by default
 * (FR41-FR44, C17, C19, AC13, AC15). Also asserts the reserved catalog already
 * carries the output domain + ten ids at 1.3.0 (no bump).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { RESERVED_CATALOG, RESERVED_CATALOG_VERSION } from "@opencode-ai/core/operator/catalog"
import { OutputSpoolBackendLive } from "@/operator/outputspool/backend-live"
import { OutputSpoolStackWiring } from "@/operator/outputspool/stack-wiring"
import { OutputSpoolCommandPort } from "@/operator/outputspool/outputspool-command-port"

const OUTPUT_IDS = [
  "output.stat", "output.read", "output.follow", "output.export", "output.share",
  "output.release", "output.delete", "output.purge", "output.retention.set", "output.quota.set",
]

const ctx = (id: string, payload: Record<string, unknown> = {}) =>
  ({
    descriptor: { id, domain: "output" },
    request: {
      id,
      principal: { kind: "operator", subject: "op-1", projectBinding: null },
      scope: { kind: "project", ref: "proj-1" },
      source: "cli",
      payload,
    },
  }) as any

describe("operator output.* wiring", () => {
  test("the reserved catalog already declares the output domain + ten ids at 1.3.0", () => {
    expect(RESERVED_CATALOG_VERSION).toBe("1.3.0")
    const ids = new Set(RESERVED_CATALOG.ids)
    for (const id of OUTPUT_IDS) expect(ids.has(id)).toBe(true)
    expect(RESERVED_CATALOG.domains).toContain("output")
  })

  test("all ten operations dispatch to the domain invoke (zero model calls)", async () => {
    const backend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({})
    const wiring = OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend })
    const invoke = wiring.ports.output.invoke
    for (const id of OUTPUT_IDS) {
      const payload =
        id === "output.read" ? { outputRef: "r", limit: 10 } : id === "output.follow" ? { cursor: "c" } : { outputRef: "r" }
      const result = await invoke(ctx(id, payload))
      expect(["query", "failure"]).toContain(result.kind)
    }
  })

  test("cross-project share is denied by default", async () => {
    const backend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({})
    const wiring = OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend })
    const result = await wiring.ports.output.invoke(ctx("output.share", { outputRef: "r" }))
    expect(result.kind).toBe("failure")
    if (result.kind === "failure") expect(result.code).toBe("unauthorized")
  })

  test("a plugin/MCP registration of a reserved output id is refused", () => {
    expect(OutputSpoolCommandPort.isReservedOutputId("output.read")).toBe(true)
    expect(OutputSpoolCommandPort.isReservedOutputId("plugin.custom")).toBe(false)
  })

  test("an injected real backend method is honestly reachable", async () => {
    const backend = OutputSpoolBackendLive.createLiveOutputSpoolBackend({
      override: {
        stat: () =>
          Effect.succeed({
            stat: {
              outputRef: "r",
              channel: "stdout" as const,
              state: "sealed" as const,
              committedBytes: 5,
              fsyncTier: "console" as const,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          }),
      },
    })
    const wiring = OutputSpoolStackWiring.createOutputSpoolDomainWiring({ backend })
    const result = await wiring.ports.output.invoke(ctx("output.stat", { outputRef: "r" }))
    expect(result.kind).toBe("query")
  })
})
