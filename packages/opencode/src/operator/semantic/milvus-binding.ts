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
import { IndexJobs } from "@/semantic/index-jobs"
import type { MilvusPort, MilvusGap } from "@/semantic/milvus-adapter"
import { isTransientDataPlaneError, withDataPlaneRetry } from "@/util/effect-http-client"
import { DataPlaneRetryStats } from "@/semantic/data-plane-retry-stats"
import type { IndexPort } from "@opencode-ai/protocol/semantic/ports"
import type { CollectionKind, IndexError } from "@opencode-ai/protocol/semantic/commands"

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

/**
 * Feature 019 / T008 (FR6, FR7) — the per-collection live-doc source. It projects
 * the current agents/skills/skill_chunks/tools into content-hashed, content-free
 * `LiveDoc`s (the agent/skill builders join the shipped `toolLiveDoc`), embedding the
 * dense/sparse vectors from the bound embedding client. When no embedding provider is
 * configured it MUST reject rather than fabricate vectors — the reconcile then
 * degrades to a typed gap.
 */
export interface LiveDocSource {
  readonly collect: (input: {
    readonly collection: CollectionKind
    readonly projectId: string
    /** Feature 050 (C2 fix) — a full rebuild embeds EVERY doc (the source disables its embed-skip). */
    readonly full?: boolean
  }) => Promise<readonly IndexJobs.LiveDoc[]>
}

/** The reconcile projection context: the project partition + the pinned binding version (never re-pinned, FR7). */
export interface MaintenanceContext {
  readonly projectId: string
  readonly bindingVersion: number
}

export interface MilvusIndexBindingDeps {
  readonly endpoint: MilvusEndpointConfig
  readonly probe: MilvusProbe
  /**
   * Feature 019 (FR6, FR7) — the live Milvus port + the bound live-doc source. When
   * BOTH are present, `reindex`/`reconcile` compose `runReconcile` (diff the live-doc
   * source against the enumerated indexed docs, apply upserts/tombstones) and report
   * content-free counts with the pinned binding version UNCHANGED. When either is
   * absent, the maintenance verbs keep the honest not-composed `milvus_unavailable` gap.
   */
  readonly port?: MilvusPort
  readonly source?: LiveDocSource
  /** Resolve the reconcile projection context (project + pinned binding version) per run. */
  readonly context?: () => Promise<MaintenanceContext>
  /** The Feature 005 spool sink for the bounded job log; a bounded content-free ref when absent. */
  readonly spool?: IndexJobs.OutputSpoolSink
}

const DEFAULT_TIMEOUT_MS = 2000
const MAX_TIMEOUT_MS = 10000

const milvusUnavailable = (reason: string): IndexError => ({ type: "milvus_unavailable", reason })

/** A content-free spool fallback: returns a bounded, secret-free ref, never a job body (C22). */
const boundedSpool: IndexJobs.OutputSpoolSink = {
  spool: (input) => Effect.succeed(`spool:reconcile:${input.collection}`),
}

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

  const port = deps.port
  const source = deps.source
  const spool = deps.spool ?? boundedSpool

  // Feature 050 (FR12) — bound, jittered-exponential transient-only retry for the MAINTENANCE
  // data plane (never the live query runner). `milvus_unavailable`/transport retries; a domain gap
  // (`invalid_filters`/`cas_conflict`/`dimension_mismatch`) never does. Each taken retry increments
  // the resilience `retry_count` recorder (AC7).
  const dataPlaneRetry = <A>(effect: Effect.Effect<A, MilvusGap>): Effect.Effect<A, MilvusGap> =>
    withDataPlaneRetry(effect, isTransientDataPlaneError, { onRetry: DataPlaneRetryStats.record })

  /**
   * Feature 019 (FR6, FR7) — run one collection's reconcile over the live port: read
   * the pinned context, collect the live docs, enumerate the indexed docs, then diff +
   * apply via `runReconcile`. `full` forces a rebuild (indexed treated as empty → every
   * live doc upserts); a scheduled reconcile diffs the real enumerated state. The pinned
   * binding version is carried UNCHANGED — a reconcile never re-pins the binding.
   */
  const runMaintenance = (collection: CollectionKind, full: boolean): Effect.Effect<{ upsertedCount: number; tombstonedCount: number; outputRef: string }, IndexError> =>
    Effect.gen(function* () {
      if (port === undefined || source === undefined || deps.context === undefined) {
        return yield* gatedGap(full ? "index.reindex" : "index.reconcile")
      }
      const health = yield* runProbe
      if (!health.reachable) return yield* Effect.fail(milvusUnavailable("milvus endpoint unreachable"))
      const ctx = yield* Effect.tryPromise({ try: () => deps.context!(), catch: () => milvusUnavailable("maintenance context unavailable") })
      const live = yield* Effect.tryPromise({
        // A full rebuild embeds EVERY doc (C2 fix): the source disables its embed-skip for `full`.
        try: () => source.collect({ collection, projectId: ctx.projectId, full }),
        // A missing embedding provider / definition source degrades typed — never fabricated vectors (FR6).
        catch: () => milvusUnavailable("live-doc source unavailable (embedding provider not configured)"),
      })
      const indexed = full
        ? []
        : yield* dataPlaneRetry(port.enumerateIndexed({ collection, projectId: ctx.projectId })).pipe(
            Effect.mapError((): IndexError => milvusUnavailable("enumerate indexed docs failed")),
            Effect.map((r) => r.docs),
          )
      const result = yield* dataPlaneRetry(
        IndexJobs.runReconcile(
          { milvus: port, spool },
          { collection, live, indexed, projectId: ctx.projectId, bindingVersion: ctx.bindingVersion },
        ),
      ).pipe(Effect.mapError((): IndexError => milvusUnavailable("index maintenance failed")))
      return {
        upsertedCount: result.summary.upsertedCount,
        tombstonedCount: result.summary.tombstonedCount,
        outputRef: result.outputRef,
      }
    })

  return {
    // The real bound verb: a bounded probe → the live reachability finding.
    test: () =>
      Effect.map(runProbe, (health) => ({ reachable: health.reachable, latencyMs: health.latencyMs })),
    status: () => gatedGap("index.status"),
    reindex: (input) => runMaintenance(input.collection, true),
    reconcile: (input) => runMaintenance(input.collection, false),
    showCollections: () => gatedGap("index.show-collections"),
  }
}
