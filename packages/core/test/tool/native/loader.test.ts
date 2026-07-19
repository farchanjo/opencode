import { describe, expect, test } from "bun:test"
import path from "path"
import {
  discover,
  invokeNative,
  isUnavailable,
  loadNative,
  NativeLoader,
  type BunFfi,
  type DlopenModule,
  type LoaderDeps,
} from "@opencode-ai/core/tool/native/loader"

/**
 * Feature 010 — loader discovery/dlopen/handshake/gap tests (T006, S4).
 *
 * Every seam is injected: platform, arch, env, `fileExists`, and the `bun:ffi`
 * surface. No real dylib is loaded here; the parity suite exercises the real native
 * path. These tests assert each discovery rung, the cached second load, the ABI
 * handshake mismatch, and that `win32` never `dlopen`s.
 */

const BUNDLED = "/bundled/base"

function fakeFfi(options: {
  readonly abi?: number
  readonly versionJson?: string
  readonly readJson?: string
  readonly onDlopen?: (p: string) => void
}): BunFfi {
  const strings = new Map<number, string>()
  let seq = 1
  const alloc = (json: string) => {
    const id = seq++
    strings.set(id, json)
    return id
  }
  const version =
    options.versionJson ?? JSON.stringify({ abi_version: 1, semver: "0.1.0", caps: { max_read_lines: 2000 } })
  const module: DlopenModule = {
    symbols: {
      oc_abi_version: () => options.abi ?? 1,
      oc_version: () => alloc(version),
      oc_free: (ptr: number) => strings.delete(ptr),
      oc_read: () => alloc(options.readJson ?? JSON.stringify({ status: "ok", result: { content: "native" } })),
      oc_grep: () => alloc(JSON.stringify({ status: "ok", result: { mode: "content", matches: [] } })),
    },
  }
  return {
    dlopen: (p) => {
      options.onDlopen?.(p)
      return module
    },
    ptr: (view) => view,
    cString: (ptr) => strings.get(ptr as number) ?? "",
  }
}

function deps(overrides: Partial<LoaderDeps>): LoaderDeps {
  return {
    platform: "darwin",
    arch: "arm64",
    env: {},
    fileExists: () => false,
    bundledBaseDir: BUNDLED,
    ffi: () => fakeFfi({}),
    ...overrides,
  }
}

describe("native loader — discovery ladder", () => {
  test("per-crate env file path wins the ladder", () => {
    const target = "/custom/libopencode_tools_ffi.dylib"
    const result = discover(
      "tools",
      deps({ env: { OPENCODE_TOOLS_FFI_PATH: target }, fileExists: (c) => c === target }),
    )
    expect(result).toEqual({ path: target })
  })

  test("OPENCODE_NATIVE_LIB_DIR override resolves the crate file", () => {
    const overrideDir = "/override/dir"
    const expected = path.join(overrideDir, "libopencode_tools_ffi.dylib")
    const result = discover(
      "tools",
      deps({ env: { OPENCODE_NATIVE_LIB_DIR: overrideDir }, fileExists: (c) => c === expected }),
    )
    expect(result).toEqual({ path: expected })
  })

  test("bundled platform-arch path is the fallback rung", () => {
    const expected = path.join(BUNDLED, "darwin-arm64", "libopencode_tools_ffi.dylib")
    const result = discover("tools", deps({ fileExists: (c) => c === expected }))
    expect(result).toEqual({ path: expected })
  })

  test("no artifact yields a library_missing gap", () => {
    const result = discover("tools", deps({}))
    expect(isUnavailable(result) && result.gapReason).toBe("library_missing")
  })

  test("linux resolves the .so extension", () => {
    const expected = path.join(BUNDLED, "linux-x64", "libopencode_pty_ffi.so")
    const result = discover("pty", deps({ platform: "linux", arch: "x64", fileExists: (c) => c === expected }))
    expect(result).toEqual({ path: expected })
  })
})

describe("native loader — load + handshake", () => {
  test("disabled flag short-circuits before any dlopen", () => {
    let opened = false
    const result = loadNative("tools", false, deps({ ffi: () => fakeFfi({ onDlopen: () => (opened = true) }) }))
    expect(isUnavailable(result) && result.gapReason).toBe("disabled")
    expect(opened).toBe(false)
  })

  test("win32 never dlopens", () => {
    let opened = false
    const result = loadNative(
      "tools",
      true,
      deps({ platform: "win32", fileExists: () => true, ffi: () => fakeFfi({ onDlopen: () => (opened = true) }) }),
    )
    expect(isUnavailable(result)).toBe(true)
    expect(opened).toBe(false)
  })

  test("ABI major mismatch is a bounded abi_mismatch gap", () => {
    const result = loadNative(
      "tools",
      true,
      deps({ fileExists: () => true, ffi: () => fakeFfi({ abi: 999 }) }),
    )
    expect(isUnavailable(result) && result.gapReason).toBe("abi_mismatch")
  })

  test("successful load surfaces the handshake caps", () => {
    const result = loadNative("tools", true, deps({ fileExists: () => true }))
    expect(isUnavailable(result)).toBe(false)
    if (!isUnavailable(result)) {
      expect(result.version.abiVersion).toBe(1)
      expect(result.version.caps.max_read_lines).toBe(2000)
    }
  })
})

describe("native loader — caching + marshalling", () => {
  test("the cached crate is dlopened at most once", () => {
    let opens = 0
    const loader = new NativeLoader(deps({ fileExists: () => true, ffi: () => fakeFfi({ onDlopen: () => opens++ }) }))
    const first = loader.load("tools", true)
    const second = loader.load("tools", true)
    expect(opens).toBe(1)
    expect(second).toBe(first)
  })

  test("invokeNative frees the response exactly once", () => {
    const freed: number[] = []
    const ffi = fakeFfi({ readJson: JSON.stringify({ status: "ok", result: { content: "hi" } }) })
    const wrapped: BunFfi = { ...ffi, cString: ffi.cString }
    const loaded = loadNative("tools", true, deps({ fileExists: () => true, ffi: () => wrapped }))
    if (isUnavailable(loaded)) throw new Error("expected a loaded crate")
    const originalFree = loaded.module.symbols.oc_free!
    loaded.module.symbols.oc_free = (ptr: number) => {
      freed.push(ptr)
      return originalFree(ptr)
    }
    const envelope = invokeNative<{ content: string }>(loaded, "oc_read", { path: "/x" }, wrapped)
    expect(envelope).toEqual({ status: "ok", result: { content: "hi" } })
    expect(freed.length).toBe(1)
  })
})
