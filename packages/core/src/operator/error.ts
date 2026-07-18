/**
 * Closed operator error taxonomy (Feature 007 / T009).
 * Codes from contracts/command-envelope.md — no free-string codes on dispatcher path.
 */
import { Option, Schema } from "effect"

export const ERROR_CODES = [
  "unauthorized",
  "forbidden_scope",
  "conflict",
  "idempotent_replay",
  "invalid_argument",
  "reserved_name",
  "confirmation_required",
  "unavailable",
  "secret_backend",
  "transport_error",
  "not_implemented",
] as const

export const ErrorCode = Schema.Literals([...ERROR_CODES]).annotate({
  identifier: "Operator.ErrorCode",
})
export type ErrorCode = typeof ErrorCode.Type

/** HTTP status mapping for API adapters (informational for V1 core). */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthorized: 401,
  forbidden_scope: 403,
  conflict: 409,
  idempotent_replay: 200,
  invalid_argument: 400,
  reserved_name: 409,
  confirmation_required: 400,
  unavailable: 503,
  secret_backend: 503,
  transport_error: 502,
  not_implemented: 501,
}

export const OperatorError = Schema.Struct({
  code: ErrorCode,
  message: Schema.String,
  retryable: Schema.Boolean,
  /** Redacted structured details; never secrets/paths with secret material. */
  details: Schema.optional(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])),
  ),
}).annotate({ identifier: "Operator.Error" })
export type OperatorError = typeof OperatorError.Type

const decodeCode = Schema.decodeUnknownOption(ErrorCode)
const decodeError = Schema.decodeUnknownOption(OperatorError)

export type ParseOk<T> = { readonly ok: true; readonly value: T }
export type ParseFail = { readonly ok: false; readonly reason: string }
export type ParseResult<T> = ParseOk<T> | ParseFail

export function isErrorCode(input: unknown): input is ErrorCode {
  return Option.isSome(decodeCode(input))
}

export function parseErrorCode(input: unknown): ParseResult<ErrorCode> {
  const decoded = decodeCode(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "unknown operator error code" }
  }
  return { ok: true, value: decoded.value }
}

export function parseOperatorError(input: unknown): ParseResult<OperatorError> {
  const decoded = decodeError(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid operator error shape" }
  }
  return { ok: true, value: decoded.value }
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["unavailable", "transport_error", "secret_backend", "conflict"])

export function defaultRetryable(code: ErrorCode): boolean {
  return RETRYABLE.has(code)
}

/**
 * Build a structured error. Message is redacted of common secret patterns.
 * Details values are stringified scalars only (no nested objects).
 */
export function makeOperatorError(input: {
  code: ErrorCode
  message: string
  retryable?: boolean
  details?: Readonly<Record<string, string | number | boolean | null>>
}): OperatorError {
  const message = redactSecrets(input.message)
  const details = input.details ? redactDetails(input.details) : undefined
  return {
    code: input.code,
    message,
    retryable: input.retryable ?? defaultRetryable(input.code),
    ...(details ? { details } : {}),
  }
}

/**
 * Redact likely secret material from free-text messages.
 * Covers key=value, Bearer, PEM, JWT, high-entropy tokens, common credential shapes.
 */
export function redactSecrets(text: string): string {
  let out = text
  out = out.replace(/(api[_-]?key|token|secret|password|authorization|passwd|passphrase)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
  out = out.replace(/\b(sk|pk|rk|ghp|gho|ghu|ghs|ghr|xox[baprs])[-_][A-Za-z0-9]{8,}\b/g, "[REDACTED]")
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
  out = out.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PEM]")
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
  // High-entropy-ish blobs (base64-ish, length >= 32)
  out = out.replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, (m) => {
    if (/^[A-Za-z]+$/.test(m) || /^[0-9]+$/.test(m)) return m
    const unique = new Set(m).size
    if (unique >= 12) return "[REDACTED]"
    return m
  })
  return out
}

function redactDetails(
  details: Readonly<Record<string, string | number | boolean | null>>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (/secret|token|password|authorization|api[_-]?key|private|credential|passwd/i.test(key)) {
      out[key] = "[REDACTED]"
      continue
    }
    out[key] = typeof value === "string" ? redactSecrets(value) : value
  }
  return out
}

export * as OperatorErrorModule from "./error"
