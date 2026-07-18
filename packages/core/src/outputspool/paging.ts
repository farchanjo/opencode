/**
 * Feature 005 / T019 (S9) — server-capped, UTF-8-safe byte-offset paging.
 *
 * Framework-free and deterministic: no I/O. The application positional reader
 * (`packages/opencode/src/outputspool/page-reader.ts`, T027) reads the raw byte
 * window from the spool file and hands it here; this module owns only the paging
 * contract (FR20, FR21, C15, AC2, AC3).
 *
 * Contract (FR20, FR21, C15):
 *   - The canonical offset unit is uncompressed bytes; `limit` is mandatory and
 *     capped to the server `page_cap`.
 *   - A page never splits a UTF-8 codepoint: a window that stops mid-sequence is
 *     trimmed back to the last complete codepoint boundary, so the next read
 *     resumes on a boundary.
 *   - `caught_up` is true when the reader has consumed through the committed end.
 *   - `eof` is true only when the channel is sealed/aborted AND consumed through
 *     the committed end; an open stream reports `caught_up`, never `eof`.
 */
export * as Paging from "./paging"

/** The paging request plus the raw byte window the reader supplied for `[offset, …]`. */
export interface PageInput {
  readonly offset: number
  readonly limit: number
  /** Server-side hard cap on `limit` (FR20, C3, AC1). */
  readonly page_cap: number
  /** The control-store committed-length authority for the channel (C12). */
  readonly committed_bytes: number
  /** Whether the channel is sealed or aborted (terminal — no further append). */
  readonly sealed: boolean
  /** The raw bytes read at `offset`; may over-read, it is re-capped here. */
  readonly window: Uint8Array
}

/** The paged read result, mirroring `page.cue` `#ReadPage` plus the page bytes. */
export interface PageResult {
  readonly bytes: Uint8Array
  readonly range: { readonly offset: number; readonly limit: number; readonly length: number }
  readonly next_offset: number
  readonly committed_bytes: number
  readonly caught_up: boolean
  readonly eof: boolean
}

/**
 * The largest prefix length of `bytes` that ends on a complete UTF-8 codepoint
 * boundary. A trailing incomplete multi-byte sequence is excluded so a page
 * never splits a codepoint; a complete boundary is returned unchanged (C15, AC3).
 */
export const utf8BoundaryLength = (bytes: Uint8Array): number => {
  const len = bytes.length
  if (len === 0) return 0
  let cont = 0
  let i = len
  while (i > 0 && (bytes[i - 1] & 0xc0) === 0x80 && cont < 3) {
    i--
    cont++
  }
  if (i === 0) return len // all continuation bytes: malformed — do not trim further
  const lead = bytes[i - 1]
  const seqLen = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
  if (cont + 1 === seqLen) return len // the trailing sequence is complete
  return i - 1 // drop the incomplete lead + its continuation bytes
}

/**
 * Compute one UTF-8-safe page. Pure and total: caps the limit, trims the window
 * to a codepoint boundary, and reports `caught_up`/`eof` per the read contract
 * (FR20, FR21, C15, AC2, AC3).
 */
export const computePage = (input: PageInput): PageResult => {
  const cappedLimit = Math.max(0, Math.min(Math.floor(input.limit), Math.floor(input.page_cap)))
  const remaining = Math.max(0, input.committed_bytes - input.offset)
  const rawLen = Math.min(cappedLimit, remaining, input.window.length)
  const raw = input.window.subarray(0, rawLen)
  const length = utf8BoundaryLength(raw)
  const next_offset = input.offset + length
  const caught_up = next_offset === input.committed_bytes
  const eof = input.sealed && caught_up
  return Object.freeze({
    bytes: raw.subarray(0, length),
    range: Object.freeze({ offset: input.offset, limit: cappedLimit, length }),
    next_offset,
    committed_bytes: input.committed_bytes,
    caught_up,
    eof,
  })
}
