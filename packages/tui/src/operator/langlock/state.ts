// Pure signal-and-projection layer for the Lang Lock panel (Feature 004 /
// T036, FR31, FR32, C13). No I/O, no solid-js — safe to recompute on every
// render, mirroring packages/tui/src/operator/jobs/state.ts (Feature 003
// T030).

import type { AdvisoryRecord, LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"
import { deriveAdvisoryRowView, type AdvisoryRowView } from "./history"
import { derivePolicyCardView, type LangLockPolicyCardView } from "./card"
import { emptyFallback, isPresent, isRecord, projected, shapeMismatch, type PanelProjection } from "../projection"

/**
 * Raw langlock signal the caller assembles from the Feature 007 registry's
 * `LangLockPolicyPort.resolve`/`AdvisoryPort.list` reads. Every field here is
 * already the bounded, redacted, versioned operator-surface projection — this
 * module never widens or resolves anything further.
 */
export interface LangLockPanelSignal {
  readonly policy: LangLockPolicySummary | null
  readonly advisories: readonly AdvisoryRecord[]
}

/**
 * Safe default: no resolved policy, no advisory history. Used until a live
 * `LangLockPolicyPort`/`AdvisoryPort` source is wired into this component; the
 * panel renders nothing rather than inventing a policy or advisory row. See
 * ../jobs/state.ts's `EMPTY_JOBS_PANEL_SIGNAL` wiring point for the identical
 * precedent this mirrors: the TUI operator surface
 * (`packages/tui/src/context/operator-slash.tsx`) currently exposes only a
 * request/response `tryHandle` returning an `OperatorSlashDisplay` (title/
 * message/variant/outcome strings), not a structured `LangLockPolicyPort`/
 * `AdvisoryPort` query result or a live `langlock.*` observation stream, so
 * there is no live `LangLockPanelSignal` source to wire yet. Once either seam
 * exists, thread it through `<LangLockPanel signal={...} />` (see ./index.tsx)
 * without changing this module's shape.
 */
export const EMPTY_LANGLOCK_PANEL_SIGNAL: LangLockPanelSignal = { policy: null, advisories: [] }

/** Bounded row count rendered per panel view (mirrors jobs' C22 bound). */
export const MAX_VISIBLE_ADVISORIES = 50

/** The effective policy card view, or null when unresolved (honest empty baseline). */
export function derivePolicyView(signal: LangLockPanelSignal): LangLockPolicyCardView | null {
  return signal.policy === null ? null : derivePolicyCardView(signal.policy)
}

/** Bounded, order-preserving advisory history row list. */
export function deriveVisibleAdvisories(signal: LangLockPanelSignal): readonly AdvisoryRowView[] {
  return signal.advisories.slice(0, MAX_VISIBLE_ADVISORIES).map(deriveAdvisoryRowView)
}

// =============================================================================
// Structured-result projection (Feature 012 / T004, FR4, FR8)
// =============================================================================

/** Structural guard for the redacted `LangLockPolicySummary` carried on `langlock.status`/`show` effective. */
function isPolicySummary(value: unknown): value is LangLockPolicySummary {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.tag === "string" &&
    typeof value.displayName === "string" &&
    typeof value.scope === "string" &&
    typeof value.origin === "string" &&
    typeof value.policyVersion === "number" &&
    typeof value.enforcementMode === "string" &&
    typeof value.hardPolicyFloorTag === "string" &&
    typeof value.overrideAuthorized === "boolean" &&
    typeof value.updatedAt === "string"
  )
}

/** Content-free advisory guard; validates the discriminating id + lifecycle fields only. */
function isAdvisoryRecord(value: unknown): value is AdvisoryRecord {
  return (
    isRecord(value) &&
    typeof value.advisoryId === "string" &&
    typeof value.policyVersion === "number" &&
    typeof value.state === "string" &&
    typeof value.remediationStatus === "string"
  )
}

/**
 * Total projection of a `langlock.status`/`show` structured-result `effective`
 * payload onto the `LangLockPanelSignal` (FR4, FR8). The read effective is a bare
 * redacted `LangLockPolicySummary`; a combined read may wrap it as `{ policy,
 * advisories }`. Absent → `empty_fallback`; a payload with no valid policy →
 * `shape_mismatch`; both degrade to `EMPTY_LANGLOCK_PANEL_SIGNAL`. Never throws.
 */
export function projectLangLockSignal(effective: unknown): PanelProjection<LangLockPanelSignal> {
  if (!isPresent(effective)) return emptyFallback(EMPTY_LANGLOCK_PANEL_SIGNAL)
  const policy = isPolicySummary(effective) ? effective : isRecord(effective) && isPolicySummary(effective.policy) ? effective.policy : null
  if (policy === null) return shapeMismatch(EMPTY_LANGLOCK_PANEL_SIGNAL)
  const advisories = isRecord(effective) && Array.isArray(effective.advisories) ? effective.advisories.filter(isAdvisoryRecord) : []
  return projected({ policy, advisories })
}

export * as LangLockPanelState from "./state"
