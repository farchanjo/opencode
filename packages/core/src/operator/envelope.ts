/**
 * Command request/result envelopes (Feature 007 contracts).
 */
import { Option, Schema } from "effect"
import { CommandId } from "./command-id"
import { OperatorPrincipal } from "./principal"
import { OperatorScope } from "./scope"
import { ErrorCode, makeOperatorError, OperatorError } from "./error"

export const CommandSource = Schema.Literals([
  "palette",
  "slash",
  "cli",
  "settings",
  "app",
  "desktop",
  "api",
  "system",
]).annotate({ identifier: "Operator.CommandSource" })
export type CommandSource = typeof CommandSource.Type

export const CommandRequest = Schema.Struct({
  id: CommandId,
  principal: OperatorPrincipal,
  scope: OperatorScope,
  version: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
  confirm: Schema.optional(Schema.Boolean),
  source: CommandSource,
  payload: Schema.optional(Schema.Unknown),
  /** Explicit TTY flag for confirmation policy (CLI). */
  isTty: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "Operator.CommandRequest" })
export type CommandRequest = typeof CommandRequest.Type

export const Outcome = Schema.Literals([
  "success",
  "idempotent_replay",
  "conflict",
  "unauthorized",
  "forbidden_scope",
  "invalid_argument",
  "reserved_name",
  "confirmation_required",
  "unavailable",
  "secret_backend",
  "transport_error",
  "not_implemented",
  /** CAS committed; EventV2 publish deferred/pending reconcile (not silent success). */
  "audit_pending",
]).annotate({ identifier: "Operator.Outcome" })
export type Outcome = typeof Outcome.Type

export const CommandResult = Schema.Struct({
  ok: Schema.Boolean,
  id: Schema.String,
  version: Schema.optional(Schema.String),
  effective: Schema.optional(Schema.Unknown),
  outcome: Outcome,
  auditId: Schema.optional(Schema.String),
  error: Schema.optional(OperatorError),
  /** Admin results must never be Message/Part/transcript types. */
  kind: Schema.Literal("operator.admin_result"),
}).annotate({ identifier: "Operator.CommandResult" })
export type CommandResult = typeof CommandResult.Type

const decodeRequest = Schema.decodeUnknownOption(CommandRequest)
const decodeSource = Schema.decodeUnknownOption(CommandSource)

export type ParseOk<T> = { readonly ok: true; readonly value: T }
export type ParseFail = { readonly ok: false; readonly reason: string }
export type ParseResult<T> = ParseOk<T> | ParseFail

export function parseCommandRequest(input: unknown): ParseResult<CommandRequest> {
  const decoded = decodeRequest(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid command request envelope" }
  }
  return { ok: true, value: decoded.value }
}

export function parseCommandSource(input: unknown): ParseResult<CommandSource> {
  const decoded = decodeSource(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid command source" }
  }
  return { ok: true, value: decoded.value }
}

export function successResult(input: {
  id: string
  version?: string
  effective?: unknown
  auditId?: string
  outcome?: "success" | "idempotent_replay"
}): CommandResult {
  return {
    ok: true,
    id: input.id,
    kind: "operator.admin_result",
    outcome: input.outcome ?? "success",
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.effective !== undefined ? { effective: input.effective } : {}),
    ...(input.auditId !== undefined ? { auditId: input.auditId } : {}),
  }
}

export function failureResult(input: {
  id: string
  code: ErrorCode
  message: string
  retryable?: boolean
  details?: Readonly<Record<string, string | number | boolean | null>>
}): CommandResult {
  const error = makeOperatorError({
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    details: input.details,
  })
  return {
    ok: false,
    id: input.id,
    kind: "operator.admin_result",
    outcome: input.code,
    error,
  }
}

/** Runtime type guard: admin results are never transcript/message types. */
export function isAdminResult(value: unknown): value is CommandResult {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return record.kind === "operator.admin_result" && typeof record.ok === "boolean" && typeof record.id === "string"
}

export function isTranscriptLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const kind = record.kind ?? record.type ?? record.role
  if (typeof kind !== "string") return false
  return (
    kind === "user" ||
    kind === "assistant" ||
    kind === "message" ||
    kind === "part" ||
    kind === "session.message" ||
    kind === "session.part" ||
    kind.startsWith("message.") ||
    kind.startsWith("part.")
  )
}

export * as OperatorEnvelope from "./envelope"
