/**
 * Feature 005 / T026 (S14) — Bun FileSink batched writer + tiered fsync.
 * Asserts batched append with no per-token syscall and the per-tier fsync
 * posture (durable syncs at seal + interval, console at seal only, disposable
 * never) over an injected sink + fsync port (FR8, C2, AC1, AC10).
 */
import { describe, expect, test } from "bun:test"
import { FileSinkWriter } from "@/outputspool/file-sink-writer"

const enc = (s: string) => new TextEncoder().encode(s)

const recordingSink = () => {
  const writes: number[] = []
  let flushes = 0
  const buf: number[] = []
  return {
    writes,
    flushCount: () => flushes,
    buffer: () => buf,
    sink: {
      write: (chunk: Uint8Array) => {
        writes.push(chunk.length)
        for (const b of chunk) buf.push(b)
        return chunk.length
      },
      flush: () => {
        flushes++
        return 0
      },
      end: () => {},
    },
  }
}

const countingFsync = () => {
  const calls: string[] = []
  return { calls, port: { datasync: () => calls.push("datasync"), sync: () => calls.push("sync") } }
}

describe("file-sink-writer", () => {
  test("batched append: one sink write per append, not per token", async () => {
    const rec = recordingSink()
    const fsync = countingFsync()
    const w = FileSinkWriter.createChannelWriter({ path: "/x", tier: "console", sink: rec.sink, fsync: fsync.port })
    await w.append(0, enc("hello "))
    await w.append(6, enc("world"))
    expect(rec.writes).toEqual([6, 5])
    expect(w.committedBytes()).toBe(11)
  })

  test("durable tier fsyncs at seal", async () => {
    const rec = recordingSink()
    const fsync = countingFsync()
    const w = FileSinkWriter.createChannelWriter({ path: "/x", tier: "durable", sink: rec.sink, fsync: fsync.port })
    await w.append(0, enc("abc"))
    await w.seal()
    expect(fsync.calls).toContain("sync")
  })

  test("disposable tier never fsyncs", async () => {
    const rec = recordingSink()
    const fsync = countingFsync()
    const w = FileSinkWriter.createChannelWriter({ path: "/x", tier: "disposable", sink: rec.sink, fsync: fsync.port })
    await w.append(0, enc("abc"))
    await w.seal()
    expect(fsync.calls).toHaveLength(0)
  })

  test("console tier fsyncs at seal but not at the interval", async () => {
    const rec = recordingSink()
    const fsync = countingFsync()
    const w = FileSinkWriter.createChannelWriter({ path: "/x", tier: "console", sink: rec.sink, fsync: fsync.port, fsyncBatchBytes: 1 })
    await w.append(0, enc("abcdefgh"))
    expect(fsync.calls).toHaveLength(0)
    await w.seal()
    expect(fsync.calls).toEqual(["sync"])
  })

  test("backpressure when the queue depth cap is exceeded", async () => {
    const rec = recordingSink()
    const fsync = countingFsync()
    // A sink that never advances the committed length so the queue fills.
    const stuck = { write: () => 0, flush: () => 0, end: () => {} }
    const w = FileSinkWriter.createChannelWriter({ path: "/x", tier: "durable", sink: stuck, fsync: fsync.port, queueDepthCap: 4 })
    await w.append(0, enc("ab"))
    const r = await w.append(2, enc("cdef"))
    expect(r.kind).toBe("backpressure")
  })
})
