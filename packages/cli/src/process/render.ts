import { fallback, isRecord, yesNo } from "../operator/output"

/**
 * Feature 002 / T034 — human renderers for the `opencode process` command
 * surface. Pure over the redacted `ProcessPort` response views (status/tree/
 * watch/cancel/steer/handoff, `contracts/ports.ts`). No model call is ever
 * made to produce these; every row is already redacted server-side.
 */

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function usageLine(usage: unknown): string | undefined {
  if (!isRecord(usage)) return undefined
  if (usage.available !== true) return "usage: unavailable"
  const parts: string[] = []
  if (typeof usage.provenance === "string") parts.push(usage.provenance)
  if (typeof usage.source === "string") parts.push(usage.source)
  const tokens = [usage.inputTokens, usage.outputTokens, usage.reasoningTokens]
    .filter((value) => typeof value === "number")
    .reduce((sum: number, value) => sum + (value as number), 0)
  const rate = typeof usage.tokensPerSecond === "number" ? ` (${usage.tokensPerSecond.toFixed(1)} tok/s)` : ""
  return `usage: ${parts.join("/") || "?"} tokens=${tokens}${rate}`
}

/** Render a single `ProcessRow`-shaped payload (accepts either the row directly or `{ row }`). */
export function renderRow(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const row = isRecord(effective.row) ? effective.row : effective
  const lines = [`process ${String(row.processId ?? "-")}: ${String(row.status ?? "unknown")}`]
  lines.push(`task: ${String(row.taskId ?? "-")}  attempt: ${String(row.attempt ?? "-")}  gen: ${String(row.generation ?? "-")}`)
  if (row.agentKind !== undefined || row.model !== undefined) {
    lines.push(`agent: ${String(row.agentKind ?? "-")}  model: ${String(row.provider ?? "-")}/${String(row.model ?? "-")}`)
  }
  if (row.hierarchyRole) lines.push(`role: ${String(row.hierarchyRole)}`)
  if (row.validationOutcome) lines.push(`validation: ${String(row.validationOutcome)}`)
  if (row.terminalReason) lines.push(`terminal reason: ${String(row.terminalReason)}`)
  if (row.cancelOutcome) lines.push(`cancel outcome: ${String(row.cancelOutcome)}`)
  if (row.settlementState) lines.push(`settlement: ${String(row.settlementState)}`)
  const usage = usageLine(row.usage)
  if (usage) lines.push(usage)
  if (row.error) lines.push(`error: ${String(row.error)}`)
  return lines.join("\n")
}

export const renderStatus = renderRow
export const renderWatchFrame = renderRow

function treeLine(node: unknown, depth: number): string[] {
  if (!isRecord(node)) return [`${"  ".repeat(depth)}${String(node)}`]
  const row = isRecord(node.row) ? node.row : node
  const children = asArray(node.childProcessIds)
  const head = `${"  ".repeat(depth)}${String(row.processId ?? "-")} [${String(row.status ?? "unknown")}]${
    row.hierarchyRole ? ` (${String(row.hierarchyRole)})` : ""
  }`
  return [head, ...(children.length ? [`${"  ".repeat(depth + 1)}children: ${children.map(String).join(", ")}`] : [])]
}

export function renderTree(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const nodes = asArray(effective.nodes)
  if (!nodes.length) return "process tree: (empty)"
  return nodes.flatMap((node) => treeLine(node, 0)).join("\n")
}

export function renderCancel(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`cancel outcome: ${String(effective.outcome ?? "unknown")}`]
  if (effective.auditId) lines.push(`audit: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export function renderSteer(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`steer outcome: ${String(effective.outcome ?? "requested")}`]
  if (effective.auditId) lines.push(`audit: ${String(effective.auditId)}`)
  lines.push(`accepted: ${yesNo(effective.accepted ?? effective.outcome === "accepted")}`)
  return lines.join("\n")
}

export function renderHandoff(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`handoff outcome: ${String(effective.outcome ?? "requested")}`]
  if (effective.targetSessionId) lines.push(`target session: ${String(effective.targetSessionId)}`)
  if (effective.auditId) lines.push(`audit: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export * as ProcessRender from "./render"
