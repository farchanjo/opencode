import { describe, expect, test } from "bun:test"
import { listReservedIds } from "@opencode-ai/core/operator"
import { Commands } from "../commands/commands"

/**
 * Feature 004 / T035 (S18) — the `opencode op langlock` CLI surface holds no
 * authority of its own: every leaf must map to a reserved Feature 007
 * `langlock.*` command id (FR32, FR33, C3). This guards against the CLI
 * drifting from the operator catalog, mirroring `jobs/surface.test.ts` and
 * `commands/routing-surface.test.ts`.
 */
describe("langlock command surface", () => {
  test("declares the canonical langlock.* verb set (FR32, FR33)", () => {
    expect(Object.keys(Commands.commands.langlock.commands).sort()).toEqual(["reset", "set", "show", "status"])
  })

  test("every langlock leaf id is reserved by the Feature 007 catalog", () => {
    const reserved = new Set(listReservedIds())
    const surfaced = ["langlock.status", "langlock.show", "langlock.set", "langlock.reset"]
    for (const id of surfaced) expect(reserved.has(id)).toBe(true)
  })
})
