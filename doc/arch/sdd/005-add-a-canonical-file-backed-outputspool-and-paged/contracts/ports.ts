/**
 * Feature 005 — Application Ports (OutputSpool and ArtifactStore: Canonical
 * File-Backed Content Plane and Paged Access)
 *
 * These interfaces define the inbound ports owned by Feature 005. They are
 * implemented by the domain spool engine (`packages/core/src/outputspool/**`)
 * and application adapters (`packages/opencode/src/outputspool/**`,
 * `packages/opencode/src/operator/outputspool/**`), and are consumed by
 * Feature 002 (`Lifecycle.OutputRef`/`BoundedOutputRef`,
 * `RowTelemetry.output_ref`), Feature 003 (occurrence-owned OutputGroup,
 * `NotificationEnvelope.output_ref`), Feature 004 (execution-envelope
 * `output_ref`, language tag/provenance on textual channels), and Feature 007
 * operator control-plane adapters (Settings/CLI/TUI/palette/native-slash) per
 * ADR-0003 and ADR-0006. Feature 005 never registers a parallel command
 * registry, event bus, permission system, or store authority (C3, C7, C19,
 * C20, C21; plan.md "Non-goals").
 *
 * Domain: file-backed content from the first observable chunk over a bounded
 * writer queue (FR6-FR9, C2), byte-offset UTF-8-safe paging with an opaque,
 * fencing-aware cursor (FR20-FR22, C14, C18), the closed
 * open->sealing->sealed/aborted/corrupt/expired/unknown state machine (FR19,
 * C20), ref-aware retention over TTL/lease/reference-edges/legal-hold
 * (FR28-FR30, C5), and the reserved `output.*` operator command surface
 * already at `RESERVED_CATALOG_VERSION = "1.3.0"` (FR41-FR44, C17, C19).
 * Every mutation (writer open/append/seal/abort and every admin op) requires
 * a re-evaluated authorization; admin ops additionally require an operator
 * principal, explicit scope, version/CAS, idempotency, and audit (FR42,
 * FR47, FR48, C7).
 *
 * Wire-shape source of truth: `doc/arch/schemas/outputspool/*.cue` (ids.cue,
 * cursor.cue, enums.cue, page.cue, stat.cue, preview.cue, quota.cue,
 * retention.cue, events.cue — plan.md "New module tree target"). This file
 * is the TypeScript mirror; it does not redefine event payload schemas owned
 * by `packages/schema/src/outputspool/*`.
 */

import type { Effect } from "effect"

// =============================================================================
// Shared identifiers (wire shape: doc/arch/schemas/outputspool/ids.cue)
// =============================================================================

export type ProjectId = string
export type RootSessionId = string
export type ProcessAttemptId = string
export type GenerationId = string

/** Opaque bounded token; never a filesystem path and never a saved permission resource (FR12, FR17, FR48, C18). */
export type OutputRef = string

/** Opaque token encoding group id, generation, channel, and byte offset plus an integrity tag (FR17, FR22, C14, C18). */
export type Cursor = string

export type LeaseId = string
export type AuditId = string

/** Opaque secret reference minted by Feature 007 SecretPort; never inline plaintext in a preview (FR4, C8, C22). */
export type SecretRef = string

/**
 * Output identity scoped to process/attempt/generation (FR14). One
 * `OutputGroupRef` maps to exactly one generation subtree; a stale
 * generation never shares a file with its successor (C1, C18).
 */
export interface OutputGroupRef {
  readonly projectId: ProjectId
  readonly rootSessionId: RootSessionId
  readonly processAttemptId: ProcessAttemptId
  readonly generation: GenerationId
}

// =============================================================================
// Closed enums (wire shape: doc/arch/schemas/outputspool/enums.cue)
// =============================================================================

/** The 7-member channel vocabulary; every group opens exactly one channel kind (FR15). */
export type ChannelKind =
  | "assistant-text"
  | "reasoning"
  | "stdout"
  | "stderr"
  | "tool-result"
  | "error"
  | "artifact"

/**
 * The 7-member state machine (FR19, C20). `sealed`, `aborted`, `corrupt`,
 * `expired`, and `unknown` are terminal for the generation.
 */
export type GroupState = "open" | "sealing" | "sealed" | "aborted" | "corrupt" | "expired" | "unknown"

/** Tiered durability by channel class, never per-token fsync (C2). */
export type FsyncTier = "durable" | "console" | "disposable"

/** Cursor lifecycle bucket (plan.md "State machines" -> "Cursor lifecycle", C14, C18). */
export type CursorState = "active" | "invalidated" | "rejected"

/**
 * Settlement flow bucket bridging content-plane settlement to the Feature 002
 * terminal-status seam (plan.md "State machines" -> "Settlement flow with
 * Feature 002", C13). Feature 002 owns `terminal`; Feature 005 owns every
 * state before it.
 */
export type SettlementState =
  | "running"
  | "settling"
  | "settled_sealed"
  | "settled_unknown"
  | "settled_corrupt"
  | "terminal"

/** Observable admission/fault states; never swallowed (FR10, C4). */
export type AdmissionFaultKind = "enospc" | "fd_exhaustion" | "quota" | "permission" | "latency"

/** Action scope enumeration; re-evaluated per action (FR43, C7). */
export type Scope = "self" | "child" | "tree" | "session" | "project" | "operator-global"

/** Quota caps apply at these scopes (FR10, C3). */
export type QuotaScope = "global" | "root" | "session" | "process" | "channel"

/** Reference-graph inbound edge kinds gating retention reclaim (FR28-FR30, C5). */
export type ReferenceEdgeKind =
  | "transcript"
  | "todo_evidence"
  | "handoff_envelope"
  | "notification_envelope"
  | "row_telemetry"

/** Stable error codes returned across every port; never a path or content snippet (C22). */
export type StableErrorCode =
  | "not_found"
  | "denied"
  | "quota"
  | "enospc"
  | "corrupt"
  | "expired"
  | "invalid_cursor"

// =============================================================================
// output.* event vocabulary (wire shape: doc/arch/schemas/outputspool/events.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and register via `EventV2.define` into
 * `packages/schema/src/durable-event-manifest.ts` through the single EventV2
 * authority (C20). Seal, abort, settlement, and reconciliation outcomes;
 * content is never an event payload (FR4, FR5).
 */
export const DURABLE_OUTPUTSPOOL_EVENT_TYPES = [
  "output.sealed",
  "output.aborted",
  "output.settled_sealed",
  "output.settled_unknown",
  "output.settled_corrupt",
  "output.released",
  "output.purged",
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay); MAY be
 * dropped under `allBounded` load without affecting durable seal/read (C20).
 */
export const LIVE_OUTPUTSPOOL_EVENT_TYPES = [
  "output.append_progress",
  "output.backpressure",
  "output.admission_fault",
  "output.cursor_invalidated",
  "output.reconcile_started",
  "output.unknown",
] as const

export type DurableOutputSpoolEventType = (typeof DURABLE_OUTPUTSPOOL_EVENT_TYPES)[number]
export type LiveOutputSpoolEventType = (typeof LIVE_OUTPUTSPOOL_EVENT_TYPES)[number]

/** The 13-member closed `output.*` event vocabulary (C20). */
export type OutputSpoolEventType = DurableOutputSpoolEventType | LiveOutputSpoolEventType

// =============================================================================
// Wire mirrors (page, stat, preview, quota, retention, lease)
// =============================================================================

/**
 * Read response page (wire shape: doc/arch/schemas/outputspool/page.cue).
 * `eof` is true only when the channel is sealed (or aborted with no further
 * append) and the reader has consumed through committed end (FR21, C20).
 */
export interface ReadPage {
  readonly bytes: Uint8Array
  readonly nextOffset: number
  readonly committedBytes: number
  readonly caughtUp: boolean
  readonly eof: boolean
}

/** Read model backing `output.stat` (wire shape: doc/arch/schemas/outputspool/stat.cue, FR18). */
export interface OutputStat {
  readonly outputRef: OutputRef
  readonly channel: ChannelKind
  readonly state: GroupState
  readonly committedBytes: number
  readonly fsyncTier: FsyncTier
  readonly languageTag?: string // Feature 004 Lang Lock provenance on textual channels (FR40)
  readonly updatedAt: string // ISO-8601
}

/**
 * Bounded redacted preview (wire shape: doc/arch/schemas/outputspool/preview.cue).
 * Never a path and never a full channel; secret material is a `SecretRef`
 * (FR4, FR33, C8, C22).
 */
export interface BoundedPreview {
  readonly outputRef: OutputRef
  readonly headSlice: string
  readonly truncated: boolean
  readonly secretRefs: readonly SecretRef[]
}

/** Scope-caps descriptor (wire shape: doc/arch/schemas/outputspool/quota.cue, FR10, C3). */
export interface QuotaDescriptor {
  readonly scope: QuotaScope
  readonly scopeId: string
  readonly maxBytes: number
  readonly maxQueueDepthBytes: number
}

/** Reclaim-eligibility descriptor (wire shape: doc/arch/schemas/outputspool/retention.cue, FR28-FR30, C5). */
export interface RetentionDescriptor {
  readonly ttlSeconds: number
  readonly hasLiveLease: boolean
  readonly hasActiveReaderOrWriter: boolean
  readonly referenceEdgeKinds: readonly ReferenceEdgeKind[]
  readonly legalHold: boolean
}

/** One holder reference edge; `release` drops exactly one (FR28-FR30, C5). */
export interface Lease {
  readonly leaseId: LeaseId
  readonly outputRef: OutputRef
  readonly holderKind: ReferenceEdgeKind
  readonly expiresAt: string // ISO-8601
}

// =============================================================================
// Principals
// =============================================================================

/** Feature 007 operator principals permitted to authorize admin-plane output actions (C7). */
export interface OperatorPrincipal {
  readonly kind: "operator" | "manager-view" | "system"
  readonly id: string
}

// =============================================================================
// SpoolWriterPort — open / append / seal / abort (FR8, FR9, FR18, FR24, C2, C20)
// =============================================================================

/**
 * Producer-owning port backing the native `begin`/`append`/`seal`/`abort`
 * contract. Only the producer that owns the Feature 002 Process may write
 * its own OutputGroup; no second executor writes bytes (FR2, FR38, C21).
 * Stale-generation fencing rejects append/seal from a superseded writer
 * (FR14, FR27, C18, AC11).
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

export interface OpenInput {
  readonly groupRef: OutputGroupRef
  readonly channel: ChannelKind
  readonly fsyncTier: FsyncTier
}

export interface OpenOutput {
  readonly outputRef: OutputRef
  readonly state: GroupState
}

export interface AppendInput {
  readonly outputRef: OutputRef
  readonly expectedOffset: number
  readonly chunk: Uint8Array
}

export interface AppendOutput {
  readonly committedBytes: number
  readonly state: GroupState
}

export interface SealInput {
  readonly outputRef: OutputRef
}

export interface SealOutput {
  readonly committedBytes: number
  readonly state: GroupState
}

export interface AbortInput {
  readonly outputRef: OutputRef
  readonly reason: string
}

export interface AbortOutput {
  readonly committedBytes: number
  readonly state: GroupState
}

export type SpoolWriterError =
  | { readonly type: "stale_generation"; readonly outputRef: OutputRef } // guards C18, C21 fencing
  | { readonly type: "enospc" } // guards C4
  | { readonly type: "fd_exhaustion" } // guards C4
  | { readonly type: "quota"; readonly scope: QuotaScope } // guards FR10, C3, C4
  | { readonly type: "permission_denied" } // guards C4, C6
  | { readonly type: "offset_conflict"; readonly expectedOffset: number; readonly actualOffset: number } // guards FR9
  | { readonly type: "corrupt"; readonly outputRef: OutputRef } // guards C12
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// SpoolReaderPort — stat / read / follow with cursors (FR18, FR20-FR22, C14, C23)
// =============================================================================

/**
 * Backs the reserved `output.stat|read|follow` consume-plane commands
 * (mutates:false, `scopesAllowed` session+project). Authorization is
 * re-evaluated per call; a raw OutputRef is never a saved permission
 * resource (FR42, FR47, FR48, C7, AC15).
 */
export interface SpoolReaderPort {
  /** Read model: state, committed bytes, channel, provenance (FR18). */
  readonly stat: (input: StatInput) => Effect.Effect<StatOutput, SpoolReaderError>

  /** Server-capped byte-offset page; UTF-8-safe; never splits a codepoint (FR20, FR21, C15, AC2, AC3). */
  readonly read: (input: ReadInput) => Effect.Effect<ReadOutput, SpoolReaderError>

  /** Resume from an opaque cursor; stable `expired`/`invalid_cursor` on a stale token (FR22, C14, AC4). */
  readonly follow: (input: FollowInput) => Effect.Effect<FollowOutput, SpoolReaderError>
}

export interface StatInput {
  readonly outputRef: OutputRef
  readonly principal: OperatorPrincipal
}

export interface StatOutput {
  readonly stat: OutputStat
}

export interface ReadInput {
  readonly outputRef: OutputRef
  readonly offset: number
  readonly limit: number // mandatory, server-capped (FR20)
  readonly principal: OperatorPrincipal
}

export interface ReadOutput {
  readonly page: ReadPage
}

export interface FollowInput {
  readonly cursor: Cursor
  readonly principal: OperatorPrincipal
}

export interface FollowOutput {
  readonly page: ReadPage
  readonly cursor: Cursor
}

export type SpoolReaderError =
  | { readonly type: "not_found"; readonly outputRef: OutputRef } // guards StableErrorCode "not_found"
  | { readonly type: "denied"; readonly reason: string } // guards FR47, FR48, C7
  | { readonly type: "expired" } // guards C14
  | { readonly type: "invalid_cursor"; readonly cursor: Cursor } // guards C14, AC4
  | { readonly type: "invalid_argument"; readonly field: string; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// RetentionPort — lease / release / cleanup (FR28-FR30, C5)
// =============================================================================

/**
 * Reference-aware retention, never mtime-only. A group is reclaimable only
 * when TTL has elapsed AND it holds no live lease, no active reader/writer,
 * and no inbound reference-graph edge AND no legal/privacy hold applies
 * (FR28-FR30, AC16). `cleanup` reclaims only fully unreferenced expired
 * groups in bounded batches (AC17).
 */
export interface RetentionPort {
  /** Acquire a holder reference edge that blocks reclaim (FR28, C5). */
  readonly lease: (input: LeaseInput) => Effect.Effect<LeaseOutput, RetentionError>

  /** Drop exactly one holder reference edge (FR29). */
  readonly release: (input: ReleaseInput) => Effect.Effect<ReleaseOutput, RetentionError>

  /** Bounded-batch reclaim of fully unreferenced expired groups (FR29, FR30, AC17). */
  readonly cleanup: (input: CleanupInput) => Effect.Effect<CleanupOutput, RetentionError>
}

export interface LeaseInput {
  readonly outputRef: OutputRef
  readonly holderKind: ReferenceEdgeKind
  readonly ttlSeconds: number
}

export interface LeaseOutput {
  readonly lease: Lease
}

export interface ReleaseInput {
  readonly leaseId: LeaseId
  readonly principal: OperatorPrincipal
}

export interface ReleaseOutput {
  readonly outputRef: OutputRef
  readonly remainingEdgeCount: number
}

export interface CleanupInput {
  readonly scope: Scope
  readonly scopeId: string
  readonly batchLimit: number
}

export interface CleanupOutput {
  readonly reclaimedCount: number
  readonly scannedCount: number
}

export type RetentionError =
  | { readonly type: "not_found"; readonly outputRef: OutputRef }
  | { readonly type: "referenced"; readonly outputRef: OutputRef } // guards C5 — live lease/reader/writer/edge blocks reclaim
  | { readonly type: "legal_hold"; readonly outputRef: OutputRef } // guards Privacy 1
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// AdminPort — export / share / release / delete / purge / retention.set / quota.set
// (FR41-FR44, C17, C19, registered via Feature 007)
// =============================================================================

/**
 * Backs the reserved admin-plane `output.export|share|release|delete|purge|
 * retention.set|quota.set` commands, registered via Feature 007 per ADR-0003
 * and ADR-0006; Feature 005 supplies only these typed domain implementations
 * (C19). Every mutation requires an operator principal, explicit scope,
 * version/CAS, idempotency, and audit (FR42). Export and share are
 * deny-by-default across projects; an in-project export is content-bounded
 * and never a raw path (FR44, C17).
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

export interface ExportInput {
  readonly outputRef: OutputRef
  readonly scope: "project"
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface ExportOutput {
  readonly preview: BoundedPreview
  readonly auditId: AuditId
}

export interface ShareInput {
  readonly outputRef: OutputRef
  readonly scope: "project"
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface ShareOutput {
  readonly shareRef: OutputRef
  readonly auditId: AuditId
}

export interface AdminReleaseInput {
  readonly outputRef: OutputRef
  readonly scope: "project"
  readonly principal: OperatorPrincipal
}

export interface AdminReleaseOutput {
  readonly outputRef: OutputRef
  readonly auditId: AuditId
}

export interface DeleteInput {
  readonly outputRef: OutputRef
  readonly scope: "project"
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface DeleteOutput {
  readonly outputRef: OutputRef
  readonly auditId: AuditId
}

export interface PurgeInput {
  readonly outputRef: OutputRef
  readonly scope: "project"
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface PurgeOutput {
  readonly outputRef: OutputRef
  readonly auditId: AuditId
}

export interface SetRetentionInput {
  readonly scope: "global" | "project"
  readonly scopeId: string
  readonly retention: RetentionDescriptor
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface SetRetentionOutput {
  readonly retention: RetentionDescriptor
  readonly auditId: AuditId
}

export interface SetQuotaInput {
  readonly scope: "global" | "project"
  readonly scopeId: string
  readonly quota: QuotaDescriptor
  readonly expectedVersion: number
  readonly principal: OperatorPrincipal
}

export interface SetQuotaOutput {
  readonly quota: QuotaDescriptor
  readonly auditId: AuditId
}

export type AdminError =
  | { readonly type: "unauthorized"; readonly reason: string } // guards FR42, FR43, C7
  | { readonly type: "cross_project_denied" } // guards FR44, C17
  | { readonly type: "version_conflict"; readonly expectedVersion: number; readonly actualVersion: number }
  | { readonly type: "reserved_name"; readonly id: string } // guards C19 output.* collision
  | { readonly type: "not_found"; readonly outputRef: OutputRef }
  | { readonly type: "legal_hold"; readonly outputRef: OutputRef } // guards Privacy 1
  | { readonly type: "quota"; readonly scope: QuotaScope }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }
