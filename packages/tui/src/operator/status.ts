/**
 * Pure status projection for the Feature 015 inline StatusSection (FR4).
 *
 * Projects an opaque, already-redacted operator `effective` payload into a
 * bounded key/value node list for the generic renderer used by the plain
 * (non-rich-panel) domain screens. Total and side-effect free: an absent or
 * non-record payload yields the honest empty list, never a throw or a fabricated
 * value, mirroring the `view.cue` `#ViewTree` shape and the per-domain panel
 * projections' honest-empty contract (../projection.ts).
 */
import { isRecord } from "./projection"

/** One key/value leaf of the inline status projection (mirrors `view.cue #ViewNode`). */
export interface OperatorStatusNode {
  readonly key: string
  readonly value: string
}

/** Max key/value rows rendered inline — bounded like the rich panels' row caps. */
export const MAX_STATUS_NODES = 24

/** Max rendered length of a single value before it is truncated with an ellipsis. */
export const MAX_STATUS_VALUE = 80

/**
 * Project a plain domain's effective status payload into bounded key/value rows.
 * A non-record (absent/scalar/array) payload degrades to the honest empty list;
 * nested objects/arrays render as bounded `{n}`/`[n]` summaries, never expanded
 * — no secret or raw payload body is widened here.
 */
export function toStatusNodes(effective: unknown): readonly OperatorStatusNode[] {
  if (!isRecord(effective)) return []
  const nodes: OperatorStatusNode[] = []
  for (const [key, raw] of Object.entries(effective)) {
    if (nodes.length >= MAX_STATUS_NODES) break
    nodes.push({ key, value: formatStatusValue(raw) })
  }
  return nodes
}

/** Render one opaque value as a bounded, content-free string (never throws). */
function formatStatusValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "—"
  if (typeof raw === "string") return truncate(raw)
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw)
  if (Array.isArray(raw)) return `[${raw.length}]`
  if (isRecord(raw)) return `{${Object.keys(raw).length}}`
  // JSON effective payloads never carry these; only `symbol`/`function` remain here.
  return typeof raw === "symbol" ? truncate(raw.toString()) : "function"
}

function truncate(value: string): string {
  return value.length > MAX_STATUS_VALUE ? `${value.slice(0, MAX_STATUS_VALUE - 1)}…` : value
}

/**
 * The command id whose read backs a plain domain's inline StatusSection: every
 * plain domain reads its `<domain>.status` View verb (FR4). Rich domains resolve
 * their read from `READ_PANEL_BY_DOMAIN` instead; this owns the plain convention
 * so the read id is not duplicated.
 */
export function plainStatusReadId(domain: string): string {
  return `${domain}.status`
}
