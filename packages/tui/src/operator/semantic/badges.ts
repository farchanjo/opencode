// Pure text-first capability-badge projection for one semantic model
// descriptor (Feature 006 / T039, FR29, FR30, C16). No I/O, no solid-js —
// mirrors packages/tui/src/operator/langlock/history.ts's text-derivation
// style.
//
// Source of truth for the row shape: the committed `@opencode-ai/protocol/
// semantic/commands` `SemanticModelDescriptor` — the redacted Feature 007
// operator-surface projection. `embedding-similarity` is a DISTINCT
// `CapabilityKind` member and is rendered under its own badge, never folded
// into (or mislabeled as) `reranker` (FR30, C16, AC34). This module never
// surfaces a secret, an endpoint credential, or a filesystem path.

import type { SemanticModelDescriptor } from "@opencode-ai/protocol/semantic/commands"

export interface ModelBadgeRowView {
  readonly modelDescriptorIdText: string
  readonly displayNameText: string
  /** Capability badges rendered verbatim from the closed 4-member enum; `embedding-similarity` stays its own badge. */
  readonly capabilityBadgesText: readonly string[]
  readonly dimensionsText: string
  readonly limitsText: string
  /** One of `validated | declared | failed | stale` — untrusted until `validated` (C16). */
  readonly probeStateText: string
  readonly enabledText: string
}

function describeLimits(limits: SemanticModelDescriptor["limits"]): string {
  if (limits === undefined) return "-"
  const batch = limits.maxBatchSize === undefined ? "-" : `batch<=${limits.maxBatchSize}`
  const tokens = limits.maxInputTokens === undefined ? "-" : `tokens<=${limits.maxInputTokens}`
  return `${batch} ${tokens}`
}

/** Derive the bounded, redacted badge row view for one model descriptor (FR30, C16, AC34). */
export function deriveModelBadgeRowView(descriptor: SemanticModelDescriptor): ModelBadgeRowView {
  return {
    modelDescriptorIdText: descriptor.id,
    displayNameText: descriptor.displayName,
    capabilityBadgesText: descriptor.capabilityKinds,
    dimensionsText: descriptor.dimensions === undefined ? "-" : String(descriptor.dimensions),
    limitsText: describeLimits(descriptor.limits),
    probeStateText: descriptor.probeState,
    enabledText: descriptor.enabled ? "enabled" : "disabled",
  }
}

export * as SemanticBadges from "./badges"
