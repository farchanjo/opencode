/**
 * Feature 010 — `apply_patch` native wrapper (T011, S9).
 *
 * Marshals a {@link NativeApplyPatchRequest} through `oc_apply_patch` (multi-hunk
 * parse + per-hunk surrounding-context matching) and translates the FFI `error.code`
 * into a `ToolFailure`, so native and fallback are indistinguishable to the model
 * (FR4, FR18, C4, AC5). Selection is gated by `experimental.nativeTools`.
 *
 * The native engine applies **all or nothing**: a `context_mismatch` leaves every
 * target untouched, so there is never a partial application to reconcile. The typed
 * validation and context messages are emitted verbatim by the native engine and
 * passed straight through; an IO failure maps to a generic `Unable to apply patch`.
 */

import { ToolFailure } from "@opencode-ai/llm"
import type { LoadedNative, NativeLoader, NativeUnavailable } from "./loader"
import { isUnavailable } from "./loader"
import type { FfiError, NativeApplyPatchRequest, NativeApplyPatchResult } from "./types"

/** The result of attempting a native patch apply: a value, a failure, or a gap. */
export type NativeApplyPatchOutcome =
  | { readonly kind: "ok"; readonly result: NativeApplyPatchResult }
  | { readonly kind: "error"; readonly failure: ToolFailure }
  | { readonly kind: "unavailable"; readonly gap: NativeUnavailable }

/**
 * Translate one `oc_apply_patch` `error.code` into a `ToolFailure` (C4). The parse and
 * context codes carry the native engine's descriptive message; an IO failure maps to a
 * generic `Unable to apply patch`.
 */
export function translateApplyPatchError(error: FfiError): ToolFailure {
  switch (error.code) {
    case "invalid_request":
    case "context_mismatch":
      return new ToolFailure({ message: error.message })
    default:
      return new ToolFailure({ message: "Unable to apply patch" })
  }
}

/**
 * Attempt `oc_apply_patch` behind the `experimental.nativeTools` flag. A load-time gap
 * or an unavailable `bun:ffi` surface yields `{ kind: "unavailable" }`; a typed FFI
 * error yields the translated `ToolFailure`; success yields the `#ApplyPatchResult`.
 */
export function runNativeApplyPatch(
  loader: NativeLoader,
  enabled: boolean,
  request: NativeApplyPatchRequest,
): NativeApplyPatchOutcome {
  const loaded = loader.load("tools", enabled)
  if (isUnavailable(loaded)) return { kind: "unavailable", gap: loaded }
  const native: LoadedNative = loaded

  const envelope = loader.invoke<NativeApplyPatchResult>(native, "oc_apply_patch", request)
  if (envelope.status === "error") {
    if (envelope.error.code === "internal_panic") {
      return { kind: "unavailable", gap: { gapReason: "dlopen_failed", detail: "internal_panic" } }
    }
    return { kind: "error", failure: translateApplyPatchError(envelope.error) }
  }
  return { kind: "ok", result: envelope.result }
}
