/**
 * Feature 005 — OutputSpool application ports (T014).
 *
 * TypeScript mirror of the `SpoolWriterPort`, `SpoolReaderPort`, `RetentionPort`
 * and `AdminPort` inbound-port interfaces from
 * doc/arch/sdd/005-add-a-canonical-file-backed-outputspool-and-paged/contracts/ports.ts.
 * These interfaces are implemented by the domain spool engine
 * (`packages/core/src/outputspool/**`) and application adapters
 * (`packages/opencode/src/outputspool/**`, `packages/opencode/src/operator/
 * outputspool/**`), and are consumed by Feature 002 (`Lifecycle.OutputRef`/
 * `BoundedOutputRef`, `RowTelemetry.output_ref`), Feature 003 (occurrence-owned
 * OutputGroup, `NotificationEnvelope.output_ref`), Feature 004 (execution-envelope
 * `output_ref`, language tag/provenance on textual channels), and Feature 007
 * operator control-plane adapters (Settings/CLI/TUI/palette/native-slash) per
 * ADR-0003 and ADR-0006. Feature 005 never registers a parallel command registry,
 * event bus, permission system, or store authority (C3, C7, C19, C20, C21).
 *
 * Request/response payloads and typed error unions live in ./commands — this file
 * defines only the port method signatures.
 */

import type { Effect } from "effect"
import type {
  AbortInput,
  AbortOutput,
  AdminError,
  AdminReleaseInput,
  AdminReleaseOutput,
  AppendInput,
  AppendOutput,
  CleanupInput,
  CleanupOutput,
  DeleteInput,
  DeleteOutput,
  ExportInput,
  ExportOutput,
  FollowInput,
  FollowOutput,
  LeaseInput,
  LeaseOutput,
  OpenInput,
  OpenOutput,
  PurgeInput,
  PurgeOutput,
  ReadInput,
  ReadOutput,
  ReleaseInput,
  ReleaseOutput,
  RetentionError,
  SealInput,
  SealOutput,
  SetQuotaInput,
  SetQuotaOutput,
  SetRetentionInput,
  SetRetentionOutput,
  ShareInput,
  ShareOutput,
  SpoolReaderError,
  SpoolWriterError,
  StatInput,
  StatOutput,
} from "./commands"

/**
 * Producer-owning port backing the native `begin`/`append`/`seal`/`abort`
 * contract. Only the producer that owns the Feature 002 Process may write its own
 * OutputGroup; no second executor writes bytes (FR2, FR38, C21). Stale-generation
 * fencing rejects append/seal from a superseded writer (FR14, FR27, C18, AC11).
 */
export interface SpoolWriterPort {
  /** Open a channel generation and mint its OutputRef (FR18). */
  readonly open: (input: OpenInput) => Effect.Effect<OpenOutput, SpoolWriterError>

  /** Idempotent bounded-queue append at the expected byte offset (FR8, FR9). */
  readonly append: (input: AppendInput) => Effect.Effect<AppendOutput, SpoolWriterError>

  /** Commit finality of committed bytes for a generation (FR24). */
  readonly seal: (input: SealInput) => Effect.Effect<SealOutput, SpoolWriterError>

  /** Stop further append while preserving committed bytes for authorized read (FR24, FR26). */
  readonly abort: (input: AbortInput) => Effect.Effect<AbortOutput, SpoolWriterError>
}

/**
 * Backs the reserved `output.stat|read|follow` consume-plane commands
 * (mutates:false, `scopesAllowed` session+project). Authorization is re-evaluated
 * per call; a raw OutputRef is never a saved permission resource (FR42, FR47,
 * FR48, C7, AC15).
 */
export interface SpoolReaderPort {
  /** Read model: state, committed bytes, channel, provenance (FR18). */
  readonly stat: (input: StatInput) => Effect.Effect<StatOutput, SpoolReaderError>

  /** Server-capped byte-offset page; UTF-8-safe; never splits a codepoint (FR20, FR21, C15, AC2, AC3). */
  readonly read: (input: ReadInput) => Effect.Effect<ReadOutput, SpoolReaderError>

  /** Resume from an opaque cursor; stable `expired`/`invalid_cursor` on a stale token (FR22, C14, AC4). */
  readonly follow: (input: FollowInput) => Effect.Effect<FollowOutput, SpoolReaderError>
}

/**
 * Reference-aware retention, never mtime-only. A group is reclaimable only when
 * TTL has elapsed AND it holds no live lease, no active reader/writer, and no
 * inbound reference-graph edge AND no legal/privacy hold applies (FR28-FR30,
 * AC16). `cleanup` reclaims only fully unreferenced expired groups in bounded
 * batches (AC17).
 */
export interface RetentionPort {
  /** Acquire a holder reference edge that blocks reclaim (FR28, C5). */
  readonly lease: (input: LeaseInput) => Effect.Effect<LeaseOutput, RetentionError>

  /** Drop exactly one holder reference edge (FR29). */
  readonly release: (input: ReleaseInput) => Effect.Effect<ReleaseOutput, RetentionError>

  /** Bounded-batch reclaim of fully unreferenced expired groups (FR29, FR30, AC17). */
  readonly cleanup: (input: CleanupInput) => Effect.Effect<CleanupOutput, RetentionError>
}

/**
 * Backs the reserved admin-plane `output.export|share|release|delete|purge|
 * retention.set|quota.set` commands, registered via Feature 007 per ADR-0003 and
 * ADR-0006; Feature 005 supplies only these typed domain implementations (C19).
 * Every mutation requires an operator principal, explicit scope, version/CAS,
 * idempotency, and audit (FR42). Export and share are deny-by-default across
 * projects; an in-project export is content-bounded and never a raw path (FR44,
 * C17).
 */
export interface AdminPort {
  /** In-project, content-bounded export; cross-project is deny-by-default (FR44, C17). */
  readonly export: (input: ExportInput) => Effect.Effect<ExportOutput, AdminError>

  /** In-project share grant; cross-project is deny-by-default (FR44, C17). */
  readonly share: (input: ShareInput) => Effect.Effect<ShareOutput, AdminError>

  /** Operator-forced drop of one holder reference edge, with audit (FR42, C7). */
  readonly release: (input: AdminReleaseInput) => Effect.Effect<AdminReleaseOutput, AdminError>

  /** Explicit deletion of one group, with audit (FR50). */
  readonly delete: (input: DeleteInput) => Effect.Effect<DeleteOutput, AdminError>

  /** Explicit legal-hold-aware purge, with audit (FR50, Privacy 1). */
  readonly purge: (input: PurgeInput) => Effect.Effect<PurgeOutput, AdminError>

  /** Backs `output.retention.set`; scope/CAS/idempotency/audit (FR30, C5). */
  readonly setRetention: (input: SetRetentionInput) => Effect.Effect<SetRetentionOutput, AdminError>

  /** Backs `output.quota.set`; scope/CAS/idempotency/audit (FR10, C3). */
  readonly setQuota: (input: SetQuotaInput) => Effect.Effect<SetQuotaOutput, AdminError>
}
