import { describe, expect, test } from "bun:test"
import { listReservedIds } from "@opencode-ai/core/operator"
import { Commands } from "../commands/commands"

/**
 * Feature 005 / T038 (S26) — the `opencode output` CLI surface holds no
 * authority of its own: every leaf must map to a reserved Feature 007
 * `output.*` command id from the RESERVED_CATALOG_VERSION 1.3.0 catalog
 * (FR41, FR42, C19). This guards against the CLI drifting from the operator
 * catalog, mirroring `../jobs/surface.test.ts` and `../langlock/surface.test.ts`.
 */
describe("output command surface", () => {
  test("declares the canonical output.* verb set (FR41, FR42, AC13)", () => {
    expect(Object.keys(Commands.commands.output.commands).sort()).toEqual([
      "delete",
      "export",
      "follow",
      "purge",
      "quota",
      "read",
      "release",
      "retention",
      "share",
      "stat",
    ])
    expect(Object.keys(Commands.commands.output.commands.retention.commands)).toEqual(["set"])
    expect(Object.keys(Commands.commands.output.commands.quota.commands)).toEqual(["set"])
  })

  test("every output leaf id is reserved by the Feature 007 catalog", () => {
    const reserved = new Set(listReservedIds())
    const surfaced = [
      "output.stat",
      "output.read",
      "output.follow",
      "output.release",
      "output.delete",
      "output.purge",
      "output.export",
      "output.share",
      "output.retention.set",
      "output.quota.set",
    ]
    for (const id of surfaced) expect(reserved.has(id)).toBe(true)
  })
})
