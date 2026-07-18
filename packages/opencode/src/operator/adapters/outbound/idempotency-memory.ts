/**
 * In-memory idempotency with claim (Feature 007 / T015).
 */
import type {
  IdempotencyClaimResult,
  IdempotencyKey,
  IdempotencyPort,
  IdempotencyRecord,
} from "../../application/ports/idempotency-port"

function keyOf(k: IdempotencyKey): string {
  return `${k.principalRef}\0${k.commandId}\0${k.idempotencyKey}`
}

type Cell =
  | { status: "claimed"; expiresAtMs: number }
  | { status: "done"; record: IdempotencyRecord }

export function createMemoryIdempotencyPort(): IdempotencyPort {
  const map = new Map<string, Cell>()
  return {
    async get(key, requestHash) {
      const cell = map.get(keyOf(key))
      if (!cell || cell.status !== "done") return null
      return cell.record
    },
    async put(record) {
      map.set(keyOf(record), { status: "done", record })
    },
    async claim(key, nowMs, requestHash): Promise<IdempotencyClaimResult> {
      const k = keyOf(key)
      const existing = map.get(k)
      if (existing?.status === "done") {
        if (existing.record.requestHash !== requestHash) return { status: "mismatch" }
        return { status: "replay", record: existing.record }
      }
      if (existing?.status === "claimed" && existing.expiresAtMs > nowMs) {
        return { status: "busy" }
      }
      map.set(k, { status: "claimed", expiresAtMs: nowMs + 60_000 })
      return { status: "claimed" }
    },
  }
}

export * as MemoryIdempotencyAdapter from "./idempotency-memory"
