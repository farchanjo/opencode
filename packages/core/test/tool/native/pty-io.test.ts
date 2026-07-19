import { describe, expect, test } from "bun:test"
import { MasterFdReader, OutputCapture, type FdIo } from "@opencode-ai/core/tool/native/pty-reader"
import { PtyRegistry } from "@opencode-ai/core/tool/native/pty-registry"

/**
 * Feature 010 — PTY master-fd reader + session registry tests (T014, S12).
 *
 * Every syscall seam is injected via a scripted {@link FdIo}: no real terminal is
 * allocated, so the capture / EOF / single-owner-close logic is asserted
 * deterministically. The real master-fd path is exercised by the PTY acceptance suite.
 */

/** A scripted `fs.read`/`write`/`close` surface driving the reader step by step. */
class FakeFdIo implements FdIo {
  readonly writes: Buffer[] = []
  closed = 0
  reads = 0
  constructor(private readonly script: (Buffer | "eof" | "eagain")[]) {}
  read(
    _fd: number,
    buffer: Buffer,
    offset: number,
    _length: number,
    _position: number | null,
    callback: (error: NodeJS.ErrnoException | null, bytesRead: number) => void,
  ): void {
    this.reads++
    const next = this.script.shift()
    if (next === undefined || next === "eof") return callback(null, 0)
    if (next === "eagain") {
      const err = new Error("resource temporarily unavailable") as NodeJS.ErrnoException
      err.code = "EAGAIN"
      return callback(err, 0)
    }
    const n = next.copy(buffer, offset)
    callback(null, n)
  }
  write(_fd: number, buffer: Buffer): void {
    this.writes.push(buffer)
  }
  close(_fd: number): void {
    this.closed++
  }
}

/** An FdIo that always signals "no data yet" — the reader stays open until closed. */
class BlockingFdIo implements FdIo {
  closed = 0
  read(
    _fd: number,
    _buffer: Buffer,
    _offset: number,
    _length: number,
    _position: number | null,
    callback: (error: NodeJS.ErrnoException | null, bytesRead: number) => void,
  ): void {
    const err = new Error("EAGAIN") as NodeJS.ErrnoException
    err.code = "EAGAIN"
    callback(err, 0)
  }
  write(): void {}
  close(): void {
    this.closed++
  }
}

describe("PTY OutputCapture (T014)", () => {
  test("accumulates chunks and decodes UTF-8", () => {
    const capture = new OutputCapture(1024)
    capture.push(Buffer.from("hello "))
    capture.push(Buffer.from("world"))
    expect(capture.text()).toBe("hello world")
    expect(capture.truncated).toBe(false)
  })

  test("clips at the cap and latches truncated, dropping later output", () => {
    const capture = new OutputCapture(5)
    capture.push(Buffer.from("abc"))
    capture.push(Buffer.from("defgh"))
    expect(capture.truncated).toBe(true)
    expect(capture.text()).toBe("abcde")
    capture.push(Buffer.from("ignored"))
    expect(capture.text()).toBe("abcde")
  })
})

describe("PTY MasterFdReader (T014, C9)", () => {
  test("streams chunks into the capture until EOF, then closes the fd once", async () => {
    const io = new FakeFdIo([Buffer.from("out-1"), Buffer.from("out-2"), "eof"])
    const reader = new MasterFdReader(7, { io })
    await reader.done
    expect(reader.capture.text()).toBe("out-1out-2")
    expect(io.closed).toBe(1)
  })

  test("an EAGAIN is retried, not treated as EOF", async () => {
    const io = new FakeFdIo(["eagain", Buffer.from("data"), "eof"])
    const reader = new MasterFdReader(7, { io })
    await reader.done
    expect(reader.capture.text()).toBe("data")
  })

  test("write forwards bytes to the terminal fd", async () => {
    const io = new FakeFdIo([Buffer.from("x"), "eof"])
    const reader = new MasterFdReader(7, { io })
    reader.write("stdin\n")
    await reader.done
    expect(io.writes.map((b) => b.toString())).toEqual(["stdin\n"])
  })

  test("close before EOF closes the fd exactly once and resolves done", async () => {
    const io = new BlockingFdIo()
    const reader = new MasterFdReader(7, { io })
    reader.close()
    reader.close() // idempotent — no second close
    await reader.done
    expect(io.closed).toBe(1)
  })
})

describe("PTY session registry — single-owner fd (T014, C9, C10)", () => {
  test("register opens a reader keyed by session id; get/has resolve it", () => {
    const io = new BlockingFdIo()
    const registry = new PtyRegistry({ io })
    const entry = registry.register({ sessionId: "pty-a", pid: 1234, masterFd: 9, pgid: 1234 })
    expect(entry.pid).toBe(1234)
    expect(entry.pgid).toBe(1234)
    expect(registry.has("pty-a")).toBe(true)
    expect(registry.get("pty-a")).toBe(entry)
    expect(registry.size).toBe(1)
    registry.closeAll()
  })

  test("close tears down the fd exactly once and drops the entry; a second close is a no-op", () => {
    const io = new BlockingFdIo()
    const registry = new PtyRegistry({ io })
    registry.register({ sessionId: "pty-b", pid: 5, masterFd: 9, pgid: 5 })
    expect(registry.close("pty-b")).toBe(true)
    expect(io.closed).toBe(1)
    expect(registry.has("pty-b")).toBe(false)
    expect(registry.close("pty-b")).toBe(false)
    expect(io.closed).toBe(1)
  })

  test("closeAll closes every live session", () => {
    const io = new BlockingFdIo()
    const registry = new PtyRegistry({ io })
    registry.register({ sessionId: "pty-c", pid: 1, masterFd: 9, pgid: 1 })
    registry.register({ sessionId: "pty-d", pid: 2, masterFd: 10, pgid: 2 })
    expect(registry.size).toBe(2)
    registry.closeAll()
    expect(registry.size).toBe(0)
    expect(io.closed).toBe(2)
  })
})
