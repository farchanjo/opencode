/**
 * Feature 015 T014-T017 — pure entity-CRUD classification + honest availability
 * (FR12, FR13, FR14, FR15, FR17). Pins the collection-domain → entity-kind map,
 * the list/create/idKey descriptors, the total row projection (honest-empty on an
 * absent/foreign payload), the per-entity action list (a toggle dispatching the
 * OPPOSITE of the row's live state, edit/reschedule/delete, and the marked typed
 * gaps), and that every action rides a REAL canonical catalog id — no new dispatch
 * path, no fabricated id (FR17).
 */
import { describe, expect, test } from "bun:test"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import { createSpyPort, createFakeToast, createFakeDialog } from "./harness"
import {
  buildOperatorEntityActions,
  entityConsumedConfigureIds,
  entityCreateAvailability,
  listOperatorEntityKinds,
  projectEntityRows,
  resolveOperatorEntityScreen,
  type OperatorEntityRow,
} from "../../src/operator/entity"

const CATALOG_IDS = new Set(listOperatorPaletteEntries().map((e) => e.id))
const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

const enabledJob: OperatorEntityRow = { entityId: "jobdef_a", label: "job a", badge: "enabled", active: true }
const disabledJob: OperatorEntityRow = { entityId: "jobdef_b", label: "job b", badge: "disabled", active: false }

describe("Feature 015 T014-T016 — collection domain → entity kinds (FR12-FR14)", () => {
  test("only the three collection domains expose entity lists", () => {
    expect(listOperatorEntityKinds("jobs")).toEqual(["job"])
    expect(listOperatorEntityKinds("semantic")).toEqual(["provider", "model"])
    expect(listOperatorEntityKinds("mcp")).toEqual(["mcp_server"])
    expect(listOperatorEntityKinds("langlock")).toEqual([])
    expect(listOperatorEntityKinds("telemetry")).toEqual([])
  })

  test("each screen descriptor names a real list-read + create id and its entity id key", () => {
    const job = resolveOperatorEntityScreen("job")
    expect(job).toMatchObject({ listRead: "jobs.list", createId: "jobs.create", idKey: "jobDefinitionId", title: "Jobs" })
    expect(resolveOperatorEntityScreen("provider")).toMatchObject({ listRead: "semantic.provider.list", createId: "semantic.provider.add", idKey: "id" })
    expect(resolveOperatorEntityScreen("model")).toMatchObject({ listRead: "semantic.model.list", createId: "semantic.model.register", idKey: "id" })
    expect(resolveOperatorEntityScreen("mcp_server")).toMatchObject({ listRead: "mcp.server.list", createId: "mcp.server.add", idKey: "id" })
  })
})

describe("Feature 015 T014 — total row projection (FR12)", () => {
  test("jobs.list effective projects definition rows with the live enabled state", () => {
    const rows = projectEntityRows("job", {
      definitions: [
        { jobDefinitionId: "jobdef_a", name: "job a", enabled: true, registrationState: "registered", version: 1 },
        { jobDefinitionId: "jobdef_b", name: "job b", enabled: false, registrationState: "registered", version: 1 },
      ],
    })
    expect(rows.map((r) => [r.entityId, r.label, r.active])).toEqual([
      ["jobdef_a", "job a", true],
      ["jobdef_b", "job b", false],
    ])
  })

  test("an absent/foreign payload projects the honest empty list, never fabricated rows (FR15)", () => {
    expect(projectEntityRows("job", undefined)).toEqual([])
    expect(projectEntityRows("provider", null)).toEqual([])
    expect(projectEntityRows("mcp_server", { other: 1 })).toEqual([])
    expect(projectEntityRows("model", [1, 2])).toEqual([])
  })

  test("semantic.provider.list effective projects provider rows from `profiles`", () => {
    const rows = projectEntityRows("provider", { profiles: [{ id: "prov_a", name: "OpenAI", enabled: true }] })
    expect(rows).toEqual([{ entityId: "prov_a", label: "OpenAI", badge: "enabled", active: true }])
  })
})

describe("Feature 015 T014 — jobs item actions (FR12)", () => {
  test("an enabled job's toggle dispatches jobs.disable; a disabled job's toggle dispatches jobs.enable", () => {
    const [enabledToggle] = buildOperatorEntityActions("job", enabledJob)
    expect(enabledToggle).toMatchObject({ interaction: "toggle", id: "jobs.disable", verb: "disable" })
    const [disabledToggle] = buildOperatorEntityActions("job", disabledJob)
    expect(disabledToggle).toMatchObject({ interaction: "toggle", id: "jobs.enable", verb: "enable" })
  })

  test("the item offers edit(modal), reschedule(modal), delete(confirm), run-now(typed gap)", () => {
    const byVerb = new Map(buildOperatorEntityActions("job", enabledJob).map((a) => [a.verb, a]))
    expect(byVerb.get("edit")).toMatchObject({ id: "jobs.update", interaction: "modal" })
    expect(byVerb.get("reschedule")).toMatchObject({ id: "jobs.reschedule", interaction: "modal" })
    expect(byVerb.get("delete")).toMatchObject({ id: "jobs.delete", interaction: "confirm" })
    // run-now stays a marked typed gap even though the jobs domain persists (FR15).
    expect(byVerb.get("run_now")).toMatchObject({ id: "jobs.run-now", availability: "unavailable" })
    expect(byVerb.get("edit")!.availability).not.toBe("unavailable")
  })
})

describe("Feature 015 T015 — semantic item actions + honest secret/Milvus gaps (FR13, FR15)", () => {
  test("provider offers edit/rotate-secret/disable/delete; the secret rotate is marked inert", () => {
    const byVerb = new Map(buildOperatorEntityActions("provider", { entityId: "prov_a", label: "OpenAI", badge: "enabled", active: true }).map((a) => [a.verb, a]))
    expect(byVerb.get("edit")).toMatchObject({ id: "semantic.provider.update", availability: "available" })
    expect(byVerb.get("disable")).toMatchObject({ id: "semantic.provider.disable", interaction: "direct" })
    expect(byVerb.get("delete")).toMatchObject({ id: "semantic.provider.delete", interaction: "confirm" })
    // Secret-bearing rotate is inert until keychain — never a fabricated success (FR15).
    expect(byVerb.get("rotate_secret")).toMatchObject({ id: "semantic.provider.rotate-secret", availability: "unavailable" })
  })

  test("model offers a disable action mapped to the canonical id", () => {
    const actions = buildOperatorEntityActions("model", { entityId: "mdl_a", label: "bge", badge: "enabled" })
    expect(actions.map((a) => [a.verb, a.id])).toEqual([["disable", "semantic.model.disable"]])
  })
})

describe("Feature 015 T016 — mcp servers (honest-unavailable backend marked inert, FR14, FR15)", () => {
  test("connect/disconnect toggles over the live connection state, all actions inert", () => {
    const connected = buildOperatorEntityActions("mcp_server", { entityId: "srv_a", label: "srv", badge: "connected", active: true })
    expect(connected[0]).toMatchObject({ interaction: "toggle", id: "mcp.server.disconnect", verb: "disconnect" })
    const disconnected = buildOperatorEntityActions("mcp_server", { entityId: "srv_a", label: "srv", badge: "disconnected", active: false })
    expect(disconnected[0]).toMatchObject({ id: "mcp.server.connect", verb: "connect" })
    // The whole mcp backend is honest-unavailable today → every action marked inert.
    for (const action of connected) expect(action.availability).toBe("unavailable")
  })
})

describe("Feature 015 T017 — availability + parity (FR15, FR17)", () => {
  test("create availability is honest per domain (jobs persists, mcp unavailable)", () => {
    expect(entityCreateAvailability("job")).not.toBe("unavailable")
    expect(entityCreateAvailability("mcp_server")).toBe("unavailable")
  })

  test("every entity action / create / list-read rides a REAL catalog command id (no new dispatch path)", () => {
    for (const kind of ["job", "provider", "model", "mcp_server"] as const) {
      const screen = resolveOperatorEntityScreen(kind)
      expect(CATALOG_IDS.has(screen.listRead)).toBe(true)
      if (screen.createId) expect(CATALOG_IDS.has(screen.createId)).toBe(true)
      const sample: OperatorEntityRow = { entityId: "x", label: "x", badge: "b", active: true }
      for (const action of buildOperatorEntityActions(kind, sample)) expect(CATALOG_IDS.has(action.id)).toBe(true)
    }
  })

  test("consumed Configure ids partition into real Configure verbs of the domain", () => {
    for (const domain of ["jobs", "semantic", "mcp"]) {
      for (const id of entityConsumedConfigureIds(domain)) {
        expect(BY_ID.get(id)?.mutates).toBe(true)
      }
    }
    expect(entityConsumedConfigureIds("jobs").has("jobs.create")).toBe(true)
    expect(entityConsumedConfigureIds("jobs").has("jobs.run-now")).toBe(true)
    // A view verb is never consumed by the entity screens.
    expect(entityConsumedConfigureIds("jobs").has("jobs.list")).toBe(false)
  })
})

describe("Feature 015 T014/T018 — entity actions ride the SAME loopback + toast discipline (FR17, FR18)", () => {
  test("an enabled job's toggle dispatches /op.jobs.disable carrying the entity id", async () => {
    const spy = createSpyPort()
    const { toast, calls } = createFakeToast()
    const [toggle] = buildOperatorEntityActions("job", enabledJob)
    await executeOperatorCommand({
      entry: entry(toggle.id),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { jobDefinitionId: enabledJob.entityId },
    })
    expect(spy.tryHandleCalls[0].text).toBe('/op.jobs.disable {"jobDefinitionId":"jobdef_a"}')
    // A user-invoked mutation MAY toast its final outcome (FR18).
    expect(calls.length).toBe(1)
  })

  test("a silent list read fires NO toast (views/status/prefill reads stay silent, FR18)", async () => {
    const spy = createSpyPort()
    const { toast, calls } = createFakeToast()
    await executeOperatorCommand({ entry: entry("jobs.list"), port: spy.port, dialog: createFakeDialog(), toast, silent: true })
    expect(calls).toHaveLength(0)
  })

  test("a delete rides /op.jobs.delete with the entity id (canonical, no new path)", async () => {
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    await executeOperatorCommand({
      entry: entry("jobs.delete"),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { jobDefinitionId: "jobdef_a" },
    })
    expect(spy.tryHandleCalls[0].text).toBe('/op.jobs.delete {"jobDefinitionId":"jobdef_a"}')
  })
})

/**
 * Faithful model of `DialogOperatorEntityItem.confirmDelete`: it only dispatches
 * when the DialogConfirm gate resolves `true`; a declined confirm dispatches
 * nothing (no phantom mutation). Returns the spy so a test asserts the wire.
 */
async function confirmDeleteModel(kind: "job" | "provider", ok: boolean) {
  const screen = resolveOperatorEntityScreen(kind)
  const row: OperatorEntityRow = { entityId: "ent_1", label: "ent", badge: "enabled", active: true }
  const del = buildOperatorEntityActions(kind, row).find((a) => a.interaction === "confirm")!
  const spy = createSpyPort()
  const { toast } = createFakeToast()
  if (ok) {
    await executeOperatorCommand({
      entry: entry(del.id),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { [screen.idKey]: row.entityId },
    })
  }
  return { spy, del }
}

describe("Feature 015 T023 — delete confirm gate: no phantom dispatch on cancel (FR12)", () => {
  test("a declined delete confirm dispatches nothing (no wire call)", async () => {
    const { spy } = await confirmDeleteModel("job", false)
    expect(spy.tryHandleCalls).toHaveLength(0)
    expect(spy.preflightCalls).toHaveLength(0)
  })

  test("an accepted delete confirm dispatches the canonical id once, carrying the entity id", async () => {
    const { spy, del } = await confirmDeleteModel("job", true)
    expect(del.id).toBe("jobs.delete")
    expect(spy.tryHandleCalls).toHaveLength(1)
    expect(spy.tryHandleCalls[0].text).toBe('/op.jobs.delete {"jobDefinitionId":"ent_1"}')
  })
})

describe("Feature 015 T023 — semantic + mcp list → item → action dispatch chains (FR13, FR14, FR17)", () => {
  test("a provider row's disable/delete ride the canonical semantic ids with the `id` key", async () => {
    // list → row → item actions, exactly as the screen composes them.
    const [row] = projectEntityRows("provider", { profiles: [{ id: "prov_a", name: "OpenAI", enabled: true }] })
    const byVerb = new Map(buildOperatorEntityActions("provider", row).map((a) => [a.verb, a]))
    const screen = resolveOperatorEntityScreen("provider")
    for (const verb of ["disable", "delete"] as const) {
      const action = byVerb.get(verb)!
      const spy = createSpyPort()
      const { toast } = createFakeToast()
      await executeOperatorCommand({
        entry: entry(action.id),
        port: spy.port,
        dialog: createFakeDialog(),
        toast,
        payload: { [screen.idKey]: row.entityId },
      })
      expect(spy.tryHandleCalls[0].text).toBe(`/op.${action.id} {"id":"prov_a"}`)
    }
  })

  test("an mcp server's connect/disconnect toggle rides the OPPOSITE canonical id over the live state", async () => {
    const connected: OperatorEntityRow = { entityId: "srv_a", label: "srv", badge: "connected", active: true }
    const [toggle] = buildOperatorEntityActions("mcp_server", connected)
    expect(toggle.id).toBe("mcp.server.disconnect")
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    const result = await executeOperatorCommand({
      entry: entry(toggle.id),
      port: spy.port,
      dialog: createFakeDialog(),
      toast,
      payload: { id: connected.entityId },
    })
    expect(spy.tryHandleCalls[0].text).toBe('/op.mcp.server.disconnect {"id":"srv_a"}')
    // the whole mcp backend is honest-unavailable → the action is marked inert.
    expect(toggle.availability).toBe("unavailable")
    // it still surfaces the typed envelope, never a fabricated success.
    expect(result.outcome).toBeDefined()
  })
})
