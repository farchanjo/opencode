import { describe, expect, test } from "bun:test"
import { WriterQueue } from "@opencode-ai/core/outputspool/writer-queue"

// Feature 005 / T018 (S8) — bounded producer queue + batched writer. Deterministic
// over an injected sink; no per-token write (FR8, FR9, C2, C3, AC1, AC5).

const bytes = (...n: number[]) => new Uint8Array(n)
const caps: WriterQueue.WriterCaps = { queue_depth_cap: 8 }

describe("WriterQueue — enqueue at expected offset", () => {
  test("accepts an append at the writable offset and grows the queue", () => {
    const r = WriterQueue.enqueue(WriterQueue.create(0), 0, bytes(1, 2, 3), caps)
    expect(r.kind).toBe("accepted")
    if (r.kind === "accepted") expect(WriterQueue.writableOffset(r.state)).toBe(3)
  })
  test("an append behind the writable offset is an idempotent duplicate", () => {
    const first = WriterQueue.enqueue(WriterQueue.create(0), 0, bytes(1, 2, 3), caps)
    if (first.kind !== "accepted") throw new Error("setup")
    const dup = WriterQueue.enqueue(first.state, 1, bytes(9), caps)
    expect(dup.kind).toBe("duplicate")
  })
  test("an append ahead of the writable offset is an offset_conflict", () => {
    const r = WriterQueue.enqueue(WriterQueue.create(0), 5, bytes(1), caps)
    expect(r.kind).toBe("offset_conflict")
    if (r.kind === "offset_conflict") expect(r.expected_offset).toBe(0)
  })
})

describe("WriterQueue — backpressure", () => {
  test("raises backpressure when the depth cap would be exceeded", () => {
    const s = WriterQueue.create(0)
    const r = WriterQueue.enqueue(s, 0, bytes(1, 2, 3, 4, 5, 6, 7, 8, 9), caps)
    expect(r.kind).toBe("backpressure")
  })
})

describe("WriterQueue — batched drain", () => {
  test("drains the whole pending buffer in one sink call", () => {
    let calls = 0
    const sink: WriterQueue.WriterSinkPort = {
      write: (b) => {
        calls++
        return b.length
      },
    }
    const acc = WriterQueue.enqueue(WriterQueue.create(0), 0, bytes(1, 2, 3, 4), caps)
    if (acc.kind !== "accepted") throw new Error("setup")
    const d = WriterQueue.drain(acc.state, sink)
    expect(calls).toBe(1)
    expect(d.written).toBe(4)
    expect(d.state.committed_bytes).toBe(4)
    expect(WriterQueue.queueDepth(d.state)).toBe(0)
  })

  test("tolerates a short/partial write and retains the remainder", () => {
    const sink: WriterQueue.WriterSinkPort = { write: () => 2 } // partial: only 2 of 4
    const acc = WriterQueue.enqueue(WriterQueue.create(0), 0, bytes(1, 2, 3, 4), caps)
    if (acc.kind !== "accepted") throw new Error("setup")
    const d = WriterQueue.drain(acc.state, sink)
    expect(d.written).toBe(2)
    expect(d.state.committed_bytes).toBe(2)
    expect(WriterQueue.queueDepth(d.state)).toBe(2)
    // Idempotent producer retry at the already-queued offset is a duplicate.
    const retry = WriterQueue.enqueue(d.state, 0, bytes(1, 2), caps)
    expect(retry.kind).toBe("duplicate")
  })

  test("a zero-byte write is a no-op that retains the queue", () => {
    const sink: WriterQueue.WriterSinkPort = { write: () => 0 }
    const acc = WriterQueue.enqueue(WriterQueue.create(0), 0, bytes(1, 2), caps)
    if (acc.kind !== "accepted") throw new Error("setup")
    const d = WriterQueue.drain(acc.state, sink)
    expect(d.written).toBe(0)
    expect(WriterQueue.queueDepth(d.state)).toBe(2)
  })
})
