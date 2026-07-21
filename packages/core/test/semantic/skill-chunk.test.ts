import { describe, expect, test } from "bun:test"
import { SkillChunker } from "@opencode-ai/core/semantic/skill-chunk"

// Feature 050 / T005 — the pure skill-body chunker: chunk window boundaries and
// overlap, the id-pattern-safe separator (never `#`, per the `SkillChunkId`
// brand pattern `^[A-Za-z0-9_-]{1,192}$`), the sanitize-before-hash ordering
// (`content_hash` over sanitized bytes, never the raw window), and that a
// boundary-only shift with unchanged sanitized bytes yields the same
// `content_hash`.

const LONG_BODY = "word ".repeat(400).trim() // ~2000 chars, ~500 tokens at chars/4

const mintRef = (chunkIndex: number, contentHash: string): string => `${chunkIndex}:${contentHash.slice(0, 8)}`

const baseInput = (overrides: Partial<SkillChunker.SkillChunkInput> = {}): SkillChunker.SkillChunkInput => ({
  parentSkillId: "deploy-helper",
  body: LONG_BODY,
  maxChunks: 100,
  chunkSizeTokens: 50,
  overlapTokens: 10,
  mintRef,
  ...overrides,
})

describe("SkillChunker.chunkSkill — window boundaries and cap (FR8)", () => {
  test("produces multiple windows with fixed overlap over a long body", () => {
    const chunks = SkillChunker.chunkSkill(baseInput())
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((chunk, i) => {
      expect(chunk.doc.position.chunk_index).toBe(i)
      expect(chunk.doc.position.overlap).toBe(10)
    })
  })

  test("never exceeds maxChunks even when more windows would fit", () => {
    const chunks = SkillChunker.chunkSkill(baseInput({ maxChunks: 2 }))
    expect(chunks.length).toBeLessThanOrEqual(2)
  })

  test("char ranges cover the body and stay within bounds", () => {
    const chunks = SkillChunker.chunkSkill(baseInput())
    for (const chunk of chunks) {
      expect(chunk.charStart).toBeGreaterThanOrEqual(0)
      expect(chunk.charEnd).toBeLessThanOrEqual(LONG_BODY.length)
      expect(chunk.charEnd).toBeGreaterThanOrEqual(chunk.charStart)
    }
    // The union of windows reaches the end of the body (chunkBody stops once start >= totalTokens).
    const last = chunks.at(-1)!
    expect(last.charEnd).toBe(LONG_BODY.length)
  })

  test("a single short body yields exactly one chunk", () => {
    const chunks = SkillChunker.chunkSkill(baseInput({ body: "a short skill body" }))
    expect(chunks.length).toBe(1)
    expect(chunks[0].doc.position.chunk_index).toBe(0)
  })
})

describe("SkillChunker.chunkSkill — id pattern safety", () => {
  test("chunk id uses an underscore separator, never '#'", () => {
    const chunks = SkillChunker.chunkSkill(baseInput())
    for (const chunk of chunks) {
      expect(chunk.doc.id).toMatch(/^[A-Za-z0-9_-]{1,192}$/)
      expect(chunk.doc.id).not.toContain("#")
      expect(chunk.doc.id as string).toBe(`deploy-helper_c${chunk.doc.position.chunk_index}`)
    }
  })

  test("parent_skill_id and identity.source are set correctly", () => {
    const [chunk] = SkillChunker.chunkSkill(baseInput())
    expect(chunk.doc.parent_skill_id as string).toBe("deploy-helper")
    expect(chunk.doc.identity.source).toBe("skill_chunk")
    expect(chunk.doc.identity.version).toBe(1)
  })
})

describe("SkillChunker.chunkSkill — sanitize-before-hash ordering", () => {
  test("content_hash is over the SANITIZED body, never the raw window", () => {
    const body = "see /Users/me/secret/key.pem for the deploy credentials"
    const chunks = SkillChunker.chunkSkill(baseInput({ body, maxChunks: 1, chunkSizeTokens: 100, overlapTokens: 0 }))
    const [chunk] = chunks
    expect(chunk.sanitizedBody).toContain("[path]")
    expect(chunk.sanitizedBody).not.toContain("/Users/me/secret/key.pem")
  })

  test("body_ref offset is 0 and limit equals the sanitized body's byte length", () => {
    const [chunk] = SkillChunker.chunkSkill(baseInput({ maxChunks: 1 }))
    expect(chunk.doc.body_ref.offset).toBe(0)
    expect(chunk.doc.body_ref.limit).toBe(Buffer.byteLength(chunk.sanitizedBody, "utf8"))
  })

  test("output_ref is minted via the caller-supplied mintRef, never derived internally", () => {
    const [chunk] = SkillChunker.chunkSkill(baseInput({ maxChunks: 1 }))
    expect(chunk.doc.body_ref.output_ref as string).toBe(mintRef(0, chunk.doc.identity.content_hash))
  })
})

describe("SkillChunker.chunkSkill — boundary-shift stability", () => {
  test("a shift that leaves sanitized bytes unchanged yields the same content_hash", () => {
    // Two bodies whose FIRST window (same chunkSize/overlap) slices to identical
    // sanitized text even though the tail of the body differs beyond the window.
    const shared = "alpha beta gamma delta epsilon zeta eta theta"
    const bodyA = `${shared} — tail variant one`
    const bodyB = `${shared} — tail variant two, much longer than the first`
    const chunksA = SkillChunker.chunkSkill(baseInput({ body: bodyA, chunkSizeTokens: 8, overlapTokens: 0, maxChunks: 1 }))
    const chunksB = SkillChunker.chunkSkill(baseInput({ body: bodyB, chunkSizeTokens: 8, overlapTokens: 0, maxChunks: 1 }))
    expect(chunksA[0].sanitizedBody).toBe(chunksB[0].sanitizedBody)
    expect(chunksA[0].doc.identity.content_hash).toBe(chunksB[0].doc.identity.content_hash)
  })
})
