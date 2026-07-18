import { describe, expect, test } from "bun:test"
import type { ReadPage } from "@opencode-ai/protocol/outputspool/commands"
import { decodeBoundedText, derivePageView, MAX_PREVIEW_BYTES, type LoadedOutputPage } from "./page"

function page(overrides: Partial<ReadPage> = {}): ReadPage {
  return {
    bytes: new TextEncoder().encode("hello output"),
    nextOffset: 12,
    committedBytes: 12,
    caughtUp: true,
    eof: false,
    ...overrides,
  }
}

describe("output-panel page decode + projection (FR20-FR22, C15, C20, C22)", () => {
  test("decodeBoundedText decodes a Uint8Array to UTF-8 text", () => {
    expect(decodeBoundedText(new TextEncoder().encode("hi"))).toEqual({ text: "hi", truncated: false })
  })

  test("decodeBoundedText tolerates a plain numeric array and a numeric-keyed record", () => {
    const bytes = Array.from(new TextEncoder().encode("hi"))
    expect(decodeBoundedText(bytes).text).toBe("hi")
    const record = Object.fromEntries(bytes.map((value, index) => [String(index), value]))
    expect(decodeBoundedText(record).text).toBe("hi")
  })

  test("decodeBoundedText bounds the preview and reports truncation (C22)", () => {
    const oversized = new Uint8Array(MAX_PREVIEW_BYTES + 10).fill(97)
    const { text, truncated } = decodeBoundedText(oversized)
    expect(text.length).toBe(MAX_PREVIEW_BYTES)
    expect(truncated).toBe(true)
  })

  test("derivePageView projects a plain output.read page with no cursor", () => {
    const loaded: LoadedOutputPage = { page: page(), cursor: null }
    const view = derivePageView(loaded)
    expect(view.text).toBe("hello output")
    expect(view.nextOffsetText).toBe("12")
    expect(view.committedBytesText).toBe("12")
    expect(view.caughtUpText).toBe("caught up")
    expect(view.eofText).toBe("open")
    expect(view.cursor).toBeNull()
  })

  test("derivePageView carries the resume cursor from an output.follow page", () => {
    const loaded: LoadedOutputPage = { page: page({ eof: true }), cursor: "cursor-token" }
    const view = derivePageView(loaded)
    expect(view.eofText).toBe("eof")
    expect(view.cursor).toBe("cursor-token")
  })
})
