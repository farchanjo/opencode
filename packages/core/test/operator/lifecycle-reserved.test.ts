/**
 * Feature 002 / T031 (C19, FR49–FR51, AC18) — the reserved `process.*`/`task.*`
 * operator command ids are owned by Feature 007 and are NEVER registered by
 * plugin/MCP/custom/slash registries. Feature 002 supplies only the typed domain
 * implementations; this test pins that the reserved-name guard rejects a
 * collision from any non-builtin source while the builtin authority is allowed.
 */
import { describe, expect, test } from "bun:test"
import {
  checkReservedRegistrationName,
  getReservedEntry,
  isReservedCommandId,
  listReservedIds,
} from "../../src/operator"

const PROCESS_IDS = ["process.status", "process.tree", "process.watch", "process.cancel", "process.steer", "process.handoff"] as const
const TASK_IDS = ["task.status", "task.tree", "task.watch", "task.cancel"] as const

describe("T031 reserved process.*/task.* catalog (C19)", () => {
  test("all Feature 002 command ids are reserved in the catalog", () => {
    for (const id of [...PROCESS_IDS, ...TASK_IDS]) {
      expect(isReservedCommandId(id)).toBe(true)
      expect(listReservedIds()).toContain(id)
    }
  })

  test("native control ids are mutating; read ids are not (C19)", () => {
    for (const id of ["process.cancel", "process.steer", "process.handoff", "task.cancel"] as const) {
      expect(getReservedEntry(id)?.mutates).toBe(true)
    }
    for (const id of ["process.status", "process.tree", "process.watch", "task.status", "task.tree", "task.watch"] as const) {
      expect(getReservedEntry(id)?.mutates).toBe(false)
    }
  })

  test("plugin/MCP/custom registries cannot register a reserved id", () => {
    for (const source of ["plugin", "mcp", "custom", "slash"] as const) {
      for (const id of [...PROCESS_IDS, ...TASK_IDS]) {
        const check = checkReservedRegistrationName(id, source)
        expect(check.ok).toBe(false)
        if (!check.ok) expect(check.code).toBe("reserved_name")
      }
    }
  })

  test("the builtin authority is allowed to bind the reserved ids", () => {
    for (const id of [...PROCESS_IDS, ...TASK_IDS]) {
      expect(checkReservedRegistrationName(id, "builtin").ok).toBe(true)
    }
  })
})
