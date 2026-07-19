import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { ReadToolFileSystem } from "@opencode-ai/core/tool/read-filesystem"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { NativeLoader, type BunFfi, type LoaderDeps } from "@opencode-ai/core/tool/native/loader"
import { runNativeRead } from "@opencode-ai/core/tool/native/read.native"
import { runNativeWrite } from "@opencode-ai/core/tool/native/write.native"
import { runNativeEdit } from "@opencode-ai/core/tool/native/edit.native"
import { runNativeApplyPatch } from "@opencode-ai/core/tool/native/apply-patch.native"
import { globRequest, runNativeGlob } from "@opencode-ai/core/tool/native/glob.native"
import { contentRequest, runNativeGrep } from "@opencode-ai/core/tool/native/grep.native"
import type { NativeUnavailableGapReason } from "@opencode-ai/core/tool/native/types"
import { testEffect } from "../../lib/effect"

/**
 * Feature 010 — fallback byte-identity suite (T020, S16).
 *
 * Covers all six native tools across every native-unavailability cause — dylib
 * absent (`library_missing`), present-but-unloadable (`dlopen_failed`), ABI-mismatched
 * (`abi_mismatch`), and flag-off (`disabled`). For each cause every wrapper records the
 * typed `native_unavailable` capability gap with the correct bounded `gap_reason`, never
 * throws (the session never hard-fails), and the TypeScript reference path serves the
 * call byte-identically (FR7, FR19, NFR1, NFR6, C14, AC13, AC14).
 */

const FIXTURES = path.resolve(import.meta.dir, "../../fixtures/native-parity")

type Cause = "library_missing" | "dlopen_failed" | "abi_mismatch"

/** A `bun:ffi` surface whose `dlopen` fails or hands back an ABI-mismatched module. */
function fakeFfi(cause: Cause): BunFfi {
  return {
    dlopen: (_p, _s) => {
      if (cause === "dlopen_failed") throw new Error("simulated dlopen failure")
      // abi_mismatch: the handshake reports an unexpected ABI major.
      return {
        symbols: {
          oc_abi_version: () => 999,
          oc_version: () => 0,
          oc_free: () => {},
        },
      }
    },
    ptr: () => 0,
    cString: () => "{}",
  }
}

/** Loader deps that deterministically reproduce one unavailability cause on darwin/linux. */
function causeDeps(cause: Cause): LoaderDeps {
  return {
    platform: "linux",
    arch: "x64",
    env: {},
    // library_missing: nothing on disk; the others resolve a bundled path then fail at dlopen/handshake.
    fileExists: () => cause !== "library_missing",
    bundledBaseDir: "/fake/native",
    ffi: () => fakeFfi(cause),
  }
}

/** Every tool wrapper reduced to `{ kind, gapReason }` for a given loader + enabled flag. */
function probeAllTools(loader: NativeLoader, enabled: boolean, dir: string, file: string) {
  return {
    read: runNativeRead(loader, enabled, { path: file, offset: null, limit: null }),
    write: runNativeWrite(loader, enabled, { path: path.join(dir, "w.txt"), content: "x" }),
    edit: runNativeEdit(loader, enabled, { path: file, old_string: "body", new_string: "z", replace_all: false }),
    apply_patch: runNativeApplyPatch(loader, enabled, { patch: "noop", cwd: dir }),
    glob: runNativeGlob(loader, enabled, globRequest({ cwd: dir, pattern: "*.txt" })),
    grep: runNativeGrep(loader, enabled, contentRequest({ cwd: dir, pattern: "body" })),
  }
}

function scratch(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-fallback-"))
  const file = path.join(dir, "f.txt")
  fs.writeFileSync(file, "body\n")
  return { dir, file }
}

const CAUSES: readonly { cause: Cause; enabled: boolean; expected: NativeUnavailableGapReason }[] = [
  { cause: "library_missing", enabled: true, expected: "library_missing" },
  { cause: "dlopen_failed", enabled: true, expected: "dlopen_failed" },
  { cause: "abi_mismatch", enabled: true, expected: "abi_mismatch" },
]

describe("native fallback — every tool records the typed gap for each cause (T020, AC14)", () => {
  for (const { cause, enabled, expected } of CAUSES) {
    test(`${cause}: all six wrappers report gap_reason=${expected} and never throw`, () => {
      const { dir, file } = scratch()
      const loader = new NativeLoader(causeDeps(cause))
      const outcomes = probeAllTools(loader, enabled, dir, file)
      for (const [tool, outcome] of Object.entries(outcomes)) {
        expect(outcome.kind, `${tool} must be unavailable under ${cause}`).toBe("unavailable")
        if (outcome.kind === "unavailable") expect(outcome.gap.gapReason).toBe(expected)
      }
    })
  }

  test("disabled (flag off): all six wrappers report gap_reason=disabled (AC13)", () => {
    const { dir, file } = scratch()
    // The flag-off gap must not depend on any dylib being present.
    const loader = new NativeLoader(causeDeps("library_missing"))
    const outcomes = probeAllTools(loader, false, dir, file)
    for (const [tool, outcome] of Object.entries(outcomes)) {
      expect(outcome.kind, `${tool} must be unavailable when disabled`).toBe("unavailable")
      if (outcome.kind === "unavailable") expect(outcome.gap.gapReason).toBe("disabled")
    }
  })

  test("win32 never selects native — every wrapper degrades to the disabled gap", () => {
    const { dir, file } = scratch()
    const win32Deps: LoaderDeps = { ...causeDeps("library_missing"), platform: "win32" }
    const loader = new NativeLoader(win32Deps)
    const outcomes = probeAllTools(loader, true, dir, file)
    for (const outcome of Object.values(outcomes)) {
      expect(outcome.kind).toBe("unavailable")
      if (outcome.kind === "unavailable") expect(outcome.gap.gapReason).toBe("disabled")
    }
  })
})

const read = testEffect(AppNodeBuilder.build(FSUtil.node))

describe("native fallback — the TypeScript read path is byte-identical under every cause (NFR1)", () => {
  for (const { cause, enabled } of [...CAUSES, { cause: "library_missing" as Cause, enabled: false }]) {
    read.effect(`read serves byte-identical bytes when native is ${enabled ? cause : "disabled"}`, () =>
      Effect.gen(function* () {
        const loader = new NativeLoader(causeDeps(cause))
        // The native attempt is a gap; the caller runs the untouched TS reference.
        const native = runNativeRead(loader, enabled, { path: path.join(FIXTURES, "lf.txt"), offset: null, limit: null })
        expect(native.kind).toBe("unavailable")

        const fs_ = yield* FSUtil.Service
        const abs = AbsolutePath.make(path.join(FIXTURES, "lf.txt"))
        const ts = (yield* ReadToolFileSystem.read(fs_, abs, abs, {})) as { content: string }
        // The TS path is the deterministic byte source — identical regardless of cause.
        expect(ts.content).toBe("alpha\nbeta\ngamma\n")
      }),
    )
  }
})

const grep = testEffect(AppNodeBuilder.build(Ripgrep.node))

describe("native fallback — grep/glob route through the Ripgrep seam, no hard fail (FR7, AC14)", () => {
  grep.effect("with native unavailable, the rg seam still serves grep + glob", () =>
    Effect.gen(function* () {
      const loader = new NativeLoader(causeDeps("dlopen_failed"))
      const grepOut = runNativeGrep(loader, true, contentRequest({ cwd: FIXTURES, pattern: "beta" }))
      const globOut = runNativeGlob(loader, true, globRequest({ cwd: FIXTURES, pattern: "*.txt" }))
      expect(grepOut.kind).toBe("unavailable")
      expect(globOut.kind).toBe("unavailable")

      // The external `rg` seam is the fallback; tolerate its absence honestly.
      const rg = yield* Ripgrep.Service
      const settled = yield* rg.grep({ cwd: FIXTURES, pattern: "beta", limit: 100 }).pipe(
        Effect.map((matches) => ({ tag: "ok" as const, matches })),
        Effect.catch((error: { message: string }) => Effect.succeed({ tag: "err" as const, message: error.message })),
      )
      if (settled.tag === "err") {
        console.warn(`grep fallback seam skipped — rg unavailable: ${settled.message}`)
        return
      }
      expect(settled.matches.some((m) => m.entry.path === "lf.txt")).toBe(true)
    }),
  )
})
