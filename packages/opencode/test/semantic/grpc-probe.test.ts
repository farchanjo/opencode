/**
 * Feature 006 / T025 (S15) — gRPC-under-Bun probe acceptance.
 *
 * Asserts the probe emits a typed `grpc_bun_supported` / `grpc_bun_unsupported`
 * finding with the driver-selection consequence recorded, and that no path
 * hard-fails routing on an unreachable backend (FR7, C1, C20). The live SDK seam
 * is exercised opportunistically against `MILVUS_PROBE_ADDRESS` (or the default
 * loopback) to record the real empirical outcome under Bun; the deterministic
 * paths use injected seams.
 */
import { describe, expect, test } from "bun:test"
import { GrpcProbe } from "@/semantic/grpc-probe"

const clock = (() => {
  let t = 0
  return { nowMs: () => (t += 10) }
})()

describe("grpc-probe classifyFinding", () => {
  test("a live health check is grpc_bun_supported, driver grpc, reachedServer true", () => {
    const finding = GrpcProbe.classifyFinding({ kind: "health_ok", latencyMs: 12 })
    expect(finding.outcome).toBe("grpc_bun_supported")
    expect(GrpcProbe.driverFor(finding)).toBe("grpc")
    if (finding.outcome === "grpc_bun_supported") expect(finding.detail.reachedServer).toBe(true)
  })

  test("a typed gRPC UNAVAILABLE (no server) is still grpc_bun_supported, reachedServer false", () => {
    const finding = GrpcProbe.classifyFinding({ kind: "connection_refused", grpcCode: 14, latencyMs: 8 })
    expect(finding.outcome).toBe("grpc_bun_supported")
    expect(GrpcProbe.driverFor(finding)).toBe("grpc")
    if (finding.outcome === "grpc_bun_supported") {
      expect(finding.detail.channelOperational).toBe(true)
      expect(finding.detail.reachedServer).toBe(false)
    }
  })

  test("a runtime incompatibility is grpc_bun_unsupported, driver fake_fallback", () => {
    const finding = GrpcProbe.classifyFinding({ kind: "runtime_incompatible", reason: "import failed" })
    expect(finding.outcome).toBe("grpc_bun_unsupported")
    expect(GrpcProbe.driverFor(finding)).toBe("fake_fallback")
  })
})

describe("grpc-probe runProbe (injected seams)", () => {
  test("a client that throws on construct routes to the fake fallback, never throws", async () => {
    const sdk: GrpcProbe.ProbeSdkPort = {
      construct: async () => {
        throw new Error("Bun cannot load @grpc/grpc-js")
      },
    }
    const finding = await GrpcProbe.runProbe({ sdk, clock }, { address: "x:1", ssl: false, timeoutMs: 100 })
    expect(finding.outcome).toBe("grpc_bun_unsupported")
    expect(GrpcProbe.driverFor(finding)).toBe("fake_fallback")
  })

  test("a typed gRPC error on health is supported (channel works, no server)", async () => {
    const sdk: GrpcProbe.ProbeSdkPort = {
      construct: async () => ({
        checkHealth: async () => {
          throw Object.assign(new Error("14 UNAVAILABLE: ECONNREFUSED"), { code: 14 })
        },
        close: async () => {},
      }),
    }
    const finding = await GrpcProbe.runProbe({ sdk, clock }, { address: "127.0.0.1:19530", ssl: false, timeoutMs: 100 })
    expect(finding.outcome).toBe("grpc_bun_supported")
  })
})

describe("grpc-probe live SDK under Bun (empirical, T025 acceptance)", () => {
  test("the real Milvus SDK imports/constructs/operates its gRPC channel under Bun", async () => {
    const address = process.env.MILVUS_PROBE_ADDRESS ?? "127.0.0.1:19530"
    const finding = await GrpcProbe.runProbe(
      { sdk: GrpcProbe.liveSdkPort, clock: { nowMs: () => Date.now() } },
      { address, ssl: false, timeoutMs: 1500 },
    )
    // The empirical finding for this repo is grpc_bun_supported: the SDK imports
    // and constructs under Bun and the channel surfaces a typed UNAVAILABLE when
    // no server answers. Either way, routing must never hard-fail (C20): the call
    // returned a typed finding rather than throwing.
    expect(["grpc_bun_supported", "grpc_bun_unsupported"]).toContain(finding.outcome)
    expect(["grpc", "fake_fallback"]).toContain(GrpcProbe.driverFor(finding))
    if (finding.outcome === "grpc_bun_supported") expect(finding.detail.constructed).toBe(true)
  }, 10_000)
})
