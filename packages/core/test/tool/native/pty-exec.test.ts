import { describe, expect, test } from "bun:test"
import { NativeLoader } from "@opencode-ai/core/tool/native/loader"
import { loadNativePty, SIGKILL, SIGTERM, type NativePtyOps } from "@opencode-ai/core/tool/native/pty.native"
import { PtyRegistry } from "@opencode-ai/core/tool/native/pty-registry"
import { runPty, terminatePty, type PtyRunDeps } from "@opencode-ai/core/tool/native/pty-exec"
import type { FdIo } from "@opencode-ai/core/tool/native/pty-reader"
import type { NativePtySpawnResult, NativePtyWaitResult } from "@opencode-ai/core/tool/native/types"

/**
 * Feature 010 — PTY orchestration + SIGTERM→3s→SIGKILL escalation tests (T015, S13).
 *
 * The timer grace is shortened and the native ops + reader syscalls are faked, so the
 * escalation ordering and the spawn→stream→wait→teardown lifecycle are asserted
 * deterministically without a real dylib. A real `setTimeout` timer with a small grace
 * keeps the tests fast and free of wall-clock flakiness.
 */

/** Deps with a real `setTimeout` timer and a short grace for fast, deterministic runs. */
function fastDeps(forceKillAfterMs = 20): PtyRunDeps {
  return {
    timer: (callback, delayMs) => {
      const handle = setTimeout(callback, delayMs)
      return () => clearTimeout(handle)
    },
    forceKillAfterMs,
  }
}

/**
 * A coupled fake: the reader IO streams `output` then blocks on EAGAIN until the process
 * is "killed", at which point it reports EOF — mirroring a real PTY whose master reaches
 * EOF once the child dies. `kill` flips that state so the escalation drives completion.
 */
function fakePty(options: { readonly output?: string; readonly exitOnEof?: NativePtyWaitResult }) {
  const state = { killed: false, spawned: 0, closed: 0 }
  const kills: number[] = []
  const pending = options.output ? [Buffer.from(options.output)] : []
  const io: FdIo = {
    read: (_fd, buffer, offset, _length, _position, cb) => {
      const chunk = pending.shift()
      if (chunk) return cb(null, chunk.copy(buffer, offset))
      if (state.killed) return cb(null, 0) // EOF once terminated
      const err = new Error("EAGAIN") as NodeJS.ErrnoException
      err.code = "EAGAIN"
      cb(err, 0)
    },
    write: () => {},
    close: () => {},
  }
  const ops: NativePtyOps = {
    spawn: (): NativePtySpawnResult => {
      state.spawned++
      return { session_id: "pty-fake", pid: 4321, master_fd: 42 }
    },
    resize: () => {},
    kill: (req) => {
      kills.push(req.signal)
      // Model a child that ignores SIGTERM; only SIGKILL forces the terminal to EOF.
      if (req.signal === SIGKILL) state.killed = true
    },
    wait: (): NativePtyWaitResult =>
      state.killed
        ? (options.exitOnEof ?? { exited: true, exit_code: null, signal: SIGKILL })
        : (options.exitOnEof ?? { exited: true, exit_code: 0, signal: null }),
    close: () => {
      state.closed++
    },
  }
  return { ops, io, kills, state }
}

describe("terminatePty escalation (T015, C12)", () => {
  test("a child that ignores SIGTERM is SIGKILL'd after the grace", async () => {
    const kills: number[] = []
    const ops: NativePtyOps = {
      spawn: () => ({ session_id: "s", pid: 1, master_fd: 2 }),
      resize: () => {},
      kill: (req) => kills.push(req.signal),
      wait: () => ({ exited: false, exit_code: null, signal: null }),
      close: () => {},
    }
    // `done` never resolves — the child outlives both graces.
    await terminatePty(ops, "s", new Promise<void>(() => {}), fastDeps(15))
    expect(kills[0]).toBe(SIGTERM)
    expect(kills).toContain(SIGKILL)
    expect(kills.indexOf(SIGTERM)).toBeLessThan(kills.indexOf(SIGKILL))
  })

  test("a child that exits within the grace is never SIGKILL'd", async () => {
    const kills: number[] = []
    const ops: NativePtyOps = {
      spawn: () => ({ session_id: "s", pid: 1, master_fd: 2 }),
      resize: () => {},
      kill: (req) => kills.push(req.signal),
      wait: () => ({ exited: true, exit_code: 0, signal: null }),
      close: () => {},
    }
    // `done` resolves immediately (EOF within the grace).
    await terminatePty(ops, "s", Promise.resolve(), fastDeps(1000))
    expect(kills).toEqual([SIGTERM])
    expect(kills).not.toContain(SIGKILL)
  })
})

describe("runPty orchestration (T015)", () => {
  test("a prompt exit yields the captured output and tears the session down once", async () => {
    const { ops, io, state } = fakePty({ output: "hello-pty", exitOnEof: { exited: true, exit_code: 0, signal: null } })
    // The child self-exits: after streaming, report EOF without a kill.
    state.killed = true
    const registry = new PtyRegistry({ io })
    const result = await runPty(
      ops,
      registry,
      { command: "/bin/echo", args: ["hi"], cwd: null, env: [], cols: 80, rows: 24, timeoutMs: 10_000 },
      fastDeps(),
    )
    expect(result.timedOut).toBe(false)
    expect(result.exit).toBe(0)
    expect(result.output).toBe("hello-pty")
    expect(state.spawned).toBe(1)
    expect(state.closed).toBe(1)
    expect(registry.size).toBe(0)
  })

  test("a command that never exits times out and escalates to SIGKILL", async () => {
    const { ops, io, kills } = fakePty({ exitOnEof: { exited: true, exit_code: null, signal: SIGKILL } })
    const registry = new PtyRegistry({ io })
    const result = await runPty(
      ops,
      registry,
      { command: "/bin/sh", args: ["-c", "sleep 999"], cwd: null, env: [], cols: 80, rows: 24, timeoutMs: 20 },
      fastDeps(15),
    )
    expect(result.timedOut).toBe(true)
    expect(kills[0]).toBe(SIGTERM)
    expect(kills).toContain(SIGKILL)
    expect(result.signal).toBe(SIGKILL)
    expect(registry.size).toBe(0)
  })
})

describe("native PTY backend gate (T015, T017, C2)", () => {
  test("loadNativePty reports the disabled gap when the flag is off (default)", () => {
    const backend = loadNativePty(new NativeLoader(), false)
    expect(backend.kind).toBe("unavailable")
    if (backend.kind === "unavailable") expect(backend.gap.gapReason).toBe("disabled")
  })
})
