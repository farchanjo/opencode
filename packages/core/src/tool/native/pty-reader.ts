/**
 * Feature 010 — PTY master-fd reader (T014, S12).
 *
 * Async master-fd IO lives entirely on Bun's event loop: the PTY master fd that
 * `oc_pty_spawn` hands over (already `O_NONBLOCK`, set Rust-side) is drained by a
 * non-blocking `fs.read` loop scheduled on the event loop, so **no FFI call sits on the
 * IO hot path** (FR10, NFR4, C9). EOF (a zero-length read or `EIO` once the child closes
 * the terminal) resolves {@link MasterFdReader.done}, which is how a `pty: true` run
 * detects completion without polling a syscall. Output flows into the existing bash sink
 * under the unchanged `MAX_CAPTURE_BYTES` cap (FR23, C20).
 *
 * `node:net.Socket({ fd })` was the plan's first choice but does not deliver PTY-master
 * bytes under Bun 1.3.14; the `fs.read` + `O_NONBLOCK` loop is research.md's documented
 * contingency and is the primary path here (see the Wave-4 spec-first note).
 *
 * Every syscall seam (`read` / `write` / `close`) and the scheduler are injected, so the
 * capture / backpressure / single-owner-close logic is unit testable without a terminal.
 */

/** The 1 MiB output-capture cap, identical to `bash.ts` `MAX_CAPTURE_BYTES` (C20). */
export const MAX_CAPTURE_BYTES = 1024 * 1024

/** Read buffer size per non-blocking pump iteration. */
const READ_CHUNK_BYTES = 64 * 1024

/** The minimal `fs` syscall surface the reader consumes (injected for tests). */
export interface FdIo {
  read(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
    callback: (error: NodeJS.ErrnoException | null, bytesRead: number) => void,
  ): void
  write(fd: number, buffer: Buffer): void
  close(fd: number): void
}

/** Schedules the next pump tick; `delayMs > 0` backs off after a transient `EAGAIN`. */
export type Scheduler = (callback: () => void, delayMs: number) => void

/** The default `fs`-backed syscall surface over the real master fd. */
export function defaultFdIo(): FdIo {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("fs")
  return {
    read: (fd, buffer, offset, length, position, callback) => fs.read(fd, buffer, offset, length, position, callback),
    write: (fd, buffer) => {
      try {
        fs.writeSync(fd, buffer)
      } catch {
        // A closed/failed terminal write is non-fatal to the run.
      }
    },
    close: (fd) => {
      try {
        fs.closeSync(fd)
      } catch {
        // Double-close / already-invalid fd is a no-op.
      }
    },
  }
}

/** The default scheduler: `setTimeout`, degrading to a microtask-ish 0 ms tick. */
export function defaultScheduler(): Scheduler {
  return (callback, delayMs) => {
    setTimeout(callback, delayMs)
  }
}

/**
 * Bounded output accumulator: appends chunks until the cap, then drops the overflow and
 * latches the `truncated` flag — the same bounded-preview contract the bash sink uses.
 */
export class OutputCapture {
  private readonly chunks: Buffer[] = []
  private total = 0
  private latched = false

  constructor(private readonly cap: number = MAX_CAPTURE_BYTES) {}

  /** Append a chunk, clipping at the cap and latching `truncated` on overflow. */
  push(chunk: Buffer): void {
    if (this.latched) return
    const remaining = this.cap - this.total
    if (chunk.length >= remaining) {
      this.chunks.push(chunk.subarray(0, remaining))
      this.total = this.cap
      this.latched = true
      return
    }
    this.chunks.push(chunk)
    this.total += chunk.length
  }

  /** Whether the capture hit the byte cap and dropped later output. */
  get truncated(): boolean {
    return this.latched
  }

  /** The captured bytes so far. */
  buffer(): Buffer {
    return Buffer.concat(this.chunks)
  }

  /** The captured bytes decoded as UTF-8. */
  text(): string {
    return this.buffer().toString("utf8")
  }
}

/**
 * A live master-fd stream: a non-blocking `fs.read` loop on Bun's event loop funnels
 * output into an {@link OutputCapture} and resolves {@link done} exactly once at EOF
 * (child closed the terminal). The master fd is closed exactly once — by {@link close}
 * or the natural EOF — honoring the single-owner contract (C9, C10).
 */
export class MasterFdReader {
  readonly capture: OutputCapture
  readonly done: Promise<void>
  private readonly io: FdIo
  private readonly schedule: Scheduler
  private readonly buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES)
  private stopped = false
  private fdClosed = false
  private resolveDone!: () => void

  constructor(
    readonly masterFd: number,
    options: { readonly cap?: number; readonly io?: FdIo; readonly scheduler?: Scheduler } = {},
  ) {
    this.capture = new OutputCapture(options.cap ?? MAX_CAPTURE_BYTES)
    this.io = options.io ?? defaultFdIo()
    this.schedule = options.scheduler ?? defaultScheduler()
    this.done = new Promise<void>((resolve) => (this.resolveDone = resolve))
    this.schedule(() => this.pump(), 0)
  }

  /** Write input bytes to the terminal (drives the child's stdin). */
  write(data: Buffer | string): void {
    if (this.stopped) return
    this.io.write(this.masterFd, Buffer.isBuffer(data) ? data : Buffer.from(data))
  }

  /** Tear down the stream and close the master fd exactly once (idempotent). */
  close(): void {
    if (this.stopped) return
    this.settle()
  }

  private pump(): void {
    if (this.stopped) return
    this.io.read(this.masterFd, this.buffer, 0, this.buffer.length, null, (error, bytesRead) => {
      if (this.stopped) return
      if (error) {
        // EAGAIN/EWOULDBLOCK: no data yet — back off and retry on the event loop.
        if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") {
          this.schedule(() => this.pump(), 5)
          return
        }
        // EIO on a PTY master means the child closed the slave — a normal EOF.
        this.settle()
        return
      }
      if (bytesRead === 0) {
        this.settle()
        return
      }
      // Copy out of the reused read buffer before scheduling the next read, which
      // would otherwise overwrite the bytes the capture is still holding.
      this.capture.push(Buffer.from(this.buffer.subarray(0, bytesRead)))
      this.schedule(() => this.pump(), 0)
    })
  }

  private settle(): void {
    if (this.stopped) return
    this.stopped = true
    if (!this.fdClosed) {
      this.fdClosed = true
      this.io.close(this.masterFd)
    }
    this.resolveDone()
  }
}
