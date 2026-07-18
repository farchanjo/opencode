import { describe, expect, test } from "bun:test"
import { listReservedIds } from "@opencode-ai/core/operator"
import { Commands } from "../commands/commands"

/**
 * Feature 003 / T029 (S17) — the `opencode op jobs` CLI surface holds no
 * authority of its own: every leaf must map to a reserved Feature 007
 * `jobs.*` command id (C12, C13). This guards against the CLI drifting from
 * the operator catalog, mirroring `commands/routing-surface.test.ts`.
 */
describe("jobs command surface", () => {
  test("declares the canonical jobs.* verb set (FR30)", () => {
    expect(Object.keys(Commands.commands.jobs.commands).sort()).toEqual([
      "create",
      "delete",
      "disable",
      "enable",
      "history",
      "list",
      "reschedule",
      "run-now",
      "show",
      "status",
      "update",
      "watch",
    ])
  })

  test("every jobs leaf id is reserved by the Feature 007 catalog", () => {
    const reserved = new Set(listReservedIds())
    const surfaced = [
      "jobs.list",
      "jobs.status",
      "jobs.show",
      "jobs.create",
      "jobs.update",
      "jobs.enable",
      "jobs.disable",
      "jobs.delete",
      "jobs.reschedule",
      "jobs.run-now",
      "jobs.history",
      "jobs.watch",
    ]
    for (const id of surfaced) expect(reserved.has(id)).toBe(true)
  })
})
