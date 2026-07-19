/**
 * Feature 010 — `grep` native wrapper (T007, S5).
 *
 * Marshals a {@link NativeGrepRequest} through `oc_grep` (the embedded
 * `grep-searcher`/`grep-regex`/`ignore` engine — never an external `rg` spawn) and
 * maps the content-mode result into the `FileSystem.Match[]` shape `grep.ts` already
 * produces, so the native backend is transparent to the model (FR6, FR18, C5, C8).
 *
 * Selection is gated by `experimental.nativeTools`. On a load-time gap, an ABI
 * mismatch, or an FFI error, the caller falls back through the `Ripgrep.Service`
 * seam (external `rg`) exactly as before — native is never a hard dependency.
 */

import { FileSystem } from "../../filesystem"
import { RelativePath } from "../../schema"
import type { LoadedNative, NativeLoader, NativeUnavailable } from "./loader"
import { isUnavailable } from "./loader"
import type { GrepOutputMode, NativeGrepRequest, NativeGrepResult } from "./types"

/** The result of attempting a native grep: mapped matches, an FFI error, or a gap. */
export type NativeGrepOutcome =
  | { readonly kind: "ok"; readonly matches: FileSystem.Match[] }
  | { readonly kind: "error"; readonly code: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly gap: NativeUnavailable }

/** Build a native grep request in `content` mode from a cwd + pattern + optional glob. */
export function contentRequest(input: {
  readonly cwd: string
  readonly pattern: string
  readonly include?: string
}): NativeGrepRequest {
  return {
    pattern: input.pattern,
    path: input.cwd,
    mode: "content" satisfies GrepOutputMode,
    glob: input.include ?? null,
    context_lines: null,
  }
}

/** Map the native content-mode result into the `FileSystem.Match[]` shape `grep.ts` returns. */
export function toMatches(result: NativeGrepResult): FileSystem.Match[] {
  const matches = result.matches ?? []
  return matches.map((match) =>
    FileSystem.Match.make({
      entry: FileSystem.Entry.make({ path: RelativePath.make(match.path), type: "file" }),
      line: match.line_number,
      offset: match.byte_offset,
      text: match.text,
      submatches: [],
    }),
  )
}

/**
 * Attempt `oc_grep` in `content` mode behind the `experimental.nativeTools` flag.
 * `unavailable` routes the caller to the `Ripgrep.Service` fallback; `error` carries
 * the typed `error.code` (for example `invalid_pattern`) the caller may surface.
 */
export function runNativeGrep(
  loader: NativeLoader,
  enabled: boolean,
  request: NativeGrepRequest,
): NativeGrepOutcome {
  const loaded = loader.load("tools", enabled)
  if (isUnavailable(loaded)) return { kind: "unavailable", gap: loaded }
  const native: LoadedNative = loaded

  const envelope = loader.invoke<NativeGrepResult>(native, "oc_grep", request)
  if (envelope.status === "error") {
    if (envelope.error.code === "internal_panic") {
      return { kind: "unavailable", gap: { gapReason: "dlopen_failed", detail: "internal_panic" } }
    }
    return { kind: "error", code: envelope.error.code, message: envelope.error.message }
  }
  return { kind: "ok", matches: toMatches(envelope.result) }
}
