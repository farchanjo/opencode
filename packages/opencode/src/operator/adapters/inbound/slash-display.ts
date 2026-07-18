/**
 * Redacted operator slash display mapper (T031).
 * Human-readable + structured details; never secret material / raw config expansion.
 * No transcript Message/Part injection. Bounded depth/size.
 */
import {
  isExactSecretRef,
  isSecretFieldName,
  redactSecrets,
  type CommandResult,
  type Outcome,
} from "@opencode-ai/core/operator"

export type OperatorSlashDisplayVariant = "info" | "success" | "warning" | "error"

export type OperatorSlashDisplay = {
  readonly title: string
  readonly message: string
  readonly variant: OperatorSlashDisplayVariant
  readonly outcome: Outcome
  readonly auditPending: boolean
  readonly details: Readonly<Record<string, string | number | boolean | null>>
  readonly injectTranscript: false
}

const OUTCOME_TITLE: Readonly<Record<string, string>> = {
  success: "Operator",
  idempotent_replay: "Operator (replay)",
  conflict: "Operator conflict",
  confirmation_required: "Confirmation required",
  unavailable: "Operator unavailable",
  not_implemented: "Operator not implemented",
  unauthorized: "Operator unauthorized",
  forbidden_scope: "Operator scope denied",
  invalid_argument: "Operator invalid",
  reserved_name: "Reserved name",
  secret_backend: "Secret backend error",
  transport_error: "Operator transport error",
  audit_pending: "Operator (audit pending)",
}

const MAX_DEPTH = 5
const MAX_KEYS = 24
const MAX_STRING = 240
const MAX_ARRAY = 12

function variantFor(outcome: Outcome, ok: boolean): OperatorSlashDisplayVariant {
  if (outcome === "audit_pending") return "warning"
  if (outcome === "confirmation_required") return "warning"
  if (outcome === "conflict") return "warning"
  if (outcome === "unavailable" || outcome === "not_implemented" || outcome === "secret_backend") {
    return "warning"
  }
  if (!ok) return "error"
  if (outcome === "success" || outcome === "idempotent_replay") return "success"
  return "info"
}

function truncateString(s: string): string {
  const redacted = redactSecrets(s)
  if (redacted.length <= MAX_STRING) return redacted
  return `${redacted.slice(0, MAX_STRING)}…`
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") return truncateString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (isExactSecretRef(value)) {
    return {
      backend: value.backend,
      name: value.name,
      version: value.version,
    }
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redactValue(item, depth + 1))
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    let n = 0
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_KEYS) {
        out.__truncated__ = true
        break
      }
      n += 1
      if (isSecretFieldName(key)) {
        if (isExactSecretRef(child)) {
          out[key] = redactValue(child, depth + 1)
        } else {
          out[key] = "[REDACTED]"
        }
        continue
      }
      out[key] = redactValue(child, depth + 1)
    }
    return out
  }
  return String(value)
}

function flattenDetails(value: unknown): Record<string, string | number | boolean | null> {
  const redacted = redactValue(value)
  if (redacted === null) return {}
  if (typeof redacted === "string" || typeof redacted === "number" || typeof redacted === "boolean") {
    return { value: redacted }
  }
  if (typeof redacted !== "object") return {}
  const out: Record<string, string | number | boolean | null> = {}
  let n = 0
  for (const [key, child] of Object.entries(redacted as Record<string, unknown>)) {
    if (n >= MAX_KEYS) break
    n += 1
    if (child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      out[key] = typeof child === "string" ? truncateString(child) : child
      continue
    }
    try {
      out[key] = truncateString(JSON.stringify(child))
    } catch {
      out[key] = "[unserializable]"
    }
  }
  return out
}

/**
 * Map CommandResult to native TUI toast/panel display (no transcript).
 * Never renders arbitrary handler strings without redaction.
 */
export function mapOperatorResultToDisplay(result: CommandResult): OperatorSlashDisplay {
  const outcome = result.outcome
  const auditPending = outcome === "audit_pending"
  const title = OUTCOME_TITLE[outcome] ?? (result.ok ? "Operator" : "Operator error")
  const baseMessage = result.ok
    ? truncateString(`${result.id}: ${outcome}`)
    : truncateString(result.error?.message ?? `${result.id}: ${outcome}`)

  const details: Record<string, string | number | boolean | null> = {
    id: result.id,
    outcome,
  }
  if (result.version !== undefined) details.version = truncateString(result.version)
  if (result.auditId !== undefined) details.auditId = truncateString(result.auditId)
  if (auditPending) details.audit_pending = true

  if (result.error?.details) {
    for (const [key, value] of Object.entries(result.error.details)) {
      if (isSecretFieldName(key)) {
        details[key] = "[REDACTED]"
        continue
      }
      details[key] = typeof value === "string" ? truncateString(value) : value
    }
  }

  if (result.effective !== undefined) {
    const flat = flattenDetails(result.effective)
    for (const [key, value] of Object.entries(flat)) {
      if (key in details) continue
      details[`effective.${key}`] = value
    }
  }

  return {
    title,
    message: baseMessage,
    variant: variantFor(outcome, result.ok),
    outcome,
    auditPending,
    details,
    injectTranscript: false,
  }
}

export function displayToToast(display: OperatorSlashDisplay): {
  title: string
  message: string
  variant: OperatorSlashDisplayVariant
} {
  const suffix = display.auditPending ? " [audit pending]" : ""
  return {
    title: display.title,
    message: `${display.message}${suffix}`,
    variant: display.variant,
  }
}

export * as OperatorSlashDisplay from "./slash-display"
