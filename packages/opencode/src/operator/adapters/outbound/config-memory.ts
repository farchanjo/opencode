/**
 * TEST-ONLY in-memory ConfigPort (Feature 007 / T013–T017 / T024).
 * Simulates Config.Service CAS without disk or prod paths.
 * Live composition MUST use createDurableOperatorStore / Config.Service — never this adapter.
 *
 * When `auditIntent` is provided, it is stored atomically with a successful CAS in the
 * same function (no separate enqueue step / no crash window inside this adapter).
 */
import { createHash } from "node:crypto"
import { stableAuditEventId, type AuditRecord } from "@opencode-ai/core/operator"
import {
  nextConfigVersion,
  type ConfigEntry,
  type ConfigPort,
  type ConfigSnapshot,
} from "../../application/ports/config-port"

type Store = {
  entry: ConfigEntry | null
  snapshots: ConfigSnapshot[]
  /** payload by snapshot id for restore */
  snapshotPayloads: Map<string, unknown>
}

export type MemoryAuditIntent = {
  readonly eventId: string
  readonly projectKey: string
  readonly record: AuditRecord
  readonly authority: string
  readonly afterVersion: string
}

export type MemoryConfigPort = ConfigPort & {
  /**
   * TEST-ONLY: drain intents captured atomically with successful compareAndSet.
   * Production outbox is Config+Flock auditOutbox via createDurableOperatorStore.
   */
  readonly takeAuditIntents: () => readonly MemoryAuditIntent[]
  readonly listAuditIntents: () => readonly MemoryAuditIntent[]
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)
}

/** @deprecated alias — prefer createMemoryConfigPort (still test-only). */
export function createMemoryConfigPort(): MemoryConfigPort {
  const byAuthority = new Map<string, Store>()
  const auditIntents: MemoryAuditIntent[] = []
  const rollbackSlots = new Map<
    string,
    {
      domain: string
      previousBinding: string
      previousPayload: unknown
      activatedAtMs: number
      available: boolean
    }
  >()

  function store(authority: string): Store {
    const existing = byAuthority.get(authority)
    if (existing) return existing
    const created: Store = { entry: null, snapshots: [], snapshotPayloads: new Map() }
    byAuthority.set(authority, created)
    return created
  }

  return {
    async get(authority) {
      return store(authority).entry
    },

    async compareAndSet(input) {
      const s = store(input.authority)
      const current = s.entry
      if (input.expectedVersion === null) {
        if (current !== null) {
          return { ok: false, code: "conflict", currentVersion: current.version }
        }
      } else if (!current || current.version !== input.expectedVersion) {
        return {
          ok: false,
          code: "conflict",
          currentVersion: current?.version ?? "cas_v0",
        }
      }
      const version = nextConfigVersion(current?.version ?? null)
      // R1 test parity: snapshot of pre-CAS state in the same step as payload write
      if (input.snapshotBefore && current) {
        const id = `snap_${input.nowMs}_${s.snapshots.length}`
        const snap: ConfigSnapshot = {
          id,
          authority: input.authority,
          version: current.version,
          createdAtMs: input.nowMs,
          payloadHash: hashPayload(current.payload),
          payloadRef: `memory://${input.authority}/${id}`,
        }
        s.snapshots.push(snap)
        s.snapshotPayloads.set(id, current.payload)
      }
      const entry: ConfigEntry = {
        version,
        payload: input.payload,
        updatedAtMs: input.nowMs,
      }
      // Atomic with CAS: authority entry + optional audit intent in one step.
      s.entry = entry
      if (input.auditIntent) {
        const fullRecord = {
          ...input.auditIntent.record,
          afterVersion: version,
        } as AuditRecord
        const eventId = input.auditIntent.eventId ?? stableAuditEventId(fullRecord)
        auditIntents.push({
          eventId,
          projectKey: input.auditIntent.projectKey,
          record: fullRecord,
          authority: input.authority,
          afterVersion: version,
        })
      }
      // R1 test parity: capture rollback slot intent with CAS (separate RollbackPort may also set)
      if (input.rollbackSlot) {
        rollbackSlots.set(input.rollbackSlot.domain, input.rollbackSlot)
      }
      if (input.clearRollbackDomain) {
        rollbackSlots.delete(input.clearRollbackDomain)
      }
      return { ok: true, version, entry }
    },

    async snapshot(input) {
      const s = store(input.authority)
      if (!s.entry) return null
      const id = input.id ?? `snap_${input.nowMs}_${s.snapshots.length}`
      const snap: ConfigSnapshot = {
        id,
        authority: input.authority,
        version: s.entry.version,
        createdAtMs: input.nowMs,
        payloadHash: hashPayload(s.entry.payload),
        payloadRef: `memory://${input.authority}/${id}`,
      }
      s.snapshots.push(snap)
      s.snapshotPayloads.set(id, s.entry.payload)
      return snap
    },

    async listSnapshots(authority) {
      return [...store(authority).snapshots]
    },

    async pruneSnapshots(input) {
      const s = store(input.authority)
      const drop = new Set(input.dropIds)
      const before = s.snapshots.length
      s.snapshots = s.snapshots.filter((x) => !drop.has(x.id))
      for (const id of drop) s.snapshotPayloads.delete(id)
      return before - s.snapshots.length
    },

    async restoreSnapshot(input) {
      const s = store(input.authority)
      const snap = s.snapshots.find((x) => x.id === input.snapshotId)
      const payload = s.snapshotPayloads.get(input.snapshotId)
      if (!snap || payload === undefined) {
        return { ok: false, code: "unavailable", reason: `snapshot not found: ${input.snapshotId}` }
      }
      const version = nextConfigVersion(s.entry?.version ?? null)
      const entry: ConfigEntry = { version, payload, updatedAtMs: input.nowMs }
      s.entry = entry
      return { ok: true, version, entry }
    },

    takeAuditIntents() {
      return auditIntents.splice(0, auditIntents.length)
    },
    listAuditIntents() {
      return [...auditIntents]
    },
  }
}

export * as MemoryConfigAdapter from "./config-memory"
