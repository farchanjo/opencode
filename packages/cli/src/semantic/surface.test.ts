import { describe, expect, test } from "bun:test"
import { listReservedIds } from "@opencode-ai/core/operator"
import { Commands } from "../commands/commands"

/**
 * Feature 006 / T038 (S24) — the `opencode op semantic` CLI surface holds no
 * authority of its own: every leaf must map to one of the 30 reserved
 * Feature 007 `semantic.*` command ids (FR29, C15). This guards against the
 * CLI drifting from the operator catalog, mirroring `langlock/surface.test.ts`
 * and `jobs/surface.test.ts`.
 */
describe("semantic command surface", () => {
  const groups = Commands.commands.semantic.commands

  test("declares the six semantic sub-groups", () => {
    expect(Object.keys(groups).sort()).toEqual(["binding", "embedding", "index", "model", "provider", "reranker"])
  })

  test("declares the canonical provider.* verb set", () => {
    expect(Object.keys(groups.provider.commands).sort()).toEqual(
      ["add", "delete", "disable", "list", "rotate-secret", "test", "update"].sort(),
    )
  })

  test("declares the canonical model.* verb set", () => {
    expect(Object.keys(groups.model.commands).sort()).toEqual(["disable", "discover", "list", "register", "validate"].sort())
  })

  test("declares the canonical embedding.* verb set", () => {
    expect(Object.keys(groups.embedding.commands).sort()).toEqual(["cutover", "reindex", "rollback", "select", "show", "validate"].sort())
  })

  test("declares the canonical reranker.* verb set", () => {
    expect(Object.keys(groups.reranker.commands).sort()).toEqual(["cutover", "rollback", "select", "show", "validate"].sort())
  })

  test("declares the canonical binding.* verb set", () => {
    expect(Object.keys(groups.binding.commands).sort()).toEqual(["history", "status"].sort())
  })

  test("declares the canonical index.* verb set", () => {
    expect(Object.keys(groups.index.commands).sort()).toEqual(["reconcile", "reindex", "show-collections", "status", "test"].sort())
  })

  test("every semantic leaf id is one of the 30 reserved Feature 007 ids", () => {
    const reserved = new Set(listReservedIds())
    const surfaced = [
      ...Object.keys(groups.provider.commands).map((verb) => `semantic.provider.${verb}`),
      ...Object.keys(groups.model.commands).map((verb) => `semantic.model.${verb}`),
      ...Object.keys(groups.embedding.commands).map((verb) => `semantic.embedding.${verb}`),
      ...Object.keys(groups.reranker.commands).map((verb) => `semantic.reranker.${verb}`),
      ...Object.keys(groups.binding.commands).map((verb) => `semantic.binding.${verb}`),
      ...Object.keys(groups.index.commands).map((verb) => `semantic.index.${verb}`),
    ]
    expect(surfaced.length).toBe(30)
    for (const id of surfaced) expect(reserved.has(id)).toBe(true)
  })
})
