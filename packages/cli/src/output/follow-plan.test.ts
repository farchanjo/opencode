import { describe, expect, test } from "bun:test"
import { isFollowEof, nextFollowCursor } from "./follow-plan"

describe("output follow plan", () => {
  test("nextFollowCursor resumes from the response cursor, never rewinding to the original", () => {
    expect(nextFollowCursor({ cursor: "cursor-2" }, "cursor-1")).toBe("cursor-2")
  })

  test("nextFollowCursor falls back to the previous cursor when the frame carries none", () => {
    expect(nextFollowCursor({}, "cursor-1")).toBe("cursor-1")
    expect(nextFollowCursor(null, "cursor-1")).toBe("cursor-1")
  })

  test("isFollowEof is true only when the page reports eof", () => {
    expect(isFollowEof({ page: { eof: true } })).toBe(true)
    expect(isFollowEof({ page: { eof: false } })).toBe(false)
    expect(isFollowEof({ page: { caughtUp: true } })).toBe(false)
    expect(isFollowEof(null)).toBe(false)
  })
})
