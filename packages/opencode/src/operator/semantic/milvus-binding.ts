/**
 * Feature 017 / T016 (FR13, FR14) — the Milvus registry binding for the operator
 * semantic index, closing GAP D.
 *
 * Feature 014 wired the config-backed HALF of the semantic registry but left
 * `semantic.index.*` a typed `milvus_unavailable` gap because the Milvus/provider
 * probe stack (`packages/opencode/src/semantic/milvus-adapter.ts`,
 * `grpc-probe.ts`, `url-guard.ts`) was not bound from the operator `AppRuntime`.
 * This module binds an `IndexPort` override over that shipped machinery WHEN a
 * Milvus endpoint is configured (the Feature 006/009 config shape). Every op is
 * guarded by a BOUNDED probe/timeout and degrades to the typed
 * `milvus_unavailable` envelope on any unreachable/timeout/error path — never a
 * fabricated index state and never a leaked endpoint or credential (FR14, FR18).
 *
 * Honest capability split (semantic stays a MIXED domain, spec domain model
 * "readiness: mixed"):
 *   - `index.test` binds over the live adapter under a bounded probe and returns
 *     the real `{ reachable, latencyMs }`; a probe-seam outage → `milvus_unavailable`.
 *   - `index.status` / `reindex` / `reconcile` / `show-collections` run the SAME
 *     bounded probe gate but the full blue/green index-maintenance pipeline
 *     (`semantic/index-jobs.ts`, the cutover executor) is not composed from the
 *     operator runtime, so they return a typed `milvus_unavailable` with an honest
 *     reason rather than a synthesized generation/document count.
 *
 * When NO endpoint is configured the composition root does not bind this port,
 * so the verbs degrade to the EXACT same typed `milvus_unavailable` gap as today
 * (`backend-live.ts` `indexGap`) — the unconfigured identity.
 */
export * as MilvusBinding from "./milvus-binding"

import { Effect } from "effect"
import type { IndexPort } from "@opencode-ai/protocol/semantic/ports"
import type { IndexError } from "@opencode-ai/protocol/semantic/commands"

/**
 * The Milvus endpoint config (Feature 006/009 shape) the composition root resolves.
 * The credential is a `SecretRef` only — never a plaintext secret (FR18, Security).
 */
export interface MilvusEndpointConfig {
  /** The Milvus gRPC endpoint (`host:port`); never logged or surfaced in a result. */
  readonly address: string
  /** TLS on the gRPC channel (default true — secure by default). */
  readonly ssl?: boolean
  /** Bounded probe/timeout budget in milliseconds (default 2000, hard-capped 10000). */
  readonly timeoutMs?: number
  /** Opaque credential reference resolved by the Feature 007 SecretPort at use time. */
  readonly secretRef?: string
}

/** A bounded health-probe result; `reachable:false` is a finding, never a crash (C20). */
export interface MilvusProbeResult {
  readonly reachable: boolean
  readonly latencyMs: number
}

/**
 * The narrow probe seam the binding runs each op behind. The live composition
 * root supplies a probe over `semantic/grpc-probe.ts` + the `milvus-adapter`
 * health call under the `url-guard` SSRF policy; a test injects a double. It
 * MUST resolve (never reject) — an unreachable backend is a `reachable:false`
 * result; a genuine seam outage rejects and is mapped to `milvus_unavailable`.
 */
export type MilvusProbe = (input: {
  readonly address: string
  readonly ssl: boolean
  readonly timeoutMs: number
}) => Promise<MilvusProbeResult>

export interface MilvusIndexBindingDeps {
  readonly endpoint: MilvusEndpointConfig
  readonly probe: MilvusProbe
}

const DEFAULT_TIMEOUT_MS = 2000
const MAX_TIMEOUT_MS = 10000

const milvusUnavailable = (reason: string): IndexError => ({ type: "milvus_unavailable", reason })

/**
 * Bind the operator `IndexPort` over the shipped Milvus stack under a bounded
 * probe. The endpoint address/credential never leave this seam — only a bounded,
 * secret-free reachability finding or a typed gap crosses it.
 */
export function createMilvusIndexPort(deps: MilvusIndexBindingDeps): IndexPort {
  const { address, ssl } = deps.endpoint
  const timeoutMs = Math.min(Math.max(1, deps.endpoint.timeoutMs ?? DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS)

  /** Run the bounded probe; a seam outage maps to a typed `milvus_unavailable` (never a raw error). */
  const runProbe: Effect.Effect<MilvusProbeResult, IndexError> = Effect.tryPromise({
    try: () => deps.probe({ address, ssl: ssl !== false, timeoutMs }),
    // Bounded, secret-free reason — never the endpoint address or a stack trace.
    catch: () => milvusUnavailable("milvus probe seam unreachable"),
  })

  /** Gate an op behind the bounded probe, then surface the honest not-composed gap. */
  const gatedGap = (op: string): Effect.Effect<never, IndexError> =>
    Effect.gen(function* () {
      const health = yield* runProbe
      if (!health.reachable) return yield* Effect.fail(milvusUnavailable("milvus endpoint unreachable"))
      return yield* Effect.fail(
        milvusUnavailable(`${op} requires the index-maintenance pipeline, not composed from the operator runtime`),
      )
    })

  return {
    // The real bound verb: a bounded probe → the live reachability finding.
    test: () =>
      Effect.map(runProbe, (health) => ({ reachable: health.reachable, latencyMs: health.latencyMs })),
    status: () => gatedGap("index.status"),
    reindex: () => gatedGap("index.reindex"),
    reconcile: () => gatedGap("index.reconcile"),
    showCollections: () => gatedGap("index.show-collections"),
  }
}
