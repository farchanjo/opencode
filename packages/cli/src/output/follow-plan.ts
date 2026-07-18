import { isRecord } from "../operator/output"

/**
 * Feature 005 / T038 (S26) — pure cursor-reconnect logic for `output follow`.
 *
 * Extracted from `./follow.ts` so the "resume from the LAST returned cursor,
 * never the original one" contract (C14, C18) is directly unit-testable
 * without an Effect/Dispatch harness, mirroring `../process/poll.ts`'s split
 * between cadence and terminal-state detection.
 */
export * as OutputFollowPlan from "./follow-plan"

/** Resolve the cursor for the NEXT `output.follow` call: the frame's cursor, or the previous one on absence — never rewinds. */
export function nextFollowCursor(effective: unknown, previousCursor: string): string {
  if (!isRecord(effective)) return previousCursor
  const cursor = effective.cursor
  return typeof cursor === "string" && cursor.length > 0 ? cursor : previousCursor
}

/** True when the followed page has reached `eof` (sealed/aborted and fully consumed; C20). */
export function isFollowEof(effective: unknown): boolean {
  if (!isRecord(effective)) return false
  const page = (effective as { readonly page?: unknown }).page
  return isRecord(page) && page.eof === true
}
