/**
 * Feature 005 / T037 (S24) — the typed `output.*` domain implementation backing
 * the Feature 007 operator control plane (C19, FR41-FR44).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and the
 * reserved-name guard; Feature 005 supplies ONLY these typed
 * `SpoolReaderPort`/`RetentionPort`/`AdminPort` domain implementations plus their
 * audit events. This port registers NO command ids and makes ZERO provider/model
 * calls, tokens, or cost (FR41, AC13): the consume-plane `stat`/`read`/`follow`
 * project content-free read models and authorized bounded pages, and every
 * admin-plane mutation carries an operator principal + explicit scope + version/
 * CAS + idempotency enforced by the backend, returning a Feature 007
 * audit-correlation id. The reserved `output.stat|read|follow|export|share|
 * release|delete|purge|retention.set|quota.set` ids already live in
 * `packages/core/src/operator/catalog.ts` at `RESERVED_CATALOG_VERSION = 1.3.0`
 * — no catalog bump is performed and no id is added here (C19).
 *
 * The backend seam (`OutputSpoolBackend`) is the un-audited domain surface the
 * Feature 005 application adapters (`packages/opencode/src/outputspool/**`:
 * control store, page reader, retention sweeper, authorization) collectively
 * provide; the composition root injects the real implementations, or an honest
 * capability gap when the live spool store is not reachable (see backend-live.ts).
 * This module never returns a filesystem path and never carries content or
 * secrets in a view (FR12, C18, C22).
 */
export * as OutputSpoolOperatorPort from "./outputspool-port"

import type {
  AdminError,
  AdminReleaseInput,
  AdminReleaseOutput,
  DeleteInput,
  DeleteOutput,
  ExportInput,
  ExportOutput,
  FollowInput,
  FollowOutput,
  PurgeInput,
  PurgeOutput,
  ReadInput,
  ReadOutput,
  SetQuotaInput,
  SetQuotaOutput,
  SetRetentionInput,
  SetRetentionOutput,
  ShareInput,
  ShareOutput,
  SpoolReaderError,
  StatInput,
  StatOutput,
} from "@opencode-ai/protocol/outputspool/commands"
import type { Effect } from "effect"

/** A bounded, secret-free operator audit event (never a prompt/payload/path, C22). */
export interface OutputSpoolAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "denied"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface OutputSpoolAuditSink {
  readonly record: (event: OutputSpoolAuditEvent) => Effect.Effect<void>
}

/**
 * The narrow domain seam the Feature 005 application adapters provide. The three
 * consume methods return content-free read models / authorized pages; the seven
 * admin methods return the settled result carrying a Feature 007 audit id. The
 * cross-project deny-by-default guard lives in the backend (FR44, C17).
 */
export interface OutputSpoolBackend {
  readonly stat: (input: StatInput) => Effect.Effect<StatOutput, SpoolReaderError>
  readonly read: (input: ReadInput) => Effect.Effect<ReadOutput, SpoolReaderError>
  readonly follow: (input: FollowInput) => Effect.Effect<FollowOutput, SpoolReaderError>
  readonly export: (input: ExportInput) => Effect.Effect<ExportOutput, AdminError>
  readonly share: (input: ShareInput) => Effect.Effect<ShareOutput, AdminError>
  readonly release: (input: AdminReleaseInput) => Effect.Effect<AdminReleaseOutput, AdminError>
  readonly delete: (input: DeleteInput) => Effect.Effect<DeleteOutput, AdminError>
  readonly purge: (input: PurgeInput) => Effect.Effect<PurgeOutput, AdminError>
  readonly setRetention: (input: SetRetentionInput) => Effect.Effect<SetRetentionOutput, AdminError>
  readonly setQuota: (input: SetQuotaInput) => Effect.Effect<SetQuotaOutput, AdminError>
}

/** The typed operator port; a thin pass-through over the injected backend (mirrors langlock-port). */
export type OutputSpoolPort = OutputSpoolBackend

export interface OutputSpoolPortDeps {
  readonly backend: OutputSpoolBackend
}

/**
 * Build the typed `output.*` operator port over the injected domain backend. The
 * backend already authors the audit-correlation ids on admin outputs and the
 * cross-project deny-by-default guard; this port is the stable surface the
 * command adapter and the CLI/TUI consume (FR41, AC13).
 */
export const createOutputSpoolPort = (deps: OutputSpoolPortDeps): OutputSpoolPort => deps.backend
