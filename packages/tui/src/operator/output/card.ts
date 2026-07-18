// Pure text-first card projection for one OutputSpool channel entry (Feature
// 005 / T039, FR18, FR41, C22). No I/O, no solid-js — safe to recompute on
// every render, mirroring packages/tui/src/operator/langlock/card.ts (Feature
// 004 T036).
//
// Source of truth for the row shape: the committed
// `@opencode-ai/protocol/outputspool/commands` `OutputStat` — the redacted,
// content-free operator-surface projection (never the durable snake_case
// `packages/schema/src/outputspool/stat.ts` record, and never a filesystem
// path, C18). This module never resolves or renders channel content.

import type { OutputStat } from "@opencode-ai/protocol/outputspool/commands"

export interface OutputEntryCardView {
  readonly outputRef: string
  /** Screen-reader text is independent of any color coding (C23). */
  readonly channelText: string
  readonly stateText: string
  readonly committedBytesText: string
  readonly durabilityTierText: string
  readonly languageTagText: string | null
  readonly updatedAtText: string
}

/** Derive the bounded, content-free card view for one channel's read model (FR18, C22). */
export function deriveEntryCardView(stat: OutputStat): OutputEntryCardView {
  return {
    outputRef: stat.outputRef,
    channelText: stat.channel,
    stateText: stat.state,
    committedBytesText: `${stat.committedBytes} B`,
    durabilityTierText: stat.fsyncTier,
    languageTagText: stat.languageTag ?? null,
    updatedAtText: stat.updatedAt,
  }
}

export * as OutputCard from "./card"
