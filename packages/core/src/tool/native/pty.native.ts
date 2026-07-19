/**
 * Feature 010 — native PTY op wrappers (T015, S13).
 *
 * Marshals the five `oc_pty_*` entry points behind the `experimental.nativePty` flag
 * and the `pty` crate loader. A load-time gap, an ABI mismatch, or an `internal_panic`
 * yields a typed `native_unavailable` outcome so `bash.ts` degrades to its unchanged
 * `ChildProcess` path (FR12, FR19, C19). Native code is never a permission authority —
 * the caller evaluates `permission.assert` in TypeScript **before** invoking `spawn`
 * (FR13, C20).
 */

import type { LoadedNative, NativeLoader, NativeUnavailable } from "./loader"
import { isUnavailable } from "./loader"
import type {
  FfiError,
  NativePtyKillRequest,
  NativePtyResizeRequest,
  NativePtySessionRequest,
  NativePtySpawnRequest,
  NativePtySpawnResult,
  NativePtyWaitResult,
} from "./types"

/** SIGTERM — the first, graceful signal `bash.ts` delivers to a PTY process group (C12). */
export const SIGTERM = 15
/** SIGKILL — the TS-driven escalation 3 s after SIGTERM, mirroring `forceKillAfter` (C12). */
export const SIGKILL = 9

/** The five synchronous PTY operations, injectable so orchestration is testable (C7). */
export interface NativePtyOps {
  spawn(request: NativePtySpawnRequest): NativePtySpawnResult
  resize(request: NativePtyResizeRequest): void
  kill(request: NativePtyKillRequest): void
  wait(request: NativePtySessionRequest): NativePtyWaitResult
  close(request: NativePtySessionRequest): void
}

/** Resolving the native PTY backend: the bound ops, or a typed capability gap. */
export type NativePtyBackend =
  | { readonly kind: "ok"; readonly ops: NativePtyOps }
  | { readonly kind: "unavailable"; readonly gap: NativeUnavailable }

/** Raised when an `oc_pty_*` call returns a typed FFI error (surfaced as a bash failure). */
export class NativePtyError extends Error {
  constructor(
    readonly code: FfiError["code"],
    message: string,
  ) {
    super(message)
    this.name = "NativePtyError"
  }
}

/** Bind the five ops to a loaded `pty` crate, translating each envelope to a value/throw. */
function boundOps(loader: NativeLoader, native: LoadedNative): NativePtyOps {
  const invoke = <TResult>(symbol: string, request: unknown): TResult => {
    const envelope = loader.invoke<TResult>(native, symbol, request)
    if (envelope.status === "error") throw new NativePtyError(envelope.error.code, envelope.error.message)
    return envelope.result
  }
  return {
    spawn: (request) => invoke<NativePtySpawnResult>("oc_pty_spawn", request),
    resize: (request) => void invoke<unknown>("oc_pty_resize", request),
    kill: (request) => void invoke<unknown>("oc_pty_kill", request),
    wait: (request) => invoke<NativePtyWaitResult>("oc_pty_wait", request),
    close: (request) => void invoke<unknown>("oc_pty_close", request),
  }
}

/**
 * Resolve the native PTY backend behind `experimental.nativePty`. A load-time gap
 * (library missing / dlopen failed / ABI mismatch / disabled) returns `unavailable`
 * so the caller runs the unchanged non-PTY path.
 */
export function loadNativePty(loader: NativeLoader, enabled: boolean): NativePtyBackend {
  const loaded = loader.load("pty", enabled)
  if (isUnavailable(loaded)) return { kind: "unavailable", gap: loaded }
  return { kind: "ok", ops: boundOps(loader, loaded) }
}
