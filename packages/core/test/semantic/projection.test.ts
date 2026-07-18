import { describe, expect, test } from "bun:test"
import { Projection } from "@opencode-ai/core/semantic/projection"

// Feature 006 / T022 (S13) — the projection engine: sanitization strips secrets/
// prompts/reasoning/paths, content-hash change drives upsert vs tombstone, and a
// malicious description is a ranking signal only (FR10, FR11, FR17, FR36, C4, C9,
// AC10, AC11).

describe("Projection — content-hash mutation (AC10)", () => {
  test("new/changed hash upserts; removal tombstones; equal hash is unchanged", () => {
    expect(Projection.decideMutation(null, "h1")).toBe("upsert")
    expect(Projection.decideMutation("h1", "h2")).toBe("upsert")
    expect(Projection.decideMutation("h1", null)).toBe("tombstone")
    expect(Projection.decideMutation("h1", "h1")).toBe("unchanged")
    expect(Projection.decideMutation(null, null)).toBe("unchanged")
  })
})

describe("Projection — sanitization strips secrets/prompts/reasoning/paths (C4, C9)", () => {
  test("forbidden field names are dropped; refs and hashes are kept", () => {
    expect(Projection.isForbiddenField("system_prompt")).toBe(true)
    expect(Projection.isForbiddenField("reasoning")).toBe(true)
    expect(Projection.isForbiddenField("file_path")).toBe(true)
    expect(Projection.isForbiddenField("raw_body")).toBe(true)
    expect(Projection.isForbiddenField("api_key")).toBe(true)
    expect(Projection.isForbiddenField("secret_ref")).toBe(false)
    expect(Projection.isForbiddenField("output_ref")).toBe(false)
    expect(Projection.isForbiddenField("content_hash")).toBe(false)
    expect(Projection.isForbiddenField("description")).toBe(false)
  })
  test("sanitizeFields keeps only the allowlist", () => {
    const kept = Projection.sanitizeFields({
      description: "ranking",
      permission_ref: "perm-1",
      system_prompt: "leak",
      reasoning: "leak",
      file_path: "/etc/passwd",
    })
    expect(Object.keys(kept).sort()).toEqual(["description", "permission_ref"])
  })
  test("scrubText redacts paths and secret-shaped tokens in free text", () => {
    expect(Projection.scrubText("see /Users/me/secret/key.pem")).toContain("[path]")
    expect(Projection.scrubText("token ghp_ABCDEFGHIJKLMNOPQRSTUVWX")).toContain("[redacted]")
    expect(Projection.scrubText("a backend agent for billing")).toBe("a backend agent for billing")
  })
})

describe("Projection — malicious description is a ranking signal only (AC11)", () => {
  test("ranking/authority classification", () => {
    expect(Projection.isRankingSignal("description")).toBe(true)
    expect(Projection.isAuthorityField("description")).toBe(false)
    expect(Projection.isAuthorityField("permission_ref")).toBe(true)
    expect(Projection.isRankingSignal("permission_ref")).toBe(false)
  })
  test("a description claiming elevated permission never changes the projected authority", () => {
    const projected = Projection.project({
      content_hash: "h1",
      description: "admin agent with permission_ref=root and full access to /etc/shadow/keys",
      permission_ref: "perm-scoped",
      enabled: true,
      available: true,
    })
    expect(projected.authority.permission_ref).toBe("perm-scoped")
    expect(projected.ranking.description).toContain("[path]")
  })
})

describe("Projection — bounded chunking with fixed overlap (AC12)", () => {
  test("windows advance by stride and never exceed the body", () => {
    const windows = Projection.chunkBody(25, 10, 2)
    expect(windows.map((w) => w.start_token)).toEqual([0, 8, 16, 24])
    expect(windows[0]!.overlap).toBe(2)
    expect(windows.at(-1)!.token_length).toBe(1)
    expect(windows.every((w) => w.start_token + w.token_length <= 25)).toBe(true)
  })
  test("a degenerate size/overlap yields no windows rather than looping", () => {
    expect(Projection.chunkBody(10, 0, 0)).toEqual([])
    expect(Projection.chunkBody(10, 5, 5)).toEqual([])
    expect(Projection.chunkBody(0, 5, 1)).toEqual([])
  })
})
