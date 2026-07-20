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

// ── Feature 017 T006 — detail view tree (FR23) ──────────────────────────────
// A renderer DISTINCT from the compact strip above: the view modal expands nested
// records/arrays to a bounded depth + row budget with an honest "… N more"
// truncation marker, so a probe result shows its `endpoint`/`transport` fields
// instead of the strip's `{2}` count placeholder. The `toStatusNodes`/
// `formatStatusValue`/`toStatusGroups` compact contract above stays unchanged.

/** One indented row of the detail view tree (mirrors `operator-capability-gaps` `#DetailTree`). */
export interface OperatorDetailRow {
  /** Indentation level; the top-level entries are depth 0. */
  readonly depth: number
  /** The entry key or `[i]` array index; empty on a truncation marker row. */
  readonly label: string
  /** A scalar's verbatim (capped) rendering, a branch's `… N more`, or `""` for an expandable header. */
  readonly value: string
  /** True when the row heads an expanded record/array (rendered without a value). */
  readonly branch: boolean
  /** True when the row is an honest `… N more` truncation marker (depth or row-budget bound). */
  readonly truncation: boolean
}

/** Levels the detail tree expands before a nested container collapses to `… N more` (FR23). */
export const MAX_DETAIL_DEPTH = 4

/** Total rows the detail tree renders before the remaining siblings collapse to `… N more` (FR23). */
export const MAX_DETAIL_ROWS = 200

/** The record/array child entries of a value, or `undefined` for a scalar leaf. */
function detailEntries(value: unknown): readonly { readonly label: string; readonly value: unknown }[] | undefined {
  if (Array.isArray(value)) return value.map((item, index) => ({ label: `[${index}]`, value: item }))
  if (isRecord(value)) return Object.entries(value).map(([label, item]) => ({ label, value: item }))
  return undefined
}

/** Render one scalar leaf verbatim under the shared string cap; never a `{n}`/`[n]` count (FR23). */
function formatDetailScalar(raw: unknown): string {
  if (raw === undefined) return "—"
  if (raw === null) return "null"
  if (typeof raw === "string") return truncate(raw)
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw)
  return typeof raw === "symbol" ? truncate(raw.toString()) : "function"
}

/** A `… N more` truncation marker row at `depth` for `hidden` collapsed items (FR23). */
function truncationRow(depth: number, hidden: number): OperatorDetailRow {
  return { depth, label: "", value: `… ${hidden} more`, branch: false, truncation: true }
}

/** DFS-append a container's children into `rows`, honoring the depth and row-budget bounds (FR23). */
function appendDetailChildren(
  rows: OperatorDetailRow[],
  entries: readonly { readonly label: string; readonly value: unknown }[],
  depth: number,
  maxDepth: number,
  maxRows: number,
): void {
  for (let index = 0; index < entries.length; index++) {
    if (rows.length >= maxRows) return // a prior sibling already emitted the marker
    const remaining = entries.length - index
    // Reserve the last slot for the honest marker when more than one item remains.
    if (rows.length >= maxRows - 1 && remaining > 1) {
      rows.push(truncationRow(depth, remaining))
      return
    }
    const { label, value } = entries[index]
    const children = detailEntries(value)
    if (!children) {
      rows.push({ depth, label, value: formatDetailScalar(value), branch: false, truncation: false })
      continue
    }
    if (children.length === 0) {
      rows.push({ depth, label, value: Array.isArray(value) ? "(empty)" : "(none)", branch: false, truncation: false })
      continue
    }
    if (depth + 1 >= maxDepth) {
      // At the depth bound the container collapses to an honest count marker on its
      // own header row — never a `{n}` placeholder within the bound.
      rows.push({ depth, label, value: `… ${children.length} more`, branch: true, truncation: true })
      continue
    }
    rows.push({ depth, label, value: "", branch: true, truncation: false })
    appendDetailChildren(rows, children, depth + 1, maxDepth, maxRows)
  }
}

/**
 * Project an opaque, already-redacted operator `effective` payload into an indented
 * detail tree (FR23). Records and arrays expand to `maxDepth` levels and `maxRows`
 * total rows; anything deeper or beyond the budget collapses to an honest `… N more`
 * marker. A non-record/array payload renders as a single verbatim scalar row; an
 * absent payload yields the honest empty list. No secret or raw body is widened —
 * scalars pass through the same string cap as the compact strip.
 */
export function toDetailTree(
  effective: unknown,
  maxDepth: number = MAX_DETAIL_DEPTH,
  maxRows: number = MAX_DETAIL_ROWS,
): readonly OperatorDetailRow[] {
  const entries = detailEntries(effective)
  if (!entries) {
    if (effective === undefined) return []
    return [{ depth: 0, label: "", value: formatDetailScalar(effective), branch: false, truncation: false }]
  }
  const rows: OperatorDetailRow[] = []
  appendDetailChildren(rows, entries, 0, maxDepth, maxRows)
  return rows
}
