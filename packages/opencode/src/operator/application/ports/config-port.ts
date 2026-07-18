/**
 * ConfigPort — sole config persistence boundary for Feature 007 (T013–T017).
 * Implementations MUST map to Config.Service authority (or test doubles that
 * simulate that contract). No parallel product config store.
 */
export type ConfigAuthorityKey = string

export type ConfigVersion = string

export type ConfigSnapshot = {
  readonly id: string
  readonly authority: ConfigAuthorityKey
  readonly version: ConfigVersion
  readonly createdAtMs: number
  /** Content-free hash of payload (no secrets). */
  readonly payloadHash: string
  /** Opaque storage ref — not secret material. */
  readonly payloadRef: string
}

export type ConfigEntry = {
  readonly version: ConfigVersion
  readonly payload: unknown
  readonly updatedAtMs: number
}

/** Metadata applied atomically inside compareAndSet (R1). */
export type CasAppliedMetadata = {
  readonly snapshot?: boolean
  readonly rollbackSlot?: boolean
  readonly clearRollback?: boolean
  readonly auditIntent?: boolean
}

export type CasResult =
  | {
      readonly ok: true
      readonly version: ConfigVersion
      readonly entry: ConfigEntry
      /** When set, mutation must not re-apply these via secondary writes. */
      readonly applied?: CasAppliedMetadata
    }
  | { readonly ok: false; readonly code: "conflict"; readonly currentVersion: ConfigVersion }
  | { readonly ok: false; readonly code: "unavailable"; readonly reason: string }

export type ConfigPort = {
  /** Read current entry for authority key; null if absent. */
  readonly get: (authority: ConfigAuthorityKey) => Promise<ConfigEntry | null>
  /**
   * Optimistic CAS write. expectedVersion null means create-if-absent.
   * On version mismatch returns conflict.
   */
  readonly compareAndSet: (input: {
    authority: ConfigAuthorityKey
    expectedVersion: ConfigVersion | null
    payload: unknown
    nowMs: number
    /**
     * T024: atomic audit outbox intent written in the SAME Flock Config update as authority CAS.
     * afterVersion filled by store to the new CAS version.
     */
    auditIntent?: {
      readonly record: {
        readonly source: string
        readonly actorRef: string
        readonly scope: { readonly kind: string; readonly ref: string | null }
        readonly commandId: string
        readonly beforeVersion: string | null
        readonly outcome: string
        readonly createdAtMs: number
      }
      readonly projectKey: string
      /** Optional precomputed event id; if omitted store derives from full record after afterVersion set. */
      readonly eventId?: string
    }
    /**
     * R1: capture snapshot of pre-CAS authority state in the SAME document write
     * as payload + auditIntent + optional rollback slot.
     */
    readonly snapshotBefore?: boolean
    /** R1: set cutover rollback slot in the same document write. */
    readonly rollbackSlot?: {
      readonly domain: string
      readonly previousBinding: string
      readonly previousPayload: unknown
      readonly activatedAtMs: number
      readonly available: boolean
    }
    /** R1: clear rollback slot in the same document write (rollback path). */
    readonly clearRollbackDomain?: string
  }) => Promise<CasResult>
  /** Capture snapshot of current authority state. */
  readonly snapshot: (input: {
    authority: ConfigAuthorityKey
    nowMs: number
    id?: string
  }) => Promise<ConfigSnapshot | null>
  readonly listSnapshots: (authority: ConfigAuthorityKey) => Promise<readonly ConfigSnapshot[]>
  readonly pruneSnapshots: (input: {
    authority: ConfigAuthorityKey
    dropIds: readonly string[]
  }) => Promise<number>
  readonly restoreSnapshot: (input: {
    authority: ConfigAuthorityKey
    snapshotId: string
    nowMs: number
  }) => Promise<CasResult>
}

/** Initial version token for first write. */
export const INITIAL_CONFIG_VERSION = "cas_v0" as const

export function nextConfigVersion(current: ConfigVersion | null): ConfigVersion {
  if (!current) return "cas_v1"
  const match = /^cas_v(\d+)$/.exec(current)
  if (!match) return `cas_v1`
  return `cas_v${Number(match[1]) + 1}`
}

export * as OperatorConfigPort from "./config-port"
