/**
 * Pure control-state derivation for the Feature 015 toggle and tri-state rows
 * (FR7, FR8). Total and side-effect free: it reads a domain's already-redacted
 * status `effective` payload and reports the current on/off (or on/off/auto) mode
 * plus the badge text a row renders, and it resolves which opposite verb a toggle
 * dispatches. No I/O, no solid-js — safe to recompute on every render, mirroring
 * the per-domain projection modules (./status.ts, ./projection.ts).
 */
import { isRecord } from "./projection"
import type { OperatorToggleControl, OperatorTriStateControl } from "@opencode-ai/core/operator"

/** Current on/off affordance of a toggle row (mirrors `enums.cue #ToggleState` + an honest `unknown`). */
export type ToggleState = "enabled" | "disabled" | "unavailable" | "unknown"

/** Current mode of a tri-state row (mirrors `enums.cue #TriState` + an honest `unknown`). */
export type TriStateMode = "on" | "off" | "auto" | "unknown"

/**
 * Derive a toggle's current state from its domain status effective (FR7). The
 * effective status summaries carry a boolean `enabled`; an unavailable control is
 * always `unavailable` (its backend cannot be read); an absent/foreign payload is
 * the honest `unknown`, never a fabricated on/off.
 */
export function toggleStateFrom(control: OperatorToggleControl, effective: unknown): ToggleState {
  if (control.availability === "unavailable") return "unavailable"
  if (isRecord(effective) && typeof effective.enabled === "boolean") return effective.enabled ? "enabled" : "disabled"
  return "unknown"
}

/**
 * Derive a tri-state control's current mode from its domain status effective
 * (FR8). Smart routing carries `{ enabled, auto }`: `auto` wins, else `enabled`
 * maps to `on`/`off`. An unavailable control or a foreign payload is honest, never
 * a synthesized mode.
 */
export function triStateModeFrom(control: OperatorTriStateControl, effective: unknown): TriStateMode {
  if (control.availability === "unavailable") return "unknown"
  if (!isRecord(effective)) return "unknown"
  if (effective.auto === true) return "auto"
  if (typeof effective.enabled === "boolean") return effective.enabled ? "on" : "off"
  return "unknown"
}

/** Short state badge rendered on a toggle row (FR7, FR15). */
export function toggleBadge(state: ToggleState): string {
  switch (state) {
    case "enabled":
      return "Enabled"
    case "disabled":
      return "Disabled"
    case "unavailable":
      return "Unavailable"
    default:
      return "Unknown"
  }
}

/** Short mode badge rendered on a tri-state row (FR8, FR15). */
export function triStateBadge(mode: TriStateMode): string {
  switch (mode) {
    case "on":
      return "On"
    case "off":
      return "Off"
    case "auto":
      return "Auto"
    default:
      return "Unknown"
  }
}

/** Human title for one tri-state picker option (FR8). */
export function triStateOptionLabel(state: "on" | "off" | "auto"): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

/**
 * The command id a toggle dispatches given its current state (FR7). The action
 * flips the current state — enabled dispatches the disable verb and vice versa; an
 * indeterminate (`unknown`) state defaults to enabling. An `unavailable` control
 * resolves to its enable id so invoking it still rides the SAME loopback and
 * surfaces the honest typed envelope, never a fabricated success (FR15, FR17).
 */
export function toggleTargetId(control: OperatorToggleControl, state: ToggleState): string {
  return state === "enabled" ? control.disableId : control.enableId
}
