/**
 * Feature 010 — PTY session registry (T014, S12).
 *
 * The Bun-side single owner of every live PTY session's lifecycle handles:
 * `session_id → { pid, masterFd, pgid, stream }` (CUE `#PtySessionEntry`, C10). The
 * master fd is owned and closed **exactly once** here — Rust never touches the fd after
 * `oc_pty_spawn` (C9). The registry keys sessions by the opaque, non-guessable id
 * `oc_pty_spawn` mints and drops each entry on close so a second close is a no-op.
 */

import { MasterFdReader, type FdIo, type Scheduler } from "./pty-reader"

/** Reader syscall/scheduler seams, injected so the registry is testable without a terminal. */
export interface PtyReaderOptions {
  readonly io?: FdIo
  readonly scheduler?: Scheduler
}

/** One live PTY session the registry owns end to end (CUE `#PtySessionEntry`, C10). */
export interface PtySessionEntry {
  readonly sessionId: string
  readonly pid: number
  readonly masterFd: number
  readonly pgid: number
  readonly stream: MasterFdReader
}

/** The spawn triple `oc_pty_spawn` returns, plus the pgid the registry records for kills. */
export interface PtyRegistration {
  readonly sessionId: string
  readonly pid: number
  readonly masterFd: number
  /** The child process-group id; equals `pid` because the child is a `setsid` leader (C11). */
  readonly pgid: number
}

/**
 * The process-wide PTY session registry. It is the sole owner of each master fd: it
 * opens the {@link MasterFdReader} on registration and closes it exactly once on
 * {@link close} or {@link closeAll}, guaranteeing one fd close per session (C9, C10).
 */
export class PtyRegistry {
  private readonly sessions = new Map<string, PtySessionEntry>()

  constructor(private readonly readerOptions?: PtyReaderOptions) {}

  /**
   * Register a freshly spawned session, opening its master-fd reader on Bun's event
   * loop. Returns the {@link PtySessionEntry} whose `stream` streams output to the sink.
   */
  register(registration: PtyRegistration, cap?: number): PtySessionEntry {
    const stream = new MasterFdReader(registration.masterFd, {
      ...(cap === undefined ? {} : { cap }),
      ...(this.readerOptions?.io ? { io: this.readerOptions.io } : {}),
      ...(this.readerOptions?.scheduler ? { scheduler: this.readerOptions.scheduler } : {}),
    })
    const entry: PtySessionEntry = {
      sessionId: registration.sessionId,
      pid: registration.pid,
      masterFd: registration.masterFd,
      pgid: registration.pgid,
      stream,
    }
    this.sessions.set(entry.sessionId, entry)
    return entry
  }

  /** The live entry for a session id, or `undefined` once closed. */
  get(sessionId: string): PtySessionEntry | undefined {
    return this.sessions.get(sessionId)
  }

  /** Whether a session id is still live in the registry. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** The number of live sessions (test/observability seam). */
  get size(): number {
    return this.sessions.size
  }

  /**
   * Close a session: tear down its stream (closing the master fd exactly once) and drop
   * the entry. Idempotent — closing an unknown or already-closed session is a no-op that
   * returns `false`; a real close returns `true`.
   */
  close(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId)
    if (!entry) return false
    this.sessions.delete(sessionId)
    entry.stream.close()
    return true
  }

  /** Close every live session (process teardown / test cleanup). */
  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.close(sessionId)
  }
}

let SHARED: PtyRegistry | undefined

/** The process-wide shared PTY registry every `bash pty:true` invocation reuses. */
export function sharedPtyRegistry(): PtyRegistry {
  return (SHARED ??= new PtyRegistry())
}
