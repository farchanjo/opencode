/**
 * Feature 022 (ADR-0022) — production compiled-build regression guard.
 *
 * `bun build --compile` (`bun run build --single`) rejects a synchronous
 * `require("./x")` whenever `./x` transitively imports a module with a top-level
 * `await` — here `@opencode-ai/core/global` (its `await Promise.all([...])`),
 * reached by both live seams: `telemetry-export-live` (via the `Global` import)
 * and `executor-composition-live` (via `@/config/config` → `core/global`).
 *
 * The lazy live-module seams therefore MUST load via a DYNAMIC `await import(...)`,
 * never a synchronous `require(...)`. This lightweight source-invariant guard fails
 * fast in unit CI if a future edit reintroduces a `require()` of a `*-live` module
 * in `src/routing` or `src/jobs`, so the full compiled build cannot silently break
 * again. It intentionally does NOT invoke `bun build --compile` (too heavy for the
 * unit suite); the compile itself is the hard gate exercised by the build script.
 *
 * `bun-cron-adapter` is deliberately NOT covered: it does not transitively reach a
 * top-level await, so `bun build --compile` accepts its `require(...)` unchanged.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../../src/", import.meta.url))

// Every seam whose lazy load transitively reaches a top-level await and therefore
// MUST use `await import(...)` under `bun build --compile`.
const TLA_LIVE_SEAMS = [
  "routing/telemetry-export.ts",
  "jobs/executor-composition.ts",
] as const

// Matches a synchronous require of a sibling `*-live` module, e.g.
// `require("./telemetry-export-live")` — the exact pattern the compiler rejects.
const SYNC_LIVE_REQUIRE = /require\(\s*["'`]\.\/[\w.-]*-live["'`]\s*\)/

describe("Feature 022 — compiled-build lazy live-module load is dynamic-import safe", () => {
  for (const relPath of TLA_LIVE_SEAMS) {
    test(`${relPath} loads its live seam via await import, never a compile-rejected require()`, () => {
      const source = readFileSync(SRC + relPath, "utf8")
      expect(source).not.toMatch(SYNC_LIVE_REQUIRE)
      expect(source).toMatch(/await import\(\s*["'`]\.\/[\w.-]*-live["'`]\s*\)/)
    })
  }
})
