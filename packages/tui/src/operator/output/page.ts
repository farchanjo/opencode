// Pure bounded-page text projection for the OutputSpool paged read/follow
// panel (Feature 005 / T039, FR20-FR22, C15, C20, C22). No I/O, no solid-js —
// safe to recompute on every render, mirroring
// packages/tui/src/operator/output/card.ts.
//
// Source of truth for the wire shape: `@opencode-ai/protocol/outputspool/
// commands` `ReadPage` (bytes/nextOffset/committedBytes/caughtUp/eof). The
// operator transport carries `bytes` as a `Uint8Array`, a plain numeric
// array, or (via the default `JSON.stringify(Uint8Array)` shape) a
// numeric-keyed record; this module tolerates all three so a caller never has
// to pre-decode before handing a frame to the panel.

import type { ReadPage } from "@opencode-ai/protocol/outputspool/commands"

/** Bounded preview cap for decoded page text (mirrors the CLI's MAX_PREVIEW_BYTES, C22). */
export const MAX_PREVIEW_BYTES = 4096

function toByteArray(bytes: unknown): Uint8Array | undefined {
  if (bytes instanceof Uint8Array) return bytes
  if (Array.isArray(bytes)) return Uint8Array.from(bytes.map((value) => Number(value) || 0))
  if (typeof bytes === "object" && bytes !== null) {
    const record = bytes as Record<string, unknown>
    const values = Object.keys(record)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => Number(record[key]) || 0)
    return values.length > 0 ? Uint8Array.from(values) : undefined
  }
  return undefined
}

/** Decode a `ReadPage.bytes` wire value into bounded UTF-8 text (never a path; none exists on `ReadPage`, C18). */
export function decodeBoundedText(bytes: unknown): { readonly text: string; readonly truncated: boolean } {
  const buffer = toByteArray(bytes)
  if (buffer === undefined) return { text: typeof bytes === "string" ? bytes : "", truncated: false }
  const bounded = buffer.length > MAX_PREVIEW_BYTES ? buffer.subarray(0, MAX_PREVIEW_BYTES) : buffer
  return { text: new TextDecoder().decode(bounded), truncated: buffer.length > MAX_PREVIEW_BYTES }
}

/** One loaded, bounded page — the panel never fetches this itself; a caller supplies it via `onExpand`/`onFollow` (see ./state.ts). */
export interface LoadedOutputPage {
  readonly page: ReadPage
  /** Opaque resume cursor when the page arrived from `output.follow`; null for a plain `output.read` page. */
  readonly cursor: string | null
}

export interface OutputPageView {
  readonly text: string
  readonly truncated: boolean
  readonly nextOffsetText: string
  readonly committedBytesText: string
  /** Screen-reader text independent of color coding (C23). */
  readonly caughtUpText: string
  readonly eofText: string
  readonly cursor: string | null
}

/** Derive the bounded, text-first page view for one loaded page (FR21, C20, C23). */
export function derivePageView(loaded: LoadedOutputPage): OutputPageView {
  const { text, truncated } = decodeBoundedText(loaded.page.bytes)
  return {
    text,
    truncated,
    nextOffsetText: String(loaded.page.nextOffset),
    committedBytesText: String(loaded.page.committedBytes),
    caughtUpText: loaded.page.caughtUp ? "caught up" : "more available",
    eofText: loaded.page.eof ? "eof" : "open",
    cursor: loaded.cursor,
  }
}

export * as OutputPage from "./page"
