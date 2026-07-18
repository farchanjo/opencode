/**
 * Feature 006 / T020 (S11) — the once-per-Task query-embedding cache.
 *
 * Framework-free, deterministic, zero I/O in the hot logic: the cache decides
 * hit/miss/invalidation; the actual embedding call is an injected `compute` thunk
 * the application layer backs with the OpenAI-compatible client (C10). The query
 * embedding is derived ONCE per logical Task from the structured profile and
 * reused across the agent and skill passes while valid — there is no per-token or
 * per-turn remote embedding loop (FR18, FR25, NFR4, C10, AC16).
 *
 * The cache is keyed by the task fingerprint plus the binding version and config
 * hash (`profile.cue` `#QueryFingerprint`). A stored entry is valid only when all
 * three match, so a binding-version change or a config-hash change lazily
 * invalidates the entry and forces exactly one re-embed — never a silent reuse of
 * a stale embedding across a binding cutover (FR25, C10). Entries are keyed by
 * fingerprint and bounded by the number of live tasks; `clear` drops them all.
 */
export * as QueryCache from "./query-cache"

import type { Profile } from "@opencode-ai/schema/semantic/profile"

/** The composite cache key: task fingerprint + binding version + config hash (C10). */
export interface CacheKey {
  readonly fingerprint: string
  readonly binding_version: number
  readonly config_hash: string
}

/** Project a schema `QueryFingerprint` onto the cache key (one-to-one, C10). */
export const keyOf = (qf: Profile.QueryFingerprint): CacheKey =>
  Object.freeze({ fingerprint: qf.fingerprint, binding_version: qf.binding_version, config_hash: qf.config_hash })

/** Whether two keys are the same live embedding (fingerprint + version + hash). */
const sameKey = (a: CacheKey, b: CacheKey): boolean =>
  a.fingerprint === b.fingerprint && a.binding_version === b.binding_version && a.config_hash === b.config_hash

/** The resolution of one lookup: the embedding value and whether it was a cache hit. */
export interface Resolution<E> {
  readonly value: E
  readonly hit: boolean
}

/** The once-per-Task query-embedding cache over an injected embed thunk (C10). */
export interface QueryCache<E> {
  /**
   * Resolve the embedding for a key, computing it via `compute` only on a miss.
   * A stored entry whose binding version or config hash no longer matches is
   * invalidated and recomputed exactly once (FR25, C10, AC16).
   */
  readonly resolve: (key: CacheKey, compute: () => E) => Resolution<E>
  /** The current number of cached fingerprints. */
  readonly size: () => number
  /** Drop all cached embeddings (e.g. on a config reload). */
  readonly clear: () => void
}

interface Entry<E> {
  readonly key: CacheKey
  readonly value: E
}

/**
 * Construct a fresh query-embedding cache. The embedding for a fingerprint is
 * computed once and reused across passes; a binding-version or config-hash change
 * lazily invalidates it and forces exactly one re-embed (FR18, FR25, C10, AC16).
 */
export const create = <E>(): QueryCache<E> => {
  const entries = new Map<string, Entry<E>>()

  const resolve = (key: CacheKey, compute: () => E): Resolution<E> => {
    const existing = entries.get(key.fingerprint)
    if (existing !== undefined && sameKey(existing.key, key)) {
      return Object.freeze({ value: existing.value, hit: true })
    }
    const value = compute()
    entries.set(key.fingerprint, { key, value })
    return Object.freeze({ value, hit: false })
  }

  return {
    resolve,
    size: () => entries.size,
    clear: () => entries.clear(),
  }
}
