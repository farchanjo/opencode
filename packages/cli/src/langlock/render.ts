import { fallback, isRecord, yesNo } from "../operator/output"

/**
 * Feature 004 / T035 (S18) — human renderers for the `opencode op langlock`
 * command surface. Pure string builders over the redacted `LangLockPolicySummary`
 * (`contracts/ports.ts`, `protocol/langlock/commands.ts`). No renderer ever
 * touches process streams so they stay unit-testable, and no renderer ever makes
 * a model call — every field arrives already redacted server-side and the
 * canonical tag is never presented as the sole label without its display name
 * (FR31, FR33, C13).
 */

/** Render a single `LangLockPolicySummary`-shaped payload. */
export function renderPolicy(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`langlock: ${String(effective.tag ?? "-")} (${String(effective.displayName ?? "-")})`]
  lines.push(`enabled: ${yesNo(effective.enabled)}`)
  lines.push(`scope: ${String(effective.scope ?? "-")}  origin: ${String(effective.origin ?? "-")}`)
  lines.push(`enforcement: ${String(effective.enforcementMode ?? "-")}`)
  lines.push(`policy version: ${String(effective.policyVersion ?? "-")}`)
  lines.push(`hard floor: ${String(effective.hardPolicyFloorTag ?? "-")}`)
  lines.push(`override authorized: ${yesNo(effective.overrideAuthorized)}`)
  if (effective.updatedAt !== undefined) lines.push(`updated: ${String(effective.updatedAt)}`)
  return lines.join("\n")
}

/** Render a `{ policy, auditId }`-shaped mutation result (`set`/`reset`). */
export function renderMutation(effective: unknown): string {
  if (!isRecord(effective) || !isRecord(effective.policy)) return fallback(effective)
  const lines = [renderPolicy(effective.policy)]
  if (effective.auditId !== undefined) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export * as LangLockRender from "./render"
