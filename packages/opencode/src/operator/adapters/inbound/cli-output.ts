/**
 * CLI operator output (T033): human + `--json` envelope, exit codes, redaction.
 * JSON mode: typed envelope only on stdout; diagnostics on stderr.
 */
import {
  failureResult,
  isExactSecretRef,
  isSecretFieldName,
  redactSecrets,
  type CommandResult,
  type Outcome,
} from "@opencode-ai/core/operator"

/**
 * Stable CLI exit codes by outcome taxonomy.
 * audit_pending uses 202 (HTTP-equivalent success-with-pending).
 * confirmation/conflict/unavailable/not_implemented are distinct.
 */
export const CLI_EXIT_BY_OUTCOME: Readonly<Record<Outcome, number>> = {
  success: 0,
  idempotent_replay: 0,
  audit_pending: 202,
  invalid_argument: 40,
  unauthorized: 41,
  forbidden_scope: 43,
  confirmation_required: 44,
  reserved_name: 48,
  conflict: 49,
  not_implemented: 51,
  transport_error: 52,
  unavailable: 53,
  secret_backend: 55,
}

export const CLI_EXIT_CANCELLED = 130
export const CLI_EXIT_USAGE = 64

const MAX_STRING = 240
const MAX_KEYS = 24
const MAX_DEPTH = 5
const MAX_ARRAY = 12

export type CliRenderMode = "human" | "json"

export type CliRenderInput = {
  readonly result: CommandResult
  readonly mode: CliRenderMode
  /** Optional diagnostic (never mixed into JSON stdout). */
  readonly diagnostic?: string
}

export type CliRenderOutput = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export function exitCodeForResult(result: CommandResult): number {
  return CLI_EXIT_BY_OUTCOME[result.outcome] ?? (result.ok ? 0 : 1)
}

export function formatOperatorCli(input: CliRenderInput): CliRenderOutput {
  const exitCode = exitCodeForResult(input.result)
  if (input.mode === "json") {
    const envelope = redactCommandResult(input.result)
    const stdout = `${JSON.stringify(envelope)}\n`
    const stderr = input.diagnostic ? `${redactSecrets(input.diagnostic)}\n` : ""
    return { stdout, stderr, exitCode }
  }

  const human = formatHuman(input.result)
  const diag = input.diagnostic ? `${redactSecrets(input.diagnostic)}\n` : ""
  // Human primary on stdout; diagnostics on stderr.
  return {
    stdout: `${human}\n`,
    stderr: diag,
    exitCode,
  }
}

/**
 * Pre-runner failures (payload byte/depth/file/stdin) — same typed envelope as runner
 * invalid_argument. Never throw generic Error; --json → stdout envelope, exit 40.
 */
export function formatPreRunnerInvalidArgument(input: {
  readonly id: string
  readonly message: string
  readonly mode: CliRenderMode
  readonly details?: Record<string, string | number | boolean | null>
}): CliRenderOutput {
  const result = failureResult({
    id: input.id,
    code: "invalid_argument",
    message: input.message,
    details: { source: "cli", stage: "pre_runner", ...(input.details ?? {}) },
  })
  return formatOperatorCli({ result, mode: input.mode })
}

export function formatHuman(result: CommandResult): string {
  const status = result.ok ? "ok" : "error"
  const lines: string[] = [`${status}  ${result.id}  ${result.outcome}`]
  if (result.version !== undefined) lines.push(`version  ${truncate(redactSecrets(result.version))}`)
  if (result.auditId !== undefined) lines.push(`audit    ${truncate(redactSecrets(result.auditId))}`)
  if (result.outcome === "audit_pending") lines.push("note     audit_pending (CAS committed; audit deferred)")
  if (result.error) {
    lines.push(`code     ${result.error.code}`)
    lines.push(`message  ${truncate(redactSecrets(result.error.message))}`)
  }
  if (result.effective !== undefined) {
    const flat = flattenDetails(result.effective)
    for (const [key, value] of Object.entries(flat)) {
      lines.push(`  ${key}=${formatScalar(value)}`)
    }
  }
  return lines.join("\n")
}

/** Redact free text; keep exact SecretRef shape only (no material expansion). */
export function redactCommandResult(result: CommandResult): CommandResult {
  return {
    ok: result.ok,
    id: result.id,
    kind: "operator.admin_result",
    outcome: result.outcome,
    ...(result.version !== undefined ? { version: redactSecrets(result.version) } : {}),
    ...(result.auditId !== undefined ? { auditId: redactSecrets(result.auditId) } : {}),
    ...(result.effective !== undefined ? { effective: redactValue(result.effective) } : {}),
    ...(result.error
      ? {
          error: {
            code: result.error.code,
            message: redactSecrets(result.error.message),
            retryable: result.error.retryable,
            ...(result.error.details
              ? {
                  details: Object.fromEntries(
                    Object.entries(result.error.details).map(([k, v]) => {
                      if (isSecretFieldName(k)) return [k, "[REDACTED]"] as const
                      return [k, typeof v === "string" ? redactSecrets(v) : v] as const
                    }),
                  ),
                }
              : {}),
          },
        }
      : {}),
  }
}

function formatScalar(value: string | number | boolean | null): string {
  if (value === null) return "null"
  if (typeof value === "string") return truncate(redactSecrets(value))
  return String(value)
}

function truncate(s: string): string {
  if (s.length <= MAX_STRING) return s
  return `${s.slice(0, MAX_STRING)}…`
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") return truncate(redactSecrets(value))
  if (typeof value === "number" || typeof value === "boolean") return value
  if (isExactSecretRef(value)) {
    return { backend: value.backend, name: value.name, version: value.version }
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
        out[key] = isExactSecretRef(child) ? redactValue(child, depth + 1) : "[REDACTED]"
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
      out[key] = typeof child === "string" ? truncate(redactSecrets(child)) : child
      continue
    }
    try {
      out[key] = truncate(JSON.stringify(child))
    } catch {
      out[key] = "[unserializable]"
    }
  }
  return out
}

export * as OperatorCliOutput from "./cli-output"
