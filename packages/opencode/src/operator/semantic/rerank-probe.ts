/**
 * Feature 026 (FR2) — the reranker validation probe, composed over the Feature 006
 * rerank client (`packages/opencode/src/semantic/rerank-client.ts`).
 *
 * This is the ONLY provider-network call in the reranker binding lifecycle. It turns the
 * `RerankValidationProbe` seam (`registry-backend.ts`) into a real probe that drives
 * `RerankClient.rerankNative` (profile A, native `/v1/rerank`) or
 * `RerankClient.rerankStructured` (profile B, structured chat/completions) against the
 * staged candidate's provider endpoint and reports pass/fail — never a document, a vector,
 * or a secret. Profile C (`embedding-similarity`) is refused outright (never reranker-
 * eligible, C16).
 *
 * The HTTP transport is an injected seam: production wires a `fetch`-backed JSON client
 * (`createFetchRerankHttpClient`); tests inject a fake so the whole chain runs with NO
 * network. The Authorization header is resolved from the provider's bounded `SecretRef`
 * COORDINATE through an injected `resolveAuthHeader` (the operator SecretPort's internal
 * material path) — it is only ever handed to the transport, never logged, echoed into a
 * result, or persisted (redaction intact, C19). When a secret is required but cannot be
 * resolved, the probe fails HONESTLY (`passed: false`) rather than sending an unauthenticated
 * request or fabricating a pass.
 */
export * as RerankProbe from "./rerank-probe"

import { RerankClient } from "@/semantic/rerank-client"
import type { NativeRerankHttpPort, RerankRequest, StructuredChatHttpPort } from "@/semantic/rerank-client"
import type { RerankValidationProbe } from "./registry-backend"

/** The bounded probe query + document; content-free, deterministic, and never persisted. */
const PROBE_QUERY = "reranker capability validation probe"
const PROBE_DOCUMENTS = [
  { canonicalId: "probe-doc-0", text: "relevant reranker validation probe document" },
  { canonicalId: "probe-doc-1", text: "unrelated reranker validation probe document" },
] as const
/** A small, fixed token budget for the structured (profile B) probe — deterministic and cost-bounded. */
const PROBE_TOKEN_BUDGET = 256

/** One low-level JSON POST; production = `fetch`, tests inject a fake. NEVER logs the body or header. */
export interface RerankProbeHttpClient {
  readonly postJson: (input: {
    readonly url: string
    readonly authHeader: string | null
    readonly body: unknown
  }) => Promise<unknown>
}

export interface RerankProbeDeps {
  /** The injected JSON transport (fake in tests, `fetch`-backed in production). */
  readonly http: RerankProbeHttpClient
  /**
   * Resolve the Authorization header VALUE for a provider `SecretRef` coordinate; `null` when it
   * cannot be resolved. Omitted → the probe sends no Authorization header (a local/no-secret
   * provider). NEVER logs or returns the resolved material.
   */
  readonly resolveAuthHeader?: (secretRef: string) => Promise<string | null>
}

/** Join a provider base URL with a request path, tolerating a trailing slash. */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`
}

/** Parse a native `/v1/rerank` response body into scored rows; an unrecognized shape yields `[]` (→ not passed). */
function parseNativeRows(raw: unknown, documents: RerankRequest["documents"]): ReadonlyArray<{ canonicalId: string; score: number }> {
  const results = (raw as { results?: unknown })?.results
  if (!Array.isArray(results)) return []
  const rows: Array<{ canonicalId: string; score: number }> = []
  for (const entry of results) {
    const index = (entry as { index?: unknown }).index
    const score = (entry as { relevance_score?: unknown; score?: unknown }).relevance_score ?? (entry as { score?: unknown }).score
    if (typeof index !== "number" || typeof score !== "number") continue
    const doc = documents[index]
    if (doc === undefined) continue
    rows.push({ canonicalId: doc.canonicalId, score })
  }
  return rows
}

/** Build a native `/v1/rerank` port over the injected JSON client for one resolved auth header. */
function nativePort(http: RerankProbeHttpClient, authHeader: string | null): NativeRerankHttpPort {
  return {
    postRerank: async (request) => {
      const raw = await http.postJson({
        url: joinUrl(request.baseUrl, "/v1/rerank"),
        authHeader,
        body: { model: request.model, query: request.query, documents: request.documents.map((d) => d.text), top_n: request.topK },
      })
      return parseNativeRows(raw, request.documents)
    },
  }
}

/** Build a structured chat/completions port over the injected JSON client for one resolved auth header. */
function structuredPort(http: RerankProbeHttpClient, authHeader: string | null): StructuredChatHttpPort {
  return {
    postStructuredRerank: async (request) => {
      const raw = await http.postJson({
        url: joinUrl(request.baseUrl, "/v1/chat/completions"),
        authHeader,
        body: {
          model: request.model,
          temperature: request.temperature,
          max_tokens: request.tokenBudget,
          messages: [{ role: "user", content: `${request.query}\n\n${request.documents.map((d, i) => `[${i}] ${d.text}`).join("\n")}` }],
        },
      })
      return parseNativeRows(raw, request.documents)
    },
  }
}

/**
 * Compose the reranker validation probe over the injected transport (Feature 026 FR2). The
 * returned `RerankValidationProbe.run` refuses profile C, resolves the auth header from the
 * provider secret (failing honestly when it cannot), drives the matching rerank profile, and
 * reports `{ passed }` — the probe passed iff the transport returned at least one scored row.
 */
export function createRerankValidationProbe(deps: RerankProbeDeps): RerankValidationProbe {
  return {
    run: async (input) => {
      // Profile C (embedding-similarity) is NEVER reranker-eligible; refuse before any call (C16).
      if (!RerankClient.isRerankerEligible(input.profile)) return { passed: false }

      let authHeader: string | null = null
      if (input.secretRef.length > 0 && deps.resolveAuthHeader !== undefined) {
        authHeader = await deps.resolveAuthHeader(input.secretRef)
        // A required-but-unresolvable secret fails HONESTLY — never an unauthenticated probe.
        if (authHeader === null) return { passed: false }
      }

      const request: RerankRequest = {
        baseUrl: input.baseUrl,
        model: input.modelRef,
        query: PROBE_QUERY,
        documents: PROBE_DOCUMENTS,
        topK: PROBE_DOCUMENTS.length,
      }

      const outcome =
        input.profile === "structured-chat"
          ? await RerankClient.rerankStructured({ http: structuredPort(deps.http, authHeader) }, { ...request, tokenBudget: PROBE_TOKEN_BUDGET })
          : await RerankClient.rerankNative({ http: nativePort(deps.http, authHeader) }, request)

      return { passed: outcome.ok && outcome.results.length > 0 }
    },
  }
}

/**
 * A `fetch`-backed JSON transport for the production probe. It POSTs JSON with the resolved
 * Authorization header and parses the JSON response; any transport/parse failure throws, which
 * `rerankNative`/`rerankStructured` catch and surface as a non-pass (honest). The auth header is
 * written only into the request; it is never logged.
 */
export function createFetchRerankHttpClient(fetchImpl: typeof fetch = fetch): RerankProbeHttpClient {
  return {
    postJson: async ({ url, authHeader, body }) => {
      const headers: Record<string, string> = { "content-type": "application/json" }
      if (authHeader !== null) headers["authorization"] = authHeader
      const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`rerank probe HTTP ${response.status}`)
      return response.json()
    },
  }
}
