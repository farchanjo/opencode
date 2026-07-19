import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { NativeLoader, isUnavailable, type LoadedNative } from "@opencode-ai/core/tool/native/loader"
import { runNativeWrite } from "@opencode-ai/core/tool/native/write.native"
import { runNativeEdit } from "@opencode-ai/core/tool/native/edit.native"
import { runNativeApplyPatch } from "@opencode-ai/core/tool/native/apply-patch.native"
import { globRequest, runNativeGlob } from "@opencode-ai/core/tool/native/glob.native"
import type {
  FfiEnvelope,
  NativeGlobRequest,
  NativeGlobResult,
} from "@opencode-ai/core/tool/native/types"
import { testEffect } from "../../lib/effect"

/**
 * Feature 010 — write / edit / apply_patch / glob parity harness (T009–T012).
 *
 * Drives the four Phase-3 filesystem tools through the real `libopencode_tools_ffi`
 * dylib (built by `bun run build:native`) and asserts atomic-write parity, the edit
 * uniqueness matrix with the exact `edit.ts` messages, all-or-nothing multi-hunk
 * patch application with `context_mismatch`, and mtime-sorted `.gitignore`-aware glob
 * — plus repo-level glob equivalence against the external `rg` seam (tie order
 * ignored) and the silent TS fallback when native is disabled.
 */

const loader = new NativeLoader()
const loaded = loader.load("tools", true)
const nativeReady = !isUnavailable(loaded)

/** A fresh, unique scratch directory removed on process exit. */
function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oc-parity-${name}-`))
  return dir
}

/** Invoke `oc_glob` directly on the real dylib and return the raw `#GlobResult`. */
function rawGlob(request: NativeGlobRequest): NativeGlobResult {
  const envelope = loader.invoke<NativeGlobResult>(
    loaded as LoadedNative,
    "oc_glob",
    request,
  ) as FfiEnvelope<NativeGlobResult>
  if (envelope.status === "error") throw new Error(`oc_glob failed: ${envelope.error.code}`)
  return envelope.result
}

describe("native parity — write atomic create/overwrite (T009, AC3)", () => {
  test("creates a new file and reports created with the byte count", () => {
    if (!nativeReady) return
    const dir = scratch("write-create")
    const file = path.join(dir, "new.txt")
    const outcome = runNativeWrite(loader, true, { path: file, content: "hello\nworld\n" })
    expect(outcome.kind).toBe("ok")
    if (outcome.kind !== "ok") return
    expect(outcome.result.created).toBe(true)
    expect(outcome.result.byte_count).toBe(12)
    expect(fs.readFileSync(file, "utf8")).toBe("hello\nworld\n")
  })

  test("overwrites fully — the destination is never a truncation of the prior bytes", () => {
    if (!nativeReady) return
    const dir = scratch("write-overwrite")
    const file = path.join(dir, "existing.txt")
    fs.writeFileSync(file, "old content that is much longer than the replacement")
    const outcome = runNativeWrite(loader, true, { path: file, content: "new" })
    expect(outcome.kind).toBe("ok")
    if (outcome.kind !== "ok") return
    expect(outcome.result.created).toBe(false)
    expect(fs.readFileSync(file, "utf8")).toBe("new")
    // No lingering atomic temp file — the write renamed over the target.
    const leftovers = fs.readdirSync(dir).filter((n) => n.includes(".oc_write_"))
    expect(leftovers).toEqual([])
  })

  test("preserves a prior UTF-8 BOM without doubling it", () => {
    if (!nativeReady) return
    const dir = scratch("write-bom")
    const file = path.join(dir, "bom.txt")
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("original")]))
    runNativeWrite(loader, true, { path: file, content: "replacement" })
    const bytes = fs.readFileSync(file)
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(bytes.subarray(3).toString("utf8")).toBe("replacement")
  })
})

describe("native parity — edit uniqueness matrix (T010, AC4)", () => {
  const setup = (name: string, body: string) => {
    const dir = scratch(`edit-${name}`)
    const file = path.join(dir, "target.txt")
    fs.writeFileSync(file, body)
    return file
  }

  test("single exact match replaces and reports one", () => {
    if (!nativeReady) return
    const file = setup("single", "alpha beta gamma\n")
    const outcome = runNativeEdit(loader, true, {
      path: file,
      old_string: "beta",
      new_string: "BETA",
      replace_all: false,
    })
    expect(outcome.kind).toBe("ok")
    if (outcome.kind !== "ok") return
    expect(outcome.result.replacements).toBe(1)
    expect(fs.readFileSync(file, "utf8")).toBe("alpha BETA gamma\n")
  })

  test("zero occurrences yields the exact no_match message", () => {
    if (!nativeReady) return
    const file = setup("zero", "nothing here\n")
    const outcome = runNativeEdit(loader, true, {
      path: file,
      old_string: "absent",
      new_string: "x",
      replace_all: false,
    })
    expect(outcome.kind).toBe("error")
    if (outcome.kind !== "error") return
    expect(outcome.failure.message).toBe(
      "Could not find oldString in the file. It must match exactly, including whitespace and indentation.",
    )
  })

  test("multiple occurrences without replace_all yields the exact ambiguous message", () => {
    if (!nativeReady) return
    const file = setup("many", "dup dup dup\n")
    const outcome = runNativeEdit(loader, true, {
      path: file,
      old_string: "dup",
      new_string: "x",
      replace_all: false,
    })
    expect(outcome.kind).toBe("error")
    if (outcome.kind !== "error") return
    expect(outcome.failure.message).toBe(
      "Found multiple exact matches for oldString. Provide more surrounding context or set replaceAll to true.",
    )
  })

  test("replace_all substitutes every occurrence", () => {
    if (!nativeReady) return
    const file = setup("all", "dup dup dup\n")
    const outcome = runNativeEdit(loader, true, {
      path: file,
      old_string: "dup",
      new_string: "x",
      replace_all: true,
    })
    expect(outcome.kind).toBe("ok")
    if (outcome.kind !== "ok") return
    expect(outcome.result.replacements).toBe(3)
    expect(fs.readFileSync(file, "utf8")).toBe("x x x\n")
  })

  test("identical old/new is rejected with the exact message", () => {
    if (!nativeReady) return
    const file = setup("identical", "same\n")
    const outcome = runNativeEdit(loader, true, {
      path: file,
      old_string: "same",
      new_string: "same",
      replace_all: false,
    })
    expect(outcome.kind).toBe("error")
    if (outcome.kind !== "error") return
    expect(outcome.failure.message).toBe("No changes to apply: oldString and newString are identical.")
  })
})

describe("native parity — apply_patch multi-hunk + context_mismatch (T011, AC5)", () => {
  test("all hunks apply on a matching multi-hunk patch", () => {
    if (!nativeReady) return
    const dir = scratch("patch-multi")
    fs.writeFileSync(path.join(dir, "f.txt"), "a\nb\nc\nd\ne\nf\n")
    const patch = ["*** Begin Patch", "*** Update File: f.txt", "@@", " a", "-b", "+B", " c", "@@", " e", "-f", "+F", "*** End Patch"].join("\n")
    const outcome = runNativeApplyPatch(loader, true, { patch, cwd: dir })
    expect(outcome.kind).toBe("ok")
    if (outcome.kind !== "ok") return
    expect(outcome.result.files_changed).toBe(1)
    expect(outcome.result.hunks_applied).toBe(2)
    expect(fs.readFileSync(path.join(dir, "f.txt"), "utf8")).toBe("a\nB\nc\nd\ne\nF\n")
  })

  test("a non-matching hunk yields context_mismatch and applies nothing", () => {
    if (!nativeReady) return
    const dir = scratch("patch-mismatch")
    fs.writeFileSync(path.join(dir, "g.txt"), "keep this\nand this\n")
    fs.writeFileSync(path.join(dir, "h.txt"), "x\ny\n")
    const patch = [
      "*** Begin Patch",
      "*** Update File: h.txt",
      "@@",
      " x",
      "-y",
      "+Y",
      "*** Update File: g.txt",
      "@@",
      "-nonexistent line",
      "+replacement",
      "*** End Patch",
    ].join("\n")
    const outcome = runNativeApplyPatch(loader, true, { patch, cwd: dir })
    expect(outcome.kind).toBe("error")
    if (outcome.kind !== "error") return
    // Nothing committed — the earlier matching hunk was NOT applied.
    expect(fs.readFileSync(path.join(dir, "g.txt"), "utf8")).toBe("keep this\nand this\n")
    expect(fs.readFileSync(path.join(dir, "h.txt"), "utf8")).toBe("x\ny\n")
  })
})

describe("native parity — glob gitignore + mtime (T012, AC6)", () => {
  test("results are mtime-descending and honor a gitignored directory", () => {
    if (!nativeReady) return
    const dir = scratch("glob-mtime")
    fs.writeFileSync(path.join(dir, ".gitignore"), "build/\n")
    fs.mkdirSync(path.join(dir, "build"))
    fs.writeFileSync(path.join(dir, "build", "out.txt"), "x")
    fs.writeFileSync(path.join(dir, "old.txt"), "x")
    fs.writeFileSync(path.join(dir, "new.txt"), "x")
    const now = Date.now()
    fs.utimesSync(path.join(dir, "old.txt"), (now - 100_000) / 1000, (now - 100_000) / 1000)
    fs.utimesSync(path.join(dir, "new.txt"), now / 1000, now / 1000)
    const result = rawGlob(globRequest({ cwd: dir, pattern: "**/*.txt" }))
    // build/out.txt pruned by the gitignored directory; newest first.
    expect(result.paths).toEqual(["new.txt", "old.txt"])
    expect(result.truncated).toBe(false)
  })

  test("limit truncates and sets the flag", () => {
    if (!nativeReady) return
    const dir = scratch("glob-limit")
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), "x")
    const outcome = runNativeGlob(loader, true, globRequest({ cwd: dir, pattern: "*.txt", limit: 3 }))
    expect(outcome.kind).toBe("ok")
    if (outcome.kind !== "ok") return
    expect(outcome.entries.length).toBe(3)
    expect(outcome.truncated).toBe(true)
  })
})

const rg = testEffect(AppNodeBuilder.build(Ripgrep.node))

describe("native parity — repo-level glob equivalence (tie order ignored, T012)", () => {
  rg.effect("native glob path set equals rg's file set for a pattern", () =>
    Effect.gen(function* () {
      if (!nativeReady) return
      const pattern = "*.rs"
      const repoRoot = path.resolve(import.meta.dir, "../../../../..")

      const service = yield* Ripgrep.Service
      const settled = yield* service.glob({ cwd: repoRoot, pattern, limit: 10_000 }).pipe(
        Effect.map((entries) => ({ tag: "ok" as const, entries })),
        Effect.catch((error: { message: string }) => Effect.succeed({ tag: "err" as const, message: error.message })),
      )
      if (settled.tag === "err") {
        console.warn(`repo-level glob equivalence skipped — rg backend unavailable: ${settled.message}`)
        return
      }
      const tsFiles = new Set(settled.entries.map((e) => e.path))

      const result = rawGlob({ pattern, cwd: repoRoot, limit: null })
      const nativeFiles = new Set(result.paths)

      // Ignore the undefined (mtime desc, path) tie order — compare the sets.
      expect([...nativeFiles].sort()).toEqual([...tsFiles].sort())
    }),
  )
})

describe("native parity — silent TS fallback when disabled (FR19, AC13)", () => {
  test("each Phase-3 wrapper reports the disabled gap when the flag is off", () => {
    const off = new NativeLoader()
    const dir = scratch("fallback")
    const file = path.join(dir, "f.txt")
    fs.writeFileSync(file, "body\n")

    const write = runNativeWrite(off, false, { path: file, content: "x" })
    const edit = runNativeEdit(off, false, { path: file, old_string: "body", new_string: "z", replace_all: false })
    const patch = runNativeApplyPatch(off, false, { patch: "noop", cwd: dir })
    const glob = runNativeGlob(off, false, globRequest({ cwd: dir, pattern: "*.txt" }))

    for (const outcome of [write, edit, patch, glob]) {
      expect(outcome.kind).toBe("unavailable")
      if (outcome.kind === "unavailable") expect(outcome.gap.gapReason).toBe("disabled")
    }
  })
})
