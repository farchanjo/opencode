/**
 * Feature 010 — native library loader (T006, S4).
 *
 * The discovery / `dlopen` / ABI-handshake / capability-gap seam the six tool
 * wrappers and the PTY registry sit on. Discovery ladder (C1):
 *
 *   1. env override — `OPENCODE_NATIVE_LIB_DIR` (directory) or the per-crate
 *      `OPENCODE_TOOLS_FFI_PATH` / `OPENCODE_PTY_FFI_PATH` (exact file);
 *   2. the bundled `packages/core/native/<platform>-<arch>/` path;
 *   3. neither present, or `dlopen`/handshake fails → typed `native_unavailable`.
 *
 * `win32` never `dlopen`s and always reports `native_unavailable` (C19). The
 * `dlopen` handle is cached after the first success (lazy, once per crate per
 * process). The ABI-major handshake (`oc_abi_version`) is asserted on load; a
 * mismatch is treated as unloadable (`abi_mismatch`). The marshalling helper copies
 * the returned C string and frees it exactly once through `oc_free` (C7).
 *
 * The `bun:ffi` surface is injected so the discovery/handshake/caching logic is unit
 * testable without a real dylib; production resolves it lazily from `bun:ffi`,
 * reusing the proven `dlopen` + `ptr` + `CString` pattern from
 * `packages/tui/src/terminal-win32.ts` and `keychain-darwin.ts`.
 */

import path from "path"
import type {
  FfiEnvelope,
  FfiVersionInfo,
  NativeCrate,
  NativeUnavailableGapReason,
  Platform,
} from "./types"

/** The ABI major the loader asserts against `oc_abi_version` (mirrors the Rust `ABI_VERSION`). */
export const EXPECTED_ABI_MAJOR = 1

/** The `dlopen` symbol descriptor subset this loader relies on. */
export type FfiSymbolDef = { readonly args: readonly string[]; readonly returns: string }

/** A `dlopen`ed module: callable symbols keyed by name. */
export interface DlopenModule {
  readonly symbols: Record<string, (...args: any[]) => any>
  readonly close?: () => void
}

/** The minimal `bun:ffi` surface the loader consumes (injected for tests). */
export interface BunFfi {
  readonly dlopen: (path: string, symbols: Record<string, FfiSymbolDef>) => DlopenModule
  readonly ptr: (view: ArrayBufferView) => unknown
  readonly cString: (ptr: unknown) => string
}

/** Loader-wide dependencies; every I/O and platform seam is injectable (C1, C19). */
export interface LoaderDeps {
  readonly platform: Platform
  readonly arch: string
  readonly env: Record<string, string | undefined>
  readonly fileExists: (candidate: string) => boolean
  readonly bundledBaseDir: string
  readonly ffi: () => BunFfi | null
}

/** A typed `native_unavailable` outcome carrying the bounded gap reason (C14). */
export type NativeUnavailable = { readonly gapReason: NativeUnavailableGapReason; readonly detail?: string }

/** A resolved, loaded, handshake-verified native crate. */
export interface LoadedNative {
  readonly crate: NativeCrate
  readonly path: string
  readonly version: FfiVersionInfo
  readonly module: DlopenModule
}

const LIB_STEM: Record<NativeCrate, string> = {
  tools: "libopencode_tools_ffi",
  pty: "libopencode_pty_ffi",
}

const PER_CRATE_ENV: Record<NativeCrate, string> = {
  tools: "OPENCODE_TOOLS_FFI_PATH",
  pty: "OPENCODE_PTY_FFI_PATH",
}

/** The dynamic-library extension for a platform (`win32` never loads). */
function libExtension(platform: Platform): string {
  return platform === "darwin" ? "dylib" : "so"
}

/** The symbol table each crate exports; the handshake trio is shared, tools adds `oc_read`/`oc_grep`. */
function symbolTable(crate: NativeCrate): Record<string, FfiSymbolDef> {
  const shared: Record<string, FfiSymbolDef> = {
    oc_abi_version: { args: [], returns: "u32" },
    oc_version: { args: [], returns: "ptr" },
    oc_free: { args: ["ptr"], returns: "void" },
  }
  if (crate === "tools") {
    return {
      ...shared,
      oc_read: { args: ["ptr", "u64"], returns: "ptr" },
      oc_grep: { args: ["ptr", "u64"], returns: "ptr" },
      oc_write: { args: ["ptr", "u64"], returns: "ptr" },
      oc_edit: { args: ["ptr", "u64"], returns: "ptr" },
      oc_apply_patch: { args: ["ptr", "u64"], returns: "ptr" },
      oc_glob: { args: ["ptr", "u64"], returns: "ptr" },
    }
  }
  return {
    ...shared,
    oc_pty_spawn: { args: ["ptr", "u64"], returns: "ptr" },
    oc_pty_resize: { args: ["ptr", "u64"], returns: "ptr" },
    oc_pty_kill: { args: ["ptr", "u64"], returns: "ptr" },
    oc_pty_wait: { args: ["ptr", "u64"], returns: "ptr" },
    oc_pty_close: { args: ["ptr", "u64"], returns: "ptr" },
  }
}

/**
 * Resolve the on-disk library path for a crate via the discovery ladder, or a
 * `library_missing` gap when no artifact is present. `win32` is never resolved here.
 */
export function discover(crate: NativeCrate, deps: LoaderDeps): { path: string } | NativeUnavailable {
  const ext = libExtension(deps.platform)
  const stem = LIB_STEM[crate]

  const perCrate = deps.env[PER_CRATE_ENV[crate]]
  if (perCrate && deps.fileExists(perCrate)) return { path: perCrate }

  const overrideDir = deps.env["OPENCODE_NATIVE_LIB_DIR"]
  if (overrideDir) {
    const candidate = path.join(overrideDir, `${stem}.${ext}`)
    if (deps.fileExists(candidate)) return { path: candidate }
  }

  const bundled = path.join(deps.bundledBaseDir, `${deps.platform}-${deps.arch}`, `${stem}.${ext}`)
  if (deps.fileExists(bundled)) return { path: bundled }

  return { gapReason: "library_missing" }
}

/** Decode the `oc_version` handshake payload from a loaded module (copies + frees the C string). */
function readVersion(module: DlopenModule, ffi: BunFfi): FfiVersionInfo {
  const ptr = module.symbols.oc_version!()
  const text = ffi.cString(ptr)
  module.symbols.oc_free!(ptr)
  const parsed = JSON.parse(text) as { abi_version: number; semver: string; caps: Record<string, number> }
  return { abiVersion: parsed.abi_version, semver: parsed.semver, caps: parsed.caps }
}

/**
 * Discover, `dlopen`, and ABI-handshake a native crate. Every failure mode maps to a
 * bounded {@link NativeUnavailableGapReason}; the caller falls back silently.
 * `disabled` short-circuits before any filesystem or `dlopen` work (FR19, C2).
 */
export function loadNative(
  crate: NativeCrate,
  enabled: boolean,
  deps: LoaderDeps,
): LoadedNative | NativeUnavailable {
  if (!enabled) return { gapReason: "disabled" }
  if (deps.platform === "win32") return { gapReason: "disabled", detail: "win32 never dlopens" }

  const ffi = deps.ffi()
  if (!ffi) return { gapReason: "dlopen_failed", detail: "bun:ffi unavailable" }

  const resolved = discover(crate, deps)
  if ("gapReason" in resolved) return resolved

  let module: DlopenModule
  try {
    module = ffi.dlopen(resolved.path, symbolTable(crate))
  } catch (error) {
    return { gapReason: "dlopen_failed", detail: String(error) }
  }

  let version: FfiVersionInfo
  try {
    const abiMajor = module.symbols.oc_abi_version!() as number
    if (abiMajor !== EXPECTED_ABI_MAJOR) {
      return { gapReason: "abi_mismatch", detail: `expected ${EXPECTED_ABI_MAJOR}, got ${abiMajor}` }
    }
    version = readVersion(module, ffi)
  } catch (error) {
    return { gapReason: "dlopen_failed", detail: String(error) }
  }

  return { crate, path: resolved.path, version, module }
}

/**
 * Invoke a native `oc_<name>` entry point: marshal the request as a UTF-8 JSON
 * buffer, call the symbol, copy the returned C string, free it exactly once via
 * `oc_free`, and parse the `#FfiResponse` envelope (C7).
 */
export function invokeNative<TResult>(
  loaded: LoadedNative,
  symbol: string,
  request: unknown,
  ffi: BunFfi,
): FfiEnvelope<TResult> {
  const buffer = Buffer.from(JSON.stringify(request), "utf8")
  const responsePtr = loaded.module.symbols[symbol]!(ffi.ptr(buffer), buffer.length)
  const text = ffi.cString(responsePtr)
  loaded.module.symbols.oc_free!(responsePtr)
  return JSON.parse(text) as FfiEnvelope<TResult>
}

/** Lazily resolve the real `bun:ffi` surface, or `null` off Bun / on failure. */
export function defaultBunFfi(): BunFfi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("bun:ffi") as {
      dlopen: (path: string, symbols: Record<string, FfiSymbolDef>) => DlopenModule
      ptr: (view: ArrayBufferView) => unknown
      CString: new (ptr: unknown) => { toString(): string }
    }
    if (!mod?.dlopen || !mod?.ptr || !mod?.CString) return null
    return {
      dlopen: mod.dlopen,
      ptr: mod.ptr,
      cString: (ptr) => new mod.CString(ptr).toString(),
    }
  } catch {
    return null
  }
}

/** The bundled native-artifact base dir (`packages/core/native`), resolved from this module. */
export function defaultBundledBaseDir(): string {
  return path.resolve(import.meta.dir, "../../../native")
}

/** Production {@link LoaderDeps} from the live process/runtime. */
export function defaultLoaderDeps(): LoaderDeps {
  const fs = require("fs") as typeof import("fs")
  return {
    platform: process.platform as Platform,
    arch: process.arch,
    env: process.env,
    fileExists: (candidate) => {
      try {
        return fs.statSync(candidate).isFile()
      } catch {
        return false
      }
    },
    bundledBaseDir: defaultBundledBaseDir(),
    ffi: defaultBunFfi,
  }
}

/**
 * Process-wide lazy cache of loaded crates (one `dlopen` per crate per process).
 * The cached value is either a {@link LoadedNative} or the {@link NativeUnavailable}
 * gap; both are memoized so a missing library is probed at most once.
 */
export class NativeLoader {
  private readonly deps: LoaderDeps
  private readonly cache = new Map<NativeCrate, LoadedNative | NativeUnavailable>()

  constructor(deps: LoaderDeps = defaultLoaderDeps()) {
    this.deps = deps
  }

  /** Load (or return the cached) native crate, gated by the experimental flag. */
  load(crate: NativeCrate, enabled: boolean): LoadedNative | NativeUnavailable {
    const cached = this.cache.get(crate)
    // A `disabled` gap is not cached: toggling the flag on must re-probe.
    if (cached && !("gapReason" in cached && cached.gapReason === "disabled")) return cached
    const result = loadNative(crate, enabled, this.deps)
    this.cache.set(crate, result)
    return result
  }

  /** Invoke a native entry point on an already-loaded crate. */
  invoke<TResult>(loaded: LoadedNative, symbol: string, request: unknown): FfiEnvelope<TResult> {
    const ffi = this.deps.ffi()
    if (!ffi) throw new Error("bun:ffi unavailable")
    return invokeNative<TResult>(loaded, symbol, request, ffi)
  }

  /** Drop the cache (test seam; a real process keeps the handle for its lifetime). */
  reset(): void {
    this.cache.clear()
  }
}

/** Type guard: a load/discover outcome is the `native_unavailable` gap. */
export function isUnavailable(value: LoadedNative | NativeUnavailable | { path: string }): value is NativeUnavailable {
  return "gapReason" in value
}

let SHARED: NativeLoader | undefined

/** The process-wide shared loader every tool wrapper reuses (one cache per process). */
export function sharedLoader(): NativeLoader {
  return (SHARED ??= new NativeLoader())
}
