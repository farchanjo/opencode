/**
 * Feature 008 / T016 (S8) — the tool-catalog paginated-walk policy.
 *
 * Encodes the closed `stale → walking → fresh` refresh machine with a
 * duplicate-cursor guard and a max-page bound drawn in `plan.md` "State machines"
 * and `pagination.cue` (FR10, FR11, C4). Pure and deterministic, no I/O: the
 * `packages/opencode` catalog adapter drives the `tools/list` wire calls and feeds
 * each page cursor into this decision engine.
 *
 * The guard fails CLOSED: a repeated or non-advancing cursor, or a walk that
 * breaches the max-page bound, enters `guard_tripped` with a typed reason and the
 * prior `defs[server]` is retained — never partially replaced (C4). A `list_changed`
 * notification restarts the walk at `stale`; a completed walk replaces `defs[server]`
 * and emits the durable `mcp.tools_changed` (the emission is the adapter's, this
 * module only decides `fresh`).
 */
export * as CatalogPolicy from "./catalog-policy"

import type { CatalogState } from "@opencode-ai/schema/mcp/enums-state"

export type { CatalogState }

/** The bounded pagination guard: the max-page cap and the last-seen cursor (FR10, C4). */
export interface PaginationGuard {
  readonly maxPages: number
  readonly seenCursor: string | null
  readonly pageIndex: number
}

/** A fresh guard at the start of a walk — no cursor seen yet, page 0 (C4). */
export const initialGuard = (maxPages: number): PaginationGuard =>
  Object.freeze({ maxPages, seenCursor: null, pageIndex: 0 })

/** Why the paginated walk failed closed into `guard_tripped` (C4). */
export type GuardTripReason = "duplicate_cursor" | "non_advancing_cursor" | "max_page_exceeded"

/** The decision for one page of the `tools/list` walk (never thrown). */
export type WalkDecision =
  | { readonly kind: "advance"; readonly guard: PaginationGuard }
  | { readonly kind: "complete" }
  | { readonly kind: "guard_tripped"; readonly reason: GuardTripReason }

/** Begin a paginated walk: `stale → walking`. The prior defs stay live until `complete` (C4). */
export const beginWalk = (): CatalogState => "walking"

/**
 * Decide the next step given the cursor returned by the current page. A `null`
 * next cursor completes the walk (`fresh`); a repeated cursor (equal to the
 * last-seen) or a cursor that fails to advance the page index trips the guard; a
 * page index at/over `maxPages` trips the max-page bound. Otherwise the walk
 * advances with the cursor recorded so the next repeat is caught (FR10, FR11, C4).
 */
export const nextPage = (guard: PaginationGuard, nextCursor: string | null): WalkDecision => {
  if (nextCursor === null) return Object.freeze({ kind: "complete" })
  if (guard.seenCursor !== null && nextCursor === guard.seenCursor) {
    return Object.freeze({ kind: "guard_tripped", reason: "duplicate_cursor" })
  }
  const nextIndex = guard.pageIndex + 1
  if (nextIndex >= guard.maxPages) return Object.freeze({ kind: "guard_tripped", reason: "max_page_exceeded" })
  return Object.freeze({ kind: "advance", guard: Object.freeze({ ...guard, seenCursor: nextCursor, pageIndex: nextIndex }) })
}

/** The terminal state a `WalkDecision` resolves the catalog machine into (C4). */
export const resolveState = (decision: WalkDecision): CatalogState => {
  switch (decision.kind) {
    case "complete":
      return "fresh"
    case "guard_tripped":
      return "guard_tripped"
    case "advance":
      return "walking"
  }
}

/**
 * A `notifications/tools/list_changed` restarts the refresh at `stale` regardless of
 * the current state — a completed `fresh` catalog or a tripped guard both re-walk
 * from scratch on the next change (FR11, C4).
 */
export const onListChanged = (): CatalogState => "stale"

/**
 * Whether a completed walk may replace `defs[server]`. Only a `fresh` outcome
 * replaces the cached shape; a `guard_tripped` outcome retains the prior defs and
 * fails closed (C4). This module never mutates defs — it authorises the adapter.
 */
export const mayReplaceDefs = (state: CatalogState): boolean => state === "fresh"
