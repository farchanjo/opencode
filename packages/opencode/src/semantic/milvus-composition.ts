/**
 * Feature 050 / T006 (FR4) — the single shared Milvus-port composition helper.
 *
 * The `createGrpcMilvusAdapter(createHttpMilvusClient(...))` construction chain
 * was inlined once in `operator/stack-live.ts`; a second independent
 * construction in the new pipeline runner would silently diverge in TLS /
 * timeout / health-probe behavior from the operator stack. This is the ONE place
 * the Milvus adapter is constructed — both the operator stack and the runner
 * call `composeMilvusPort`, neither builds a `MilvusAdapter` directly (FR4).
 */
export * as MilvusComposition from "./milvus-composition"

import { MilvusAdapter } from "@/semantic/milvus-adapter"
import type { MilvusPort } from "@/semantic/milvus-adapter"

/** The operator-environment Milvus endpoint knobs; TLS is on by default (an `insecure` opt-out is explicit, FR4). */
export interface MilvusPortEnv {
  /** `host:port`, or an explicit `http://`/`https://` base URL; absent → no port is composed. */
  readonly address?: string
  /** Opt out of TLS for a local profile (`OPENCODE_SEMANTIC_MILVUS_INSECURE=1`). */
  readonly insecure?: boolean
  /** The resolved Milvus `Authorization` token, supplied by the SecretPort at use time. */
  readonly token?: string
}

/**
 * Compose the single `MilvusPort` over the shipped REST v2 adapter. Returns
 * `undefined` when no endpoint is configured, so every index/binding verb
 * degrades to the exact same typed `milvus_unavailable` floor as today — never a
 * fabricated result and never a second construction path (FR4).
 */
export function composeMilvusPort(env: MilvusPortEnv): MilvusPort | undefined {
  const address = env.address?.trim()
  if (address === undefined || address.length === 0) return undefined
  return MilvusAdapter.createGrpcMilvusAdapter({
    client: MilvusAdapter.createHttpMilvusClient({
      address,
      ssl: !env.insecure,
      authorization: env.token || undefined,
    }),
  })
}
