/**
 * Feature 015 T008/T009 — pure control-state derivation (FR7, FR8, FR15). Pins the
 * total `toggleStateFrom`/`triStateModeFrom` derivations (honest `unknown` on an
 * absent/foreign payload, `unavailable` for an inert control), the badge copy, and
 * the opposite-verb resolution a toggle dispatches — the exact pieces the domain
 * screen renders and the dispatch it fires.
 */
import { describe, expect, test } from "bun:test"
import {
  listOperatorPaletteEntries,
  type OperatorPaletteEntry,
  type OperatorToggleControl,
  type OperatorTriStateControl,
} from "@opencode-ai/core/operator"
import { executeOperatorCommand } from "../../src/operator/execute"
import {
  toggleBadge,
  toggleStateFrom,
  toggleTargetId,
  triStateBadge,
  triStateModeFrom,
  triStateOptionLabel,
} from "../../src/operator/controls"
import { createSpyPort, createFakeToast, createFakeDialog, spyDisplay } from "./harness"

const BY_ID = new Map(listOperatorPaletteEntries().map((e) => [e.id, e]))
function entry(id: string): OperatorPaletteEntry {
  const e = BY_ID.get(id)
  if (!e) throw new Error(`missing entry ${id}`)
  return e
}

const telemetryToggle: OperatorToggleControl = {
  kind: "toggle",
  domain: "telemetry",
  base: "telemetry",
  label: "Telemetry",
  enableId: "telemetry.on",
  disableId: "telemetry.off",
  availability: "available",
  confirmRequired: false,
}

const mcpToggle: OperatorToggleControl = {
  ...telemetryToggle,
  domain: "mcp",
  base: "mcp.experimental",
  label: "Experimental",
  enableId: "mcp.experimental.enable",
  disableId: "mcp.experimental.disable",
  availability: "unavailable",
}

const smartTriState: OperatorTriStateControl = {
  kind: "tristate",
  domain: "smart",
  base: "smart",
  label: "Smart",
  modes: [
    { state: "on", id: "smart.on" },
    { state: "off", id: "smart.off" },
    { state: "auto", id: "smart.auto" },
  ],
  availability: "available",
}

describe("Feature 015 T008 — toggle state derivation (FR7, FR15)", () => {
  test("reads the boolean `enabled` from the domain status effective", () => {
    expect(toggleStateFrom(telemetryToggle, { enabled: true })).toBe("enabled")
    expect(toggleStateFrom(telemetryToggle, { enabled: false })).toBe("disabled")
  })

  test("an unavailable control is always unavailable, regardless of any payload (FR15)", () => {
    expect(toggleStateFrom(mcpToggle, { enabled: true })).toBe("unavailable")
  })

  test("an absent/foreign payload is the honest unknown, never a fabricated on/off", () => {
    expect(toggleStateFrom(telemetryToggle, undefined)).toBe("unknown")
    expect(toggleStateFrom(telemetryToggle, null)).toBe("unknown")
    expect(toggleStateFrom(telemetryToggle, { other: 1 })).toBe("unknown")
    expect(toggleStateFrom(telemetryToggle, [1, 2])).toBe("unknown")
  })

  test("the toggle dispatches the OPPOSITE verb of the current state (FR7)", () => {
    expect(toggleTargetId(telemetryToggle, "enabled")).toBe("telemetry.off")
    expect(toggleTargetId(telemetryToggle, "disabled")).toBe("telemetry.on")
    // Indeterminate defaults to enabling; an unavailable control still resolves an
    // id so invoking it rides the same loopback and surfaces the typed envelope.
    expect(toggleTargetId(telemetryToggle, "unknown")).toBe("telemetry.on")
    expect(toggleTargetId(mcpToggle, "unavailable")).toBe("mcp.experimental.enable")
  })

  test("toggle badge copy", () => {
    expect(toggleBadge("enabled")).toBe("Enabled")
    expect(toggleBadge("disabled")).toBe("Disabled")
    expect(toggleBadge("unavailable")).toBe("Unavailable")
    expect(toggleBadge("unknown")).toBe("Unknown")
  })
})

describe("Feature 019 T012 — truthful MCP Experimental/Extension toggle badges (FR10)", () => {
  // Once the mcp status read carries the config-backed flag state, the toggle rows read
  // the same `enabled` boolean the generic derivation already consumes. This pins that
  // an available control renders Enabled/Disabled from the config-backed effective, and
  // renders Unknown ONLY when the flag state is genuinely absent (no config entry).
  const experimentalToggle: OperatorToggleControl = {
    ...mcpToggle,
    base: "mcp.experimental",
    label: "Experimental",
    enableId: "mcp.experimental.enable",
    disableId: "mcp.experimental.disable",
    availability: "available",
  }
  const extensionToggle: OperatorToggleControl = {
    ...mcpToggle,
    base: "mcp.extension",
    label: "Extension",
    enableId: "mcp.extension.enable",
    disableId: "mcp.extension.disable",
    availability: "available",
  }

  test("experimental.status config-backed effective renders Enabled/Disabled, not Unknown", () => {
    // Shape mirrors `liveExperimentalPort.status`: flags[] + the aggregate `enabled` for the default flag.
    const enabled = { flags: [{ serverId: "srv", flag: "tasks", enabled: true }], enabled: true }
    const disabled = { flags: [{ serverId: "srv", flag: "tasks", enabled: false }], enabled: false }
    expect(toggleBadge(toggleStateFrom(experimentalToggle, enabled))).toBe("Enabled")
    expect(toggleBadge(toggleStateFrom(experimentalToggle, disabled))).toBe("Disabled")
  })

  test("extension.status config-backed effective renders Enabled/Disabled, not Unknown", () => {
    const on = { enabled: true, capabilityString: "experimental/opencode.contentStream" }
    const off = { enabled: false, capabilityString: "experimental/opencode.contentStream" }
    expect(toggleBadge(toggleStateFrom(extensionToggle, on))).toBe("Enabled")
    expect(toggleBadge(toggleStateFrom(extensionToggle, off))).toBe("Disabled")
  })

  test("a genuinely absent flag state (no aggregate `enabled`) still renders Unknown", () => {
    // The backend omits `enabled` for a server with no config-backed flag SSOT entry.
    expect(toggleBadge(toggleStateFrom(experimentalToggle, { flags: [] }))).toBe("Unknown")
    expect(toggleBadge(toggleStateFrom(extensionToggle, { capabilityString: "experimental/opencode.contentStream" }))).toBe(
      "Unknown",
    )
  })
})

describe("Feature 015 T009 — tri-state mode derivation (FR8)", () => {
  test("auto wins, else enabled maps to on/off", () => {
    expect(triStateModeFrom(smartTriState, { auto: true, enabled: true })).toBe("auto")
    expect(triStateModeFrom(smartTriState, { auto: false, enabled: true })).toBe("on")
    expect(triStateModeFrom(smartTriState, { auto: false, enabled: false })).toBe("off")
  })

  test("an absent/foreign payload is the honest unknown", () => {
    expect(triStateModeFrom(smartTriState, undefined)).toBe("unknown")
    expect(triStateModeFrom(smartTriState, { other: 1 })).toBe("unknown")
  })

  test("tri-state badge + option label copy", () => {
    expect(triStateBadge("on")).toBe("On")
    expect(triStateBadge("auto")).toBe("Auto")
    expect(triStateBadge("unknown")).toBe("Unknown")
    expect(triStateOptionLabel("on")).toBe("On")
    expect(triStateOptionLabel("auto")).toBe("Auto")
  })

  test("the derived mode is the picker's pre-selected `current` (never a synthesized default)", () => {
    // `openTriStatePicker` passes `current = mode === "unknown" ? undefined : mode`.
    const preselect = (effective: unknown) => {
      const mode = triStateModeFrom(smartTriState, effective)
      return mode === "unknown" ? undefined : mode
    }
    expect(preselect({ auto: true })).toBe("auto")
    expect(preselect({ auto: false, enabled: true })).toBe("on")
    expect(preselect({ auto: false, enabled: false })).toBe("off")
    // an unknown mode leaves the picker with no pre-selection (honest, no default).
    expect(preselect({ other: 1 })).toBeUndefined()
  })
})

describe("Feature 015 T021 — control dispatch at the loopback seam (FR7, FR8, FR15, FR17)", () => {
  test("an enabled toggle dispatches the OPPOSITE (disable) verb on the canonical /op.<id>", async () => {
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    const target = toggleTargetId(telemetryToggle, "enabled")
    expect(target).toBe("telemetry.off")
    await executeOperatorCommand({ entry: entry(target), port: spy.port, dialog: createFakeDialog(), toast })
    expect(spy.tryHandleCalls[0].text).toBe("/op.telemetry.off")
  })

  test("an inert (unavailable) toggle still rides the SAME loopback and surfaces the typed envelope — never a fabricated success (FR15)", async () => {
    // The mcp experimental toggle is inert; invoking it must dispatch the canonical
    // id and surface the honest typed envelope, not synthesize an on/off success.
    const spy = createSpyPort(() =>
      spyDisplay({ variant: "warning", outcome: "not_implemented", message: "mcp.experimental.enable is not implemented yet" }),
    )
    const { toast, calls } = createFakeToast()
    const target = toggleTargetId(mcpToggle, toggleStateFrom(mcpToggle, { enabled: true }))
    // state is `unavailable` → target resolves to the enable id, still canonical.
    expect(target).toBe("mcp.experimental.enable")
    const result = await executeOperatorCommand({ entry: entry(target), port: spy.port, dialog: createFakeDialog(), toast })
    expect(spy.tryHandleCalls[0].text).toBe("/op.mcp.experimental.enable")
    expect(result.outcome).not.toBe("success")
    expect(calls[0]?.variant).not.toBe("success")
  })

  test("a tri-state selection dispatches the selected mode's canonical verb", async () => {
    const spy = createSpyPort()
    const { toast } = createFakeToast()
    await executeOperatorCommand({ entry: entry("smart.auto"), port: spy.port, dialog: createFakeDialog(), toast })
    expect(spy.tryHandleCalls[0].text).toBe("/op.smart.auto")
  })
})
