# Data Model: OutputSpool and ArtifactStore (Feature 005)

Feature: [005 OutputSpool and ArtifactStore](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
ADR: [ADR-0006 OutputSpool Content Plane and Paged ArtifactStore](../../adr/0006-output-spool-content-plane-and-paged-artifact-store.md) (proposed)
Status: draft (finalized in the tasks phase; numeric caps, fsync interval, preview
caps, adapter caps, cursor idle-TTL, and the reconciliation fence-record format are
provisional plan constants resolved in ADR-0006 and its successors — C2, C3, C4, C8,
C11, C12, C14)

Three shapes here are stores of record and nothing else is: the **managed spool
tree** holds the content bytes and is the recovery authority (C1), the **control
store** holds the committed-length authority and generation records (C12), and
**durable settlement records** are projections over the single EventV2 authority
(C20). No shape below is a second executor, store authority, event system, or
permission system (FR2, FR3). Each `output.*` durable settlement event registers
through `EventV2.define` into `packages/schema/src/durable-event-manifest.ts` and
publishes through the new `publishOutputEvent` boundary on the existing
`EventV2Bridge`, mirroring the Feature 002 lifecycle, Feature 003 jobs, and Feature
004 langlock patterns (C20). Live append/progress/backpressure signals use the
bounded live channel and may be dropped under `allBounded` load without affecting
durable seal/read (C20). Every consumer receives only an OutputRef, an opaque
cursor, content-free metadata, and authorized content pages — never a filesystem
path (FR12, C18).

## Schema surface conventions

All TypeScript shapes use this repository's Effect `Schema` v4 surface, matching
`packages/schema/src/schema.ts` and the existing `packages/schema/src/lifecycle/**`,
`packages/schema/src/jobs/**`, and `packages/schema/src/langlock/**` modules:

- Closed enums use `Schema.Literals([...])`; a single discriminant literal uses
  `Schema.Literal("...")`.
- **Annotate-first on a plain base for every checked scalar.** Each identifier,
  offset, count, and bounded-text ValueObject is built on the plain `Schema.String`
  / `Schema.Number` base, `.annotate({ identifier })` is applied BEFORE any
  `.check(...)`, and `Schema.brand(...)` (where the CUE definition is
  identifier-shaped) is applied last. Annotating an already-checked schema (including
  `Schema.Int`, the shared `PositiveInt` / `NonNegativeInt`) drops the root
  identifier from `.ast.annotations` in favor of the last check, so
  base-then-check-then-brand is load-bearing for contract hygiene (see
  `packages/schema/src/lifecycle/ids.ts`, `values.ts`, and
  `test/contract-hygiene.test.ts`).
- Byte offsets, lengths, and counters fold `Schema.isInt()` into the check chain
  alongside the bound check; the canonical offset unit is uncompressed bytes and no
  field is real-valued (FR20, C15). A committed length is carried, never re-authored
  — the control store owns the committed-length authority (FR25, C12).
- Optional keys use the shared `optional(...)` helper; explicit nullable fields use
  `Schema.NullOr(...)`.
- Epoch-millis observational timestamps decode through `DateTimeUtcFromMillis`; the
  CUE mirror carries the ISO-8601 `#Timestamp` string form.
- No stale `Schema.literal` / `Schema.Clamp` / `Schema.Positive` / `Schema.Number`
  (bare) forms are used; those are not part of this repository's surface.

Each shape names its target module under `packages/schema/src/outputspool/**` and
mirrors a CUE definition under `doc/arch/schemas/outputspool/*.cue` one-to-one. The
CUE packages are `outputspool.shared`, `outputspool.enums`, `outputspool.cursor`,
`outputspool.page`, `outputspool.stat`, `outputspool.preview`, `outputspool.quota`,
`outputspool.retention`, `outputspool.envelope`, `outputspool.events`,
`outputspool.group`, `outputspool.channel`, and `outputspool.admin`.

---

## Shared identifiers

Name parity with `lifecycle.shared`, `jobs.shared`, and `langlock.shared` is
intentional; this feature does not cross-import those modules, so the identifier
concepts are re-declared locally (C1, C18, C21). Mirrors
`doc/arch/schemas/outputspool/ids.cue`.

```typescript
// packages/schema/src/outputspool/ids.ts (novo)

import { Schema } from "effect"

const idPattern = /^[A-Za-z0-9_-]{1,128}$/
const eventIdPattern = /^evt_[A-Za-z0-9_-]{1,120}$/

// GroupId identifies one OutputGroup aggregate — one generation subtree (FR14, C1, C18).
export const GroupId = Schema.String.annotate({ identifier: "OutputSpoolIds.GroupId" })
  .check(Schema.isPattern(idPattern))
  .pipe(Schema.brand("OutputSpool.GroupId"))
export type GroupId = typeof GroupId.Type

// OutputRef is a bounded opaque channel/artifact handle — never a path, never a saved
// permission resource (FR12, FR17, FR48, C18).
export const OutputRef = Schema.String.annotate({ identifier: "OutputSpoolIds.OutputRef" })
  .check(Schema.isNonEmpty())
  .pipe(Schema.brand("OutputSpool.OutputRef"))
export type OutputRef = typeof OutputRef.Type

// ChannelId identifies one typed channel within a group (FR15).
export const ChannelId = Schema.String.annotate({ identifier: "OutputSpoolIds.ChannelId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.ChannelId"))
export type ChannelId = typeof ChannelId.Type

// ProcessId references the Feature 002 Task Process that owns the group — never an OS PID (FR14, C21).
export const ProcessId = Schema.String.annotate({ identifier: "OutputSpoolIds.ProcessId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.ProcessId"))
export type ProcessId = typeof ProcessId.Type

export const RootSessionId = Schema.String.annotate({ identifier: "OutputSpoolIds.RootSessionId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.RootSessionId"))
export const SessionId = Schema.String.annotate({ identifier: "OutputSpoolIds.SessionId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.SessionId"))
export const ProjectId = Schema.String.annotate({ identifier: "OutputSpoolIds.ProjectId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.ProjectId"))

// EventId is the EventV2 evt_ id assigned per published output.* event (C20).
export const EventId = Schema.String.annotate({ identifier: "OutputSpoolIds.EventId" })
  .check(Schema.isPattern(eventIdPattern)).pipe(Schema.brand("OutputSpool.EventId"))

// LeaseId / HolderRef — retention lease identity and opaque holder handle (FR28, C5).
export const LeaseId = Schema.String.annotate({ identifier: "OutputSpoolIds.LeaseId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.LeaseId"))
export const HolderRef = Schema.String.annotate({ identifier: "OutputSpoolIds.HolderRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.HolderRef"))
```

Correlation, principal, and reference-edge ValueObjects keep opaque handles only;
secrets are never raw values and no field is a filesystem path (FR12, FR28, Security
5, C5, C22). The reference edges gate ref-aware retention (C5). Mirrors
`doc/arch/schemas/outputspool/correlation.cue`.

```typescript
// packages/schema/src/outputspool/correlation.ts (novo)

export const CorrelationId = Schema.String.annotate({ identifier: "OutputSpoolIds.CorrelationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.CorrelationId"))
export const CausationId = Schema.String.annotate({ identifier: "OutputSpoolIds.CausationId" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("OutputSpool.CausationId"))
// Principal is re-evaluated per action; a raw OutputRef is never a saved resource (FR47, FR48, C7).
export const Principal = Schema.String.annotate({ identifier: "OutputSpoolIds.Principal" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.Principal"))
// SecretRef is a Feature 007 SecretPort secure reference — never raw secret material (FR5, C22).
export const SecretRef = Schema.String.annotate({ identifier: "OutputSpoolIds.SecretRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.SecretRef"))
// Inbound retention edges (C5): transcript, Todo, handoff, NotificationEnvelope, RowTelemetry.
export const TranscriptRef = Schema.String.annotate({ identifier: "OutputSpoolIds.TranscriptRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.TranscriptRef"))
export const TodoRef = Schema.String.annotate({ identifier: "OutputSpoolIds.TodoRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.TodoRef"))
export const HandoffRef = Schema.String.annotate({ identifier: "OutputSpoolIds.HandoffRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.HandoffRef"))
export const NotificationRef = Schema.String.annotate({ identifier: "OutputSpoolIds.NotificationRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.NotificationRef"))
export const RowTelemetryRef = Schema.String.annotate({ identifier: "OutputSpoolIds.RowTelemetryRef" })
  .check(Schema.isNonEmpty()).pipe(Schema.brand("OutputSpool.RowTelemetryRef"))
```

Byte-offset, length, and version-counter ValueObjects keep primitive obsession out
of the aggregates. The canonical offset unit is uncompressed bytes (FR20, C15); the
committed length is the control-store recovery authority, carried not re-authored
(FR25, C12). Bounds are provisional plan constants (C3). Mirrors
`doc/arch/schemas/outputspool/values.ts`.

```typescript
// packages/schema/src/outputspool/values.ts (novo)

// ByteOffset is a zero-based uncompressed byte position; the canonical read unit (FR20, C15).
export const ByteOffset = Schema.Number.annotate({ identifier: "OutputSpoolValues.ByteOffset" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const ByteLength = Schema.Number.annotate({ identifier: "OutputSpoolValues.ByteLength" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// CommittedBytes is the control-store committed-length authority for a generation (FR25, C12).
export const CommittedBytes = Schema.Number.annotate({ identifier: "OutputSpoolValues.CommittedBytes" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
export const NextOffset = Schema.Number.annotate({ identifier: "OutputSpoolValues.NextOffset" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// PageLimit is mandatory and server-capped; provisional 1 MiB cap, 64 KiB default (FR20, C3, AC1).
export const PageLimit = Schema.Number.annotate({ identifier: "OutputSpoolValues.PageLimit" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// QueueDepthBytes bounds the per-writer async queue; provisional cap (FR8, C3, AC5).
export const QueueDepthBytes = Schema.Number.annotate({ identifier: "OutputSpoolValues.QueueDepthBytes" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// Sequence — per-aggregate order for a durable output.* event; no global order (C20).
export const Sequence = Schema.Number.annotate({ identifier: "OutputSpoolValues.Sequence" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// SchemaVersion mirrors the EventV2 durable.version counter (C20).
export const SchemaVersion = Schema.Number.annotate({ identifier: "OutputSpoolValues.SchemaVersion" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
// Generation is the fencing generation; a new generation never overwrites its predecessor (FR14, FR27, C18).
export const Generation = Schema.Number.annotate({ identifier: "OutputSpoolValues.Generation" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
// Attempt is the 1-based attempt index owned by the Feature 002 executor (C21).
export const Attempt = Schema.Number.annotate({ identifier: "OutputSpoolValues.Attempt" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
```

Bounded content-classified text, flag, and timestamp ValueObjects exclude file text,
diffs, prompts, messages, paths, snippets, and secrets (FR5, FR12, FR33, Security 5,
C22). A language tag is Feature 004 provenance metadata on a textual channel, never
re-computed content (FR40, C8). Mirrors `doc/arch/schemas/outputspool/text-values.cue`.

```typescript
// packages/schema/src/outputspool/text-values.ts (novo)

// Canonical BCP 47 provenance tag: language, optional script, optional region (FR40, C8).
const languageTagPattern = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/

// ContentType is the bounded media type of a channel; classification, not content (FR16).
export const ContentType = Schema.String.annotate({ identifier: "OutputSpoolValues.ContentType" }).check(Schema.isNonEmpty())
// IntegrityTag is the opaque cursor/seal integrity tag; codec is a plan constant (FR17, C14, C18).
export const IntegrityTag = Schema.String.annotate({ identifier: "OutputSpoolValues.IntegrityTag" }).check(Schema.isNonEmpty())
// LanguageTag is a canonical BCP 47 provenance tag on a textual channel (FR40, C8).
export const LanguageTag = Schema.String.annotate({ identifier: "OutputSpoolValues.LanguageTag" })
  .check(Schema.isPattern(languageTagPattern))
export const Reason = Schema.String.annotate({ identifier: "OutputSpoolValues.Reason" })
export const TraceId = Schema.String.annotate({ identifier: "OutputSpoolValues.TraceId" }).check(Schema.isNonEmpty())
export const SpanId = Schema.String.annotate({ identifier: "OutputSpoolValues.SpanId" }).check(Schema.isNonEmpty())
// Flags: open-stream caught-up, sealed-consumed eof, and OS-tmp disposable eligibility (FR11, FR21, C2, C20).
export const CaughtUp = Schema.Boolean.annotate({ identifier: "OutputSpoolValues.CaughtUp" })
export const Eof = Schema.Boolean.annotate({ identifier: "OutputSpoolValues.Eof" })
export const Disposable = Schema.Boolean.annotate({ identifier: "OutputSpoolValues.Disposable" })
```

---

## Enumerations

Core state/channel/scope/fault enums mirror `doc/arch/schemas/outputspool/enums.cue`;
the event/actor/outcome enums mirror `enums-event.cue`; the closed `output.*`
vocabulary mirrors `event-types.cue`. Every enum is a ValueObject, never an Entity
(calisthenics).

```typescript
// packages/schema/src/outputspool/enums.ts (novo)

// The closed typed-channel set every group supports (FR15).
export const Channel = Schema.Literals([
  "assistant-text", "reasoning", "stdout", "stderr", "tool-result", "error", "artifact",
]).annotate({ identifier: "OutputSpoolEnums.Channel" })
export type Channel = typeof Channel.Type

// The closed channel-generation state machine (FR19, C20).
export const GroupState = Schema.Literals([
  "open", "sealing", "sealed", "aborted", "corrupt", "expired", "unknown",
]).annotate({ identifier: "OutputSpoolEnums.GroupState" })
export type GroupState = typeof GroupState.Type

// ActionScope bounds an output action; authorization is re-evaluated per action (FR43, C7).
export const ActionScope = Schema.Literals([
  "self", "child", "tree", "session", "project", "operator-global",
]).annotate({ identifier: "OutputSpoolEnums.ActionScope" })

// QuotaScope bounds a quota/backpressure descriptor (FR10, C3).
export const QuotaScope = Schema.Literals(["global", "root", "session", "process", "channel"])
  .annotate({ identifier: "OutputSpoolEnums.QuotaScope" })

// DurabilityTier selects the tiered fsync posture per channel class (FR8, C2).
export const DurabilityTier = Schema.Literals(["durable", "console", "disposable"])
  .annotate({ identifier: "OutputSpoolEnums.DurabilityTier" })

// AdmissionFault is a first-class observable admission/fault state, never swallowed (FR10, C4).
export const AdmissionFault = Schema.Literals([
  "none", "enospc", "fd_exhaustion", "quota", "permission", "latency",
]).annotate({ identifier: "OutputSpoolEnums.AdmissionFault" })

// ErrorCode is the stable content-free error code returned to a caller (Security error handling).
export const ErrorCode = Schema.Literals([
  "not_found", "denied", "quota", "enospc", "corrupt", "expired", "invalid_cursor",
]).annotate({ identifier: "OutputSpoolEnums.ErrorCode" })

// CursorState is the opaque follow-cursor lifecycle (FR22, C14).
export const CursorState = Schema.Literals(["active", "invalidated", "rejected"])
  .annotate({ identifier: "OutputSpoolEnums.CursorState" })

// RetentionEdgeKind classifies one inbound reference edge that gates cleanup (FR28, C5).
export const RetentionEdgeKind = Schema.Literals([
  "transcript", "todo", "handoff", "notification", "row_telemetry", "lease",
]).annotate({ identifier: "OutputSpoolEnums.RetentionEdgeKind" })

// LegalHoldState gates privacy erasure and legal hold on a group (FR30, Privacy 1, C5).
export const LegalHoldState = Schema.Literals(["none", "hold", "released"])
  .annotate({ identifier: "OutputSpoolEnums.LegalHoldState" })
```

```typescript
// packages/schema/src/outputspool/enums-event.ts (novo)

// Durable (replayable settlement) vs live (droppable) output.* events (C20).
export const EventClass = Schema.Literals(["durable", "live"])
  .annotate({ identifier: "OutputSpoolEnums.EventClass" })
// Origin subsystem of an output.* event (C20).
export const EventSource = Schema.Literals([
  "producer", "writer", "reader", "reconciler", "retention", "operator",
]).annotate({ identifier: "OutputSpoolEnums.EventSource" })
// Who acted; no LLM ever administers (FR41, C22).
export const ActorKind = Schema.Literals(["runtime", "operator"])
  .annotate({ identifier: "OutputSpoolEnums.ActorKind" })
// Visibility is the authorization scope enforced before delivery/projection (FR47, C7).
export const Visibility = Schema.Literals(["session", "tree", "project", "operator-global"])
  .annotate({ identifier: "OutputSpoolEnums.Visibility" })
// The content-plane settlement result observed by the parent (FR23, C13).
export const SettlementOutcome = Schema.Literals(["sealed", "aborted", "unknown", "corrupt"])
  .annotate({ identifier: "OutputSpoolEnums.SettlementOutcome" })
// How a channel language tag was obtained; content-free (FR40, C8).
export const LanguageProvenance = Schema.Literals(["declared", "inherited", "detected", "none"])
  .annotate({ identifier: "OutputSpoolEnums.LanguageProvenance" })
// The bounded allowed export encoding; never a raw path (FR44, C17).
export const ExportEncoding = Schema.Literals(["bounded_text", "redacted_bundle", "content_page"])
  .annotate({ identifier: "OutputSpoolEnums.ExportEncoding" })
```

```typescript
// packages/schema/src/outputspool/event-types.ts (novo)

// The closed 11-member output.* content-plane vocabulary (C20). The output.* prefix
// is the Feature 005 content-plane event namespace on EventV2; it is DISTINCT from
// the Feature 007 output.* operator command domain (output.stat|read|follow|export|
// share|release|delete|purge|retention.set|quota.set); both are reserved (C19, C20).
export const OutputEventType = Schema.Literals([
  "output.channel_sealed", "output.channel_aborted", "output.settlement_recorded",
  "output.reconciled", "output.generation_fenced", "output.group_released",
  "output.group_reclaimed", "output.chunk_appended", "output.backpressure_signalled",
  "output.admission_degraded", "output.unknown",
]).annotate({ identifier: "OutputSpoolEnums.OutputEventType" })
export type OutputEventType = typeof OutputEventType.Type
```

---

## OutputGroup aggregate (FR14, C1, C18, C21)

The aggregate root of the content plane, keyed to one process/attempt/generation
subtree. Its identity is `id` (the `GroupId`); the composite `OutputGroupRef` is the
fencing key so a new attempt/generation never overwrites a predecessor's committed
content (FR27). The producer that owns the Feature 002 Process owns its group;
Feature 005 introduces no second executor or store authority (FR3, C21). Sub-objects
each stay within the calisthenics field bound. Mirrors
`doc/arch/schemas/outputspool/group.cue` and `group-parts.cue`.

```typescript
// packages/schema/src/outputspool/group.ts (novo)

// The project/root-session/process/attempt/generation fencing key (FR14, C1, C18).
export const OutputGroupRef = Schema.Struct({
  project_id: ProjectId,
  root_session_id: RootSessionId,
  process_id: ProcessId,
  attempt: Attempt,
  generation: Generation,
})
export type OutputGroupRef = Schema.Schema.Type<typeof OutputGroupRef>

export const GroupLineage = Schema.Struct({
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
  session_id: Schema.NullOr(SessionId),
  root_session_id: RootSessionId,
})

// Tiered fsync posture and disposable eligibility (FR8, C2).
export const GroupDurability = Schema.Struct({
  tier: DurabilityTier,
  disposable: Disposable,
})

// State machine state, committed-length authority, reason, and timestamps (FR23, FR25, C12, C13).
export const GroupSettlement = Schema.Struct({
  state: GroupState,
  committed_bytes: CommittedBytes,
  reason: Reason,
  created_at: DateTimeUtcFromMillis,
  updated_at: DateTimeUtcFromMillis,
  sealed_at: Schema.NullOr(DateTimeUtcFromMillis),
})

// First-class collection of the OutputRefs the group owns (FR15, FR17).
export const ChannelRefSet = Schema.Array(OutputRef)

export const OutputGroup = Schema.Struct({
  id: GroupId,                            // aggregate-root identity (FR14, C18)
  key: OutputGroupRef,
  lineage: GroupLineage,
  durability: GroupDurability,
  settlement: GroupSettlement,
  channels: ChannelRefSet,
})
export type OutputGroup = Schema.Schema.Type<typeof OutputGroup>
```

### OutputGroup channel lifecycle (C20)

A channel opens on `begin`, absorbs bounded-queue appends while `open`, moves to
`sealing` on a seal request, and settles to `sealed`. `abort` preserves committed
bytes; a persistent admission fault or a failed reconciliation reaches `corrupt`;
recovery of an indeterminate extent reaches `unknown`; a released/expired group
reaches `expired`. `sealed`, `aborted`, `corrupt`, `expired`, and `unknown` are
terminal for the generation (AC8, AC10, AC11).

```
[*] --> open                                  begin channel generation
open --> open                                 append at expected offset
open --> sealing                              seal requested
sealing --> sealed                            committed bytes finalized
open | sealing --> aborted                    abort or cancel (bytes preserved)
open | sealing --> corrupt                    persistent admission fault | seal after loss
open --> unknown                              crash recovery indeterminate
sealed | aborted --> expired                  released or TTL elapsed
sealed | aborted | corrupt | unknown | expired --> [*]
```

---

## OutputChannel entity (FR15, FR16, FR17)

One typed channel within a group, identified by its `OutputRef`. It is an **Entity**
because it has stable identity across appends and state transitions while its
committed length grows. A textual channel carries Feature 004 language provenance;
the `reasoning` channel is stricter by default — never emitted to OTEL, never in an
unauthorized preview, shorter TTL, and an explicit authorized principal before any
content page (FR16, Privacy 2, C9, AC22). Sub-objects each stay within the
calisthenics field bound. Mirrors `doc/arch/schemas/outputspool/channel.cue` and
`channel-parts.cue`.

```typescript
// packages/schema/src/outputspool/channel.ts (novo)

// Media type and Feature 004 language provenance; content-free (FR16, FR40, C8).
export const ChannelContent = Schema.Struct({
  content_type: ContentType,
  language_tag: Schema.NullOr(LanguageTag),
  language_provenance: LanguageProvenance,
})

// State, committed-length authority, open-stream signals, and observable admission fault (FR10, FR21, C20).
export const ChannelState = Schema.Struct({
  group_state: GroupState,
  committed_bytes: CommittedBytes,
  caught_up: CaughtUp,
  eof: Eof,
  admission_fault: AdmissionFault,
})

// Content-free correlation and capture time only (C22).
export const ChannelProvenance = Schema.Struct({
  source: EventSource,
  captured_at: DateTimeUtcFromMillis,
  correlation_id: CorrelationId,
})

export const OutputChannel = Schema.Struct({
  id: OutputRef,                          // entity identity — bounded opaque ref (FR15, FR17)
  channel: Channel,
  content: ChannelContent,
  state: ChannelState,
  provenance: ChannelProvenance,
})
export type OutputChannel = Schema.Schema.Type<typeof OutputChannel>
```

---

## OutputCursor and read contract (FR17, FR20, FR21, FR22, C14, C15, C18)

The opaque follow token is bound to a group generation and byte offset with an
integrity tag; it exposes no client-visible internals beyond the opaque contract
(FR17, C18). A reconnect with a stale or superseded cursor returns a stable
`expired`/`invalid_cursor` code rather than rewinding or leaking a later generation;
a reconnect within validity resumes from the cursor without a full re-read (FR22,
C14, AC4). Mirrors `doc/arch/schemas/outputspool/cursor.cue`.

```typescript
// packages/schema/src/outputspool/cursor.ts (novo)

export const OutputCursor = Schema.Struct({
  group_id: GroupId,
  generation: Generation,
  channel: Channel,
  offset: ByteOffset,
  integrity_tag: IntegrityTag,
})
export type OutputCursor = Schema.Schema.Type<typeof OutputCursor>

export const CursorStatus = Schema.Struct({
  state: CursorState,
  error_code: Schema.NullOr(ErrorCode),
})
```

### Cursor lifecycle (C14, C18)

```
[*] --> active                                follow issues cursor at offset
active --> active                             reconnect within validity resumes
active --> invalidated                        generation superseded (fencing) | release/cleanup/expiry | idle-TTL after seal
invalidated --> rejected                      reconnect returns expired/invalid_cursor
rejected --> [*]
```

The paged read contract carries a mandatory server-capped `limit`; the canonical
offset unit is uncompressed bytes; reads are UTF-8 safe and never split a codepoint
(FR20, AC2, AC3). `eof` is true only when the channel is sealed or aborted and the
reader has consumed through committed end; an open stream reports `caught_up`, never
`eof`, when merely caught up (FR21, C20). Mirrors
`doc/arch/schemas/outputspool/page.cue`.

```typescript
// packages/schema/src/outputspool/page.ts (novo)

export const PageRange = Schema.Struct({
  offset: ByteOffset,
  limit: PageLimit,                       // mandatory, server-capped (FR20, C3, AC1)
  length: ByteLength,
})

export const ReadRequest = Schema.Struct({
  output_ref: OutputRef,                  // no path is ever accepted (FR12, FR20)
  offset: ByteOffset,
  limit: PageLimit,
})

export const ReadPage = Schema.Struct({
  range: PageRange,
  next_offset: NextOffset,
  committed_bytes: CommittedBytes,
  caught_up: CaughtUp,
  eof: Eof,
})
export type ReadPage = Schema.Schema.Type<typeof ReadPage>
```

---

## OutputStat read model (FR18, FR41)

The content-free read model for a channel returned by `output.stat`. It carries
state, committed length, durability tier, and content provenance, never a path and
never content (FR12, C18, C22). Textual channels carry the Feature 004 language
tag/provenance read from the trusted execution envelope, never recomputed by the
content plane (FR40, C8). Mirrors `doc/arch/schemas/outputspool/stat.cue`.

```typescript
// packages/schema/src/outputspool/stat.ts (novo)

export const StatProvenance = Schema.Struct({
  content_type: ContentType,
  language_tag: Schema.NullOr(LanguageTag),
  language_provenance: LanguageProvenance,
  correlation_id: CorrelationId,
})

export const OutputStat = Schema.Struct({
  output_ref: OutputRef,
  channel: Channel,
  state: GroupState,
  committed_bytes: CommittedBytes,
  durability_tier: DurabilityTier,
  provenance: StatProvenance,
})
export type OutputStat = Schema.Schema.Type<typeof OutputStat>
```

---

## BoundedPreview and redaction (FR4, FR33, C8, C22)

The byte-and-line-capped, redacted head slice attached to EventV2 payloads, UI
cards, and NotificationEnvelope summaries alongside the opaque OutputRef only. It is
never a path and never a full channel; secret material is represented as a Feature
007 SecretRef, never inline plaintext (FR5, C22). Exact caps and the redaction
ruleset are provisional plan constants with hooks AC12/AC19. Mirrors
`doc/arch/schemas/outputspool/preview.cue`.

```typescript
// packages/schema/src/outputspool/preview.ts (novo)

// Bounded redacted head slice text; empty is valid, never full content (FR4, C8).
export const PreviewText = Schema.String.annotate({ identifier: "OutputSpoolValues.PreviewText" })

// First-class collection of SecretRefs redacted out of a preview (FR5, C22).
export const SecretRefList = Schema.Array(SecretRef)

export const BoundedPreview = Schema.Struct({
  content_type: ContentType,
  byte_cap: ByteLength,
  line_cap: ByteLength,
  head: PreviewText,
  secrets: SecretRefList,
})
export type BoundedPreview = Schema.Schema.Type<typeof BoundedPreview>
```

---

## QuotaDescriptor (FR10, C3)

The per-scope backpressure and admission caps applied at global, root, session,
process, and channel scopes. Numeric caps are provisional plan constants owned by
Feature 007 Config.Service; unbounded page size, queue depth, or retention is
prohibited (Out of Scope). Quota exceed is a first-class observable admission fault,
never swallowed (FR10, C4, AC7). Mirrors `doc/arch/schemas/outputspool/quota.cue`.

```typescript
// packages/schema/src/outputspool/quota.ts (novo)

export const QuotaDescriptor = Schema.Struct({
  scope: QuotaScope,
  byte_cap: ByteLength,
  queue_depth_cap: QueueDepthBytes,
  page_cap: PageLimit,
})
export type QuotaDescriptor = Schema.Schema.Type<typeof QuotaDescriptor>

// First-class collection of per-scope quota descriptors (FR10, C3).
export const QuotaSet = Schema.Array(QuotaDescriptor)
```

---

## RetentionDescriptor, lease, and reference graph (FR28–FR30, C5)

Retention is reference-aware, never mtime-only, replacing the ToolOutputStore mtime
cleanup (research.md `tool-output-store.ts:176-188`). A group is reclaimable only
when its TTL has elapsed AND it holds no live lease, no active reader/writer, no
inbound reference edge (transcript ref, Todo evidence, handoff envelope,
NotificationEnvelope `output_ref`, Feature 002 `RowTelemetry.output_ref`), AND no
legal/privacy hold applies (FR28, AC16). `release` drops one holder edge; `cleanup`
reclaims only fully unreferenced expired groups in bounded batches (FR30, AC17).
Per-channel TTL defaults (reasoning stricter per C9) are provisional plan constants
with hooks AC16/AC17. Mirrors `doc/arch/schemas/outputspool/retention.cue`.

```typescript
// packages/schema/src/outputspool/retention.ts (novo)

// TtlMs bounds the retention TTL for a group; provisional plan constant (FR28, C5, AC16).
export const TtlMs = Schema.Number.annotate({ identifier: "OutputSpoolValues.TtlMs" })
  .check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const RetentionLease = Schema.Struct({
  lease_id: LeaseId,
  holder_ref: HolderRef,
  granted_at: DateTimeUtcFromMillis,
  expires_at: Schema.NullOr(DateTimeUtcFromMillis),
})

export const ReferenceEdge = Schema.Struct({
  kind: RetentionEdgeKind,
  holder_ref: HolderRef,
})

// First-class collection of inbound reference edges (FR28, C5).
export const ReferenceEdgeSet = Schema.Array(ReferenceEdge)

export const RetentionDescriptor = Schema.Struct({
  ttl_ms: TtlMs,
  legal_hold: LegalHoldState,
  lease: Schema.NullOr(RetentionLease),
  edges: ReferenceEdgeSet,
})
export type RetentionDescriptor = Schema.Schema.Type<typeof RetentionDescriptor>
```

---

## OutputEnvelope (C20)

The common carrier on every `output.*` event. Kept small by composing sub-objects,
each at most seven fields. `event_id` is held as a value assigned by EventV2; the
identifiable message is the event member that carries the envelope. The envelope is
content-free per ADR-0001: only bounded enums, opaque ids, and redacted key/value
metadata — never file text, diff, prompt, message, path, snippet, reasoning, or tool
payload (FR5, C22). Mirrors `doc/arch/schemas/outputspool/envelope.cue` and
`envelope-parts.cue`.

```typescript
// packages/schema/src/outputspool/envelope.ts (novo)

export const EventKind = Schema.Struct({
  event_type: OutputEventType,
  schema_version: SchemaVersion,
  event_class: EventClass,
  source: EventSource,
  actor_kind: ActorKind,                  // runtime | operator; no LLM (FR41, C22)
  visibility: Visibility,
})

export const EventSubject = Schema.Struct({
  group_id: GroupId,
  output_ref: Schema.NullOr(OutputRef),   // no path is ever present (FR12, C18)
  channel: Schema.NullOr(Channel),
  generation: Generation,
})

export const Ordering = Schema.Struct({
  sequence: Sequence,                     // per aggregate only; no global order (C20)
  correlation_id: CorrelationId,
  causation_id: Schema.NullOr(CausationId),
})

export const Delivery = Schema.Struct({
  visibility: Visibility,
  timestamp: DateTimeUtcFromMillis,
  // Redacted: no prompts, results, tool payloads, paths, or secrets (FR5, C22).
  redacted_metadata: Schema.Record(Schema.String, Schema.String),
})

export const OutputEnvelope = Schema.Struct({
  event_id: EventId,
  kind: EventKind,
  subject: EventSubject,
  ordering: Ordering,
  delivery: Delivery,
})
export type OutputEnvelope = Schema.Schema.Type<typeof OutputEnvelope>
```

---

## OutputEvent vocabulary (C20)

The 11 members form a closed tagged union. Every member carries the `envelope`; a
member with a distinct payload adds one `detail` sub-object so seal, abort,
settlement, reconciliation, fencing, retention, and admission stay distinct semantic
events and are never collapsed into a generic status update. Mirroring the Feature
002/003/004 pattern, each member is registered as its own `EventV2.define`
`Definition` on the `EventV2Bridge` (`dataFields(Member.fields)`) and published
through the new `publishOutputEvent` boundary, so no raw tagged union is wired to the
bus (C20). Durable settlement members carry the EventV2 `durable {version, aggregate}`
annotation and replay through `readAggregate`; live signal members omit it and may be
dropped under `allBounded` load (C20). Mirrors
`doc/arch/schemas/outputspool/events.cue`, `events-settlement.cue`, and
`events-live.cue`.

Detail sub-objects:

```typescript
// packages/schema/src/outputspool/events.ts (novo)

export const SealDetail = Schema.Struct({ committed_bytes: CommittedBytes, integrity_tag: IntegrityTag })
export const AbortDetail = Schema.Struct({ committed_bytes: CommittedBytes, outcome: SettlementOutcome })
export const SettlementDetail = Schema.Struct({ outcome: SettlementOutcome, committed_bytes: CommittedBytes })
export const ReconcileDetail = Schema.Struct({ outcome: SettlementOutcome, committed_bytes: CommittedBytes })
export const FenceDetail = Schema.Struct({ generation: Generation, outcome: SettlementOutcome })
export const RetentionEventDetail = Schema.Struct({ edge_kind: RetentionEdgeKind, scope: QuotaScope })
export const AdmissionEventDetail = Schema.Struct({ fault: AdmissionFault, scope: QuotaScope })
```

Member and union shape (durable settlement example carries the annotation; the
envelope-only `chunk_appended`/`unknown` members omit `detail`):

```typescript
// Durable settlement (C20): channel_sealed/aborted, settlement_recorded, reconciled,
// generation_fenced, group_released/reclaimed.
export const OutputChannelSealedEvent = Schema.Struct({
  type: Schema.Literal("output.channel_sealed"),
  envelope: OutputEnvelope,
  detail: SealDetail,
})

// Live (C20): chunk_appended, backpressure_signalled, admission_degraded, unknown.
export const OutputBackpressureSignalledEvent = Schema.Struct({
  type: Schema.Literal("output.backpressure_signalled"),
  envelope: OutputEnvelope,
  detail: AdmissionEventDetail,
})

export const OutputChunkAppendedEvent = Schema.Struct({
  type: Schema.Literal("output.chunk_appended"),
  envelope: OutputEnvelope,               // envelope-only; droppable live progress
})
// ...one Struct per event-types.ts vocabulary entry, across events-settlement.ts
// and events-live.ts.

export const OutputEvent = Schema.TaggedUnion("type", [
  OutputChannelSealedEvent, OutputBackpressureSignalledEvent, OutputChunkAppendedEvent,
  // ...the remaining 8 members.
])
export type OutputEvent = Schema.Schema.Type<typeof OutputEvent>
```

Durable settlement definitions join the canonical inventory in
`packages/schema/src/durable-event-manifest.ts` through `Event.durable([...])` (C20),
so seal, abort, settlement, reconciliation, fencing, and retention events are
preserved across bounded-queue overflow and restart by the durable aggregate, never
by a projection. Live append/backpressure/admission and the envelope-only `unknown`
member are not durable and carry no sequence (C20). The `EventV2.define` Definitions
for every member live at the schema layer in
`packages/schema/src/outputspool/event-definitions.ts` (mirroring the Feature 002/003/
004 precedent), because the durable members must be joinable into the canonical
`Durable` inventory and the schema package can never depend on `packages/core`. The
durable members carry `durable {version: 1, aggregate: "correlation_id"}`: the
per-aggregate `Ordering.sequence` groups by `Ordering.correlation_id` — the same key
EventV2 reads from a top-level `correlation_id` data field projected from
`envelope.ordering.correlation_id` at publish time (no duplicated authority).

---

## Export/share admin and migration flag (FR31, FR44, C16, C17)

Share and export are deny-by-default across projects (Privacy 3, FR44). Within a
project, `output.export` and `output.share` are admin-plane operations requiring an
operator principal, `project` scope, version/CAS, idempotency, and audit (Feature
007; reserved catalog entries `output.export`/`output.share`, both `mutates:true`,
`scopesAllowed:["project"]`). Raw arbitrary cross-project sharing and public
filesystem path share are out of scope; a cross-project transfer requires explicit
operator authorization and a content-bounded export, never a raw path (FR44, C17).
Migration is phased behind a feature flag with a bounded dual-read window over the
legacy BackgroundJob/ToolOutputStore surfaces (FR31, C16). Mirrors
`doc/arch/schemas/outputspool/admin.cue`.

```typescript
// packages/schema/src/outputspool/admin.ts (novo)

// C16 feature-flag state over the legacy dual-read window (FR31, C16, AC12).
export const MigrationState = Schema.Struct({
  enabled: Schema.Boolean.annotate({ identifier: "OutputSpoolAdmin.Enabled" }),
  dual_read: Schema.Boolean.annotate({ identifier: "OutputSpoolAdmin.DualRead" }),
})
export type MigrationState = Schema.Schema.Type<typeof MigrationState>

// Deny-by-default in-project export; bounded encoding, never a raw path (FR44, C17, AC13).
export const ExportRequest = Schema.Struct({
  output_ref: OutputRef,
  scope: ActionScope,
  encoding: ExportEncoding,
  principal: Principal,
})

// Deny-by-default in-project share; re-evaluated per action (FR44, C17, AC15).
export const ShareRequest = Schema.Struct({
  output_ref: OutputRef,
  scope: ActionScope,
  principal: Principal,
})
```

---

## Parameters

Every provisional contract is declared here as a plan constant with a named
acceptance hook; ADR-0006 and the tasks phase fix final values (plan Non-goals; C2,
C3, C4, C8, C11, C12, C14). No value is a hidden default: each is an explicit,
overridable data constant on the domain module, never inlined into an algorithm. IDs
never appear as metric labels; over-budget dynamic values map to `other`, reusing the
Feature 001 cardinality allowlist (C22, AC18). Numeric caps and TTLs are Feature 007
Config.Service values, never a parallel store (C3, C5).

| Parameter | Provisional default | Scope | Acceptance hook |
| --------- | ------------------- | ----- | --------------- |
| `page_cap_bytes` | 1 MiB server cap | per read | FR20, AC1 |
| `page_default_bytes` | 64 KiB interactive default | per read | FR20, AC1 |
| `queue_depth_cap` | depth- and byte-capped per writer | per channel | FR8, AC5 |
| `quota_scopes` | global, root, session, process, channel | per quota | FR10, C3, AC7 |
| `durability_tier_map` | durable channels fsync at seal/abort + interval; console at seal; disposable none | per channel class | FR8, C2, AC1 |
| `fsync_batch_interval_ms` | bounded batched interval for durable tiers | per channel class | FR8, C2, AC1 |
| `admission_policy` | degrade-then-fence to aborted/corrupt preserving committed bytes | per channel | FR10, C4, AC6, AC7 |
| `admission_persistence_window_ms` | bounded window before fence | per fault | FR10, C4, AC6 |
| `reconcile_scan_limit` | bounded recovery-scan limit | recovery | FR25, C12, AC8, AC9 |
| `cursor_idle_ttl_ms` | absolute idle-TTL after seal | per cursor | FR22, C14, AC4 |
| `preview_byte_cap` | byte-and-line-capped redacted head | preview | FR4, C8, AC12 |
| `preview_line_cap` | bounded line count | preview | FR4, C8, AC12 |
| `retention_ttl_map` | per-channel TTL; reasoning stricter | per channel | FR28, C5, C9, AC16 |
| `reasoning_ttl_ms` | shorter than assistant-text default | reasoning channel | C9, AC22 |
| `cleanup_batch_size` | bounded per-cycle batch | retention | FR29, C5, AC17 |
| `adapter_caps` | explicit size/time/memory caps for plugin/MCP/legacy | compat boundary | FR36, C11, AC13 |
| `export_encodings` | bounded_text, redacted_bundle, content_page | export | FR44, C17, AC13 |
| `migration_dual_read_window` | bounded dual-read window behind the C16 flag | migration | FR31, C16, AC12 |
| `cardinality_budget` | 64 distinct dynamic ids -> `other` | metric labels | AC18, reuses Feature 001 |

Feature 001 telemetry queue/cardinality-allowlist/budget-policy constants and the
Feature 007 Config.Service CAS/idempotency parameters are reused unchanged and are
not re-declared here (C3, C5, C22).

---

## Cross-artifact traceability

| Entity | CUE mirror | TS module | Requirements |
| ------ | ---------- | --------- | ------------ |
| identifiers | `outputspool/ids.cue`, `correlation.cue` | `outputspool/ids.ts`, `correlation.ts` | FR12, FR14, FR17, FR28, C5, C18 |
| byte offsets / versions | `outputspool/values.cue` | `outputspool/values.ts` | FR20, FR25, C12, C15 |
| bounded text / flags | `outputspool/text-values.cue` | `outputspool/text-values.ts` | FR5, FR21, FR40, Security 5, C8, C22 |
| enums | `outputspool/enums.cue`, `enums-event.cue`, `event-types.cue` | `outputspool/enums.ts`, `enums-event.ts`, `event-types.ts` | FR10, FR15, FR19, FR43, C4, C7, C14, C20 |
| OutputGroup | `outputspool/group.cue`, `group-parts.cue` | `outputspool/group.ts` | FR14, FR23, FR25, C1, C12, C18, C21 |
| OutputChannel | `outputspool/channel.cue`, `channel-parts.cue` | `outputspool/channel.ts` | FR15, FR16, FR40, C8, C9 |
| OutputCursor | `outputspool/cursor.cue` | `outputspool/cursor.ts` | FR17, FR22, C14, C18 |
| ReadPage / read contract | `outputspool/page.cue` | `outputspool/page.ts` | FR20, FR21, C15 |
| OutputStat | `outputspool/stat.cue` | `outputspool/stat.ts` | FR18, FR41, C8 |
| BoundedPreview | `outputspool/preview.cue` | `outputspool/preview.ts` | FR4, FR33, C8, C22 |
| QuotaDescriptor | `outputspool/quota.cue` | `outputspool/quota.ts` | FR10, C3 |
| RetentionDescriptor / lease / edges | `outputspool/retention.cue` | `outputspool/retention.ts` | FR28, FR29, FR30, C5 |
| OutputEnvelope | `outputspool/envelope.cue`, `envelope-parts.cue` | `outputspool/envelope.ts` | FR5, C20, C22 |
| OutputEvent vocabulary | `outputspool/events.cue`, `events-settlement.cue`, `events-live.cue` | `outputspool/events.ts` + member files | FR4, C13, C20 |
| Export / share / migration | `outputspool/admin.cue` | `outputspool/admin.ts` | FR31, FR44, C16, C17 |
```
