/**
 * Cutover rollback slot (Feature 007 / T017) — stores full prior payload.
 */
export type RollbackSlot = {
  readonly domain: string
  readonly previousBinding: string
  /** Full prior authority payload for restore (not just version token). */
  readonly previousPayload?: unknown
  readonly activatedAtMs: number
  readonly available: boolean
}

export type RollbackPort = {
  readonly get: (domain: string) => Promise<RollbackSlot | null>
  readonly set: (slot: RollbackSlot) => Promise<void>
  readonly clear: (domain: string) => Promise<void>
}

export * as OperatorRollbackPort from "./rollback-port"
