// Pure signal-and-projection layer for the Semantic Search / Models panel
// (Feature 006 / T039, FR29, FR30, C16). No I/O, no solid-js — safe to
// recompute on every render, mirroring
// packages/tui/src/operator/langlock/state.ts (Feature 004 T036).

import type { DegradationOutcome, SemanticModelBinding, SemanticModelDescriptor } from "@opencode-ai/protocol/semantic/commands"
import { deriveBindingCardView, type BindingCardView } from "./card"
import { deriveModelBadgeRowView, type ModelBadgeRowView } from "./badges"
import { emptyFallback, isPresent, isRecord, projected, shapeMismatch, type PanelProjection } from "../projection"

/**
 * Raw semantic signal the caller assembles from the Feature 007 registry's
 * `semantic.model.list` / `semantic.binding.status` reads. Every field here
 * is already the bounded, redacted, versioned operator-surface projection —
 * this module never widens or resolves anything further, never re-embeds a
 * query, and never selects/substitutes a binding on its own.
 */
export interface SemanticPanelSignal {
  readonly models: readonly SemanticModelDescriptor[]
  readonly embeddingBinding?: SemanticModelBinding
  readonly rerankerBinding?: SemanticModelBinding
  readonly degradation?: DegradationOutcome
}

/**
 * Safe default: no model descriptors, no pinned bindings. Used when the dual
 * `semantic.model.list` / `semantic.binding.status` read is absent or
 * mismatched; the panel renders nothing rather than inventing a binding or a
 * capability. Live wiring is in `dialog-settings.tsx` via
 * `mergeSemanticEffective` + `projectSemanticSignal`.
 */
export const EMPTY_SEMANTIC_PANEL_SIGNAL: SemanticPanelSignal = { models: [] }

/** Bounded row count rendered per panel view (mirrors jobs'/langlock's C22-style bound). */
export const MAX_VISIBLE_MODELS = 50

/** Eligible for the embedding selector: enabled, validated, and declares the `embedding` capability (FR30, C16). */
export function isEmbeddingEligible(descriptor: SemanticModelDescriptor): boolean {
  return descriptor.enabled && descriptor.probeState === "validated" && descriptor.capabilityKinds.includes("embedding")
}

/**
 * Eligible for the reranker selector: enabled, validated, and declares the
 * `reranker` capability. `embedding-similarity` (profile C) is a distinct
 * capability and is NEVER reranker-eligible (FR30, C16, AC34).
 */
export function isRerankerEligible(descriptor: SemanticModelDescriptor): boolean {
  return descriptor.enabled && descriptor.probeState === "validated" && descriptor.capabilityKinds.includes("reranker")
}

/** The effective embedding binding card view, or `null` when unpinned (honest empty baseline). */
export function deriveEmbeddingBindingView(signal: SemanticPanelSignal): BindingCardView | null {
  return deriveBindingCardView(signal.embeddingBinding, signal.degradation)
}

/** The effective reranker binding card view, or `null` when unpinned (honest empty baseline). */
export function deriveRerankerBindingView(signal: SemanticPanelSignal): BindingCardView | null {
  return deriveBindingCardView(signal.rerankerBinding, signal.degradation)
}

/** Bounded, order-preserving capability-badge row list for every known model descriptor. */
export function deriveVisibleModelBadges(signal: SemanticPanelSignal): readonly ModelBadgeRowView[] {
  return signal.models.slice(0, MAX_VISIBLE_MODELS).map(deriveModelBadgeRowView)
}

/** The embedding selector's eligible candidates only — enabled, validated, `embedding`-capable (FR30, C16). */
export function deriveEmbeddingSelectorCandidates(signal: SemanticPanelSignal): readonly ModelBadgeRowView[] {
  return signal.models.filter(isEmbeddingEligible).slice(0, MAX_VISIBLE_MODELS).map(deriveModelBadgeRowView)
}

/** The reranker selector's eligible candidates only — excludes profile C (`embedding-similarity`) (FR30, C16, AC34). */
export function deriveRerankerSelectorCandidates(signal: SemanticPanelSignal): readonly ModelBadgeRowView[] {
  return signal.models.filter(isRerankerEligible).slice(0, MAX_VISIBLE_MODELS).map(deriveModelBadgeRowView)
}

// =============================================================================
// Structured-result projection (Feature 012 / T007, FR4, FR8)
// =============================================================================

/** Model-descriptor guard; validates the identity + capability + probe fields. */
function isModelDescriptor(value: unknown): value is SemanticModelDescriptor {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    Array.isArray(value.capabilityKinds) &&
    typeof value.probeState === "string" &&
    typeof value.enabled === "boolean"
  )
}

/** Binding guard; validates the SSOT identity + slot + state fields. */
function isModelBinding(value: unknown): value is SemanticModelBinding {
  return isRecord(value) && typeof value.id === "string" && typeof value.slot === "string" && typeof value.state === "string"
}

/** Degradation-outcome guard; validates the bounded `rung` field. */
function isDegradationOutcome(value: unknown): value is DegradationOutcome {
  return isRecord(value) && typeof value.rung === "string"
}

/** Collect the descriptors from a `semantic.model.list` (`descriptors[]`) effective; null on a present-but-malformed array, [] when absent. */
function collectDescriptors(value: unknown): readonly SemanticModelDescriptor[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  return value.every(isModelDescriptor) ? value : null
}

/**
 * Shallow-merge two opaque semantic read effectives into one projection input
 * (`semantic.model.list` `{ descriptors }` ∪ `semantic.binding.status`
 * `{ embedding?, reranker?, degradation }`). Absent sides are skipped; a
 * present-but-non-record side is ignored so a single healthy read still
 * projects. Never invents bindings or descriptors.
 */
export function mergeSemanticEffective(primary: unknown, secondary: unknown): unknown {
  if (!isPresent(primary) && !isPresent(secondary)) return undefined
  if (!isPresent(primary)) return secondary
  if (!isPresent(secondary)) return primary
  if (!isRecord(primary) || !isRecord(secondary)) return isRecord(primary) ? primary : secondary
  return { ...primary, ...secondary }
}

/**
 * Total projection of a `semantic.model.list`/`binding.status` structured-result
 * `effective` payload onto the `SemanticPanelSignal` (FR4, FR8). Accepts either
 * read alone or a merged dual-read (`mergeSemanticEffective`). Absent →
 * `empty_fallback`; a payload that names neither read (no `descriptors`/
 * `embedding`/`reranker`/`degradation`) or a malformed one → `shape_mismatch`;
 * both degrade to `EMPTY_SEMANTIC_PANEL_SIGNAL`. Never re-embeds, never
 * substitutes a binding.
 */
export function projectSemanticSignal(effective: unknown): PanelProjection<SemanticPanelSignal> {
  if (!isPresent(effective)) return emptyFallback(EMPTY_SEMANTIC_PANEL_SIGNAL)
  if (!isRecord(effective)) return shapeMismatch(EMPTY_SEMANTIC_PANEL_SIGNAL)
  const names = "descriptors" in effective || "embedding" in effective || "reranker" in effective || "degradation" in effective
  if (!names) return shapeMismatch(EMPTY_SEMANTIC_PANEL_SIGNAL)
  const models = collectDescriptors(effective.descriptors)
  if (models === null) return shapeMismatch(EMPTY_SEMANTIC_PANEL_SIGNAL)
  return projected({
    models,
    ...(isModelBinding(effective.embedding) ? { embeddingBinding: effective.embedding } : {}),
    ...(isModelBinding(effective.reranker) ? { rerankerBinding: effective.reranker } : {}),
    ...(isDegradationOutcome(effective.degradation) ? { degradation: effective.degradation } : {}),
  })
}

export * as SemanticPanelState from "./state"
