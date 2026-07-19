/**
 * Feature 010 — `glob` native wrapper (T012, S10).
 *
 * Marshals a {@link NativeGlobRequest} through `oc_glob` (the embedded `ignore` +
 * `globset` engine — never an external `rg` spawn) and maps the mtime-desc path set
 * into the `FileSystem.Entry[]` shape the `glob` tool already produces, so the native
 * backend is transparent to the model (FR5, FR7, FR18, C5, C13, AC6).
 *
 * Selection is gated by `experimental.nativeTools`. On a load-time gap, an ABI
 * mismatch, or an FFI error, the caller falls back through the `Ripgrep.Service` seam
 * (external `rg`) exactly as before — native is never a hard dependency.
 */

import { FileSystem } from "../../filesystem"
import { RelativePath } from "../../schema"
import type { LoadedNative, NativeLoader, NativeUnavailable } from "./loader"
import { isUnavailable } from "./loader"
import type { NativeGlobRequest, NativeGlobResult } from "./types"

/** The result of attempting a native glob: mapped entries, an FFI error, or a gap. */
export type NativeGlobOutcome =
  | { readonly kind: "ok"; readonly entries: FileSystem.Entry[]; readonly truncated: boolean }
  | { readonly kind: "error"; readonly code: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly gap: NativeUnavailable }

/** Build a native glob request from a cwd + pattern + optional limit. */
export function globRequest(input: {
  readonly cwd: string
  readonly pattern: string
  readonly limit?: number
}): NativeGlobRequest {
  return {
    pattern: input.pattern,
    cwd: input.cwd,
    limit: input.limit ?? null,
  }
}

/** Map the native path set into the `FileSystem.Entry[]` shape the `glob` tool returns. */
export function toEntries(result: NativeGlobResult): FileSystem.Entry[] {
  return (result.paths ?? []).map((path) =>
    FileSystem.Entry.make({ path: RelativePath.make(path), type: "file" }),
  )
}

/**
 * Attempt `oc_glob` behind the `experimental.nativeTools` flag. `unavailable` routes
 * the caller to the `Ripgrep.Service` fallback; `error` carries the typed `error.code`
 * (for example `invalid_pattern`) the caller may surface.
 */
export function runNativeGlob(
  loader: NativeLoader,
  enabled: boolean,
  request: NativeGlobRequest,
): NativeGlobOutcome {
  const loaded = loader.load("tools", enabled)
  if (isUnavailable(loaded)) return { kind: "unavailable", gap: loaded }
  const native: LoadedNative = loaded

  const envelope = loader.invoke<NativeGlobResult>(native, "oc_glob", request)
  if (envelope.status === "error") {
    if (envelope.error.code === "internal_panic") {
      return { kind: "unavailable", gap: { gapReason: "dlopen_failed", detail: "internal_panic" } }
    }
    return { kind: "error", code: envelope.error.code, message: envelope.error.message }
  }
  return { kind: "ok", entries: toEntries(envelope.result), truncated: envelope.result.truncated }
}
