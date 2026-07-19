import { describe, expect, test } from "bun:test"
import { NativeLoader, isUnavailable } from "@opencode-ai/core/tool/native/loader"
import { loadNativePty, SIGKILL, type NativePtyOps } from "@opencode-ai/core/tool/native/pty.native"
import { PtyRegistry } from "@opencode-ai/core/tool/native/pty-registry"
import { runPty } from "@opencode-ai/core/tool/native/pty-exec"

/**
 * Feature 010 — PTY acceptance suite against the real dylib (T016, S13).
 *
 * Drives `libopencode_pty_ffi` (built by `bun run build:native`) end to end: a spawned
 * command observes `isatty() == true` and emits ANSI color, `oc_pty_kill` on the pgid
 * terminates the whole tree, and a long streaming session keeps Bun's event loop
 * responsive (output flows through the master-fd reader, never an FFI hot-path call).
 * On a machine without the dylib every case no-ops rather than failing.
 */

const loader = new NativeLoader()
const backend = loadNativePty(loader, true)
const nativeReady = backend.kind === "ok"
const ops: NativePtyOps | undefined = backend.kind === "ok" ? backend.ops : undefined

/** A fresh env with a PATH so `/bin/sh` resolves its child commands. */
const env = [{ name: "PATH", value: "/usr/bin:/bin" }]

describe("PTY terminal fidelity — isatty + ANSI (T016, AC8)", () => {
  test("a command spawned via oc_pty_spawn sees a tty and emits ANSI color", async () => {
    if (!nativeReady) return
    const registry = new PtyRegistry()
    // `[ -t 1 ]` is true only under a real terminal; only then is the ANSI SGR emitted.
    const result = await runPty(
      ops!,
      registry,
      {
        command: "/bin/sh",
        args: ["-c", 'if [ -t 1 ]; then printf "\\033[31mRED\\033[0m"; else printf plain; fi'],
        cwd: null,
        env,
        cols: 80,
        rows: 24,
        timeoutMs: 10_000,
      },
    )
    expect(result.timedOut).toBe(false)
    expect(result.exit).toBe(0)
    // Proves isatty==true (the else branch would print "plain") AND ANSI color.
    expect(result.output).toContain("[31m")
    expect(result.output).toContain("RED")
    expect(result.output).not.toContain("plain")
  })
})

describe("PTY full-tree kill on the process group (T016, AC9)", () => {
  test("oc_pty_kill on the pgid terminates a forked subprocess tree", async () => {
    if (!nativeReady) return
    const registry = new PtyRegistry()
    // A parent that forks two long sleepers and waits — a real process tree.
    const spawn = ops!.spawn({
      command: "/bin/sh",
      args: ["-c", "sleep 300 & sleep 300 & wait"],
      cwd: null,
      env,
      window: { cols: 80, rows: 24 },
    })
    const entry = registry.register({
      sessionId: spawn.session_id,
      pid: spawn.pid,
      masterFd: spawn.master_fd,
      pgid: spawn.pid,
    })
    try {
      // Still running before the kill.
      expect(ops!.wait({ session_id: spawn.session_id }).exited).toBe(false)
      // One signal to the group terminates the leader and its children — no orphans.
      ops!.kill({ session_id: spawn.session_id, signal: SIGKILL })
      // The whole group dying closes the terminal → the master reader reaches EOF.
      await entry.stream.done
      const exit = ops!.wait({ session_id: spawn.session_id })
      expect(exit.exited).toBe(true)
      expect(exit.signal).toBe(SIGKILL)
      // The process group itself is gone: a redundant killpg reports ESRCH, which the
      // native layer maps to success (idempotent) — no throw.
      expect(() => ops!.kill({ session_id: spawn.session_id, signal: SIGKILL })).not.toThrow()
    } finally {
      registry.close(spawn.session_id)
      ops!.close({ session_id: spawn.session_id })
    }
  })
})

describe("PTY non-blocking event loop (T016, AC10, NFR4)", () => {
  test("a long streaming session keeps the event loop responsive", async () => {
    if (!nativeReady) return
    const registry = new PtyRegistry()
    // A concurrent timer proves the loop is not blocked while the PTY streams.
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)
    try {
      const result = await runPty(
        ops!,
        registry,
        {
          command: "/bin/sh",
          args: ["-c", "for i in 1 2 3 4 5; do echo line-$i; sleep 0.03; done"],
          cwd: null,
          env,
          cols: 80,
          rows: 24,
          timeoutMs: 10_000,
        },
      )
      expect(result.timedOut).toBe(false)
      expect(result.output).toContain("line-1")
      expect(result.output).toContain("line-5")
      // The interval advanced during the ~150ms streaming run — the loop stayed live.
      expect(ticks).toBeGreaterThan(0)
    } finally {
      clearInterval(timer)
    }
  })
})

describe("PTY loader wiring — pty crate handshake (T013, T016)", () => {
  test("the pty crate loads and passes the ABI handshake", () => {
    if (!nativeReady) return
    const loaded = loader.load("pty", true)
    expect(isUnavailable(loaded)).toBe(false)
    if (!isUnavailable(loaded)) {
      expect(loaded.crate).toBe("pty")
      expect(loaded.version.abiVersion).toBe(1)
    }
  })
})
