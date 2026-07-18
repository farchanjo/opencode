/**
 * Idempotency store port (Feature 007 / T015) — durable claim/CAS/TTL.
 * Keyed by (principalRef, commandId, idempotencyKey).
 */
import type { CommandResult } from "@opencode-ai/core/operator"
import { createHash } from "node:crypto"
import type { CommandRequest } from "@opencode-ai/core/operator"

export type IdempotencyKey = {
  readonly principalRef: string
  readonly commandId: string
  readonly idempotencyKey: string
}

export type IdempotencyRecord = IdempotencyKey & {
  readonly result: CommandResult
  readonly createdAtMs: number
  /** Canonical request fingerprint; the same key cannot replay another payload. */
  readonly requestHash: string
}

export type IdempotencyClaimResult =
  | { readonly status: "claimed" }
  | { readonly status: "replay"; readonly record: IdempotencyRecord }
  | { readonly status: "busy" }
  | { readonly status: "mismatch" }

export type IdempotencyPort = {
  readonly get: (key: IdempotencyKey, requestHash?: string) => Promise<IdempotencyRecord | null>
  readonly put: (record: IdempotencyRecord) => Promise<void>
  /**
   * Atomic claim for concurrent same-key protection.
   * Returns replay if done, busy if another worker claimed, claimed if this caller owns the work.
   */
  readonly claim?: (key: IdempotencyKey, nowMs: number, requestHash: string) => Promise<IdempotencyClaimResult>
}

/**
 * Hash the complete mutation request, not only its idempotency key. Object keys
 * are sorted so equivalent JSON objects produce one fingerprint.
 */
export function idempotencyRequestHash(request: CommandRequest): string {
  const canonical = canonicalize({
    id: String(request.id),
    principal: request.principal,
    scope: request.scope,
    confirm: request.confirm ?? null,
    source: request.source,
    isTty: request.isTty ?? null,
    payload: request.payload ?? null,
  })
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

export function principalRef(principal: { kind: string; subject: string; projectBinding: string | null }): string {
  return `${principal.kind}:${principal.subject}:${principal.projectBinding ?? "-"}`
}

/** Redact result for durable idempotent replay (no secrets). */
export function redactResultForIdempotency(result: CommandResult): CommandResult {
  return {
    ...result,
    ...(result.effective !== undefined ? { effective: redactUnknown(result.effective) } : {}),
  }
}

function redactUnknown(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redactUnknown)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/secret|token|password|authorization|api[_-]?key|credential/i.test(k)) {
      out[k] = "[REDACTED]"
      continue
    }
    out[k] = redactUnknown(v)
  }
  return out
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalize)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  )
}

export * as OperatorIdempotencyPort from "./idempotency-port"
