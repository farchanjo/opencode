import { describe, expect, test } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { loadNative, type LoaderDeps } from "@opencode-ai/core/tool/native/loader"
import { loadNativePty } from "@opencode-ai/core/tool/native/pty.native"
import { NativeLoader } from "@opencode-ai/core/tool/native/loader"

/**
 * Feature 010 — experimental flag defaults + platform gate (T017, S14).
 *
 * `experimental.nativeTools` / `experimental.nativePty` are optional booleans defaulting
 * off; their presence never changes behavior when off, and `win32` always takes the
 * TypeScript path (FR19, FR22, C2, C19, AC13, AC16). The flags are read through
 * `Config.latest(entries, "experimental")`, exactly as `bash.ts` / `grep.ts` read them.
 */

describe("experimental native flags are optional booleans (Feature 010 schema)", () => {
  test("no experimental block reads both native flags as undefined (unset)", () => {
    const experimental = Config.latest([], "experimental")
    expect(experimental?.native_tools).toBeUndefined()
    expect(experimental?.native_pty).toBeUndefined()
  })

  test("an empty experimental block leaves both flags unset", () => {
    const entries = [{ type: "document", info: { experimental: {} } } as never]
    const experimental = Config.latest(entries, "experimental")
    expect(experimental?.native_tools).toBeUndefined()
    expect(experimental?.native_pty).toBeUndefined()
  })

  test("both flags are read as on when explicitly enabled", () => {
    const entries = [{ type: "document", info: { experimental: { native_tools: true, native_pty: true } } } as never]
    const experimental = Config.latest(entries, "experimental")
    expect(experimental?.native_tools).toBe(true)
    expect(experimental?.native_pty).toBe(true)
  })

  test("both flags are read as false when explicitly disabled", () => {
    const entries = [{ type: "document", info: { experimental: { native_tools: false, native_pty: false } } } as never]
    const experimental = Config.latest(entries, "experimental")
    expect(experimental?.native_tools).toBe(false)
    expect(experimental?.native_pty).toBe(false)
  })
})

/**
 * Feature 023 FR-A — native is the DEFAULT. The glob/grep/bash gates read the flag as
 * `!== false`, so an absent (or `true`) flag selects the native path and only an
 * explicit `native_tools: false` / `native_pty: false` falls back to the TS/ripgrep/
 * ChildProcess path. These tests assert the EXACT boolean the wired gates evaluate.
 */
describe("native tools default-on gate semantics (Feature 023 FR-A)", () => {
  const toolsGate = (entries: never[]) => Config.latest(entries, "experimental")?.native_tools !== false
  const ptyGate = (entries: never[]) => Config.latest(entries, "experimental")?.native_pty !== false

  test("(a) absent flag → native path attempted (default on)", () => {
    expect(toolsGate([])).toBe(true)
    expect(ptyGate([])).toBe(true)
    const empty = [{ type: "document", info: { experimental: {} } } as never]
    expect(toolsGate(empty)).toBe(true)
    expect(ptyGate(empty)).toBe(true)
  })

  test("(b) explicit false → TypeScript/ripgrep path (opt-out)", () => {
    const off = [{ type: "document", info: { experimental: { native_tools: false, native_pty: false } } } as never]
    expect(toolsGate(off)).toBe(false)
    expect(ptyGate(off)).toBe(false)
  })

  test("explicit true keeps the native path (unchanged)", () => {
    const on = [{ type: "document", info: { experimental: { native_tools: true, native_pty: true } } } as never]
    expect(toolsGate(on)).toBe(true)
    expect(ptyGate(on)).toBe(true)
  })
})

describe("native PTY selection gate (T017, C19)", () => {
  test("loadNativePty returns the disabled gap when nativePty is off (default)", () => {
    const backend = loadNativePty(new NativeLoader(), false)
    expect(backend.kind).toBe("unavailable")
    if (backend.kind === "unavailable") expect(backend.gap.gapReason).toBe("disabled")
  })

  test("win32 never selects the native pty crate even with the flag on", () => {
    let opened = false
    const deps: LoaderDeps = {
      platform: "win32",
      arch: "x64",
      env: {},
      fileExists: () => true,
      bundledBaseDir: "/bundled",
      ffi: () => ({
        dlopen: () => {
          opened = true
          return { symbols: {} }
        },
        ptr: (v) => v,
        cString: () => "",
      }),
    }
    const result = loadNative("pty", true, deps)
    expect("gapReason" in result).toBe(true)
    expect(opened).toBe(false)
  })
})
