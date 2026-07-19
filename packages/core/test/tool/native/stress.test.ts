import { beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Feature 010 — leak-and-panic stress suite (T018, S15).
 *
 * Drives a high volume (≥ 100k, the provisional AC11 count finalized here) of `oc_read`
 * + `oc_free` cycles through the real FFI boundary and asserts:
 *   1. `oc_alloc_stats.allocated == freed` at rest — every response is freed exactly
 *      once through `oc_free` (FR17, NFR3, C18, AC11);
 *   2. process RSS stays within a bounded growth ceiling across the run (AC11);
 *   3. a native entry point that panics internally (`oc_debug_panic`) returns the typed
 *      `internal_panic` envelope, leaks no backtrace/address, and does NOT crash the Bun
 *      process — a subsequent call still succeeds (FR16, NFR2, C18, AC12).
 *
 * The alloc/free counter and the panic probe are debug-only symbols compiled behind the
 * `alloc-stats` / `panic-probe` cargo features (never in a release build); this suite
 * builds that featured dylib on demand and `dlopen`s it directly. When `cargo` is
 * unavailable the suite degrades honestly (the featured dylib is skipped, never faked).
 */

// --- Provisional constants finalized here (AC11) -----------------------------
const STRESS_ITERATIONS = 100_000
const RSS_CEILING_GROWTH_BYTES = 96 * 1024 * 1024

const REPO_ROOT = path.resolve(import.meta.dir, "../../../../..")

interface Bun_ffi {
  readonly dlopen: (p: string, s: Record<string, { args: readonly string[]; returns: string }>) => {
    readonly symbols: Record<string, (...a: any[]) => any>
    readonly close?: () => void
  }
  readonly ptr: (v: ArrayBufferView) => unknown
  readonly CString: new (p: unknown) => { toString(): string }
}

/** Load the `bun:ffi` surface, or `null` off Bun. */
function bunFfi(): Bun_ffi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("bun:ffi") as Partial<Bun_ffi> | undefined
    if (!mod || typeof mod.dlopen !== "function" || typeof mod.ptr !== "function" || typeof mod.CString !== "function")
      return null
    return mod as Bun_ffi
  } catch {
    return null
  }
}

/** Build the debug-featured probe dylib (alloc-stats + panic-probe) or return null. */
function buildProbeDylib(): string | null {
  const ext = process.platform === "darwin" ? "dylib" : "so"
  const dest = path.join(REPO_ROOT, "target/debug", `libopencode_tools_ffi.${ext}`)
  const built = spawnSync(
    "cargo",
    ["build", "-p", "opencode-tools-ffi", "--features", "alloc-stats,panic-probe"],
    { cwd: REPO_ROOT, stdio: "ignore" },
  )
  if (built.error || built.status !== 0) return null
  return fs.existsSync(dest) ? dest : null
}

const SYMBOLS = {
  oc_read: { args: ["ptr", "u64"], returns: "ptr" },
  oc_free: { args: ["ptr"], returns: "void" },
  oc_alloc_stats: { args: [], returns: "ptr" },
  oc_debug_panic: { args: ["ptr", "u64"], returns: "ptr" },
} as const

interface Probe {
  readonly ffi: Bun_ffi
  readonly module: { readonly symbols: Record<string, (...a: any[]) => any> }
  readonly fixture: string
}

let probe: Probe | null = null
let skipReason = ""

beforeAll(() => {
  const ffi = bunFfi()
  if (!ffi) {
    skipReason = "bun:ffi unavailable"
    return
  }
  const dylib = buildProbeDylib()
  if (!dylib) {
    skipReason = "cargo unavailable — featured probe dylib not built (honest fallback)"
    return
  }
  let module: { readonly symbols: Record<string, (...a: any[]) => any> }
  try {
    module = ffi.dlopen(dylib, SYMBOLS as never)
  } catch (error) {
    skipReason = `dlopen failed: ${String(error)}`
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-stress-"))
  const fixture = path.join(dir, "probe.txt")
  fs.writeFileSync(fixture, "line one\nline two\nline three\n")
  probe = { ffi, module, fixture }
})

/** Invoke an `oc_*` entry point with a JSON request; copy + free the response once. */
function invoke(p: Probe, symbol: string, request: unknown): any {
  const buffer = Buffer.from(JSON.stringify(request), "utf8")
  const responsePtr = p.module.symbols[symbol]!(p.ffi.ptr(buffer), buffer.length)
  const text = new p.ffi.CString(responsePtr).toString()
  p.module.symbols.oc_free!(responsePtr)
  return JSON.parse(text)
}

/** Force a synchronous full GC when the Bun runtime exposes one (isolates native RSS). */
function forceGc(): void {
  const g = (globalThis as { Bun?: { gc?: (sync: boolean) => void } }).Bun
  g?.gc?.(true)
}

/** Read the debug alloc/free counters (copies + frees the C string exactly once). */
function allocStats(p: Probe): { allocated: number; freed: number } {
  const ptr = p.module.symbols.oc_alloc_stats!()
  const text = new p.ffi.CString(ptr).toString()
  p.module.symbols.oc_free!(ptr)
  return JSON.parse(text)
}

describe("native stress — leak-free ≥100k oc_read/oc_free cycles (T018, AC11)", () => {
  test(
    "alloc/free counters balance at rest and RSS stays within the growth ceiling",
    () => {
      if (!probe) {
        console.warn(`native stress skipped — ${skipReason}`)
        return
      }
      const p = probe
      const buffer = Buffer.from(JSON.stringify({ path: p.fixture, offset: null, limit: null }), "utf8")
      const reqPtr = p.ffi.ptr(buffer)

      const before = allocStats(p)
      forceGc()
      const rssBefore = process.memoryUsage().rss

      // Tight cycle: marshal → call → copy → free, checking the envelope with a cheap
      // substring test so JS-heap churn does not mask a native leak in the RSS gate.
      for (let i = 0; i < STRESS_ITERATIONS; i++) {
        const responsePtr = p.module.symbols.oc_read!(reqPtr, buffer.length)
        const text = new p.ffi.CString(responsePtr).toString()
        p.module.symbols.oc_free!(responsePtr)
        if (!text.startsWith('{"status":"ok"')) throw new Error(`unexpected envelope: ${text}`)
      }

      const after = allocStats(p)
      forceGc()
      const rssAfter = process.memoryUsage().rss

      // Every response allocated over the run was freed exactly once (C18).
      const allocatedDelta = after.allocated - before.allocated
      const freedDelta = after.freed - before.freed
      expect(allocatedDelta).toBeGreaterThanOrEqual(STRESS_ITERATIONS)
      expect(after.allocated).toBe(after.freed)
      expect(allocatedDelta).toBe(freedDelta)

      // RSS growth is bounded — a per-response native leak would blow past the ceiling.
      expect(rssAfter - rssBefore).toBeLessThan(RSS_CEILING_GROWTH_BYTES)
    },
    120_000,
  )
})

describe("native stress — panic containment across the boundary (T018, AC12)", () => {
  test("oc_debug_panic returns internal_panic, leaks nothing, and never crashes Bun", () => {
    if (!probe) {
      console.warn(`native stress skipped — ${skipReason}`)
      return
    }
    const p = probe
    const buffer = Buffer.from("{}", "utf8")

    const responsePtr = p.module.symbols.oc_debug_panic!(p.ffi.ptr(buffer), buffer.length)
    const text = new p.ffi.CString(responsePtr).toString()
    p.module.symbols.oc_free!(responsePtr)
    const envelope = JSON.parse(text)

    expect(envelope.status).toBe("error")
    expect(envelope.error.code).toBe("internal_panic")
    // No backtrace, address, or panic body crosses the boundary (C3, Security).
    expect(text).not.toContain("0xfeedface")
    expect(text).not.toContain("deliberate panic probe")

    // The Bun process survived the contained unwind — a subsequent call still works.
    const after = invoke(p, "oc_read", { path: p.fixture, offset: null, limit: null })
    expect(after.status).toBe("ok")
    expect(after.result.content).toBe("line one\nline two\nline three\n")
  })
})
