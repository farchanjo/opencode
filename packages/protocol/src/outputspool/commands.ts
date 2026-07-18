/**
 * Feature 005 — OutputSpool protocol payloads (T014).
 *
 * TypeScript mirror of the shared identifiers, closed enums, the 11-member
 * `output.*` content-plane event vocabulary (durable/live split), the read
 * models, the native `begin`/`append`/`read`/`follow`/`seal`/`abort`/`stat`/
 * `release`/`cleanup` and `output.*` operator command/query payloads, and the
 * typed `SpoolWriterError`/`SpoolReaderError`/`RetentionError`/`AdminError`
 * unions from
 * doc/arch/sdd/005-add-a-canonical-file-backed-outputspool-and-paged/contracts/ports.ts
 * (FR9, FR18, FR20, FR22, FR41, FR42, FR44, C7, C14, C17, C19, C20). The
 * `SpoolWriterPort`/`SpoolReaderPort`/`RetentionPort`/`AdminPort` interfaces live
 * in ./ports — this file defines only the payload shapes they consume.
 *
 * Single-vocabulary discipline (T014): the closed enums whose authority is the
 * CUE corpus (doc/arch/schemas/outputspool/*.cue) — the 7-member `Channel`, the
 * 7-member `GroupState`, the 3-member `DurabilityTier`, the 5-member
 * `QuotaScope`, the 6-member `RetentionEdgeKind`, the 6-member `ActionScope`, and
 * the 11-member `OutputEventType` — are SOURCED from
 * `@opencode-ai/schema/outputspool/*` rather than re-declared, so the transport
 * contract can never diverge from the wire shape. This mirror never redefines the
 * `packages/schema/src/outputspool/*` event payload schemas (C20).
 *
 * Reconciliation (T014): contracts/ports.ts presented a divergent provisional
 * surface — a 13-member `output.*` vocabulary and a 5-member `ReferenceEdgeKind`.
 * This mirror reconciles it to the CUE authority (11 event names, 7 durable + 4
 * live, the 6-member retention edge set) and sources every reconciled enum from
 * the schema modules so the transport contract cannot drift. The camelCase
 * protocol shapes here are the operator-surface projection consumed by Feature
 * 007 adapters, distinct from the persisted snake_case domain records.
 */

import type {
  ActionScope as SchemaActionScope,
  AdmissionFault as SchemaAdmissionFault,
  Channel as SchemaChannel,
  CursorState as SchemaCursorState,
  DurabilityTier as SchemaDurabilityTier,
  ErrorCode as SchemaErrorCode,
  GroupState as SchemaGroupState,
  QuotaScope as SchemaQuotaScope,
  RetentionEdgeKind as SchemaRetentionEdgeKind,
} from "@opencode-ai/schema/outputspool/enums"
import type {
  ExportEncoding as SchemaExportEncoding,
  SettlementOutcome as SchemaSettlementOutcome,
} from "@opencode-ai/schema/outputspool/enums-event"
import type { OutputEventType as SchemaOutputEventType } from "@opencode-ai/schema/outputspool/event-types"

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
 * `OutputGroupRef` maps to exactly one generation subtree; a stale generation
 * never shares a file with its successor (C1, C18).
 */
export interface OutputGroupRef {
  readonly projectId: ProjectId
  readonly rootSessionId: RootSessionId
  readonly processAttemptId: ProcessAttemptId
  readonly generation: GenerationId
}

// =============================================================================
// Closed enums — SOURCED from @opencode-ai/schema/outputspool/* (T014, single vocabulary)
// =============================================================================

/** The 7-member channel vocabulary; the CUE authority (FR15). */
export type ChannelKind = SchemaChannel

/** The 7-member state machine; the CUE authority (FR19, C20). `sealed`/`aborted`/`corrupt`/`expired`/`unknown` are terminal. */
export type GroupState = SchemaGroupState

/** Tiered durability by channel class, never per-token fsync; the CUE authority (C2). */
export type FsyncTier = SchemaDurabilityTier

/** Cursor lifecycle bucket; the CUE authority (C14, C18). */
export type CursorState = SchemaCursorState

/** Observable admission/fault states; the CUE authority, never swallowed (FR10, C4). */
export type AdmissionFaultKind = SchemaAdmissionFault

/** Action scope enumeration; the 6-member CUE authority, re-evaluated per action (FR43, C7). */
export type Scope = SchemaActionScope

/** Quota caps apply at these five scopes; the CUE authority (FR10, C3). */
export type QuotaScope = SchemaQuotaScope

/**
 * Reference-graph inbound edge kinds gating retention reclaim; reconciled to the
 * 6-member CUE `RetentionEdgeKind` authority (T014, FR28-FR30, C5).
 */
export type ReferenceEdgeKind = SchemaRetentionEdgeKind

/** Stable error codes returned across every port; never a path or content snippet (C22). */
export type StableErrorCode = SchemaErrorCode

/** The bounded allowed export encoding; the CUE authority, never a raw path (FR44, C17). */
export type ExportEncoding = SchemaExportEncoding

/**
 * Settlement flow bucket bridging content-plane settlement to the Feature 002
 * terminal-status seam (plan.md "State machines" → "Settlement flow with Feature
 * 002", C13). Feature 002 owns `terminal`; Feature 005 owns every state before
 * it. Protocol-surface concept; not a CUE schema enum — the content-plane
 * settlement result is the CUE `SettlementOutcome` (FR23, C13).
 */
export type SettlementState =
  | "running"
  | "settling"
  | "settled_sealed"
  | "settled_unknown"
  | "settled_corrupt"
  | "terminal"

/** The content-plane settlement outcome observed by the parent; the CUE authority (FR23, C13). */
export type SettlementOutcome = SchemaSettlementOutcome

// =============================================================================
// output.* event vocabulary (wire shape: doc/arch/schemas/outputspool/event-types.cue)
// =============================================================================

/**
 * Durable event classes: carry the EventV2 `durable {version, aggregate}`
 * annotation and register via `EventV2.define` into
 * `packages/schema/src/durable-event-manifest.ts` through the single EventV2
 * authority (C20). Seal, abort, settlement, reconciliation, generation-fencing
 * and retention release/reclaim outcomes; content is never an event payload (FR4,
 * FR5). Reconciled to the seven CUE settlement members (T014), matching
 * `@opencode-ai/schema/outputspool/events-settlement`.
 */
export const DURABLE_OUTPUTSPOOL_EVENT_TYPES = [
  "output.channel_sealed",
  "output.channel_aborted",
  "output.settlement_recorded",
  "output.reconciled",
  "output.generation_fenced",
  "output.group_released",
  "output.group_reclaimed",
] as const

/**
 * Live event classes: omit `durable` (no sequence, no replay); MAY be dropped
 * under `allBounded` load without affecting durable seal/read (C20). Reconciled
 * to the four CUE live members (T014), matching
 * `@opencode-ai/schema/outputspool/events-live`.
 */
export const LIVE_OUTPUTSPOOL_EVENT_TYPES = [
  "output.chunk_appended",
  "output.backpressure_signalled",
  "output.admission_degraded",
  "output.unknown",
] as const

export type DurableOutputSpoolEventType = (typeof DURABLE_OUTPUTSPOOL_EVENT_TYPES)[number]
export type LiveOutputSpoolEventType = (typeof LIVE_OUTPUTSPOOL_EVENT_TYPES)[number]

/**
 * The 11-member closed `output.*` event vocabulary (C20), SOURCED from
 * `@opencode-ai/schema/outputspool/event-types` so protocol and schema never drift.
 */
export type OutputSpoolEventType = SchemaOutputEventType

// =============================================================================
// Wire mirrors (page, stat, preview, quota, retention, lease)
// =============================================================================

/**
 * Read response page (wire shape: doc/arch/schemas/outputspool/page.cue). `eof`
 * is true only when the channel is sealed (or aborted with no further append) and
 * the reader has consumed through committed end (FR21, C20).
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
 * Never a path and never a full channel; secret material is a `SecretRef` (FR4,
 * FR33, C8, C22).
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
// SpoolWriterPort payloads — open / append / seal / abort (FR8, FR9, FR18, FR24, C2, C20)
// =============================================================================

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
// SpoolReaderPort payloads — stat / read / follow with cursors (FR18, FR20-FR22, C14, C23)
// =============================================================================

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
// RetentionPort payloads — lease / release / cleanup (FR28-FR30, C5)
// =============================================================================

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
// AdminPort payloads — export / share / release / delete / purge / retention.set / quota.set
// (FR41-FR44, C17, C19, registered via Feature 007)
// =============================================================================

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
