/**
 * Feature 006 / T027 (S16) — the `/v1/embeddings` probe and embedding client.
 *
 * Rides the reused `@ai-sdk/openai-compatible` transport (base URL + secret ref,
 * no new HTTP stack): the deterministic probe posts a harmless sample and
 * captures the server's dimension / normalization / limits; query and document
 * embedding respect the server-declared batch/vector caps and never loop
 * per-token. A model that fails the probe or reports a dimension incompatible
 * with the pinned binding is EXCLUDED from the embedding selector rather than
 * silently accepted (FR30, FR37, C5, C8). The base URL passes the SSRF guard
 * before any call (C17), and the secret is supplied only as a resolved header
 * through the injected transport — never inline plaintext (C19).
 *
 * The HTTP transport is an injected seam so the probe/embed paths are provable
 * against a fake endpoint; the composition root binds the real openai-compatible
 * embedding call as the provider is configured.
 */
export * as EmbeddingClient from "./embedding-client"

/** One embeddings request over the reused transport; `secretHeaderPresent` never carries plaintext (C19). */
export interface EmbeddingsRequest {
  readonly baseUrl: string
  readonly model: string
  readonly inputs: readonly string[]
}

export interface EmbeddingsResponse {
  readonly vectors: ReadonlyArray<readonly number[]>
  readonly maxBatchSize?: number
  readonly maxInputTokens?: number
}

/** The injected HTTP seam; the real one is the openai-compatible embedding call with a resolved secret header. */
export interface EmbeddingsHttpPort {
  readonly postEmbeddings: (request: EmbeddingsRequest) => Promise<EmbeddingsResponse>
}

/** Result of the deterministic probe: the captured vector space and server caps (FR30, C5). */
export interface EmbeddingProbeResult {
  readonly dimension: number
  readonly normalized: boolean
  readonly maxBatchSize?: number
  readonly maxInputTokens?: number
}

/** A model is eligible for the embedding selector only when the native probe passes and the dimension matches (C5, C16). */
export type EmbeddingEligibility =
  | { readonly eligible: true; readonly probe: EmbeddingProbeResult }
  | { readonly eligible: false; readonly reason: "probe_failed" | "dimension_mismatch"; readonly detail: string }

const PROBE_SAMPLE = "opencode semantic embedding probe"
const NORM_EPSILON = 1e-3

/** True when a vector is L2-normalized (norm within epsilon of 1) — captured from the probe, never inferred from a name. */
export function isNormalized(vector: readonly number[]): boolean {
  let sum = 0
  for (const value of vector) sum += value * value
  return Math.abs(Math.sqrt(sum) - 1) <= NORM_EPSILON
}

/**
 * Deterministically probe an embedding model with a harmless sample, capturing
 * dimension / normalization / limits. A model that throws (probe failure) or
 * returns a dimension incompatible with `expectedDimension` is excluded from the
 * selector (FR30, C5, AC23).
 */
export const probe = async (
  deps: { readonly http: EmbeddingsHttpPort },
  input: { readonly baseUrl: string; readonly model: string; readonly expectedDimension?: number },
): Promise<EmbeddingEligibility> => {
  let response: EmbeddingsResponse
  try {
    response = await deps.http.postEmbeddings({ baseUrl: input.baseUrl, model: input.model, inputs: [PROBE_SAMPLE] })
  } catch (error) {
    return { eligible: false, reason: "probe_failed", detail: String(error).slice(0, 160) }
  }
  const vector = response.vectors[0] ?? []
  const dimension = vector.length
  if (dimension === 0) return { eligible: false, reason: "probe_failed", detail: "empty embedding vector" }
  if (input.expectedDimension !== undefined && input.expectedDimension !== dimension) {
    return { eligible: false, reason: "dimension_mismatch", detail: `expected ${input.expectedDimension}, got ${dimension}` }
  }
  return {
    eligible: true,
    probe: { dimension, normalized: isNormalized(vector), maxBatchSize: response.maxBatchSize, maxInputTokens: response.maxInputTokens },
  }
}

/** Split inputs into server-capped batches; never a per-token loop (FR37, C8, NFR4). */
export function batches<T>(items: readonly T[], maxBatchSize: number): ReadonlyArray<readonly T[]> {
  if (maxBatchSize <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxBatchSize) chunks.push(items.slice(i, i + maxBatchSize))
  return chunks
}

/**
 * Embed a batch of texts, capping each request to the server batch limit and
 * concatenating the results in order. One request per batch, never per token
 * (FR18, C8, C10, NFR4).
 */
export const embed = async (
  deps: { readonly http: EmbeddingsHttpPort },
  input: { readonly baseUrl: string; readonly model: string; readonly texts: readonly string[]; readonly maxBatchSize: number },
): Promise<ReadonlyArray<readonly number[]>> => {
  const out: Array<readonly number[]> = []
  for (const chunk of batches(input.texts, input.maxBatchSize)) {
    const response = await deps.http.postEmbeddings({ baseUrl: input.baseUrl, model: input.model, inputs: chunk })
    for (const vector of response.vectors) out.push(vector)
  }
  return out
}
