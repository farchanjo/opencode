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

/**
 * Per-group render state for the Feature 016 compact status (FR2). A populated
 * group renders in full; an empty group collapses into the single summary line.
 * `loading`/`unavailable` are decided by the read's load/availability flags at the
 * renderer, never per group here (mirrors `operator-screen-layout` `#StatusGroupState`).
 */
export type OperatorStatusGroupState = "populated" | "empty"

/** One status group: its key/value leaf plus whether it is populated or empty (FR2). */
export interface OperatorStatusGroup {
  readonly key: string
  readonly value: string
  readonly state: OperatorStatusGroupState
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
 * Classify one opaque status value as populated or empty (FR2). A `null`/absent
 * value, an empty string, an empty array, or an empty object reports `empty` — the
 * "no <thing> configured" cases that collapse into the summary line; any scalar
 * (including `false`/`0`) or non-empty container is `populated`. Never throws.
 */
function statusGroupState(raw: unknown): OperatorStatusGroupState {
  if (raw === null || raw === undefined) return "empty"
  if (typeof raw === "string") return raw.length === 0 ? "empty" : "populated"
  if (Array.isArray(raw)) return raw.length === 0 ? "empty" : "populated"
  if (isRecord(raw)) return Object.keys(raw).length === 0 ? "empty" : "populated"
  return "populated"
}

/**
 * Project a plain domain's effective status payload into bounded status groups
 * carrying their populated/empty state (FR2). Same total, side-effect-free,
 * bounded contract as `toStatusNodes`; a non-record payload yields the honest
 * empty list.
 */
export function toStatusGroups(effective: unknown): readonly OperatorStatusGroup[] {
  if (!isRecord(effective)) return []
  const groups: OperatorStatusGroup[] = []
  for (const [key, raw] of Object.entries(effective)) {
    if (groups.length >= MAX_STATUS_NODES) break
    groups.push({ key, value: formatStatusValue(raw), state: statusGroupState(raw) })
  }
  return groups
}

/**
 * The single collapsed line summarising the empty status groups (FR2), e.g.
 * `servers · resources · experimental · calls: empty`. Returns `undefined` when no
 * group is empty, so the renderer omits the line entirely. Names only the group
 * labels, never their would-be values (content-free).
 */
export function statusEmptySummary(groups: readonly OperatorStatusGroup[]): string | undefined {
  const empty = groups.filter((group) => group.state === "empty").map((group) => group.key)
  if (empty.length === 0) return undefined
  return `${empty.join(" · ")}: empty`
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
