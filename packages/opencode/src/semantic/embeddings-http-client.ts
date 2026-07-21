/**
 * Feature 050 / T009 (FR5) — the first production `EmbeddingsHttpPort`.
 *
 * Follows the `createFetchRerankHttpClient` transport shape (`rerank-probe.ts`)
 * exactly: POST JSON to `<baseUrl>/v1/embeddings` in the OpenAI-compatible
 * `{ model, input: string[] }` request shape, parse `data[].embedding`, and
 * carry one resolved `Authorization` header — never inline plaintext (C19). The
 * secret is resolved EXCLUSIVELY through the injected `resolveAuthHeader`
 * closure (the operator SecretPort's internal-material path); an empty/`null`
 * `secretRef` produces NO header (the solaris P0 default), never an empty
 * placeholder.
 *
 * The raw transport carries no retry — the bounded transient-only data-plane
 * retry is composed OUTSIDE per FR12 via `withDataPlaneRetry`/
 * `retryDataPlanePromise` (`util/effect-http-client.ts`), so the retry policy has
 * exactly one owner. A non-2xx response is a typed failure (client 4xx never
 * retries, server 5xx/429 retries), never a silent empty vector.
 */
export * as EmbeddingsHttpClient from "./embeddings-http-client"

import type { EmbeddingsHttpPort, EmbeddingsRequest, EmbeddingsResponse } from "@/semantic/embedding-client"
import { isTransientDataPlaneError, retryDataPlanePromise } from "@/util/effect-http-client"

/** A typed embeddings transport failure; the `type`/`status` drive the FR12 transient classification. */
export interface EmbeddingsHttpFailure {
  readonly type: "transport" | "http_client" | "http_server" | "malformed"
  readonly status?: number
  readonly reason: string
}

export interface FetchEmbeddingsDeps {
  /** Injected `fetch` for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch
  /** The provider `SecretRef` coordinate bound to this client; empty/`null` → no Authorization header. */
  readonly secretRef?: string | null
  /** Resolve the Authorization header VALUE for a `SecretRef`; `null` when unresolvable. Never logs the material. */
  readonly resolveAuthHeader?: (secretRef: string) => Promise<string | null>
}

/** Join a provider base URL with a request path, tolerating a trailing slash (mirrors `rerank-probe.ts`). */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`
}

/** Parse the OpenAI-compatible `{ data: [{ embedding: number[] }] }` response into ordered vectors. */
function parseVectors(raw: unknown): ReadonlyArray<readonly number[]> {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) throw failure("malformed", "missing data[] in embeddings response")
  const vectors: number[][] = []
  for (const entry of data) {
    const embedding = (entry as { embedding?: unknown }).embedding
    if (!Array.isArray(embedding) || !embedding.every((v) => typeof v === "number")) {
      throw failure("malformed", "embeddings response row missing numeric embedding")
    }
    vectors.push(embedding as number[])
  }
  return vectors
}

function failure(type: EmbeddingsHttpFailure["type"], reason: string, status?: number): EmbeddingsHttpFailure {
  return status === undefined ? { type, reason } : { type, status, reason }
}

/** Resolve the bound secret to an Authorization header value; empty ref or no resolver → no header. */
async function resolveHeader(deps: FetchEmbeddingsDeps): Promise<string | null> {
  const ref = deps.secretRef
  if (ref === undefined || ref === null || ref.length === 0) return null
  if (deps.resolveAuthHeader === undefined) return null
  return deps.resolveAuthHeader(ref)
}

/**
 * Build the production `EmbeddingsHttpPort` over `fetch`. The bounded data-plane
 * retry is composed here so callers receive a single, already-resilient port; a
 * client 4xx surfaces a typed `http_client` failure without a retry, a server
 * 5xx/429/transport fault retries up to the FR12 bound (FR5, FR12).
 */
export function createFetchEmbeddingsHttpClient(deps: FetchEmbeddingsDeps = {}): EmbeddingsHttpPort {
  const fetchImpl = deps.fetchImpl ?? fetch

  const rawPost = async (request: EmbeddingsRequest): Promise<EmbeddingsResponse> => {
    const authHeader = await resolveHeader(deps)
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (authHeader !== null) headers["authorization"] = authHeader

    let response: Response
    try {
      response = await fetchImpl(joinUrl(request.baseUrl, "/v1/embeddings"), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: request.model, input: [...request.inputs] }),
      })
    } catch (error) {
      throw failure("transport", String(error).slice(0, 160))
    }
    if (!response.ok) {
      const type = response.status >= 500 ? "http_server" : "http_client"
      throw failure(type, `embeddings HTTP ${response.status}`, response.status)
    }
    let json: unknown
    try {
      json = await response.json()
    } catch (error) {
      throw failure("malformed", String(error).slice(0, 160))
    }
    const body = json as { usage?: { max_batch_size?: number; max_input_tokens?: number } }
    return {
      vectors: parseVectors(json),
      ...(typeof body.usage?.max_batch_size === "number" ? { maxBatchSize: body.usage.max_batch_size } : {}),
      ...(typeof body.usage?.max_input_tokens === "number" ? { maxInputTokens: body.usage.max_input_tokens } : {}),
    }
  }

  return {
    postEmbeddings: (request) => retryDataPlanePromise(() => rawPost(request), isTransientDataPlaneError),
  }
}
