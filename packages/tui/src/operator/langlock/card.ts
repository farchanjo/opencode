// Pure text-first card projection for the effective Lang Lock policy (Feature
// 004 / T036, FR31, FR32, C13). No I/O, no solid-js — safe to recompute on
// every render, mirroring packages/tui/src/operator/jobs/card.ts (Feature 003
// T030).
//
// Source of truth for the row shape: the committed `@opencode-ai/protocol/
// langlock/commands` `LangLockPolicySummary` — the redacted, versioned
// Feature 007 operator-surface projection (never the durable snake_case
// `packages/schema/src/langlock/policy.ts` record). This module never
// resolves or renders artifact text, a file path, or a prompt.

import type { LangLockPolicySummary } from "@opencode-ai/protocol/langlock/commands"

export interface LangLockPolicyCardView {
  /** Screen-reader text is independent of any color coding (C13). */
  readonly tagText: string
  readonly displayNameText: string
  readonly enabledText: string
  readonly scopeText: string
  readonly originText: string
  readonly enforcementModeText: string
  /** `v<version>`, the redacted policy version surfaced to any operator query. */
  readonly policyVersionText: string
  readonly hardPolicyFloorText: string
  readonly overrideAuthorizedText: string
  readonly updatedAtText: string
}

/** Derive the bounded, redacted card view for the effective policy (FR31, FR32). */
export function derivePolicyCardView(policy: LangLockPolicySummary): LangLockPolicyCardView {
  return {
    tagText: policy.tag,
    displayNameText: policy.displayName,
    enabledText: policy.enabled ? "enabled" : "disabled",
    scopeText: policy.scope,
    originText: policy.origin,
    enforcementModeText: policy.enforcementMode,
    policyVersionText: `v${policy.policyVersion}`,
    hardPolicyFloorText: policy.hardPolicyFloorTag,
    overrideAuthorizedText: policy.overrideAuthorized ? "authorized" : "not authorized",
    updatedAtText: policy.updatedAt,
  }
}

export * as LangLockCard from "./card"
