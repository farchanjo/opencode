/**
 * OutboxPort — external systems only (Feature 007 / T023).
 * Local Config/EventV2 mutations MUST NOT require outbox for success.
 * prepareExternal is checked BEFORE mutation; failure aborts without partial commit.
 */
export type OutboxMessage = {
  readonly id: string
  readonly target: string
  readonly payloadHash: string
  readonly createdAtMs: number
  readonly delivered: boolean
  /** Durable pending body for operator.audit reconcile (secret-free AuditRecord). */
  readonly body?: unknown
}

export type OutboxPrepareResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

export type OutboxPort = {
  readonly enqueue: (input: {
    target: string
    payloadHash: string
    nowMs: number
    id?: string
    body?: unknown
  }) => Promise<{ readonly id: string }>
  readonly listPending: (limit?: number) => Promise<readonly OutboxMessage[]>
  readonly markDelivered: (id: string) => Promise<boolean>
  /** True if this port is required for local config success — always false for V1 local path. */
  readonly requiredForLocalMutation: () => boolean
  /**
   * Prepare external outbox before mutation. Failure must prevent local write.
   * Default implementations return ok for local-only paths.
   */
  readonly prepareExternal?: (input: {
    commandId: string
    nowMs: number
  }) => Promise<OutboxPrepareResult>
  /**
   * T024: claim lease for reconcile (Config+Flock).
   * - claimed: this owner holds the lease for one attempt
   * - skipped: another owner, missing, or already delivered
   * - dead_letter: max attempts exceeded (row retained as dead-letter, not pending)
   */
  readonly claim?: (id: string, owner: string, nowMs: number) => Promise<OutboxClaimResult>
  /** Permanently quarantine malformed or exhausted messages. */
  readonly markDeadLetter?: (id: string, reason: string) => Promise<boolean>
}

export type OutboxClaimResult =
  | { readonly status: "claimed" }
  | { readonly status: "skipped" }
  | { readonly status: "dead_letter" }

export * as OperatorOutboxPort from "./outbox-port"
