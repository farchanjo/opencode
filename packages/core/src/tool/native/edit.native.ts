/**
 * Feature 010 — `edit` native wrapper (T010, S8).
 *
 * Marshals a {@link NativeEditRequest} through `oc_edit` (exact string replacement
 * with the zero/one/many uniqueness matrix) and translates the FFI `error.code` into
 * the exact `edit.ts` failure message, so native and fallback are indistinguishable to
 * the model (FR3, FR18, C4, AC4). Selection is gated by `experimental.nativeTools`.
 *
 * The reference's own validation messages (`no_match`, `ambiguous_match`, and the
 * identical-string / empty-`oldString` guards) are emitted verbatim by the native
 * engine and passed straight through; only the file-access failures collapse to the
 * reference's generic `Unable to edit {path}`.
 */

import { ToolFailure } from "@opencode-ai/llm"
import type { LoadedNative, NativeLoader, NativeUnavailable } from "./loader"
import { isUnavailable } from "./loader"
import type { FfiError, NativeEditRequest, NativeEditResult } from "./types"

/** The result of attempting a native edit: a value, a translated failure, or a gap. */
export type NativeEditOutcome =
  | { readonly kind: "ok"; readonly result: NativeEditResult }
  | { readonly kind: "error"; readonly failure: ToolFailure }
  | { readonly kind: "unavailable"; readonly gap: NativeUnavailable }

/**
 * Translate one `oc_edit` `error.code` into the identical `edit.ts` `ToolFailure`
 * message (C4). The uniqueness/validation codes carry the reference's exact text; a
 * read/IO failure maps to the reference's generic `Unable to edit {path}`.
 */
export function translateEditError(error: FfiError, path: string): ToolFailure {
  switch (error.code) {
    case "no_match":
    case "ambiguous_match":
    case "invalid_request":
      // The native engine emits the reference's exact validation message verbatim.
      return new ToolFailure({ message: error.message })
    default:
      return new ToolFailure({ message: `Unable to edit ${path}` })
  }
}

/**
 * Attempt `oc_edit` behind the `experimental.nativeTools` flag. A load-time gap or an
 * unavailable `bun:ffi` surface yields `{ kind: "unavailable" }`; a typed FFI error
 * yields the translated `ToolFailure`; success yields the `#EditResult`.
 */
export function runNativeEdit(
  loader: NativeLoader,
  enabled: boolean,
  request: NativeEditRequest,
): NativeEditOutcome {
  const loaded = loader.load("tools", enabled)
  if (isUnavailable(loaded)) return { kind: "unavailable", gap: loaded }
  const native: LoadedNative = loaded

  const envelope = loader.invoke<NativeEditResult>(native, "oc_edit", request)
  if (envelope.status === "error") {
    if (envelope.error.code === "internal_panic") {
      return { kind: "unavailable", gap: { gapReason: "dlopen_failed", detail: "internal_panic" } }
    }
    return { kind: "error", failure: translateEditError(envelope.error, request.path) }
  }
  return { kind: "ok", result: envelope.result }
}
