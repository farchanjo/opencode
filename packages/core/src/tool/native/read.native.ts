/**
 * Feature 010 — `read` native wrapper (T007, S5).
 *
 * Marshals an {@link NativeReadRequest} through `oc_read` and translates the closed
 * `error.code` taxonomy into the exact `read-filesystem.ts` failure messages, so the
 * native backend is indistinguishable from the TypeScript reference to the model
 * (FR18, C4, C8). Selection is gated by `experimental.nativeTools`; when the flag is
 * off, the library is absent, or the ABI mismatches, the caller receives a typed
 * `native_unavailable` outcome and runs the untouched TypeScript path.
 */

import { ToolFailure } from "@opencode-ai/llm"
import type { LoadedNative, NativeLoader, NativeUnavailable } from "./loader"
import { isUnavailable } from "./loader"
import type { FfiError, NativeReadRequest, NativeReadResult } from "./types"

/** The result of attempting a native read: a value, a translated failure, or a gap. */
export type NativeReadOutcome =
  | { readonly kind: "ok"; readonly result: NativeReadResult }
  | { readonly kind: "error"; readonly failure: ToolFailure }
  | { readonly kind: "unavailable"; readonly gap: NativeUnavailable }

/**
 * Translate one `oc_read` `error.code` into the identical `read-filesystem.ts`
 * `ToolFailure` message (C4). `resource` is the model-facing path the reference
 * embeds in each message.
 */
export function translateReadError(error: FfiError, resource: string): ToolFailure {
  switch (error.code) {
    case "not_found":
      return new ToolFailure({ message: `File not found: ${resource}` })
    case "not_a_file":
      return new ToolFailure({ message: `Path is not a file: ${resource}` })
    case "binary_file":
      return new ToolFailure({ message: `Cannot read binary file: ${resource}` })
    case "malformed_utf8":
      return new ToolFailure({ message: `File is not valid UTF-8: ${resource}` })
    case "offset_out_of_range": {
      const offset = /Offset (\d+)/.exec(error.message)?.[1] ?? "?"
      return new ToolFailure({ message: `Offset ${offset} is out of range` })
    }
    case "media_limit":
      return new ToolFailure({ message: error.message })
    default:
      return new ToolFailure({ message: error.message })
  }
}

/**
 * Attempt `oc_read` behind the `experimental.nativeTools` flag. A load-time gap or
 * an unavailable `bun:ffi` surface yields `{ kind: "unavailable" }`; a typed FFI
 * error yields the translated `ToolFailure`; success yields the `#ReadResult`.
 */
export function runNativeRead(
  loader: NativeLoader,
  enabled: boolean,
  request: NativeReadRequest,
): NativeReadOutcome {
  const loaded = loader.load("tools", enabled)
  if (isUnavailable(loaded)) return { kind: "unavailable", gap: loaded }
  const native: LoadedNative = loaded

  const envelope = loader.invoke<NativeReadResult>(native, "oc_read", request)
  if (envelope.status === "error") {
    // `internal_panic` is not a real tool failure — degrade to the TS path.
    if (envelope.error.code === "internal_panic") {
      return { kind: "unavailable", gap: { gapReason: "dlopen_failed", detail: "internal_panic" } }
    }
    return { kind: "error", failure: translateReadError(envelope.error, request.path) }
  }
  return { kind: "ok", result: envelope.result }
}
