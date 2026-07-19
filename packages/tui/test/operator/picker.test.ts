/**
 * Feature 012 T015 — entity value_picker loaders (FR6, FR8). The jobs / process /
 * task pickers load their candidates from a read query issued through the SAME
 * executeOperatorCommand path and project its `effective` payload into options
 * keyed by the entity id. This exercises the pure loader each field exposes as
 * `field.source` (the read command id + the projection): a valid read effective →
 * options keyed by the entity id; an absent/unavailable read → an empty option set
 * (honest empty picker, never a crash); a malformed effective → empty, no throw.
 * The option `value` is always the entity id, never a command id or free text.
 */
import { describe, expect, test } from "bun:test"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { resolveOperatorFormField, type OperatorFormField } from "../../src/operator/form"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

/** Resolve a verb's value_picker field, asserting its mode. */
function pickerField(id: string): Extract<OperatorFormField, { mode: "value_picker" }> {
  const field = resolveOperatorFormField(entry(id))
  if (!field || field.mode !== "value_picker") throw new Error(`expected a value_picker for ${id}`)
  return field
}

function jobDefinition(id: string) {
  return { jobDefinitionId: id, name: `job ${id}`, enabled: true, registrationState: "registered", version: 1 }
}

describe("jobs entity picker loader (jobs.list → jobDefinitionId, FR6, FR8)", () => {
  for (const id of ["jobs.enable", "jobs.disable", "jobs.delete", "jobs.run-now"]) {
    test(`${id} reads jobs.list and projects definitions into options keyed by jobDefinitionId`, () => {
      const field = pickerField(id)
      expect(field.source?.read).toBe("jobs.list")
      const options = field.source!.project({ definitions: [jobDefinition("jobdef_a"), jobDefinition("jobdef_b")] })
      expect(options.map((o) => o.value)).toEqual(["jobdef_a", "jobdef_b"])
      expect(options[0].title).toBe("job jobdef_a")
    })
  }

  test("an unavailable read (no effective) yields an empty option set — honest empty picker, no crash", () => {
    const field = pickerField("jobs.enable")
    expect(field.source!.project(undefined)).toEqual([])
    expect(field.source!.project(null)).toEqual([])
  })

  test("a malformed jobs effective projects to empty options without throwing", () => {
    const field = pickerField("jobs.delete")
    for (const bad of [42, "x", [], {}, { definitions: [{ name: "no-id" }] }]) {
      expect(() => field.source!.project(bad)).not.toThrow()
      expect(field.source!.project(bad)).toEqual([])
    }
  })
})

describe("process / task entity picker loaders (tree → processId/taskId, FR6, FR8)", () => {
  test("process.cancel reads process.tree and projects the tree views into processId options", () => {
    const field = pickerField("process.cancel")
    expect(field.source?.read).toBe("process.tree")
    const options = field.source!.project({
      nodes: [{ view: { processId: "proc_1", state: "running" } }, { view: { processId: "proc_2", state: "idle" } }],
    })
    expect(options.map((o) => o.value)).toEqual(["proc_1", "proc_2"])
    expect(options[0].title).toBe("proc_1 · running")
  })

  test("task.cancel reads task.tree and projects de-duplicated taskId options", () => {
    const field = pickerField("task.cancel")
    expect(field.source?.read).toBe("task.tree")
    const options = field.source!.project({
      nodes: [{ view: { taskId: "task_1" } }, { view: { taskId: "task_1" } }, { view: { taskId: "task_2" } }],
    })
    expect(options.map((o) => o.value)).toEqual(["task_1", "task_2"])
  })

  test("an unavailable process/task read yields empty options without throwing", () => {
    for (const id of ["process.cancel", "task.cancel"]) {
      const field = pickerField(id)
      for (const bad of [undefined, null, {}, { nodes: "x" }, { nodes: [{ view: {} }] }]) {
        expect(() => field.source!.project(bad)).not.toThrow()
        expect(field.source!.project(bad)).toEqual([])
      }
    }
  })
})

describe("static picker keeps its fixed source (FR6)", () => {
  test("langlock.set carries no dynamic source — it uses its fixed allowlist options", () => {
    const field = pickerField("langlock.set")
    expect(field.source).toBeUndefined()
    expect(field.options().every((o) => typeof o.value === "string")).toBe(true)
  })
})
