/**
 * Feature 050 / T004 — the pure skill-body chunker, turning
 * `Skill.Info.content` into bounded `SkillChunkDoc[]` windows.
 *
 * Framework-free, deterministic, zero I/O. Reuses `Token.estimate` for the
 * `totalTokens` input and `Projection.chunkBody` for the bounded, fixed-overlap
 * token windows (`data-model.md` "SkillChunkDoc production"), capped by the
 * caller-supplied `maxChunks` (`max_skill_chunks`, `schema/routing/budget.ts:44`).
 * Each token window maps onto a character range using the SAME `chars/4`
 * approximation `Token.estimate` uses, so window boundaries stay consistent
 * with the token count that produced them.
 *
 * **Sanitization-before-hash ordering (load-bearing).** The character slice for
 * a window is scrubbed via `Projection.scrubText` BEFORE `identity.content_hash`
 * is computed — the hash is over the SANITIZED bytes actually destined for the
 * spool, never the raw window, so a boundary-only shift with unchanged
 * sanitized bytes never spuriously re-upserts.
 *
 * This module NEVER touches storage: `body_ref.output_ref` is minted by the
 * caller-supplied `mintRef` (deterministic over `chunkIndex`/`contentHash`), and
 * the actual `OutputSpoolStore.put` (I/O, Effect-based) happens in the
 * application layer using the SAME content-hash-derived ref — this chunker
 * only ever HANDS BACK a bounded `offset:0`/`limit:byteLength(sanitizedBody)`
 * window, since every chunk owns its own dedicated spool entry.
 */
export * as SkillChunker from "./skill-chunk"

import { createHash } from "node:crypto"
import type { SkillChunkDoc } from "@opencode-ai/schema/semantic/documents"
import { Projection } from "./projection"
import { Token } from "../util/token"

const CHARS_PER_TOKEN = 4
const FALLBACK_LANGUAGE_TAG = "und"

export interface SkillChunkInput {
  readonly parentSkillId: string
  readonly body: string
  /** Feature 004 Lang Lock tag when available; falls back to `"und"` (honest floor, never guessed). */
  readonly languageTag?: string
  readonly maxChunks: number
  readonly chunkSizeTokens: number
  readonly overlapTokens: number
  /** Deterministically mints the spool ref for one chunk; core never performs the actual write. */
  readonly mintRef: (chunkIndex: number, contentHash: string) => string
}

export interface SkillChunkResult {
  readonly doc: SkillChunkDoc
  /** The sanitized body bytes this chunk's `body_ref` must be written to at the spool (offset 0, full length). */
  readonly sanitizedBody: string
  readonly charStart: number
  readonly charEnd: number
}

const contentHashOf = (sanitizedBody: string): string => createHash("sha256").update(sanitizedBody).digest("hex")

/**
 * Chunk one skill body into bounded, sanitized, content-hashed windows. Pure
 * and deterministic — the same input always yields the same chunk docs
 * (FR8).
 */
export const chunkSkill = (input: SkillChunkInput): readonly SkillChunkResult[] => {
  const totalTokens = Token.estimate(input.body)
  const windows = Projection.chunkBody(totalTokens, input.chunkSizeTokens, input.overlapTokens).slice(0, input.maxChunks)
  const languageTag = input.languageTag ?? FALLBACK_LANGUAGE_TAG

  return windows.map((window) => {
    const charStart = window.start_token * CHARS_PER_TOKEN
    const charEnd = Math.min(input.body.length, (window.start_token + window.token_length) * CHARS_PER_TOKEN)
    const sanitizedBody = Projection.scrubText(input.body.slice(charStart, charEnd))
    const contentHash = contentHashOf(sanitizedBody)
    const outputRef = input.mintRef(window.chunk_index, contentHash)
    const byteLength = Buffer.byteLength(sanitizedBody, "utf8")

    const doc: SkillChunkDoc = {
      id: `${input.parentSkillId}_c${window.chunk_index}` as SkillChunkDoc["id"],
      parent_skill_id: input.parentSkillId as SkillChunkDoc["parent_skill_id"],
      position: {
        chunk_index: window.chunk_index,
        overlap: window.overlap,
      },
      identity: {
        version: 1,
        content_hash: contentHash,
        source: "skill_chunk" as SkillChunkDoc["identity"]["source"],
      },
      language_tag: languageTag,
      body_ref: {
        output_ref: outputRef as SkillChunkDoc["body_ref"]["output_ref"],
        offset: 0,
        limit: byteLength,
      },
      token_estimate: window.token_length,
    }

    return { doc, sanitizedBody, charStart, charEnd }
  })
}
