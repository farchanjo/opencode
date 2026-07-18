import { fallback, isRecord, onOff } from "../operator/output"

/**
 * Feature 001 / T033 — human renderer for the smart command surface.
 * Pure over the SmartPort status view (SmartStatusOutput).
 */

export function renderStatus(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`smart: ${effective.active === true ? "active" : "inactive"}`]
  if (effective.reason) lines.push(`reason: ${String(effective.reason)}`)
  lines.push(`brain: ${onOff(effective.brainActive)}  routing: ${onOff(effective.routingActive)}`)
  const profile = effective.routingProfile ? String(effective.routingProfile) : "-"
  const role = effective.hierarchyRole ? String(effective.hierarchyRole) : "-"
  lines.push(`profile: ${profile}  role: ${role}`)
  if (effective.indicatorState !== undefined) {
    const state = isRecord(effective.indicatorState) ? effective.indicatorState.state : effective.indicatorState
    if (state !== undefined) lines.push(`indicator: ${String(state)}`)
  }
  if (effective.degradedReason) lines.push(`degraded: ${String(effective.degradedReason)}`)
  if (effective.fallbackText) lines.push(`fallback: ${String(effective.fallbackText)}`)
  return lines.join("\n")
}

export * as SmartRender from "./render"
