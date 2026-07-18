/**
 * Feature 005 / T027 (S15) — the positional page reader.
 *
 * Reads exactly the requested byte window `[offset, offset+limit)` over the
 * verified `node:fs/promises` positional surface (`open(path,"r+")` →
 * `FileHandle.read(buffer, 0, len, pos)`), then hands the raw window to the
 * framework-free domain pager (`@opencode-ai/core/outputspool/paging`, T019),
 * which caps the limit and trims to a UTF-8 codepoint boundary and reports
 * `caught_up`/`eof` (FR9, FR20, C15, AC2). Reads open a fresh read-only handle
 * per call and never truncate, so concurrent reads during an append are safe —
 * the writer and the reader hold independent handles (C15). No consumer receives
 * a path; the reader is bound to an internal spool path by the sibling adapters
 * (FR12, C18).
 */
export * as PageReader from "./page-reader"

import { open } from "node:fs/promises"
import { Paging } from "@opencode-ai/core/outputspool/paging"

/** The server hard cap on a single page (provisional plan constant, C3, AC1). */
export const DEFAULT_PAGE_CAP = 1024 * 1024

/** The interactive default page size when a caller omits an explicit limit (C3, AC1). */
export const DEFAULT_PAGE_SIZE = 64 * 1024

export interface ReadPageDeps {
  readonly path: string
  readonly offset: number
  readonly limit: number
  /** The control-store committed-length authority for the channel (C12). */
  readonly committedBytes: number
  /** Whether the channel is sealed/aborted (terminal — arms `eof`). */
  readonly sealed: boolean
  readonly pageCap?: number
}

/**
 * Read one UTF-8-safe page positionally. Never reads past the committed length,
 * so an in-flight append beyond `committedBytes` is invisible to this read
 * (FR20, C12, C15, AC2).
 */
export const readPage = async (deps: ReadPageDeps): Promise<Paging.PageResult> => {
  const pageCap = deps.pageCap ?? DEFAULT_PAGE_CAP
  const cappedLimit = Math.max(0, Math.min(Math.floor(deps.limit), pageCap))
  const remaining = Math.max(0, deps.committedBytes - deps.offset)
  const toRead = Math.min(cappedLimit, remaining)
  const window = toRead > 0 ? await readWindow(deps.path, deps.offset, toRead) : new Uint8Array(0)
  return Paging.computePage({
    offset: deps.offset,
    limit: deps.limit,
    page_cap: pageCap,
    committed_bytes: deps.committedBytes,
    sealed: deps.sealed,
    window,
  })
}

/** Read `length` bytes at `position` over an independent read-only handle (concurrent-safe, C15). */
const readWindow = async (path: string, position: number, length: number): Promise<Uint8Array> => {
  const handle = await open(path, "r")
  try {
    const buffer = new Uint8Array(length)
    let filled = 0
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled)
      if (bytesRead === 0) break
      filled += bytesRead
    }
    return filled === length ? buffer : buffer.subarray(0, filled)
  } finally {
    await handle.close()
  }
}
