/**
 * Feature 050 / T011 (FR6) — the model-driven vector-space discovery ladder.
 *
 * Dimension and normalization are DISCOVERED from the bound model, never
 * defaulted: `EmbeddingClient.probe` posts a harmless sample and captures the
 * ACTUAL embedded-vector length and normalization (rung 1, authoritative). A
 * probe failure gets exactly two bounded retries; an optional metadata
 * cross-check seam (rung 2/3 — the `ModelsDev.Service` extension is a later
 * slice, injected here as a typed seam that defaults absent) may supply a value
 * when live probing is unavailable. With neither, discovery FAILS CLOSED with a
 * typed `probe_failed` — there is NO silent default dimension anywhere in this
 * ladder (FR6).
 *
 * The probe's metric finding is mapped onto the SHIPPED `"cosine" |
 * "inner-product"` enum at this boundary — the CUE `"ip"` shorthand never
 * crosses into `RegistryGeneration`/`MilvusPort` (research.md metric-vocabulary
 * mismatch).
 */
export * as DimensionProbe from "./dimension-probe"

import { EmbeddingClient } from "@/semantic/embedding-client"
import type { EmbeddingsHttpPort } from "@/semantic/embedding-client"

/** The discovered vector space — the ACTUAL probed length/normalization, never a default (FR6). */
export interface ProbedVectorSpace {
  readonly dimension: number
  readonly metric: "cosine" | "inner-product"
  readonly normalized: boolean
  readonly probedAt: string
  readonly source: "live-probe" | "metadata-crosscheck"
}

/** A typed fail-closed refusal — never a fallback dimension (FR6 rung 3). */
export interface ProbeFailed {
  readonly type: "probe_failed"
  readonly detail: string
}

/** The binding coordinate a probe addresses (never a secret; auth rides the injected HTTP port). */
export interface ProbeBinding {
  readonly baseUrl: string
  readonly modelRef: string
}

/**
 * The metadata cross-check seam (rung 2/3). Injected and defaulting ABSENT in
 * this slice — the `ModelsDev.Service` embedding-metadata extension lands later.
 * When present, it may return a `ProbedVectorSpace`-shaped value (minus the
 * `source`, stamped `metadata-crosscheck` here) as a last resort when the live
 * probe cannot resolve one.
 */
export type MetadataCrossCheck = (
  binding: ProbeBinding,
) => Promise<Omit<ProbedVectorSpace, "source"> | undefined>

export interface ProbeDeps {
  readonly http: EmbeddingsHttpPort
  readonly metadata?: MetadataCrossCheck
}

/** Two bounded retries → three total probe attempts before falling through to the cross-check / refusal (FR6). */
const MAX_PROBE_ATTEMPTS = 3

/**
 * Run the discovery ladder for one binding. On a live probe pass, stamp the real
 * dimension/normalization at `metric: "cosine"` (the embedding default; a
 * cross-check may narrow it later). A `dimension_mismatch` is a domain reject and
 * never retried; a transport `probe_failed` retries up to the bound, then the
 * metadata seam, then a typed refusal — never a default dimension (FR6).
 */
export async function probeVectorSpace(deps: ProbeDeps, binding: ProbeBinding): Promise<ProbedVectorSpace | ProbeFailed> {
  let lastDetail = "embedding probe did not resolve a vector space"
  for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt++) {
    const eligibility = await EmbeddingClient.probe(
      { http: deps.http },
      { baseUrl: binding.baseUrl, model: binding.modelRef },
    )
    if (eligibility.eligible) {
      return {
        dimension: eligibility.probe.dimension,
        metric: "cosine",
        normalized: eligibility.probe.normalized,
        probedAt: new Date().toISOString(),
        source: "live-probe",
      }
    }
    lastDetail = eligibility.detail
    // A dimension mismatch is a domain reject, not a transient outage — never retried.
    if (eligibility.reason === "dimension_mismatch") break
  }

  if (deps.metadata !== undefined) {
    const meta = await deps.metadata(binding)
    if (meta !== undefined) return { ...meta, source: "metadata-crosscheck" }
  }

  return { type: "probe_failed", detail: lastDetail.slice(0, 160) }
}
