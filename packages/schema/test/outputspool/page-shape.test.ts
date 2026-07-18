import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Page } from "../../src/outputspool/page"

// Feature 005 / T041 (S27) — the read-page wire shape (FR20, FR21, C15, AC2,
// AC3). Mirrors doc/arch/schemas/outputspool/page.cue: a read request carries a
// mandatory server-capped `limit`; the response carries `eof` and `caught_up` as
// two distinct boolean fields; no path is ever accepted or returned.

describe("Page.ReadRequest — mandatory server-capped limit, no path (FR20, C3)", () => {
  test("decodes a bounded request with offset and limit", () => {
    const req = { output_ref: "or_abc", offset: 0, limit: 65536 }
    const decoded = Schema.decodeUnknownSync(Page.ReadRequest)(req)
    expect(decoded.limit).toBe(65536)
    expect(decoded.offset).toBe(0)
  })

  test("limit is required — a request without a limit is rejected", () => {
    const req = { output_ref: "or_abc", offset: 0 }
    expect(() => Schema.decodeUnknownSync(Page.ReadRequest)(req)).toThrow()
  })

  test("limit must be a positive integer, never zero or fractional", () => {
    expect(() => Schema.decodeUnknownSync(Page.ReadRequest)({ output_ref: "or_abc", offset: 0, limit: 0 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Page.ReadRequest)({ output_ref: "or_abc", offset: 0, limit: 1.5 })).toThrow()
  })

  test("no path field exists on the request", () => {
    expect(Object.keys(Page.ReadRequest.fields)).not.toContain("path")
    expect(Object.keys(Page.ReadRequest.fields)).not.toContain("file_path")
  })
})

describe("Page.ReadPage — eof distinct from caught_up (FR21, AC2, AC3)", () => {
  test("eof and caught_up are two separate boolean fields", () => {
    const keys = Object.keys(Page.ReadPage.fields)
    expect(keys).toContain("eof")
    expect(keys).toContain("caught_up")
    expect(keys).not.toContain("path")
  })

  test("an open-stream page is caught_up without eof", () => {
    const page = {
      range: { offset: 0, limit: 1024, length: 10 },
      next_offset: 10,
      committed_bytes: 10,
      caught_up: true,
      eof: false,
    }
    const decoded = Schema.decodeUnknownSync(Page.ReadPage)(page)
    expect(decoded.caught_up).toBe(true)
    expect(decoded.eof).toBe(false)
  })

  test("a sealed consumed page is eof true", () => {
    const page = {
      range: { offset: 0, limit: 1024, length: 10 },
      next_offset: 10,
      committed_bytes: 10,
      caught_up: true,
      eof: true,
    }
    expect(Schema.decodeUnknownSync(Page.ReadPage)(page).eof).toBe(true)
  })
})
