// Pure text-plus-theme card projection for the direct-child process panel
// (Feature 002 / T036, FR52–FR58). No I/O, no solid-js — safe to recompute on
// every render, mirroring packages/tui/src/smart/label.ts (spec item 32:
// text-first, never color-only; C22).
//
// Source of truth for the row shape: the COMMITTED `packages/schema/src/
// lifecycle/process-row.ts` (`Row.ProcessRow`), not the draft
// `doc/arch/sdd/.../contracts/ports.ts` wire mirror.

import type { EnumsObservation } from "@opencode-ai/schema/lifecycle/enums-observation"
import type { Row } from "@opencode-ai/schema/lifecycle/process-row"

/** Allowlisted bounded activity (FR56); absent path/prompt/tool payload by construction. */
export interface ProcessCardActivity {
  readonly kind: EnumsObservation.ActivityKind
  /** Workspace-relative or otherwise already-redacted detail; never an absolute path/URL/prompt (FR56). */
  readonly detail: string | null
}

/**
 * One row plus its (optional) live activity snapshot. `activity` is not part
 * of the durable `ProcessRow` projection — it is a live-event side channel
 * the observation service (T026) will eventually push. Until that transport
 * exists, callers pass `null` (honest unavailable state, never fabricated).
 */
export interface ProcessCardInput {
  readonly row: Row.ProcessRow
  readonly activity: ProcessCardActivity | null
}

export interface ProcessCardView {
  readonly processId: string
  readonly taskId: string
  /** Textual status; independent of any color coding (AC34). */
  readonly statusText: string
  readonly isTerminal: boolean
  readonly agentLabel: string
  readonly hierarchyRole: EnumsObservation.HierarchyRole | null
  readonly validationOutcome: EnumsObservation.ValidationOutcome | null
  readonly modelLabel: string
  /** "streaming/generating" + "tokens unavailable" when no live usage signal exists (FR55, AC25). */
  readonly usageText: string
  readonly activityText: string
  readonly childCount: number
}

const TERMINAL_STATES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "zombie", "unknown"])

function usageText(row: Row.ProcessRow): string {
  const usage = row.accounting.usage.usage
  if (!usage.available) return "streaming/generating · tokens unavailable"
  const tokens = [usage.tokens.input, usage.tokens.output, usage.tokens.reasoning].filter(
    (value): value is number => typeof value === "number",
  )
  if (tokens.length === 0) return `${usage.provenance.provenance} · tokens unavailable`
  const total = tokens.reduce((sum, value) => sum + value, 0)
  const rate = usage.tokens_per_second !== null ? ` · ${usage.tokens_per_second.toFixed(1)} tok/s` : ""
  return `${usage.provenance.provenance}/${usage.provenance.source} · ${total} tokens${rate}`
}

function activityText(activity: ProcessCardActivity | null): string {
  if (!activity) return "activity unavailable"
  const label = ACTIVITY_LABEL[activity.kind]
  return activity.detail ? `${label} ${activity.detail}` : label
}

const ACTIVITY_LABEL: Record<EnumsObservation.ActivityKind, string> = {
  read: "Read",
  edit: "Edit",
  run_command: "Run command",
  search: "Search",
  waiting: "Waiting",
  generating: "Generating",
  settling: "Settling",
}

/** Derive the bounded, redacted card view rendered for one direct-child row. */
export function deriveCardView(input: ProcessCardInput): ProcessCardView {
  const { row } = input
  return {
    processId: row.id,
    taskId: row.identity.task_id,
    statusText: row.status.state,
    isTerminal: TERMINAL_STATES.has(row.status.state),
    agentLabel: row.profile.classification.agent_name,
    hierarchyRole: row.hierarchy?.role ?? null,
    validationOutcome: row.hierarchy?.validation_outcome ?? null,
    modelLabel: row.profile.model.variant
      ? `${row.profile.model.provider}/${row.profile.model.model} (${row.profile.model.variant})`
      : `${row.profile.model.provider}/${row.profile.model.model}`,
    usageText: usageText(row),
    activityText: activityText(input.activity),
    childCount: row.lineage.graph.children.length,
  }
}

export * as ProcessCard from "./card"
