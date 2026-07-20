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
  SetRetentionInput,
  ShareInput,
  ShareOutput,
  SpoolReaderError,
  StatInput,
  StatOutput,
} from "@opencode-ai/protocol/outputspool/commands"
import type { Effect } from "effect"
import type { OperatorMutationPlan } from "@/operator/application/handler"

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
 * The narrow domain seam the Feature 005 application adapters provide, converted to
 * the Feature 014 `OperatorMutationPlan` commit contract (FR5, FR6).
 *
 * `stat`/`read`/`follow` are content-free reads over the real control store + page
 * reader. `export`/`share` are cross-project deny-by-default (FR44, C17).
 * `release`/`delete`/`purge` act on the control store (SQLite) — a substrate the
 * Feature 007 config-CAS `mutateAuthority` pipeline cannot atomically own without
 * fabricating success, so they degrade to a typed capability gap by design (FR14),
 * mirroring the FR10 lifecycle-cancel boundary. `retention.set`/`quota.set` persist
 * bounded POLICY, which is genuinely config-backed: they VALIDATE at plan time and
 * return an `OperatorMutationPlan` so `mutateAuthority` owns the single committed CAS
 * write through the config round-trip seam — the backend never self-commits.
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
  readonly planSetRetention: (input: SetRetentionInput) => Effect.Effect<OperatorMutationPlan, AdminError>
  readonly planSetQuota: (input: SetQuotaInput) => Effect.Effect<OperatorMutationPlan, AdminError>
  /**
   * Feature 017 / T014 (FR9, ADR-0017) — the store-scoped admin edge. `release`/
   * `delete`/`purge` are SQLite control-store ops, not config-CAS writes: the plan's
   * `apply` records the admin outcome (the real control-store generation, NEVER a
   * fabricated config CAS version) under a store-scoped authority, and the live store
   * op runs at plan-build time so a rejection persists NOTHING (no phantom write). The
   * dispatcher's `mutateAuthority` commits the record + emits the Feature 007 audit.
   */
  readonly planRelease: (input: AdminReleaseInput) => Effect.Effect<OperatorMutationPlan, AdminError>
  readonly planDelete: (input: DeleteInput) => Effect.Effect<OperatorMutationPlan, AdminError>
  readonly planPurge: (input: PurgeInput) => Effect.Effect<OperatorMutationPlan, AdminError>
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
