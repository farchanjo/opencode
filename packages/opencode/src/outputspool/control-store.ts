/**
 * Feature 005 / T028 (S16) — the SQLite control / metadata store.
 *
 * The committed-length AUTHORITY (C12): per channel generation it records the
 * committed length, the durability tier, the seal/abort fence record, the
 * recovered state, and the inbound reference edges. Recovery treats the
 * filesystem data extent against this committed length (`reconciler.ts`, T029).
 * Generation records fence a stale writer: a new attempt/generation never
 * overwrites a predecessor's active generation, and the committed length is
 * monotonic per generation, so a superseded writer can never shrink or rewrite a
 * committed extent (FR25, FR27, C12, C18, AC8). Exactly-once FS+DB commit is NOT
 * attempted; the store orders control commits and the reconciler resolves any
 * divergence.
 *
 * The `bun:sqlite` `Database` is injected so tests bind an in-memory database and
 * the live stack binds the managed control file; this module owns only the SQL
 * schema and the typed accessors, never the file path a consumer might see
 * (FR12, C18).
 */
export * as ControlStore from "./control-store"

import type { Database } from "bun:sqlite"
import type { DurabilityTier, GroupState, RetentionEdgeKind } from "@opencode-ai/schema/outputspool/enums"

/** One persisted channel-generation control record (the committed-length authority, C12). */
export interface GenerationRecord {
  readonly output_ref: string
  readonly group_id: string
  readonly generation: number
  readonly channel: string
  readonly durability_tier: DurabilityTier
  readonly committed_bytes: number
  readonly state: GroupState
  readonly seal_record: boolean
  readonly abort_record: boolean
  readonly seal_requested: boolean
  readonly integrity_tag: string | null
  readonly correlation_id: string
  readonly created_at: number
  readonly updated_at: number
}

/** The insert payload for opening one channel generation. */
export interface OpenGenerationInput {
  readonly output_ref: string
  readonly group_id: string
  readonly generation: number
  readonly channel: string
  readonly durability_tier: DurabilityTier
  readonly correlation_id: string
  readonly now: number
}

/** The fence outcome when opening a generation against the group's active generation (C18). */
export type OpenOutcome = { readonly accepted: true } | { readonly accepted: false; readonly active_generation: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channel_generation (
  output_ref TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  channel TEXT NOT NULL,
  durability_tier TEXT NOT NULL,
  committed_bytes INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open',
  seal_record INTEGER NOT NULL DEFAULT 0,
  abort_record INTEGER NOT NULL DEFAULT 0,
  seal_requested INTEGER NOT NULL DEFAULT 0,
  integrity_tag TEXT,
  correlation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS active_generation (
  group_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_edge (
  output_ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  holder_ref TEXT NOT NULL,
  PRIMARY KEY (output_ref, kind, holder_ref)
);
`

const rowToRecord = (row: Record<string, unknown>): GenerationRecord => ({
  output_ref: String(row.output_ref),
  group_id: String(row.group_id),
  generation: Number(row.generation),
  channel: String(row.channel),
  durability_tier: String(row.durability_tier) as DurabilityTier,
  committed_bytes: Number(row.committed_bytes),
  state: String(row.state) as GroupState,
  seal_record: Number(row.seal_record) === 1,
  abort_record: Number(row.abort_record) === 1,
  seal_requested: Number(row.seal_requested) === 1,
  integrity_tag: row.integrity_tag == null ? null : String(row.integrity_tag),
  correlation_id: String(row.correlation_id),
  created_at: Number(row.created_at),
  updated_at: Number(row.updated_at),
})

export interface ControlStore {
  readonly openGeneration: (input: OpenGenerationInput) => OpenOutcome
  readonly recordCommitted: (output_ref: string, committed_bytes: number, now: number) => number
  readonly recordSeal: (output_ref: string, integrity_tag: string, now: number) => void
  readonly recordAbort: (output_ref: string, now: number) => void
  readonly markSealRequested: (output_ref: string, now: number) => void
  readonly setState: (output_ref: string, state: GroupState, now: number) => void
  readonly get: (output_ref: string) => GenerationRecord | null
  readonly listOpen: () => readonly GenerationRecord[]
  readonly addEdge: (output_ref: string, kind: RetentionEdgeKind, holder_ref: string) => void
  readonly removeEdge: (output_ref: string, kind: RetentionEdgeKind, holder_ref: string) => boolean
  readonly listEdges: (output_ref: string) => readonly { readonly kind: RetentionEdgeKind; readonly holder_ref: string }[]
  readonly deleteGeneration: (output_ref: string) => void
}

/** Build the control store over an injected `bun:sqlite` database; creates the schema idempotently. */
export const createControlStore = (db: Database): ControlStore => {
  db.run(SCHEMA)

  const insert = db.query(
    `INSERT INTO channel_generation
       (output_ref, group_id, generation, channel, durability_tier, correlation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const activeGet = db.query(`SELECT generation FROM active_generation WHERE group_id = ?`)
  const activeUpsert = db.query(
    `INSERT INTO active_generation (group_id, generation) VALUES (?, ?)
       ON CONFLICT(group_id) DO UPDATE SET generation = excluded.generation`,
  )
  const getRow = db.query(`SELECT * FROM channel_generation WHERE output_ref = ?`)
  const openRows = db.query(`SELECT * FROM channel_generation WHERE state IN ('open','sealing')`)

  const openGeneration = (input: OpenGenerationInput): OpenOutcome => {
    const activeRow = activeGet.get(input.group_id) as { generation: number } | null
    const active = activeRow ? Number(activeRow.generation) : -1
    if (input.generation < active) return { accepted: false, active_generation: active }
    insert.run(
      input.output_ref, input.group_id, input.generation, input.channel,
      input.durability_tier, input.correlation_id, input.now, input.now,
    )
    activeUpsert.run(input.group_id, Math.max(active, input.generation))
    return { accepted: true }
  }

  const recordCommitted = (output_ref: string, committed_bytes: number, now: number): number => {
    // Monotonic per generation — never shrinks a committed extent (C12).
    db.query(
      `UPDATE channel_generation SET committed_bytes = MAX(committed_bytes, ?), updated_at = ? WHERE output_ref = ?`,
    ).run(Math.max(0, Math.floor(committed_bytes)), now, output_ref)
    return get(output_ref)?.committed_bytes ?? 0
  }

  const recordSeal = (output_ref: string, integrity_tag: string, now: number): void => {
    db.query(
      `UPDATE channel_generation SET seal_record = 1, state = 'sealed', integrity_tag = ?, updated_at = ? WHERE output_ref = ?`,
    ).run(integrity_tag, now, output_ref)
  }

  const recordAbort = (output_ref: string, now: number): void => {
    db.query(
      `UPDATE channel_generation SET abort_record = 1, state = 'aborted', updated_at = ? WHERE output_ref = ?`,
    ).run(now, output_ref)
  }

  const markSealRequested = (output_ref: string, now: number): void => {
    db.query(
      `UPDATE channel_generation SET seal_requested = 1, state = 'sealing', updated_at = ? WHERE output_ref = ?`,
    ).run(now, output_ref)
  }

  const setState = (output_ref: string, state: GroupState, now: number): void => {
    db.query(`UPDATE channel_generation SET state = ?, updated_at = ? WHERE output_ref = ?`).run(state, now, output_ref)
  }

  const get = (output_ref: string): GenerationRecord | null => {
    const row = getRow.get(output_ref) as Record<string, unknown> | null
    return row ? rowToRecord(row) : null
  }

  const listOpen = (): readonly GenerationRecord[] =>
    (openRows.all() as Record<string, unknown>[]).map(rowToRecord)

  const addEdge = (output_ref: string, kind: RetentionEdgeKind, holder_ref: string): void => {
    db.query(`INSERT OR IGNORE INTO reference_edge (output_ref, kind, holder_ref) VALUES (?, ?, ?)`).run(
      output_ref, kind, holder_ref,
    )
  }

  const removeEdge = (output_ref: string, kind: RetentionEdgeKind, holder_ref: string): boolean => {
    const before = listEdges(output_ref).length
    db.query(`DELETE FROM reference_edge WHERE output_ref = ? AND kind = ? AND holder_ref = ?`).run(
      output_ref, kind, holder_ref,
    )
    return listEdges(output_ref).length < before
  }

  const listEdges = (output_ref: string): readonly { readonly kind: RetentionEdgeKind; readonly holder_ref: string }[] =>
    (db.query(`SELECT kind, holder_ref FROM reference_edge WHERE output_ref = ?`).all(output_ref) as Record<string, unknown>[]).map(
      (r) => ({ kind: String(r.kind) as RetentionEdgeKind, holder_ref: String(r.holder_ref) }),
    )

  const deleteGeneration = (output_ref: string): void => {
    db.query(`DELETE FROM reference_edge WHERE output_ref = ?`).run(output_ref)
    db.query(`DELETE FROM channel_generation WHERE output_ref = ?`).run(output_ref)
  }

  return {
    openGeneration, recordCommitted, recordSeal, recordAbort, markSealRequested,
    setState, get, listOpen, addEdge, removeEdge, listEdges, deleteGeneration,
  }
}
