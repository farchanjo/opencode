/**
 * Retention policy constants (Feature 007 / T016, T024).
 */
/** Config snapshot retention: max count. */
export const SNAPSHOT_MAX_COUNT = 10 as const

/** Config snapshot retention: max age in days. */
export const SNAPSHOT_MAX_AGE_DAYS = 30 as const

/** Audit retention: max age in days. */
export const AUDIT_RETENTION_DAYS = 90 as const

export const MS_PER_DAY = 86_400_000 as const

export function snapshotMaxAgeMs(): number {
  return SNAPSHOT_MAX_AGE_DAYS * MS_PER_DAY
}

export function auditRetentionMs(): number {
  return AUDIT_RETENTION_DAYS * MS_PER_DAY
}

/**
 * Select snapshot ids to prune: keep newest up to maxCount and within maxAgeMs of now.
 * Returns ids that should be deleted (oldest first).
 */
export function selectSnapshotsToPrune(
  entries: readonly { readonly id: string; readonly createdAtMs: number }[],
  nowMs: number,
  options?: { readonly maxCount?: number; readonly maxAgeMs?: number },
): readonly string[] {
  const maxCount = options?.maxCount ?? SNAPSHOT_MAX_COUNT
  const maxAgeMs = options?.maxAgeMs ?? snapshotMaxAgeMs()
  const sorted = [...entries].sort((a, b) => b.createdAtMs - a.createdAtMs)
  const drop = new Set<string>()
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!
    if (i >= maxCount) drop.add(e.id)
    if (nowMs - e.createdAtMs > maxAgeMs) drop.add(e.id)
  }
  return sorted.filter((e) => drop.has(e.id)).map((e) => e.id)
}

/**
 * Select audit ids older than retention window for prune.
 */
export function selectAuditsToPrune(
  entries: readonly { readonly id: string; readonly createdAtMs: number }[],
  nowMs: number,
  options?: { readonly retentionMs?: number },
): readonly string[] {
  const retentionMs = options?.retentionMs ?? auditRetentionMs()
  return entries.filter((e) => nowMs - e.createdAtMs > retentionMs).map((e) => e.id)
}

export * as OperatorRetention from "./retention"
