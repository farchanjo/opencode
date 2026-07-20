/**
 * Durable Config.Service operator store (B1/B6/B7).
 * All RMW under LockPort (Flock in production). Merges operator subtree without
 * clobbering unrelated config keys. No memory bookkeeping.
 */
import { createHash } from "node:crypto"
import { nextConfigVersion, type CasResult, type ConfigEntry, type ConfigPort, type ConfigSnapshot } from "../../application/ports/config-port"
import type { LockPort } from "../../application/ports/lock-port"
import type { CommandResult } from "@opencode-ai/core/operator"
import { stableAuditEventId, type AuditRecord } from "@opencode-ai/core/operator"
import type { IdempotencyKey, IdempotencyPort, IdempotencyRecord } from "../../application/ports/idempotency-port"
import type { RollbackPort, RollbackSlot } from "../../application/ports/rollback-port"
import type { OutboxMessage } from "../../application/ports/outbox-port"
import { selectSnapshotsToPrune, SNAPSHOT_MAX_COUNT, snapshotMaxAgeMs } from "@opencode-ai/core/operator"

export type ConfigServiceLike = {
  readonly get: () => Promise<Record<string, unknown>>
  readonly getGlobal: () => Promise<Record<string, unknown>>
  /**
   * Merge top-level keys into document (must preserve siblings) by default. Pass
   * `{ replace: true }` to write `config` wholesale instead — used only for the
   * operator project-profile write, whose target file is 100% operator-owned (see
   * `mergeOperator` below).
   */
  readonly update: (config: Record<string, unknown>, options?: { readonly replace?: boolean }) => Promise<void>
  readonly updateGlobal: (config: Record<string, unknown>) => Promise<{ changed: boolean }>
}

export type ConfigServiceAdapterOptions = {
  readonly config: ConfigServiceLike
  /** Required for production correctness (Flock). Tests may use process mutex. */
  readonly lock: LockPort
  readonly operatorNamespace?: string
  readonly projectKey?: string
  readonly beforeWrite?: (next: Record<string, unknown>) => void | Promise<void>
  /** Test failpoint: runs after Config.Service commit and may throw. */
  readonly afterWrite?: (next: Record<string, unknown>) => void | Promise<void>
}

type AuthorityRecord = {
  version: string
  payload: unknown
  updatedAtMs: number
  snapshots: Array<{
    id: string
    version: string
    createdAtMs: number
    payloadHash: string
    payload: unknown
  }>
}

/** T024 durable audit outbox row (same operator document as authorities). */
export type AuditOutboxRow = {
  id: string
  target: string
  payloadHash: string
  createdAtMs: number
  delivered: boolean
  attempts: number
  leaseOwner?: string | null
  leaseUntilMs?: number | null
  deadLetter?: boolean
  body?: {
    record: {
      source: string
      actorRef: string
      scope: { kind: string; ref: string | null }
      commandId: string
      beforeVersion: string | null
      afterVersion: string | null
      outcome: string
      createdAtMs: number
    }
    projectKey: string
    eventId: string
  }
}

type OperatorState = {
  authorities: Record<string, AuthorityRecord>
  idempotency: Record<
    string,
    {
      principalRef: string
      commandId: string
      idempotencyKey: string
      status: "claimed" | "done"
      result?: CommandResult
      requestHash?: string
      createdAtMs: number
      expiresAtMs: number
    }
  >
  rollback: Record<
    string,
    {
      domain: string
      previousBinding: string
      previousPayload: unknown
      activatedAtMs: number
      available: boolean
    }
  >
  /** T024: pending operator.audit intents (atomic with authority CAS). */
  auditOutbox: AuditOutboxRow[]
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 30 * 86_400_000

/**
 * Feature 032: the persisted operator patch is a self-describing config document. The
 * namespaced write carries `$schema` so a fresh per-project profile `config.json` is a
 * valid opencode config file, never a bare `{ operator }` fragment.
 */
const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json"

function emptyState(): OperatorState {
  return { authorities: {}, idempotency: {}, rollback: {}, auditOutbox: [] }
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)
}

function asState(raw: unknown): OperatorState {
  if (!raw || typeof raw !== "object") return emptyState()
  const r = raw as Record<string, unknown>
  return {
    authorities: { ...((r.authorities as OperatorState["authorities"]) ?? {}) },
    idempotency: { ...((r.idempotency as OperatorState["idempotency"]) ?? {}) },
    rollback: { ...((r.rollback as OperatorState["rollback"]) ?? {}) },
    auditOutbox: Array.isArray(r.auditOutbox) ? [...(r.auditOutbox as AuditOutboxRow[])] : [],
  }
}

/** Canonical hash order for the validated audit intent. */
function hashFullAuditRecord(record: {
  source: string
  actorRef: string
  scope: { kind: string; ref: string | null }
  commandId: string
  beforeVersion: string | null
  afterVersion: string | null
  outcome: string
  createdAtMs: number
}): string {
  return stableAuditEventId(record as AuditRecord)
}

function isGlobalAuthority(authority: string): boolean {
  return authority === "global" || authority.startsWith("global:")
}

/**
 * Feature 035: the per-project profile file owns ONLY project-scoped authorities; a
 * `global:*` authority belongs solely on the global config document. `readRoot` for a
 * project write returns `Config.get()`, which post-Feature-030 LAYERS the global doc's
 * operator namespace under the profile — so `state.authorities` can carry a leaked-in
 * `global:*` record. Drop every non-project-owned authority before the project write, so
 * the profile can never double-write (or, worse, shadow-and-freeze) a global authority.
 */
function projectOwnedAuthorities(
  authorities: OperatorState["authorities"],
): OperatorState["authorities"] {
  const owned: OperatorState["authorities"] = {}
  for (const [key, record] of Object.entries(authorities)) {
    if (!isGlobalAuthority(key)) owned[key] = record
  }
  return owned
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export type DurableOperatorBundle = {
  readonly config: ConfigPort
  readonly idempotency: IdempotencyPort
  readonly rollback: RollbackPort
  readonly lock: LockPort
  /** T024 durable audit outbox (same document/Flock as authorities). */
  readonly outbox: import("../../application/ports/outbox-port").OutboxPort
}

export function createDurableOperatorStore(options: ConfigServiceAdapterOptions): DurableOperatorBundle {
  if (!options.lock) {
    throw new Error("createDurableOperatorStore requires lock (Flock) for production correctness")
  }
  const ns = options.operatorNamespace ?? "operator"
  const projectKey = options.projectKey ?? "project"
  const lock = options.lock

  /**
   * ONE Flock key for the entire operator document (all authorities, idempotency, rollback, snapshots).
   * Per-authority keys allowed lost updates across concurrent different authorities.
   */
  function documentLockKey(): string {
    return `${projectKey}:operator`
  }

  async function readRoot(authority: string): Promise<Record<string, unknown>> {
    if (isGlobalAuthority(authority)) return options.config.getGlobal()
    return options.config.get()
  }

  /**
   * Persist ONLY the operator namespace this store owns (Feature 032).
   *
   * `readRoot` returns the FULL effective config. Post-Feature-030 that is a LAYERED
   * document: the inherited base (`~/.config/opencode`) merged under the profile, so it
   * carries third-party `mcp`/`provider` entries with plaintext API keys plus other
   * base-owned keys (`agent`, `command`, `mode`, `tools`, `permission`, `username`, ...).
   * Spreading that whole root into the write copied those base-inherited keys — secrets
   * included — verbatim into the per-project profile `config.json` (and, on the global
   * path, into the profile's own global `config.json`). The write seams merge this patch
   * into the target file, so a namespaced patch preserves any pre-existing project-owned
   * keys while writing only what the file legitimately owns. The base is still inherited
   * and merged at read time (Feature 030) — the file just stops DUPLICATING it.
   *
   * Re-reads under lock so concurrent non-operator updates are not clobbered.
   *
   * Feature 032 follow-up (adversarial review, MEDIUM residual): narrowing the patch to
   * `{$schema, [ns]}` stops NEW leaks, but a deep-merge write never REMOVES keys, so a
   * profile file already leaked by the pre-fix code (stale base `mcp`/`provider` secrets
   * sitting alongside the operator namespace) stayed leaked forever. The per-project
   * profile file is 100% operator-owned (Features 027/030 — users author `opencode.json`
   * in the project tree, never this file), so its write can go further than the global
   * write: REPLACE the file wholesale with `{$schema, [ns]: state}` instead of
   * deep-merging. `state` already reflects the full current operator document (loaded via
   * `readRoot` above, then mutated), so nothing operator-owned is lost — only whatever
   * stale non-operator keys were sitting in the file get dropped, self-healing a leaked
   * file on its very next mutation. The GLOBAL write keeps deep-merging: the global config
   * file legitimately has user-authored siblings (`mcp`/`provider`/`model`, ...) that must
   * survive an operator write.
   */
  async function mergeOperator(authority: string, mutate: (state: OperatorState) => void): Promise<void> {
    const root = await readRoot(authority)
    const state = asState(root[ns])
    mutate(state)
    const global = isGlobalAuthority(authority)
    // Feature 035: the global write persists to the global doc (which legitimately holds
    // `global:*` authorities). The project write REPLACES the per-project profile — whose
    // authority map must contain ONLY project-owned authorities — so strip any `global:*`
    // record that the layered read (Feature 030) merged into `state` before persisting. The
    // project-owned bookkeeping (idempotency/rollback/auditOutbox) is untouched, so a
    // re-issued command still dedups and rolls back correctly.
    const persisted = global ? state : { ...state, authorities: projectOwnedAuthorities(state.authorities) }
    const patch = { $schema: OPENCODE_CONFIG_SCHEMA, [ns]: persisted }
    if (options.beforeWrite) await options.beforeWrite(patch)
    if (global) {
      await options.config.updateGlobal(patch)
    } else {
      await options.config.update(patch, { replace: true })
    }
    if (options.afterWrite) await options.afterWrite(patch)
  }

  async function loadState(authority: string): Promise<OperatorState> {
    const root = await readRoot(authority)
    return asState(root[ns])
  }

  const configPort: ConfigPort = {
    async get(authority) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(authority)
        const rec = state.authorities[authority]
        if (!rec) return null
        return { version: rec.version, payload: rec.payload, updatedAtMs: rec.updatedAtMs } satisfies ConfigEntry
      })
    },

    async compareAndSet(input) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(input.authority)
        const current = state.authorities[input.authority]
        if (input.expectedVersion === null) {
          if (current) {
            return { ok: false, code: "conflict", currentVersion: current.version } satisfies CasResult
          }
        } else if (!current || current.version !== input.expectedVersion) {
          return {
            ok: false,
            code: "conflict",
            currentVersion: current?.version ?? "cas_v0",
          } satisfies CasResult
        }
        const version = nextConfigVersion(current?.version ?? null)
        let snapshots = current?.snapshots ? [...current.snapshots] : []
        // R1: snapshot of pre-CAS state in the same document transaction as payload write
        if (input.snapshotBefore && current) {
          const snap = {
            id: `snap_${input.nowMs}_${snapshots.length}`,
            version: current.version,
            createdAtMs: input.nowMs,
            payloadHash: hashPayload(current.payload),
            payload: clone(current.payload),
          }
          snapshots = [...snapshots, snap]
          const drop = selectSnapshotsToPrune(
            snapshots.map((s) => ({ id: s.id, createdAtMs: s.createdAtMs })),
            input.nowMs,
            { maxCount: SNAPSHOT_MAX_COUNT, maxAgeMs: snapshotMaxAgeMs() },
          )
          const dropSet = new Set(drop)
          snapshots = snapshots.filter((s) => !dropSet.has(s.id))
        }
        const nextRec: AuthorityRecord = {
          version,
          payload: input.payload,
          updatedAtMs: input.nowMs,
          snapshots,
        }
        try {
          await mergeOperator(input.authority, (s) => {
            s.authorities[input.authority] = nextRec
            // H1/H3: same Flock document update — authority + audit outbox intent
            if (input.auditIntent) {
              const fullRecord = {
                ...input.auditIntent.record,
                afterVersion: version,
              }
              const eventId = input.auditIntent.eventId ?? hashFullAuditRecord(fullRecord)
              const row: AuditOutboxRow = {
                id: eventId,
                target: "operator.audit",
                payloadHash: hashFullAuditRecord(fullRecord),
                createdAtMs: input.nowMs,
                delivered: false,
                attempts: 0,
                body: {
                  record: fullRecord,
                  projectKey: input.auditIntent.projectKey,
                  eventId,
                },
              }
              const existing = (s.auditOutbox ?? []).find((pending) => pending.id === eventId)
              if (existing && existing.payloadHash !== row.payloadHash) {
                throw new Error("audit event id already contains a different canonical record")
              }
              const without = (s.auditOutbox ?? []).filter((p) => p.id !== eventId)
              s.auditOutbox = [...without, row]
            }
            // R1: cutover rollback slot in same write (no crash window after CAS)
            if (input.rollbackSlot) {
              const slot = input.rollbackSlot
              s.rollback[slot.domain] = {
                domain: slot.domain,
                previousBinding: slot.previousBinding,
                previousPayload: slot.previousPayload ?? null,
                activatedAtMs: slot.activatedAtMs,
                available: slot.available,
              }
            }
            // R1: clear rollback slot in same write as restore CAS
            if (input.clearRollbackDomain) {
              delete s.rollback[input.clearRollbackDomain]
            }
          })
        } catch (error) {
          return {
            ok: false,
            code: "unavailable",
            reason: error instanceof Error ? error.message : "config write failed",
          } satisfies CasResult
        }
        return {
          ok: true,
          version,
          entry: { version, payload: input.payload, updatedAtMs: input.nowMs },
          applied: {
            snapshot: Boolean(input.snapshotBefore && current),
            rollbackSlot: Boolean(input.rollbackSlot),
            clearRollback: Boolean(input.clearRollbackDomain),
            auditIntent: Boolean(input.auditIntent),
          },
        } satisfies CasResult
      })
    },

    async snapshot(input) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(input.authority)
        const rec = state.authorities[input.authority]
        if (!rec) return null
        const id = input.id ?? `snap_${input.nowMs}_${rec.snapshots.length}`
        const snap = {
          id,
          version: rec.version,
          createdAtMs: input.nowMs,
          payloadHash: hashPayload(rec.payload),
          payload: clone(rec.payload),
        }
        const snapshots = [...rec.snapshots, snap]
        const drop = selectSnapshotsToPrune(
          snapshots.map((s) => ({ id: s.id, createdAtMs: s.createdAtMs })),
          input.nowMs,
          { maxCount: SNAPSHOT_MAX_COUNT, maxAgeMs: snapshotMaxAgeMs() },
        )
        const dropSet = new Set(drop)
        const pruned = snapshots.filter((s) => !dropSet.has(s.id))
        await mergeOperator(input.authority, (s) => {
          const cur = s.authorities[input.authority]
          if (cur) cur.snapshots = pruned
        })
        return {
          id: snap.id,
          authority: input.authority,
          version: snap.version,
          createdAtMs: snap.createdAtMs,
          payloadHash: snap.payloadHash,
          payloadRef: `config://${ns}/authorities/${input.authority}/snapshots/${snap.id}`,
        } satisfies ConfigSnapshot
      })
    },

    async listSnapshots(authority) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(authority)
        const rec = state.authorities[authority]
        if (!rec) return []
        return rec.snapshots.map((s) => ({
          id: s.id,
          authority,
          version: s.version,
          createdAtMs: s.createdAtMs,
          payloadHash: s.payloadHash,
          payloadRef: `config://${ns}/authorities/${authority}/snapshots/${s.id}`,
        }))
      })
    },

    async pruneSnapshots(input) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(input.authority)
        const rec = state.authorities[input.authority]
        if (!rec) return 0
        const drop = new Set(input.dropIds)
        const before = rec.snapshots.length
        await mergeOperator(input.authority, (s) => {
          const cur = s.authorities[input.authority]
          if (cur) cur.snapshots = cur.snapshots.filter((x) => !drop.has(x.id))
        })
        return before - (before - drop.size)
      })
    },

    async restoreSnapshot(input) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(input.authority)
        const rec = state.authorities[input.authority]
        const snap = rec?.snapshots.find((s) => s.id === input.snapshotId)
        if (!rec || !snap) {
          return { ok: false, code: "unavailable", reason: `snapshot not found: ${input.snapshotId}` }
        }
        const version = nextConfigVersion(rec.version)
        try {
          await mergeOperator(input.authority, (s) => {
            const cur = s.authorities[input.authority]
            if (!cur) return
            cur.version = version
            cur.payload = clone(snap.payload)
            cur.updatedAtMs = input.nowMs
          })
        } catch (error) {
          return {
            ok: false,
            code: "unavailable",
            reason: error instanceof Error ? error.message : "restore failed",
          }
        }
        return {
          ok: true,
          version,
          entry: { version, payload: clone(snap.payload), updatedAtMs: input.nowMs },
        }
      })
    },
  }

  const metaAuth = () => "project"

  const idempotency: IdempotencyPort = {
    async get(key, _requestHash) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(metaAuth())
        const rec = state.idempotency[keyOf(key)]
        if (!rec || rec.status !== "done" || !rec.result) return null
        return {
          principalRef: rec.principalRef,
          commandId: rec.commandId,
          idempotencyKey: rec.idempotencyKey,
          result: rec.result,
          createdAtMs: rec.createdAtMs,
          requestHash: rec.requestHash ?? "",
        } satisfies IdempotencyRecord
      })
    },
    async put(record) {
      return lock.withLock(documentLockKey(), async () => {
        const current = await loadState(metaAuth())
        const existing = current.idempotency[keyOf(record)]
        if (existing?.status === "done" && existing.requestHash !== record.requestHash) {
          throw new Error("idempotency key was already used with a different request payload")
        }
        await mergeOperator(metaAuth(), (s) => {
          s.idempotency[keyOf(record)] = {
            principalRef: record.principalRef,
            commandId: record.commandId,
            idempotencyKey: record.idempotencyKey,
            status: "done",
            result: record.result,
            requestHash: record.requestHash,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.createdAtMs + DEFAULT_IDEMPOTENCY_TTL_MS,
          }
          for (const [ik, iv] of Object.entries(s.idempotency)) {
            if (iv.expiresAtMs < record.createdAtMs) delete s.idempotency[ik]
          }
        })
      })
    },
    async claim(key, nowMs, requestHash) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(metaAuth())
        const k = keyOf(key)
        const existing = state.idempotency[k]
        if (existing?.status === "done" && existing.result) {
          if (existing.requestHash !== requestHash) return { status: "mismatch" as const }
          return {
            status: "replay" as const,
            record: {
              principalRef: existing.principalRef,
              commandId: existing.commandId,
              idempotencyKey: existing.idempotencyKey,
              result: existing.result,
              createdAtMs: existing.createdAtMs,
              requestHash: existing.requestHash ?? "",
            },
          }
        }
        if (existing?.status === "claimed" && existing.expiresAtMs > nowMs) {
          if (existing.requestHash !== requestHash) return { status: "mismatch" as const }
          return { status: "busy" as const }
        }
        await mergeOperator(metaAuth(), (s) => {
          s.idempotency[k] = {
            principalRef: key.principalRef,
            commandId: key.commandId,
            idempotencyKey: key.idempotencyKey,
            status: "claimed",
            requestHash,
            createdAtMs: nowMs,
            expiresAtMs: nowMs + 60_000,
          }
        })
        return { status: "claimed" as const }
      })
    },
  }

  const rollback: RollbackPort = {
    async get(domain) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(metaAuth())
        const slot = state.rollback[domain]
        if (!slot) return null
        return {
          domain: slot.domain,
          previousBinding: slot.previousBinding,
          previousPayload: slot.previousPayload,
          activatedAtMs: slot.activatedAtMs,
          available: slot.available,
        } satisfies RollbackSlot
      })
    },
    async set(slot) {
      return lock.withLock(documentLockKey(), async () => {
        await mergeOperator(metaAuth(), (s) => {
          s.rollback[slot.domain] = {
            domain: slot.domain,
            previousBinding: slot.previousBinding,
            previousPayload: slot.previousPayload ?? null,
            activatedAtMs: slot.activatedAtMs,
            available: slot.available,
          }
        })
      })
    },
    async clear(domain) {
      return lock.withLock(documentLockKey(), async () => {
        await mergeOperator(metaAuth(), (s) => {
          delete s.rollback[domain]
        })
      })
    },
  }

  const LEASE_MS = 30_000
  const MAX_ATTEMPTS = 8

  const outbox: import("../../application/ports/outbox-port").OutboxPort = {
    async enqueue(msg) {
      return lock.withLock(documentLockKey(), async () => {
        const id = msg.id ?? `outbox_${Date.now()}`
        await mergeOperator(metaAuth(), (s) => {
          const without = (s.auditOutbox ?? []).filter((p) => p.id !== id)
          without.push({
            id,
            target: msg.target,
            payloadHash: msg.payloadHash,
            createdAtMs: msg.nowMs,
            delivered: false,
            attempts: 0,
            body: msg.body as AuditOutboxRow["body"],
          })
          s.auditOutbox = without
        })
        return { id }
      })
    },
    async listPending(limit) {
      return lock.withLock(documentLockKey(), async () => {
        const state = await loadState(metaAuth())
        const now = Date.now()
        const pending = (state.auditOutbox ?? [])
          .filter((p) => !p.delivered && !p.deadLetter)
          .filter((p) => !p.leaseUntilMs || p.leaseUntilMs < now || !p.leaseOwner)
          .map((p) => ({
            id: p.id,
            target: p.target,
            payloadHash: p.payloadHash,
            createdAtMs: p.createdAtMs,
            delivered: p.delivered,
            body: p.body,
          }))
        return (limit === undefined ? pending : pending.slice(0, Math.max(0, limit))) as OutboxMessage[]
      })
    },
    async markDelivered(id) {
      return lock.withLock(documentLockKey(), async () => {
        let found = false
        await mergeOperator(metaAuth(), (s) => {
          const before = s.auditOutbox?.length ?? 0
          s.auditOutbox = (s.auditOutbox ?? []).filter((p) => p.id !== id)
          found = (s.auditOutbox?.length ?? 0) < before || before === 0
          // If already absent, treat as delivered (ack race)
          if (!found && !(s.auditOutbox ?? []).some((p) => p.id === id)) found = true
        })
        // Re-check: if not present after filter, delivered
        const state = await loadState(metaAuth())
        return !(state.auditOutbox ?? []).some((p) => p.id === id)
      })
    },
    requiredForLocalMutation() {
      return false
    },
    async prepareExternal() {
      return { ok: true }
    },
    async claim(id, owner, nowMs) {
      return lock.withLock(documentLockKey(), async () => {
        let result: { status: "claimed" } | { status: "skipped" } | { status: "dead_letter" } = {
          status: "skipped",
        }
        await mergeOperator(metaAuth(), (s) => {
          const row = (s.auditOutbox ?? []).find((p) => p.id === id)
          if (!row || row.delivered || row.deadLetter) {
            result = { status: "skipped" }
            return
          }
          if (row.leaseUntilMs && row.leaseUntilMs > nowMs && row.leaseOwner && row.leaseOwner !== owner) {
            result = { status: "skipped" }
            return
          }
          row.attempts = (row.attempts ?? 0) + 1
          if (row.attempts > MAX_ATTEMPTS) {
            // Exhausted retries: retain as dead-letter (not pending, not deleted).
            row.deadLetter = true
            row.leaseOwner = null
            row.leaseUntilMs = null
            result = { status: "dead_letter" }
            return
          }
          row.leaseOwner = owner
          row.leaseUntilMs = nowMs + LEASE_MS
          result = { status: "claimed" }
        })
        return result
      })
    },
    async markDeadLetter(id) {
      return lock.withLock(documentLockKey(), async () => {
        let marked = false
        await mergeOperator(metaAuth(), (s) => {
          const row = (s.auditOutbox ?? []).find((pending) => pending.id === id)
          if (!row || row.delivered || row.deadLetter) return
          row.deadLetter = true
          row.leaseOwner = null
          row.leaseUntilMs = null
          marked = true
        })
        return marked
      })
    },
  }

  return { config: configPort, idempotency, rollback, lock, outbox }
}

/** @deprecated Prefer createDurableOperatorStore with explicit lock. */
export function createConfigServiceAdapter(options: ConfigServiceAdapterOptions): ConfigPort {
  return createDurableOperatorStore(options).config
}

function keyOf(k: IdempotencyKey): string {
  return `${k.principalRef}\0${k.commandId}\0${k.idempotencyKey}`
}

/** In-memory Config.Service double with sibling-preserving merge. */
export function createFakeConfigService(): ConfigServiceLike & {
  readonly dump: () => { project: Record<string, unknown>; global: Record<string, unknown> }
} {
  let project: Record<string, unknown> = {}
  let global: Record<string, unknown> = {}
  return {
    async get() {
      return clone(project)
    },
    async getGlobal() {
      return clone(global)
    },
    async update(config, options) {
      project = options?.replace ? clone(config) : { ...project, ...clone(config) }
    },
    async updateGlobal(config) {
      const before = JSON.stringify(global)
      global = { ...global, ...clone(config) }
      return { changed: before !== JSON.stringify(global) }
    },
    dump() {
      return { project: clone(project), global: clone(global) }
    },
  }
}

/**
 * File-backed Config.Service-like for multi-process CAS tests.
 * Entire document is one JSON file; update rewrites under Flock (caller).
 */
export function createFileConfigService(filePath: string): ConfigServiceLike {
  async function read(): Promise<Record<string, unknown>> {
    const f = Bun.file(filePath)
    if (!(await f.exists())) return {}
    try {
      return (await f.json()) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  async function write(doc: Record<string, unknown>) {
    await Bun.write(filePath, JSON.stringify(doc, null, 2))
  }
  return {
    async get() {
      return read()
    },
    async getGlobal() {
      return read()
    },
    async update(config, options) {
      const next = options?.replace ? config : { ...(await read()), ...config }
      await write(next)
    },
    async updateGlobal(config) {
      const cur = await read()
      const next = { ...cur, ...config }
      const changed = JSON.stringify(cur) !== JSON.stringify(next)
      await write(next)
      return { changed }
    },
  }
}

export function contentHash(payload: unknown): string {
  return hashPayload(payload)
}

export function allocateVersion(current: string | null): string {
  return nextConfigVersion(current)
}

export type { CasResult, ConfigSnapshot }

export * as ConfigServiceAdapter from "./config-service"
