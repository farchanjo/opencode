/**
 * Feature 005 / T026 (S14) — the Bun `FileSink` batched-append adapter with the
 * tiered fsync posture.
 *
 * Drives the framework-free domain writer queue
 * (`@opencode-ai/core/outputspool/writer-queue`, T018) over a real Bun
 * `FileSink` (`Bun.file(path).writer()` → `write`/`flush`/`end`). The producer
 * enqueues chunks; a batched drain writes the whole pending buffer in one
 * `write`+`flush` call, so there is NO per-token filesystem write (FR6, FR8,
 * C2). Durability follows the C2 tiers over the verified `node:fs`
 * `fsyncSync`/`fdatasyncSync` surface (an fsync on any fd of the file flushes
 * its data extent):
 *
 *   - durable  (`assistant-text`/`reasoning`/`tool-result`/`error`/`artifact`):
 *     fsync the data extent at seal/abort AND at a bounded batched interval;
 *   - console  (`stdout`/`stderr`): fsync at seal only;
 *   - disposable (OS-tmp): never fsync.
 *
 * The fsync syscall is injected (`FsyncPort`) so tests assert the per-tier
 * posture and the "no per-token syscall" invariant deterministically; the live
 * adapter binds the real `node:fs` calls (FR24, FR26, C2, AC1, AC10).
 */
export * as FileSinkWriter from "./file-sink-writer"

import { closeSync, fdatasyncSync, fsyncSync, openSync } from "node:fs"
import { WriterQueue } from "@opencode-ai/core/outputspool/writer-queue"
import type { DurabilityTier } from "@opencode-ai/schema/outputspool/enums"

/** The batched-writer byte-depth cap (provisional plan constant, C3, AC5). */
export const DEFAULT_QUEUE_DEPTH_CAP = 4 * 1024 * 1024

/** The bounded batched fsync interval for durable tiers, in bytes written since last fsync (C2, AC1). */
export const DEFAULT_FSYNC_BATCH_BYTES = 1 * 1024 * 1024

/** The injected fsync surface; the live adapter binds `node:fs` fsyncSync/fdatasyncSync (C2). */
export interface FsyncPort {
  /** Flush the file's data extent (fdatasync) — used at the batched interval. */
  readonly datasync: (path: string) => void
  /** Flush data + metadata (fsync) — used at seal/abort. */
  readonly sync: (path: string) => void
}

/** The live `node:fs`-backed fsync port; opens a short-lived fd per flush (C2). */
export const nodeFsyncPort: FsyncPort = {
  datasync: (path) => withFd(path, fdatasyncSync),
  sync: (path) => withFd(path, fsyncSync),
}

const withFd = (path: string, op: (fd: number) => void): void => {
  const fd = openSync(path, "r+")
  try {
    op(fd)
  } finally {
    closeSync(fd)
  }
}

/** A minimal Bun `FileSink`-shaped sink; injectable so tests avoid real disk. */
export interface ByteSink {
  readonly write: (chunk: Uint8Array) => number
  readonly flush: () => number | Promise<number>
  readonly end: () => void | Promise<void>
}

/** Open a Bun `FileSink` for appended writes at `path` (live adapter). */
export const openBunSink = (path: string): ByteSink => {
  const sink = Bun.file(path).writer()
  return {
    write: (chunk) => sink.write(chunk) as number,
    flush: () => sink.flush(),
    end: () => {
      sink.end()
    },
  }
}

/** Which fsync moments apply for a durability tier (C2). */
const tierPolicy = (tier: DurabilityTier): { readonly interval: boolean; readonly terminal: boolean } => {
  switch (tier) {
    case "durable":
      return { interval: true, terminal: true }
    case "console":
      return { interval: false, terminal: true }
    case "disposable":
      return { interval: false, terminal: false }
  }
}

export interface ChannelWriterDeps {
  readonly path: string
  readonly tier: DurabilityTier
  readonly sink: ByteSink
  readonly fsync: FsyncPort
  readonly queueDepthCap?: number
  readonly fsyncBatchBytes?: number
  /** Committed length recovered from the control store, if resuming (C12). */
  readonly recoveredCommittedBytes?: number
}

/** The outcome of one batched append; mirrors the domain enqueue+drain result. */
export type AppendResult =
  | { readonly kind: "accepted"; readonly committedBytes: number; readonly queueDepthBytes: number }
  | { readonly kind: "duplicate"; readonly committedBytes: number }
  | { readonly kind: "offset_conflict"; readonly expectedOffset: number }
  | { readonly kind: "backpressure"; readonly committedBytes: number; readonly queueDepthBytes: number }

/**
 * A single-channel batched writer. Owns the domain queue state and the Bun sink
 * for one channel generation file; append enqueues then drains, seal/abort flush
 * and fsync per tier (FR8, C2).
 */
export interface ChannelWriter {
  readonly committedBytes: () => number
  readonly append: (expectedOffset: number, chunk: Uint8Array) => Promise<AppendResult>
  readonly seal: () => Promise<number>
  readonly abort: () => Promise<number>
}

export const createChannelWriter = (deps: ChannelWriterDeps): ChannelWriter => {
  const caps: WriterQueue.WriterCaps = { queue_depth_cap: deps.queueDepthCap ?? DEFAULT_QUEUE_DEPTH_CAP }
  const batchBytes = deps.fsyncBatchBytes ?? DEFAULT_FSYNC_BATCH_BYTES
  const policy = tierPolicy(deps.tier)
  const sinkPort: WriterQueue.WriterSinkPort = { write: (bytes) => deps.sink.write(bytes) }

  let state = WriterQueue.create(deps.recoveredCommittedBytes ?? 0)
  let bytesSinceFsync = 0

  const drain = async (): Promise<void> => {
    const before = WriterQueue.queueDepth(state)
    if (before === 0) return
    const result = WriterQueue.drain(state, sinkPort)
    state = result.state
    if (result.written === 0) return
    await deps.sink.flush()
    bytesSinceFsync += result.written
    if (policy.interval && bytesSinceFsync >= batchBytes) {
      deps.fsync.datasync(deps.path)
      bytesSinceFsync = 0
    }
  }

  const append = async (expectedOffset: number, chunk: Uint8Array): Promise<AppendResult> => {
    const signal = WriterQueue.enqueue(state, expectedOffset, chunk, caps)
    state = signal.state
    if (signal.kind === "offset_conflict") return { kind: "offset_conflict", expectedOffset: signal.expected_offset }
    if (signal.kind === "duplicate") return { kind: "duplicate", committedBytes: state.committed_bytes }
    if (signal.kind === "backpressure")
      return { kind: "backpressure", committedBytes: state.committed_bytes, queueDepthBytes: signal.queue_depth_bytes }
    await drain()
    return { kind: "accepted", committedBytes: state.committed_bytes, queueDepthBytes: WriterQueue.queueDepth(state) }
  }

  const finalize = async (): Promise<number> => {
    await drain()
    await deps.sink.end()
    if (policy.terminal) deps.fsync.sync(deps.path)
    return state.committed_bytes
  }

  return {
    committedBytes: () => state.committed_bytes,
    append,
    seal: finalize,
    abort: finalize,
  }
}
