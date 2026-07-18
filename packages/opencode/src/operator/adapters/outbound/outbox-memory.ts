/**
 * External-only outbox (Feature 007 / T023 review fix).
 * prepareExternal runs before mutation; requiredForLocalMutation is always false.
 * TEST/in-process only — live audit intents use Config+Flock store.outbox.
 */
import type {
  OutboxClaimResult,
  OutboxMessage,
  OutboxPort,
  OutboxPrepareResult,
} from "../../application/ports/outbox-port"

const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_LEASE_MS = 30_000

type MutableOutbox = {
  id: string
  target: string
  payloadHash: string
  createdAtMs: number
  delivered: boolean
  deadLetter?: boolean
  body?: unknown
  attempts?: number
  leaseOwner?: string | null
  leaseUntilMs?: number | null
}

export function createMemoryOutboxPort(options?: {
  /** When set, prepareExternal fails (tests partial-commit prevention). */
  failPrepare?: boolean
  maxAttempts?: number
  leaseMs?: number
}): OutboxPort {
  const messages: MutableOutbox[] = []
  let seq = 0
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const leaseMs = options?.leaseMs ?? DEFAULT_LEASE_MS
  return {
    async enqueue(input) {
      const id = input.id ?? `outbox_${++seq}`
      const existing = messages.find((message) => message.id === id)
      if (existing && existing.payloadHash !== input.payloadHash) {
        throw new Error("outbox id already contains a different payload")
      }
      if (existing) return { id }
      messages.push({
        id,
        target: input.target,
        payloadHash: input.payloadHash,
        createdAtMs: input.nowMs,
        delivered: false,
        body: input.body,
        attempts: 0,
      })
      return { id }
    },
    async listPending(limit) {
      return messages.filter((m) => !m.delivered && !m.deadLetter).slice(0, limit) as OutboxMessage[]
    },
    async markDelivered(id) {
      const m = messages.find((x) => x.id === id)
      if (!m) return false
      m.delivered = true
      return true
    },
    requiredForLocalMutation() {
      return false
    },
    async prepareExternal(): Promise<OutboxPrepareResult> {
      if (options?.failPrepare) {
        return { ok: false, reason: "external outbox prepare failed" }
      }
      return { ok: true }
    },
    async claim(id, owner, nowMs): Promise<OutboxClaimResult> {
      const message = messages.find((item) => item.id === id)
      if (!message || message.delivered || message.deadLetter) return { status: "skipped" }
      if (
        message.leaseUntilMs &&
        message.leaseUntilMs > nowMs &&
        message.leaseOwner &&
        message.leaseOwner !== owner
      ) {
        return { status: "skipped" }
      }
      message.attempts = (message.attempts ?? 0) + 1
      if (message.attempts > maxAttempts) {
        message.deadLetter = true
        message.leaseOwner = null
        message.leaseUntilMs = null
        return { status: "dead_letter" }
      }
      message.leaseOwner = owner
      message.leaseUntilMs = nowMs + leaseMs
      return { status: "claimed" }
    },
    async markDeadLetter(id) {
      const message = messages.find((item) => item.id === id)
      if (!message || message.delivered) return false
      message.deadLetter = true
      message.leaseOwner = null
      message.leaseUntilMs = null
      return true
    },
  }
}

export function createBrokenLocalOutboxPort(): OutboxPort {
  const base = createMemoryOutboxPort()
  return {
    ...base,
    requiredForLocalMutation() {
      return true
    },
  }
}

export * as MemoryOutboxAdapter from "./outbox-memory"
