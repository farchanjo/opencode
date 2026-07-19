import { describe, expect, test } from "bun:test"
import { McpCatalog } from "@/mcp/catalog"

// Drive McpCatalog.paginate directly against scripted cursor pages to prove the
// walk delegates its guard to the core CatalogPolicy (T016/T027): a normal walk
// completes, a duplicate/non-advancing cursor and an unbounded walk fail closed.

describe("catalog walker guard delegation (T027)", () => {
  test("a normal multi-page walk completes and preserves item order", async () => {
    const pages: Record<string, { items: number[]; nextCursor?: string }> = {
      "": { items: [1, 2], nextCursor: "c1" },
      c1: { items: [3, 4], nextCursor: "c2" },
      c2: { items: [5] },
    }
    const out = await McpCatalog.paginate(
      (cursor) => Promise.resolve(pages[cursor ?? ""]),
      (r) => r.items,
    )
    expect(out).toEqual([1, 2, 3, 4, 5])
  })

  test("a non-advancing (repeated) cursor trips the guard and fails closed", async () => {
    const promise = McpCatalog.paginate(
      () => Promise.resolve({ items: [1], nextCursor: "same" }), // always returns the same cursor
      (r) => r.items,
    )
    await expect(promise).rejects.toThrow(/guard tripped/i)
  })

  test("an unbounded walk (ever-changing cursor) trips the max-page bound", async () => {
    let n = 0
    const promise = McpCatalog.paginate(
      () => Promise.resolve({ items: [n], nextCursor: `c${n++}` }),
      (r) => r.items,
    )
    await expect(promise).rejects.toThrow(/guard tripped/i)
  })
})
