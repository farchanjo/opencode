/**
 * Feature 005 / T035 (S23) — budgeted context-slice materialization with range
 * recording.
 *
 * Materializes ONLY budgeted byte ranges of a sealed channel through the paged
 * `read(offset, limit)` contract, so the LLM never receives an entire spool file
 * automatically (FR32, FR33, C10, AC12, AC19). The exact ranges used are
 * recorded into the durable transcript reference set that feeds retention (a
 * `transcript` reference edge blocks reclaim while the slice is live, C5), so a
 * Manager/Architect handoff carries a summary plus the OutputRef and reads
 * bounded pages rather than injecting the whole channel (FR34, FR38, C10, AC19).
 *
 * The paged reader and the range recorder are injected so this module is
 * deterministic under test; the live stack binds `page-reader.ts` and the
 * control-store transcript-edge recorder.
 */
export * as ContextSlice from "./context-slice"

/** A requested byte range within a sealed channel (uncompressed bytes, C15). */
export interface SliceRange {
  readonly offset: number
  readonly limit: number
}

/** The injected paged reader; reads exactly one bounded window (FR20, C15). */
export type PagedRead = (output_ref: string, offset: number, limit: number) => Promise<{ readonly bytes: Uint8Array }>

/** The injected recorder writing a `transcript` reference edge for a used range (C5). */
export type RecordRange = (output_ref: string, range: { readonly offset: number; readonly length: number }) => void | Promise<void>

/** One materialized slice: the bytes and the exact range recorded into the transcript set. */
export interface MaterializedSlice {
  readonly bytes: Uint8Array
  readonly offset: number
  readonly length: number
}

export interface MaterializeInput {
  readonly output_ref: string
  readonly ranges: readonly SliceRange[]
  /** The total byte budget across all ranges; materialization stops at the budget (C10, AC19). */
  readonly budget_bytes: number
}

export interface MaterializeResult {
  readonly slices: readonly MaterializedSlice[]
  readonly total_bytes: number
  /** True when the budget capped materialization before every requested range was read. */
  readonly budget_exhausted: boolean
}

export interface ContextSlice {
  readonly materialize: (input: MaterializeInput) => Promise<MaterializeResult>
}

/**
 * Build the context-slice materializer. `materialize` reads only the selected
 * ranges up to the budget and records each range used; it never reads the whole
 * channel and never exceeds the budget (FR32, FR33, C10, AC19).
 */
export const createContextSlice = (read: PagedRead, record: RecordRange): ContextSlice => {
  const materialize = async (input: MaterializeInput): Promise<MaterializeResult> => {
    const slices: MaterializedSlice[] = []
    let total = 0
    let exhausted = false
    for (const range of input.ranges) {
      const room = input.budget_bytes - total
      if (room <= 0) {
        exhausted = true
        break
      }
      const limit = Math.min(range.limit, room)
      const { bytes } = await read(input.output_ref, range.offset, limit)
      if (bytes.length === 0) continue
      await record(input.output_ref, { offset: range.offset, length: bytes.length })
      slices.push({ bytes, offset: range.offset, length: bytes.length })
      total += bytes.length
    }
    return { slices, total_bytes: total, budget_exhausted: exhausted }
  }
  return { materialize }
}
