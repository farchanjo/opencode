/**
 * Feature 006 / T025 (S15) — gRPC-under-Bun capability probe for the Milvus
 * SDK.
 *
 * `@zilliz/milvus2-sdk-node` is a gRPC client (`@grpc/grpc-js`,
 * `@grpc/proto-loader`, `protobufjs`, `generic-pool`); its behavior under the
 * Bun runtime is a named plan risk (research.md "gRPC-under-Bun implication").
 * This module records the EMPIRICAL, TYPED capability outcome and its
 * driver-selection consequence — the task's acceptance is the recorded finding,
 * never forced success (FR7, C1).
 *
 * The classifier distinguishes a Bun-runtime INCOMPATIBILITY (import/construct
 * throws, or a non-gRPC runtime error) from a mere CONNECTION failure (a typed
 * gRPC status such as `UNAVAILABLE` when no server is reachable). A connection
 * failure still proves the gRPC channel constructs, pools, retries, and surfaces
 * a typed status under Bun — i.e. `grpc_bun_supported`. Only a runtime
 * incompatibility yields `grpc_bun_unsupported`, which routes the single Milvus
 * port through the injected fake / HTTP-fallback adapter instead of the gRPC
 * driver. No probe outcome hard-fails routing on an unreachable backend (C20).
 *
 * The empirical run recorded for this repository (macOS, Bun 1.3.x, SDK 3.0.3):
 * the SDK imports (`MilvusClient` is a function), constructs a client with its
 * channel pool in ~44ms, and `checkHealth()` against an unreachable
 * `127.0.0.1:19530` returns a typed gRPC `Error 14 UNAVAILABLE` (ECONNREFUSED,
 * retried three times) rather than crashing — a `grpc_bun_supported` finding,
 * driver = `grpc`. See research.md "gRPC-under-Bun empirical validation (T025)".
 */
export * as GrpcProbe from "./grpc-probe"

/** Which Milvus driver the single Milvus port binds behind, per the recorded finding. */
export type MilvusDriver = "grpc" | "fake_fallback"

/** Observable facts captured while attempting the probe (content-free, C22). */
export interface GrpcProbeDetail {
  /** The SDK module imported under the Bun runtime. */
  readonly imported: boolean
  /** A `MilvusClient` constructed (its gRPC channel pool built) under Bun. */
  readonly constructed: boolean
  /** The channel operated: a health call returned, or failed with a typed gRPC status. */
  readonly channelOperational: boolean
  /** A live Milvus server answered the health call (false when only a typed UNAVAILABLE was seen). */
  readonly reachedServer: boolean
  readonly latencyMs: number
}

/** The typed gRPC-under-Bun capability finding and its driver-selection consequence (FR7, C1). */
export type GrpcBunFinding =
  | {
      readonly outcome: "grpc_bun_supported"
      readonly driver: "grpc"
      readonly detail: GrpcProbeDetail
    }
  | {
      readonly outcome: "grpc_bun_unsupported"
      readonly driver: "fake_fallback"
      readonly reason: string
    }

/**
 * A single probe attempt result. `connection_refused` is a typed gRPC status
 * (`grpcCode`, e.g. 14 UNAVAILABLE) proving the channel works but no server
 * answered; `runtime_incompatible` is an import/construct/runtime failure that
 * means the gRPC stack does not operate under Bun.
 */
export type ProbeAttempt =
  | { readonly kind: "health_ok"; readonly latencyMs: number }
  | { readonly kind: "connection_refused"; readonly grpcCode: number; readonly latencyMs: number }
  | { readonly kind: "runtime_incompatible"; readonly reason: string }

/**
 * Classify a probe attempt into the typed finding. A live health call or a typed
 * gRPC connection status both prove the channel operates under Bun
 * (`grpc_bun_supported`, driver `grpc`); only a runtime incompatibility routes to
 * the fake fallback (`grpc_bun_unsupported`). Pure and deterministic.
 */
export const classifyFinding = (attempt: ProbeAttempt): GrpcBunFinding => {
  if (attempt.kind === "runtime_incompatible") {
    return { outcome: "grpc_bun_unsupported", driver: "fake_fallback", reason: attempt.reason }
  }
  const reachedServer = attempt.kind === "health_ok"
  return {
    outcome: "grpc_bun_supported",
    driver: "grpc",
    detail: {
      imported: true,
      constructed: true,
      channelOperational: true,
      reachedServer,
      latencyMs: attempt.latencyMs,
    },
  }
}

/** The recorded driver the Milvus port binds behind for a given finding (FR7, C1). */
export const driverFor = (finding: GrpcBunFinding): MilvusDriver => finding.driver

/** A grpc-status-bearing error carries a numeric `code` (the gRPC status). */
function grpcStatusCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code: unknown }).code
    if (typeof code === "number") return code
  }
  return undefined
}

/** The narrow probe seam an adapter injects; the real one lazily imports the SDK. */
export interface ProbeHealthClient {
  readonly checkHealth: () => Promise<boolean>
  readonly close: () => Promise<void>
}

export interface ProbeSdkPort {
  /** Load the SDK and construct a health client, or throw a runtime-incompatibility error. */
  readonly construct: (input: ProbeInput) => Promise<ProbeHealthClient>
}

export interface ProbeInput {
  readonly address: string
  readonly ssl: boolean
  readonly timeoutMs: number
}

export interface ClockPort {
  readonly nowMs: () => number
}

/**
 * Run the probe over an injected SDK seam and clock, mapping the observed
 * behavior to a typed attempt then a typed finding. Import/construct failures
 * classify as `runtime_incompatible`; a typed gRPC status classifies as
 * `connection_refused`; a successful health call classifies as `health_ok`.
 * Never throws — an unreachable backend is a finding, not a failure (C20).
 */
export const runProbe = async (
  deps: { readonly sdk: ProbeSdkPort; readonly clock: ClockPort },
  input: ProbeInput,
): Promise<GrpcBunFinding> => classifyFinding(await attempt(deps, input))

async function attempt(
  deps: { readonly sdk: ProbeSdkPort; readonly clock: ClockPort },
  input: ProbeInput,
): Promise<ProbeAttempt> {
  const started = deps.clock.nowMs()
  let client: ProbeHealthClient
  try {
    client = await deps.sdk.construct(input)
  } catch (error) {
    return { kind: "runtime_incompatible", reason: describe(error) }
  }
  return runHealth(client, deps.clock, started)
}

async function runHealth(
  client: ProbeHealthClient,
  clock: ClockPort,
  started: number,
): Promise<ProbeAttempt> {
  try {
    const ok = await client.checkHealth()
    const latencyMs = clock.nowMs() - started
    if (ok) return { kind: "health_ok", latencyMs }
    return { kind: "connection_refused", grpcCode: 14, latencyMs }
  } catch (error) {
    const code = grpcStatusCode(error)
    if (code !== undefined) return { kind: "connection_refused", grpcCode: code, latencyMs: clock.nowMs() - started }
    return { kind: "runtime_incompatible", reason: describe(error) }
  } finally {
    await client.close().catch(() => {})
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 200)
  return String(error).slice(0, 200)
}

/**
 * The real SDK seam: lazily import `@zilliz/milvus2-sdk-node` and construct a
 * `MilvusClient`. A thrown import/construct error is surfaced to the classifier
 * as a runtime incompatibility (`grpc_bun_unsupported`).
 */
export const liveSdkPort: ProbeSdkPort = {
  construct: async (input) => {
    const mod = (await import("@zilliz/milvus2-sdk-node")) as {
      readonly MilvusClient: new (config: {
        address: string
        ssl: boolean
        timeout: number
      }) => {
        checkHealth: () => Promise<{ isHealthy?: boolean }>
        closeConnection?: () => Promise<unknown>
      }
    }
    const client = new mod.MilvusClient({ address: input.address, ssl: input.ssl, timeout: input.timeoutMs })
    return {
      checkHealth: async () => {
        const res = await client.checkHealth()
        return res.isHealthy === true
      },
      close: async () => {
        await client.closeConnection?.()
      },
    }
  },
}
