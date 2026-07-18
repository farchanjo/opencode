import { describe, expect, test } from "bun:test"
import { Paging } from "@opencode-ai/core/outputspool/paging"

// Feature 005 / T019 (S9) — server-capped UTF-8-safe byte-offset paging. Pure; no
// I/O (FR20, FR21, C15, AC2, AC3).

// Bytes for "h" + U+00E9 (a 2-byte UTF-8 sequence 0xC3 0xA9) + "llo": the accented
// codepoint sits at byte offsets [1,2].
const MULTIBYTE = new Uint8Array([0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]) // 6 bytes

describe("Paging — UTF-8 codepoint boundary", () => {
  test("never splits a codepoint at a page boundary", () => {
    // Read a 2-byte window at offset 0: it spans 'h' + the lead byte of the
    // 2-byte codepoint, cutting the codepoint mid-sequence.
    const page = Paging.computePage({
      offset: 0,
      limit: 2,
      page_cap: 1024,
      committed_bytes: MULTIBYTE.length,
      sealed: false,
      window: MULTIBYTE.subarray(0, 2),
    })
    // The incomplete lead byte is trimmed off; the page ends after 'h'.
    expect(page.range.length).toBe(1)
    expect(page.next_offset).toBe(1)
  })

  test("a boundary-aligned window is returned whole", () => {
    const page = Paging.computePage({
      offset: 0,
      limit: 3,
      page_cap: 1024,
      committed_bytes: MULTIBYTE.length,
      sealed: false,
      window: MULTIBYTE.subarray(0, 3),
    })
    // bytes [0..3): ASCII 'h' + the full 2-byte codepoint = 3 bytes, complete.
    expect(page.range.length).toBe(3)
    expect(page.next_offset).toBe(3)
  })

  test("utf8BoundaryLength trims a trailing incomplete sequence", () => {
    expect(Paging.utf8BoundaryLength(new Uint8Array([0x68, 0xc3]))).toBe(1) // ASCII + lead byte only
    expect(Paging.utf8BoundaryLength(new Uint8Array([0x68, 0xc3, 0xa9]))).toBe(3) // ASCII + full sequence
  })
})

describe("Paging — caught_up vs eof", () => {
  const ascii = new TextEncoder().encode("abcdef")

  test("an open stream reports caught_up, never eof", () => {
    const page = Paging.computePage({
      offset: 0,
      limit: 100,
      page_cap: 1024,
      committed_bytes: 6,
      sealed: false,
      window: ascii,
    })
    expect(page.caught_up).toBe(true)
    expect(page.eof).toBe(false)
  })

  test("a sealed consumed channel reports eof", () => {
    const page = Paging.computePage({
      offset: 0,
      limit: 100,
      page_cap: 1024,
      committed_bytes: 6,
      sealed: true,
      window: ascii,
    })
    expect(page.caught_up).toBe(true)
    expect(page.eof).toBe(true)
  })

  test("not-yet-consumed is neither caught_up nor eof", () => {
    const page = Paging.computePage({
      offset: 0,
      limit: 3,
      page_cap: 1024,
      committed_bytes: 6,
      sealed: true,
      window: ascii.subarray(0, 3),
    })
    expect(page.caught_up).toBe(false)
    expect(page.eof).toBe(false)
    expect(page.next_offset).toBe(3)
  })
})

describe("Paging — server cap", () => {
  test("caps the limit to the server page_cap", () => {
    const ascii = new TextEncoder().encode("abcdefghij")
    const page = Paging.computePage({
      offset: 0,
      limit: 1000,
      page_cap: 4,
      committed_bytes: 10,
      sealed: false,
      window: ascii.subarray(0, 4),
    })
    expect(page.range.limit).toBe(4)
    expect(page.range.length).toBe(4)
    expect(page.next_offset).toBe(4)
  })
})
