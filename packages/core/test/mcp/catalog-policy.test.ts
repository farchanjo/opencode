import { describe, expect, test } from "bun:test"
import { CatalogPolicy } from "@opencode-ai/core/mcp/catalog-policy"

// Feature 008 / T016 (S8) — the catalog paginated-walk policy: a normal walk reaches
// fresh, a duplicate/non-advancing cursor and a max-page breach reach guard_tripped
// fail-closed retaining prior defs, and list_changed restarts at stale (FR10, FR11, C4).

describe("CatalogPolicy — normal paginated walk (C4)", () => {
  test("a walk that runs to a null next cursor completes fresh and may replace defs", () => {
    let guard = CatalogPolicy.initialGuard(10)
    expect(CatalogPolicy.beginWalk()).toBe("walking")
    const step1 = CatalogPolicy.nextPage(guard, "cursor-1")
    expect(step1.kind).toBe("advance")
    if (step1.kind === "advance") guard = step1.guard
    const step2 = CatalogPolicy.nextPage(guard, "cursor-2")
    expect(step2.kind).toBe("advance")
    if (step2.kind === "advance") guard = step2.guard
    const final = CatalogPolicy.nextPage(guard, null)
    expect(final.kind).toBe("complete")
    expect(CatalogPolicy.resolveState(final)).toBe("fresh")
    expect(CatalogPolicy.mayReplaceDefs("fresh")).toBe(true)
  })
})

describe("CatalogPolicy — guard fails closed (C4)", () => {
  test("a duplicate cursor trips the guard and retains prior defs", () => {
    let guard = CatalogPolicy.initialGuard(10)
    const step1 = CatalogPolicy.nextPage(guard, "cursor-1")
    if (step1.kind === "advance") guard = step1.guard
    const repeat = CatalogPolicy.nextPage(guard, "cursor-1")
    expect(repeat).toMatchObject({ kind: "guard_tripped", reason: "duplicate_cursor" })
    expect(CatalogPolicy.resolveState(repeat)).toBe("guard_tripped")
    expect(CatalogPolicy.mayReplaceDefs("guard_tripped")).toBe(false)
  })

  test("a max-page breach trips the guard fail-closed", () => {
    let guard = CatalogPolicy.initialGuard(2)
    const step1 = CatalogPolicy.nextPage(guard, "cursor-1")
    expect(step1.kind).toBe("advance")
    if (step1.kind === "advance") guard = step1.guard
    const breach = CatalogPolicy.nextPage(guard, "cursor-2")
    expect(breach).toMatchObject({ kind: "guard_tripped", reason: "max_page_exceeded" })
  })
})

describe("CatalogPolicy — list_changed restarts at stale (FR11, C4)", () => {
  test("a list_changed notification restarts the refresh regardless of current state", () => {
    expect(CatalogPolicy.onListChanged()).toBe("stale")
  })
})
