/**
 * Feature 005 / T027 (S15) — positional page reader.
 * Asserts a bounded positional page and a concurrent read during append over a
 * sandbox spool file (FR9, FR20, C15, AC2).
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { appendFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PageReader } from "@/outputspool/page-reader"

const freshFile = () => join(mkdtempSync(join(tmpdir(), "outputspool-reader-")), "data")

describe("page-reader", () => {
  test("reads a bounded positional window", async () => {
    const path = freshFile()
    await writeFile(path, "0123456789")
    const page = await PageReader.readPage({ path, offset: 2, limit: 3, committedBytes: 10, sealed: false })
    expect(new TextDecoder().decode(page.bytes)).toBe("234")
    expect(page.next_offset).toBe(5)
    expect(page.eof).toBe(false)
  })

  test("never reads past the committed length even if the file is longer", async () => {
    const path = freshFile()
    await writeFile(path, "0123456789")
    const page = await PageReader.readPage({ path, offset: 0, limit: 100, committedBytes: 4, sealed: true })
    expect(new TextDecoder().decode(page.bytes)).toBe("0123")
    expect(page.eof).toBe(true)
  })

  test("concurrent read during append sees only committed bytes", async () => {
    const path = freshFile()
    await writeFile(path, "abc")
    const readP = PageReader.readPage({ path, offset: 0, limit: 64, committedBytes: 3, sealed: false })
    await appendFile(path, "def")
    const page = await readP
    expect(new TextDecoder().decode(page.bytes)).toBe("abc")
    expect(page.caught_up).toBe(true)
    expect(page.eof).toBe(false)
  })
})
