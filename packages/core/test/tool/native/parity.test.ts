import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import {
  MAX_MEDIA_INGEST_BYTES,
  MAX_READ_BYTES,
  MAX_READ_LINES,
  ReadToolFileSystem,
} from "@opencode-ai/core/tool/read-filesystem"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { NativeLoader, isUnavailable, type LoadedNative } from "@opencode-ai/core/tool/native/loader"
import { runNativeRead } from "@opencode-ai/core/tool/native/read.native"
import { contentRequest, runNativeGrep } from "@opencode-ai/core/tool/native/grep.native"
import type { FfiEnvelope, NativeGrepRequest, NativeGrepResult } from "@opencode-ai/core/tool/native/types"
import { testEffect } from "../../lib/effect"

/**
 * Feature 010 — read + grep byte-identity parity harness (T008, S6).
 *
 * Runs the shared `native-parity/` fixtures through BOTH backends — the real
 * `libopencode_tools_ffi` dylib (built by `bun run build:native`) and the TypeScript
 * references — and asserts byte-identity on `read`, mode-correct results on `grep`,
 * the mirrored constants against the `oc_version` introspection, and the silent TS
 * fallback when native is disabled.
 */

const FIXTURES = path.resolve(import.meta.dir, "../../fixtures/native-parity")
const loader = new NativeLoader()

/** The loaded native crate, or a skip reason when the dylib is absent in this env. */
const loaded = loader.load("tools", true)
const nativeReady = !isUnavailable(loaded)

interface ReadCase {
  readonly file: string
  readonly offset?: number
  readonly limit?: number
  readonly compareWindow?: boolean
  readonly desc: string
}

const READ_CASES: readonly ReadCase[] = [
  { file: "lf.txt", desc: "whole LF file" },
  { file: "crlf.txt", desc: "whole CRLF file preserves carriage returns" },
  { file: "crlf.txt", offset: 1, limit: 10, compareWindow: true, desc: "paged CRLF strips carriage returns" },
  { file: "utf8.txt", offset: 1, limit: 10, compareWindow: true, desc: "paged non-ASCII UTF-8" },
  { file: "longline.txt", offset: 1, limit: 1, compareWindow: true, desc: "2000-char line truncation" },
  { file: "big.txt", compareWindow: true, desc: ">50 KiB paged-by-size read" },
  { file: "big.txt", offset: 100, limit: 50, compareWindow: true, desc: "explicit window deep in a big file" },
  { file: "nul.txt", desc: "NUL byte -> binary_file error" },
  { file: "lf.txt", offset: 50, limit: 5, desc: "offset past EOF -> offset_out_of_range" },
]

/** Native read outcome reduced to a comparable `{ content?, error?, truncated?, next? }`. */
function nativeRead(fixture: ReadCase) {
  const abs = path.join(FIXTURES, fixture.file)
  const outcome = runNativeRead(loader, true, {
    path: abs,
    offset: fixture.offset ?? null,
    limit: fixture.limit ?? null,
  })
  if (outcome.kind === "ok")
    return { content: outcome.result.content, truncated: outcome.result.truncated, next: outcome.result.next ?? null }
  if (outcome.kind === "error") return { error: outcome.failure.message }
  return { unavailable: true as const }
}

/** Invoke `oc_grep` directly on the real dylib and return the raw `#GrepResult`. */
function rawGrep(request: NativeGrepRequest): NativeGrepResult {
  const envelope = loader.invoke<NativeGrepResult>(loaded as LoadedNative, "oc_grep", request) as FfiEnvelope<NativeGrepResult>
  if (envelope.status === "error") throw new Error(`oc_grep failed: ${envelope.error.code}`)
  return envelope.result
}

const read = testEffect(AppNodeBuilder.build(FSUtil.node))

describe("native parity — read byte-identity (both backends)", () => {
  for (const fixture of READ_CASES) {
    read.effect(`${fixture.file}: ${fixture.desc}`, () =>
      Effect.gen(function* () {
        if (!nativeReady) return // dylib absent in this environment; fallback suite covers TS.
        const fs = yield* FSUtil.Service
        const abs = AbsolutePath.make(path.join(FIXTURES, fixture.file))
        const page = {
          ...(fixture.offset === undefined ? {} : { offset: fixture.offset }),
          ...(fixture.limit === undefined ? {} : { limit: fixture.limit }),
        }
        const settled = yield* ReadToolFileSystem.read(fs, abs, abs, page).pipe(
          Effect.map((result) => ({ tag: "ok" as const, result: result as { content: string; truncated?: boolean; next?: number } })),
          Effect.catch((error: { message: string }) => Effect.succeed({ tag: "err" as const, message: error.message })),
        )
        const native = nativeRead(fixture)

        if (settled.tag === "err") {
          // Reference failed — native must fail with the identical message.
          expect(native).toHaveProperty("error")
          expect((native as { error: string }).error).toBe(settled.message)
          return
        }

        const tsResult = settled.result
        expect(native).toHaveProperty("content")
        const nativeOk = native as { content: string; truncated: boolean; next: number | null }
        expect(nativeOk.content).toBe(tsResult.content)
        if (fixture.compareWindow) {
          expect(nativeOk.truncated).toBe(tsResult.truncated ?? false)
          expect(nativeOk.next).toBe(tsResult.next ?? null)
        }
      }),
    )
  }
})

describe("native parity — constants locked to TypeScript (C16)", () => {
  test("oc_version caps equal the read-filesystem.ts anchors", () => {
    if (!nativeReady) {
      console.warn("native dylib absent — skipping constant parity (build with `bun run build:native`)")
      return
    }
    if (isUnavailable(loaded)) throw new Error("unreachable")
    const caps = loaded.version.caps
    expect(caps.max_read_lines).toBe(MAX_READ_LINES)
    expect(caps.max_read_bytes).toBe(MAX_READ_BYTES)
    expect(caps.max_media_ingest_bytes).toBe(MAX_MEDIA_INGEST_BYTES)
    expect(caps.max_line_length).toBe(2000)
    expect(loaded.version.abiVersion).toBe(1)
  })
})

describe("native parity — grep embedded engine (no rg spawn)", () => {
  test("content mode reports line numbers over the fixture corpus", () => {
    if (!nativeReady) return
    const outcome = runNativeGrep(loader, true, contentRequest({ cwd: FIXTURES, pattern: "line number 42\\b" }))
    expect(outcome.kind).toBe("ok")
    if (outcome.kind !== "ok") return
    const inBig = outcome.matches.filter((m) => m.entry.path === "big.txt")
    expect(inBig.length).toBe(1)
    expect(inBig[0]!.line).toBe(42)
  })

  test("files_with_matches over a controlled tree is deterministic", () => {
    if (!nativeReady) return
    const result = rawGrep({ pattern: "beta", path: FIXTURES, mode: "files_with_matches", glob: null, context_lines: null })
    expect(result.mode).toBe("files_with_matches")
    // `beta` appears in lf.txt; the sorted file set is deterministic.
    expect(result.files).toContain("lf.txt")
    expect(result.matches).toBeNull()
  })

  test("count mode reports per-file totals", () => {
    if (!nativeReady) return
    const result = rawGrep({ pattern: "line1|line2", path: FIXTURES, mode: "count", glob: null, context_lines: null })
    expect(result.mode).toBe("count")
    const crlf = (result.counts ?? []).find((c) => c.path === "crlf.txt")
    expect(crlf?.count).toBe(2)
  })

  test("invalid regex yields the invalid_pattern code", () => {
    if (!nativeReady) return
    const outcome = runNativeGrep(loader, true, {
      pattern: "(",
      path: FIXTURES,
      mode: "content",
      glob: null,
      context_lines: null,
    })
    expect(outcome.kind).toBe("error")
    if (outcome.kind === "error") expect(outcome.code).toBe("invalid_pattern")
  })
})

const grep = testEffect(AppNodeBuilder.build(Ripgrep.node))

describe("native parity — repo-level grep equivalence (tie order ignored)", () => {
  grep.effect("native files-with-matches equals rg's distinct file set", () =>
    Effect.gen(function* () {
      if (!nativeReady) return
      const pattern = "oc_pty_spawn"
      const repoRoot = path.resolve(import.meta.dir, "../../../../..")

      // TypeScript backend via the external `rg` seam. Resolving the pinned rg may
      // require a one-time download; tolerate its absence honestly rather than fail.
      const rg = yield* Ripgrep.Service
      const settled = yield* rg.grep({ cwd: repoRoot, pattern, limit: 10_000 }).pipe(
        Effect.map((matches) => ({ tag: "ok" as const, matches })),
        Effect.catch((error: { message: string }) => Effect.succeed({ tag: "err" as const, message: error.message })),
      )
      if (settled.tag === "err") {
        console.warn(`repo-level grep equivalence skipped — rg backend unavailable: ${settled.message}`)
        return
      }
      const tsFiles = new Set(settled.matches.map((m) => m.entry.path))

      const result = rawGrep({ pattern, path: repoRoot, mode: "files_with_matches", glob: null, context_lines: null })
      const nativeFiles = new Set(result.files ?? [])

      // Ignore ordering ties: compare the sets. Both honor .gitignore and skip .git.
      expect([...nativeFiles].sort()).toEqual([...tsFiles].sort())
    }),
  )
})

describe("native parity — silent TS fallback when native is disabled (FR19, AC13)", () => {
  read.effect("disabled flag routes read to the byte-identical TypeScript path", () =>
    Effect.gen(function* () {
      const disabledLoader = new NativeLoader()
      const abs = AbsolutePath.make(path.join(FIXTURES, "lf.txt"))
      // Flag off -> native_unavailable gap (disabled); the caller runs the TS path.
      const outcome = runNativeRead(disabledLoader, false, { path: path.join(FIXTURES, "lf.txt") })
      expect(outcome.kind).toBe("unavailable")
      if (outcome.kind === "unavailable") expect(outcome.gap.gapReason).toBe("disabled")

      const fs = yield* FSUtil.Service
      const ts = (yield* ReadToolFileSystem.read(fs, abs, abs, {})) as { content: string }
      expect(ts.content).toBe("alpha\nbeta\ngamma\n")
    }),
  )
})
