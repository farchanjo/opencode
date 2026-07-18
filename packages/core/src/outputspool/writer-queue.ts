/**
 * Feature 005 / T018 (S8) — the bounded producer queue and batched-writer
 * contract.
 *
 * Framework-free and deterministic over an injected `WriterSinkPort`: no I/O, no
 * Effect runtime, no wall-clock read. The real Bun `FileSink` adapter lives in
 * the application layer (`packages/opencode/src/outputspool/file-sink-writer.ts`,
 * T026); this module owns only the queue discipline (FR6-FR9, C2, C3).
 *
 * Invariants (FR7, FR8, FR9, C2, C3, AC1, AC5):
 *   - File-backed from the first observable chunk: the producer enqueues into a
 *     bounded queue and a batched writer drains it — there is no per-token
 *     filesystem write, and process memory is O(queue), not O(total output).
 *   - Expected-offset idempotent append: an append at the next writable offset
 *     is accepted; a re-delivered append behind the writable offset is a
 *     tolerated no-op (`duplicate`); an append ahead of it is an
 *     `offset_conflict`.
 *   - A batched drain writes the whole pending buffer in one sink call and
 *     tolerates a short or partial write, retaining the unwritten remainder for
 *     the next drain.
 *   - Enqueue past the depth/byte bound raises `backpressure` instead of growing
 *     the queue unbounded.
 */
export * as WriterQueue from "./writer-queue"

/** Bounded-queue caps; the byte depth ceiling is never relaxed by a caller (FR8, C3). */
export interface WriterCaps {
  /** Maximum queued (un-drained) bytes before backpressure is raised (FR8, AC5). */
  readonly queue_depth_cap: number
}

/**
 * The injected batched-writer sink. Writes the whole pending buffer in one call
 * and returns the number of bytes actually written (`0..bytes.length`); a short
 * or partial write is tolerated by returning fewer than `bytes.length` (FR9).
 */
export interface WriterSinkPort {
  readonly write: (bytes: Uint8Array) => number
}

/** The immutable writer state: the committed length and the bounded pending queue. */
export interface WriterState {
  readonly committed_bytes: number
  readonly pending: Uint8Array
}

const EMPTY = new Uint8Array(0)

/** Build a fresh writer state at an optional recovered committed length. */
export const create = (committed_bytes = 0): WriterState =>
  Object.freeze({ committed_bytes: Math.max(0, Math.floor(committed_bytes)), pending: EMPTY })

/** The next writable byte offset: committed bytes plus queued (un-drained) bytes. */
export const writableOffset = (state: WriterState): number => state.committed_bytes + state.pending.length

/** Queued (un-drained) byte depth. */
export const queueDepth = (state: WriterState): number => state.pending.length

const concat = (head: Uint8Array, tail: Uint8Array): Uint8Array => {
  if (head.length === 0) return tail
  if (tail.length === 0) return head
  const out = new Uint8Array(head.length + tail.length)
  out.set(head, 0)
  out.set(tail, head.length)
  return out
}

/** The outcome of enqueueing one append. */
export type EnqueueSignal =
  | { readonly kind: "accepted"; readonly state: WriterState; readonly queue_depth_bytes: number }
  | { readonly kind: "duplicate"; readonly state: WriterState }
  | { readonly kind: "offset_conflict"; readonly state: WriterState; readonly expected_offset: number }
  | { readonly kind: "backpressure"; readonly state: WriterState; readonly queue_depth_bytes: number }

/**
 * Enqueue one append at `expected_offset`. An append at the next writable offset
 * is accepted unless it would exceed the depth cap (then `backpressure`); an
 * append behind the writable offset is an idempotent `duplicate`; an append
 * ahead of it is an `offset_conflict` carrying the expected offset (FR8, FR9,
 * C3, AC5).
 */
export const enqueue = (
  state: WriterState,
  expected_offset: number,
  chunk: Uint8Array,
  caps: WriterCaps,
): EnqueueSignal => {
  const writable = writableOffset(state)
  if (expected_offset < writable) return Object.freeze({ kind: "duplicate", state })
  if (expected_offset > writable) return Object.freeze({ kind: "offset_conflict", state, expected_offset: writable })
  if (state.pending.length + chunk.length > caps.queue_depth_cap)
    return Object.freeze({ kind: "backpressure", state, queue_depth_bytes: state.pending.length })
  const pending = concat(state.pending, chunk)
  return Object.freeze({
    kind: "accepted",
    state: Object.freeze({ committed_bytes: state.committed_bytes, pending }),
    queue_depth_bytes: pending.length,
  })
}

/** The outcome of a batched drain: the advanced state and the bytes written. */
export interface DrainResult {
  readonly state: WriterState
  readonly written: number
}

/**
 * Drain the pending queue in one batched sink call. A short or partial write is
 * tolerated: the written prefix advances the committed length and the unwritten
 * remainder is retained for the next drain (FR8, FR9, C2, AC1). Never a
 * per-token write.
 */
export const drain = (state: WriterState, sink: WriterSinkPort): DrainResult => {
  if (state.pending.length === 0) return Object.freeze({ state, written: 0 })
  const reported = sink.write(state.pending)
  const written = Math.max(0, Math.min(Math.floor(reported), state.pending.length))
  if (written === 0) return Object.freeze({ state, written: 0 })
  return Object.freeze({
    state: Object.freeze({
      committed_bytes: state.committed_bytes + written,
      pending: state.pending.slice(written),
    }),
    written,
  })
}
