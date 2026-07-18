/**
 * Canonical dotted CommandId parser/normalizer (Feature 007 / T006).
 * Form: domain.operation or domain.sub.operation (lowercase, no spaces, no empty segments).
 */
import { Option, Schema } from "effect"

/** Segment: starts with [a-z], then [a-z0-9-]* (no empty, no spaces, no underscores). */
const SEGMENT = /^[a-z][a-z0-9-]*$/

/**
 * Canonical dotted command id: at least two segments separated by `.`.
 * Rejects spaces, empty segments, leading/trailing dots, uppercase, underscores.
 */
export const CommandIdPattern = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

export const CommandId = Schema.String.check(Schema.isPattern(CommandIdPattern)).pipe(Schema.brand("Operator.CommandId"))
export type CommandId = typeof CommandId.Type

const decodeCommandId = Schema.decodeUnknownOption(CommandId)

export type ParseOk<T> = { readonly ok: true; readonly value: T }
export type ParseFail = { readonly ok: false; readonly reason: string }
export type ParseResult<T> = ParseOk<T> | ParseFail

/** Normalize raw input: trim, lowercase, collapse accidental whitespace rejection. */
export function normalizeCommandIdInput(raw: string): string {
  return raw.trim().toLowerCase()
}

export function parseCommandId(input: unknown): ParseResult<CommandId> {
  if (typeof input !== "string") {
    return { ok: false, reason: "command id must be a string" }
  }
  if (input !== input.trim()) {
    return { ok: false, reason: "command id must not have leading or trailing whitespace" }
  }
  if (input.length === 0) {
    return { ok: false, reason: "command id must not be empty" }
  }
  if (/\s/.test(input)) {
    return { ok: false, reason: "command id must not contain spaces" }
  }
  if (input.includes("..") || input.startsWith(".") || input.endsWith(".")) {
    return { ok: false, reason: "command id must not have empty segments" }
  }

  const normalized = normalizeCommandIdInput(input)
  if (normalized !== input) {
    // Uppercase or mixed case: normalize only when structure is otherwise valid
    const segments = normalized.split(".")
    if (segments.length < 2 || segments.some((s) => !SEGMENT.test(s))) {
      return { ok: false, reason: "command id must be dotted lowercase segments (domain.operation)" }
    }
    const decoded = decodeCommandId(normalized)
    if (Option.isNone(decoded)) {
      return { ok: false, reason: "command id failed schema validation" }
    }
    return { ok: true, value: decoded.value }
  }

  const segments = input.split(".")
  if (segments.length < 2) {
    return { ok: false, reason: "command id requires at least domain.operation" }
  }
  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, reason: "command id must not have empty segments" }
    }
    if (!SEGMENT.test(segment)) {
      return {
        ok: false,
        reason: `invalid command id segment "${segment}": use [a-z][a-z0-9-]*`,
      }
    }
  }

  const decoded = decodeCommandId(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "command id failed schema validation" }
  }
  return { ok: true, value: decoded.value }
}

/** Domain is the first segment of a valid CommandId. */
export function commandDomain(id: CommandId): string {
  const dot = id.indexOf(".")
  return id.slice(0, dot)
}

/** Operation path is everything after the first segment. */
export function commandOperation(id: CommandId): string {
  const dot = id.indexOf(".")
  return id.slice(dot + 1)
}

export function commandSegments(id: CommandId): readonly string[] {
  return id.split(".")
}

export * as OperatorCommandId from "./command-id"
