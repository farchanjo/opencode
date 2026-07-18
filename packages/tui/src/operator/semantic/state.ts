// Pure signal-and-projection layer for the Semantic Search / Models panel
// (Feature 006 / T039, FR29, FR30, C16). No I/O, no solid-js — safe to
// recompute on every render, mirroring
// packages/tui/src/operator/langlock/state.ts (Feature 004 T036).

import type { DegradationOutcome, SemanticModelBinding, SemanticModelDescriptor } from "@opencode-ai/protocol/semantic/commands"
import { deriveBindingCardView, type BindingCardView } from "./card"
import { deriveModelBadgeRowView, type ModelBadgeRowView } from "./badges"

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
 * Safe default: no model descriptors, no pinned bindings. Used until a live
 * `semantic.model.list` / `semantic.binding.status` source is wired into this
 * component; the panel renders nothing rather than inventing a binding or a
 * capability. See ../langlock/state.ts's `EMPTY_LANGLOCK_PANEL_SIGNAL` wiring
 * point for the identical precedent this mirrors: the TUI operator surface
 * (`packages/tui/src/context/operator-slash.tsx`) currently exposes only a
 * request/response `tryHandle` returning an `OperatorSlashDisplay`, not a
 * structured `SemanticPanelSignal` source, so there is no live signal source
 * to wire yet. Once that seam exists, thread it through
 * `<SemanticPanel signal={...} />` (see ./index.tsx) without changing this
 * module's shape.
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

export * as SemanticPanelState from "./state"
