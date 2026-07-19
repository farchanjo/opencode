/**
 * Feature 010 — `write` native wrapper (T009, S7).
 *
 * Marshals a {@link NativeWriteRequest} through `oc_write` (atomic tempfile + rename)
 * and translates the FFI `error.code` into the exact `write.ts` failure message, so
 * the native backend is indistinguishable from the TypeScript reference (FR2, FR18,
 * C8, AC3). Selection is gated by `experimental.nativeTools`; a load-time gap, an ABI
 * mismatch, or an `internal_panic` yields a typed `native_unavailable` outcome and the
 * caller runs the untouched TypeScript path.
 */

import { ToolFailure } from "@opencode-ai/llm"
import type { LoadedNative, NativeLoader, NativeUnavailable } from "./loader"
import { isUnavailable } from "./loader"
import type { FfiError, NativeWriteRequest, NativeWriteResult } from "./types"

/** The result of attempting a native write: a value, a translated failure, or a gap. */
export type NativeWriteOutcome =
  | { readonly kind: "ok"; readonly result: NativeWriteResult }
  | { readonly kind: "error"; readonly failure: ToolFailure }
  | { readonly kind: "unavailable"; readonly gap: NativeUnavailable }

/**
 * Translate one `oc_write` `error.code` into the identical `write.ts` `ToolFailure`
 * message (C4). Every failure path in the reference reports `Unable to write {path}`.
 */
export function translateWriteError(_error: FfiError, path: string): ToolFailure {
  return new ToolFailure({ message: `Unable to write ${path}` })
}

/**
 * Attempt `oc_write` behind the `experimental.nativeTools` flag. A load-time gap or an
 * unavailable `bun:ffi` surface yields `{ kind: "unavailable" }`; a typed FFI error
 * yields the translated `ToolFailure`; success yields the `#WriteResult`.
 */
export function runNativeWrite(
  loader: NativeLoader,
  enabled: boolean,
  request: NativeWriteRequest,
): NativeWriteOutcome {
  const loaded = loader.load("tools", enabled)
  if (isUnavailable(loaded)) return { kind: "unavailable", gap: loaded }
  const native: LoadedNative = loaded

  const envelope = loader.invoke<NativeWriteResult>(native, "oc_write", request)
  if (envelope.status === "error") {
    // `internal_panic` is not a real tool failure — degrade to the TS path.
    if (envelope.error.code === "internal_panic") {
      return { kind: "unavailable", gap: { gapReason: "dlopen_failed", detail: "internal_panic" } }
    }
    return { kind: "error", failure: translateWriteError(envelope.error, request.path) }
  }
  return { kind: "ok", result: envelope.result }
}
