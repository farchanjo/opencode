import { fallback, isRecord, yesNo } from "../operator/output"

/**
 * Feature 001 / T033 — human renderers for the routing command surface.
 * Pure over the redacted RoutingPort response views (status/explain/test/
 * capabilityInspect). No model call is ever made to produce these.
 */

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function renderStatus(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const enabled = effective.enabled === true ? "enabled" : "disabled"
  const lines = [`routing: ${enabled} (mode ${String(effective.mode ?? "unknown")})`]
  lines.push(`strict gates: ${yesNo(effective.strictGates)}`)
  const pool = asArray(effective.decisionModelPool).map(String)
  if (pool.length) lines.push(`decision pool: ${pool.join(", ")}`)
  if (isRecord(effective.rolePools)) {
    for (const [role, models] of Object.entries(effective.rolePools)) {
      lines.push(`  ${role}: ${asArray(models).map(String).join(", ")}`)
    }
  }
  if (effective.catalogVersion !== undefined || effective.policyVersion !== undefined) {
    lines.push(`catalog: ${String(effective.catalogVersion ?? "-")}  policy: ${String(effective.policyVersion ?? "-")}`)
  }
  if (effective.health !== undefined) {
    const reason = effective.reason ? ` (${String(effective.reason)})` : ""
    lines.push(`health: ${String(effective.health)}${reason}`)
  }
  if (effective.offline !== undefined) lines.push(`offline: ${yesNo(effective.offline)}`)
  if (effective.recommendedAction) lines.push(`recommended: ${String(effective.recommendedAction)}`)
  return lines.join("\n")
}

function candidateLine(candidate: unknown): string {
  if (!isRecord(candidate)) return `  ${String(candidate)}`
  const rank = candidate.rank ?? "?"
  const agent = String(candidate.agentId ?? "-")
  const model = String(candidate.modelId ?? "-")
  const score = candidate.score !== undefined ? ` score=${String(candidate.score)}` : ""
  return `  #${rank} ${agent} / ${model}${score}`
}

export function renderExplain(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`decision ${String(effective.decisionId ?? "-")}`]
  lines.push(`class: ${String(effective.taskClass ?? "-")}  profile: ${String(effective.routingProfile ?? "-")}`)
  if (effective.selectedAgent !== undefined || effective.selectedModel !== undefined) {
    const confidence = effective.confidence !== undefined ? ` (confidence ${String(effective.confidence)})` : ""
    lines.push(
      `selected: ${String(effective.selectedAgent ?? "-")} / ${String(effective.selectedModel ?? "-")}${confidence}`,
    )
  }
  lines.push(`decision model called: ${yesNo(effective.decisionModelCalled)}`)
  const candidates = asArray(effective.candidates)
  if (candidates.length) {
    lines.push(`candidates: ${candidates.length}`)
    lines.push(...candidates.map(candidateLine))
  }
  if (effective.fallbackAttempted !== undefined) {
    const reason = effective.fallbackReason ? ` (${String(effective.fallbackReason)})` : ""
    lines.push(`fallback: ${yesNo(effective.fallbackAttempted)}${reason}`)
  }
  return lines.join("\n")
}

export function renderTest(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`class: ${String(effective.taskClass ?? "-")}  profile: ${String(effective.routingProfile ?? "-")}`]
  const candidates = asArray(effective.authorizedCandidates)
  lines.push(`authorized candidates: ${candidates.length}`)
  lines.push(...candidates.map(candidateLine))
  // The routing baseline is a deterministic local simulation; state it plainly.
  lines.push("no external model call was made")
  return lines.join("\n")
}

function dimensionsLine(dimensions: unknown): string | undefined {
  if (!isRecord(dimensions)) return undefined
  const parts = Object.entries(dimensions).map(([name, value]) => `${name}=${value === null ? "?" : String(value)}`)
  return parts.length ? `    dimensions: ${parts.join(" ")}` : undefined
}

function recordLines(record: unknown): string[] {
  if (!isRecord(record)) return [`  ${String(record)}`]
  const header = `  ${String(record.modelId ?? record.model_id ?? "-")} source=${String(record.source ?? "-")} confidence=${String(record.confidence ?? "-")}`
  const dims = dimensionsLine(record.dimensions)
  return dims ? [header, dims] : [header]
}

export function renderCapabilityInspect(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const records = asArray(effective.records)
  const lines = [`capability records: ${records.length}`]
  for (const record of records) lines.push(...recordLines(record))
  return lines.join("\n")
}

export * as RoutingRender from "./render"
