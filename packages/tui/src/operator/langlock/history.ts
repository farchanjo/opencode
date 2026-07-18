// Pure text-first projection for one redacted advisory record (Feature 004 /
// T036, FR21, C5, C6). No I/O, no solid-js — mirrors
// packages/tui/src/operator/jobs/history.ts's text-derivation style.
//
// Source of truth for the row shape: the committed `@opencode-ai/protocol/
// langlock/commands` `AdvisoryRecord` — already content-free (never artifact
// text, diff, prompt, message, path, or snippet, per its own contract
// comment); this module never widens it.

import type { AdvisoryRecord } from "@opencode-ai/protocol/langlock/commands"

export interface AdvisoryRowView {
  readonly advisoryId: string
  readonly stateText: string
  readonly pathKindText: string
  readonly confidenceBucketText: string
  readonly detectorProvenanceText: string
  readonly remediationStatusText: string
  /** `v<version>`, the policy version captured at detection time. */
  readonly policyVersionText: string
  readonly createdAtText: string
  readonly updatedAtText: string
}

/** Derive the bounded, redacted row view for one advisory record (FR21, C5, C6). */
export function deriveAdvisoryRowView(advisory: AdvisoryRecord): AdvisoryRowView {
  return {
    advisoryId: advisory.advisoryId,
    stateText: advisory.state,
    pathKindText: advisory.pathKind,
    confidenceBucketText: advisory.confidenceBucket,
    detectorProvenanceText: advisory.detectorProvenance,
    remediationStatusText: advisory.remediationStatus,
    policyVersionText: `v${advisory.policyVersion}`,
    createdAtText: advisory.createdAt,
    updatedAtText: advisory.updatedAt,
  }
}

export * as LangLockHistory from "./history"
