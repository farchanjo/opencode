/**
 * Feature 010 — PTY execution orchestration (T015, S13).
 *
 * Ties the native `oc_pty_*` ops, the session registry, and the Bun-side master-fd
 * reader into one bash `pty: true` run: spawn → stream output on the event loop →
 * detect completion when the reader reaches EOF (the child closed the terminal) → fetch
 * the exit status with a single non-blocking `oc_pty_wait`. On timeout the run applies
 * the TS-driven `SIGTERM` then, after a 3 s grace, `SIGKILL` escalation mirroring
 * `bash.ts` `forceKillAfter` (FR10, FR12, C12, NFR4). No FFI call sits on the IO hot
 * path — output flows through the reader, and the wait syscall runs once at the end.
 *
 * The timer is injectable so the escalation is testable with a controllable `done`
 * promise and a short grace; production uses `setTimeout` and the 3 s grace.
 */

import type { NativePtyOps } from "./pty.native"
import { SIGKILL, SIGTERM } from "./pty.native"
import type { PtyRegistry } from "./pty-registry"

/** The 3 s SIGTERM→SIGKILL grace, identical to `bash.ts` `forceKillAfter` (C12). */
export const FORCE_KILL_AFTER_MS = 3000

/** One bash `pty: true` invocation's inputs (the permission gate has already passed). */
export interface PtyRunInput {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string | null
  readonly env: readonly { readonly name: string; readonly value: string }[]
  readonly cols: number
  readonly rows: number
  readonly timeoutMs: number
}

/** The captured outcome of a PTY run, shaped for the bash tool's `Output`. */
export interface PtyRunResult {
  readonly output: string
  readonly truncated: boolean
  readonly exit: number | null
  readonly signal: number | null
  readonly timedOut: boolean
}

/** Schedules a one-shot timer returning a canceler; injected for deterministic tests. */
export type TimerFn = (callback: () => void, delayMs: number) => () => void

/** Injected timer + grace tuning; the default uses `setTimeout` and the 3 s grace. */
export interface PtyRunDeps {
  readonly timer: TimerFn
  readonly forceKillAfterMs: number
}

/** The production deps: `setTimeout` timer and the 3 s SIGKILL grace. */
export function defaultPtyRunDeps(): PtyRunDeps {
  return {
    timer: (callback, delayMs) => {
      const handle = setTimeout(callback, delayMs)
      return () => clearTimeout(handle)
    },
    forceKillAfterMs: FORCE_KILL_AFTER_MS,
  }
}

/**
 * Resolve `true` if `settled` wins within `ms`, `false` on timeout. The timer is always
 * canceled so no dangling handle keeps the event loop alive.
 */
function raceTimeout(settled: Promise<unknown>, ms: number, deps: PtyRunDeps): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false
    const cancel = deps.timer(() => {
      if (done) return
      done = true
      resolve(false)
    }, ms)
    void settled.then(() => {
      if (done) return
      done = true
      cancel()
      resolve(true)
    })
  })
}

/**
 * Escalate termination of a still-running session: one `SIGTERM`, then — if the child
 * outlives the grace (its `done`/EOF has not resolved) — one `SIGKILL` to the process
 * group, mirroring `forceKillAfter` (C12). Exported for the escalation-ordering test.
 */
export async function terminatePty(
  ops: NativePtyOps,
  sessionId: string,
  done: Promise<unknown>,
  deps: PtyRunDeps,
): Promise<void> {
  ops.kill({ session_id: sessionId, signal: SIGTERM })
  if (await raceTimeout(done, deps.forceKillAfterMs, deps)) return
  // The child ignored SIGTERM through the grace — force the whole group down.
  ops.kill({ session_id: sessionId, signal: SIGKILL })
  await raceTimeout(done, deps.forceKillAfterMs, deps)
}

/**
 * Run one command on a native PTY, capturing its output under the sink cap. Completion
 * is detected by the reader reaching EOF; on timeout the SIGTERM→3 s→SIGKILL escalation
 * terminates the process group. The master fd is always closed exactly once, and the
 * native session torn down, in the `finally` (C9, C10).
 */
export async function runPty(
  ops: NativePtyOps,
  registry: PtyRegistry,
  input: PtyRunInput,
  deps: PtyRunDeps = defaultPtyRunDeps(),
): Promise<PtyRunResult> {
  const spawn = ops.spawn({
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    window: { cols: input.cols, rows: input.rows },
  })
  const entry = registry.register({
    sessionId: spawn.session_id,
    pid: spawn.pid,
    masterFd: spawn.master_fd,
    pgid: spawn.pid,
  })

  try {
    // The child closing the terminal (reader EOF) is the completion signal; a timeout
    // triggers the escalation, after which we still await EOF so output is fully drained.
    const finished = await raceTimeout(entry.stream.done, input.timeoutMs, deps)
    let timedOut = false
    if (!finished) {
      timedOut = true
      await terminatePty(ops, spawn.session_id, entry.stream.done, deps)
    }
    await entry.stream.done

    // After EOF the child is reapable: one non-blocking wait yields the exit status.
    const final = ops.wait({ session_id: spawn.session_id })
    return {
      output: entry.stream.capture.text(),
      truncated: entry.stream.capture.truncated,
      exit: final.exit_code,
      signal: final.signal,
      timedOut,
    }
  } finally {
    // Single-owner teardown: close the fd exactly once, then drop the native session.
    registry.close(spawn.session_id)
    try {
      ops.close({ session_id: spawn.session_id })
    } catch {
      // Teardown is best-effort; a close race never fails the run.
    }
  }
}
