/**
 * In-memory cutover rollback slots (Feature 007 / T017).
 */
import type { RollbackPort, RollbackSlot } from "../../application/ports/rollback-port"

export function createMemoryRollbackPort(): RollbackPort {
  const map = new Map<string, RollbackSlot>()
  return {
    async get(domain) {
      return map.get(domain) ?? null
    },
    async set(slot) {
      map.set(slot.domain, {
        domain: slot.domain,
        previousBinding: slot.previousBinding,
        previousPayload: slot.previousPayload,
        activatedAtMs: slot.activatedAtMs,
        available: slot.available,
      })
    },
    async clear(domain) {
      map.delete(domain)
    },
  }
}

export * as MemoryRollbackAdapter from "./rollback-memory"
