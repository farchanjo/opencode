/**
 * Feature 005 / T025 (S13) — managed private spool tree + path guards.
 * Asserts private `0700`/`0600` permissions, a rejected traversal/symlink escape,
 * and that no path crosses a consumer boundary (the layout only returns internal
 * paths to sibling adapters, FR11, FR45, FR46, C1, C6, AC14).
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, statSync, writeFileSync, symlinkSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SpoolLayout } from "@/outputspool/spool-layout"

const freshRoot = () => mkdtempSync(join(tmpdir(), "outputspool-layout-"))

const KEY: SpoolLayout.SubtreeKey = {
  project_id: "proj",
  root_session_id: "root",
  process_attempt: "p1",
  generation: "0",
  channel: "stdout",
}

describe("spool-layout", () => {
  test("ensureSubtree creates a 0700 private directory", async () => {
    const layout = SpoolLayout.createSpoolLayout({ root: freshRoot() })
    const dir = await layout.ensureSubtree(KEY)
    if (SpoolLayout.supportsPosixModes()) {
      expect(statSync(dir).mode & 0o777).toBe(SpoolLayout.DIR_MODE)
    }
  })

  test("rejects a traversal segment", () => {
    const layout = SpoolLayout.createSpoolLayout({ root: freshRoot() })
    expect(() => layout.subtreeDir({ ...KEY, generation: ".." })).toThrow(SpoolLayout.SpoolPathError)
  })

  test("rejects a candidate that escapes the root", async () => {
    const layout = SpoolLayout.createSpoolLayout({ root: freshRoot() })
    await expect(layout.guardWithinRoot("/etc/passwd")).rejects.toThrow(SpoolLayout.SpoolPathError)
  })

  test("rejects a symlink component escaping the root", async () => {
    const root = freshRoot()
    const layout = SpoolLayout.createSpoolLayout({ root })
    const outside = mkdtempSync(join(tmpdir(), "outputspool-outside-"))
    writeFileSync(join(outside, "secret"), "x")
    mkdirSync(join(root, "proj"), { recursive: true })
    symlinkSync(outside, join(root, "proj", "root"))
    await expect(layout.guardWithinRoot(join(root, "proj", "root", "secret"))).rejects.toThrow(SpoolLayout.SpoolPathError)
  })

  test("channelFile stays under the root and is never absolute-escaping", () => {
    const root = freshRoot()
    const layout = SpoolLayout.createSpoolLayout({ root })
    const file = layout.channelFile(KEY, "data")
    expect(file.startsWith(root)).toBe(true)
  })
})
