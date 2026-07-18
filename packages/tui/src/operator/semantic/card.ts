// Pure text-first card projection for the current pinned embedding/reranker
// binding (Feature 006 / T039, FR29, FR30, C1, C16, C20). No I/O, no
// solid-js — mirrors packages/tui/src/operator/langlock/card.ts.
//
// Source of truth: the committed `@opencode-ai/protocol/semantic/commands`
// `SemanticModelBinding` / `DegradationOutcome` — the redacted Feature 007
// operator-surface projection (never the durable SSOT record). Degraded
// status is derived from the 3-rung `RetrievalMode` ladder
// (`full_semantic | catalog_lexical | fail_closed`); a binding is never
// silently substituted, so `modelDescriptorIdText`/`versionText` always
// reflect the operator-pinned model even while degraded (C20). This module
// never surfaces a secret, an endpoint credential, or a filesystem path.

import type { DegradationOutcome, SemanticModelBinding } from "@opencode-ai/protocol/semantic/commands"

export interface BindingCardView {
  readonly slotText: string
  readonly stateText: string
  readonly modeText: string
  readonly modelDescriptorIdText: string
  readonly originText: string
  readonly versionText: string
  /** Screen-reader text is independent of any color coding (C13-style parity with langlock). */
  readonly degradedText: string
}

/** Derive the bounded, redacted card view for one binding slot; `null` when unpinned (honest empty). */
export function deriveBindingCardView(binding: SemanticModelBinding | undefined, degradation?: DegradationOutcome): BindingCardView | null {
  if (binding === undefined) return null
  const degraded = degradation !== undefined && degradation.rung !== "full_semantic"
  const degradedText = degraded ? `degraded (${degradation?.gapCode ?? degradation?.rung})` : "nominal"
  return {
    slotText: binding.slot,
    stateText: binding.state,
    modeText: binding.compatibilityMode,
    modelDescriptorIdText: binding.modelDescriptorId,
    originText: binding.selectedBy,
    versionText: `v${binding.bindingVersion}`,
    degradedText,
  }
}

export * as SemanticCard from "./card"
