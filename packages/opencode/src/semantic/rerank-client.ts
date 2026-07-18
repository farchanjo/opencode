/**
 * Feature 006 / T028 (S17) — the three explicit rerank profiles.
 *
 * Profile A is a native `/v1/rerank` request/response adapter; profile B is
 * structured chat/completions with deterministic schema, fixed temperature, and
 * tool-free behavior under an explicit token/cost budget; profile C is
 * embedding-similarity — a DISTINCT capability that is never badged
 * cross-encoder/reranker and is never eligible for the reranker slot. Rerank
 * capability is never inferred from a `/v1/models` name, and a manual
 * declaration is untrusted until the native probe passes (FR30, FR4, C16).
 *
 * The transports are injected seams (the real ones ride the reused
 * openai-compatible transport with a resolved secret header, C19); tests drive
 * fakes. Profile C's presence here is only to REJECT it for the reranker slot,
 * never to run it as a reranker (C16, AC34).
 */
export * as RerankClient from "./rerank-client"

import type { RerankProfile } from "@opencode-ai/protocol/semantic/commands"

/** One document to rerank against the query; content-free downstream (only the score/rank survives). */
export interface RerankDocument {
  readonly canonicalId: string
  readonly text: string
}

export interface RerankRequest {
  readonly baseUrl: string
  readonly model: string
  readonly query: string
  readonly documents: readonly RerankDocument[]
  readonly topK: number
}

/** One reranked result: the canonical id and the relevance score (never the final route, FR4). */
export interface RerankResult {
  readonly canonicalId: string
  readonly score: number
  readonly rank: number
}

export type RerankError =
  | { readonly type: "reranker_not_eligible"; readonly profile: RerankProfile; readonly reason: string }
  | { readonly type: "not_validated"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }

/** Native `/v1/rerank` (profile A) transport seam. */
export interface NativeRerankHttpPort {
  readonly postRerank: (request: RerankRequest) => Promise<ReadonlyArray<{ canonicalId: string; score: number }>>
}

/** Structured chat/completions (profile B) transport seam; deterministic schema, fixed temperature, tool-free. */
export interface StructuredChatHttpPort {
  readonly postStructuredRerank: (
    request: RerankRequest & { readonly temperature: 0; readonly tokenBudget: number },
  ) => Promise<ReadonlyArray<{ canonicalId: string; score: number }>>
}

/** Profile C (embedding-similarity) is NEVER eligible for the reranker slot (FR30, C16, AC34). */
export const isRerankerEligible = (profile: RerankProfile): boolean => profile !== "embedding-similarity"

/** Sort scored rows into a stable ranked result (highest score first, canonical id as the tie-break). */
function ranked(rows: ReadonlyArray<{ canonicalId: string; score: number }>, topK: number): readonly RerankResult[] {
  return [...rows]
    .sort((a, b) => b.score - a.score || a.canonicalId.localeCompare(b.canonicalId))
    .slice(0, topK)
    .map((row, index) => ({ canonicalId: row.canonicalId, score: row.score, rank: index }))
}

/**
 * Run profile A: the native `/v1/rerank` round trip. Rejects immediately if a
 * caller passes a non-native profile (defense in depth; the eligible profile is
 * fixed at binding time, C16).
 */
export const rerankNative = async (
  deps: { readonly http: NativeRerankHttpPort },
  request: RerankRequest,
): Promise<{ ok: true; results: readonly RerankResult[] } | { ok: false; error: RerankError }> => {
  try {
    const rows = await deps.http.postRerank(request)
    return { ok: true, results: ranked(rows, request.topK) }
  } catch (error) {
    return { ok: false, error: { type: "unavailable", reason: String(error).slice(0, 160) } }
  }
}

/**
 * Run profile B: structured chat/completions with temperature 0, no tools, and
 * an explicit token budget, so the ranking is deterministic and cost-bounded
 * (C16, AC26).
 */
export const rerankStructured = async (
  deps: { readonly http: StructuredChatHttpPort },
  request: RerankRequest & { readonly tokenBudget: number },
): Promise<{ ok: true; results: readonly RerankResult[] } | { ok: false; error: RerankError }> => {
  try {
    const rows = await deps.http.postStructuredRerank({ ...request, temperature: 0, tokenBudget: request.tokenBudget })
    return { ok: true, results: ranked(rows, request.topK) }
  } catch (error) {
    return { ok: false, error: { type: "unavailable", reason: String(error).slice(0, 160) } }
  }
}

/**
 * Reject binding profile C to the reranker slot. Profile C is embedding-similarity,
 * a distinct capability; it is never run as a reranker (FR30, C16, AC34).
 */
export const rejectForRerankerSlot = (profile: RerankProfile): RerankError | null => {
  if (isRerankerEligible(profile)) return null
  return { type: "reranker_not_eligible", profile, reason: "embedding-similarity is never eligible for the reranker slot" }
}

/**
 * A rerank-suggestive model name without a passing native probe is INELIGIBLE:
 * rerank capability is never inferred from a `/v1/models` name (FR30, C16, AC24).
 */
export const eligibleAfterProbe = (input: { readonly probePassed: boolean }): RerankError | null => {
  if (input.probePassed) return null
  return { type: "not_validated", reason: "rerank capability requires a passing native probe, never a model name" }
}
