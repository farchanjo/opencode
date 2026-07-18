# Tasks: Add A Canonical File-Backed OutputSpool And Paged ArtifactStore

Ordered, measurable work breakdown derived from `plan.md` slices S0–S27, the
`data-model.md` entity definitions, `contracts/ports.ts`, ADR-0006, and the
`doc/arch/schemas/outputspool/*.cue` mirrors (23 files). Every task stays inside
the `specScopeGlobs` declared in `doc/arch/speckit.toml`. Phase 1 (schema/protocol)
is additive and non-breaking; no runtime behavior changes until the Phase 3 wiring
and the C16-flagged migration. Feature 005 adds no second executor, SessionRunner,
EventV2 system, parallel store authority, or parallel permission system (FR2, FR3,
C20, C21): content lives under a managed private spool tree keyed
project/root-session/process-attempt/generation/channel (C1), the control store owns
the committed-length recovery authority (C12), durable settlement events register
through `EventV2.define` into `packages/schema/src/durable-event-manifest.ts` and
publish through the new `publishOutputEvent` boundary on the existing `EventV2Bridge`
(C20), authorization rides Feature 007 principals and PermissionV2 scopes (C7), and
management flows through the reserved `output.*` catalog IDs already present at
`RESERVED_CATALOG_VERSION = 1.3.0` — no catalog bump is performed (C19). The module
name is `outputspool` across every package. No consumer ever receives a filesystem
path; consumers receive only an OutputRef, an opaque cursor, content-free metadata,
and authorized content pages (FR12, C18).

The canonical wire shape is the CUE corpus under `doc/arch/schemas/outputspool/*.cue`
mirrored one-to-one by `data-model.md`: the closed **11-member** `output.*`
content-plane event vocabulary (`event-types.cue`, 7 durable + 4 live), the 7-member
`Channel` and `GroupState`, the 6-member `QuotaScope`/`RetentionEdgeKind`, and the
`AdmissionFault`/`ErrorCode`/`CursorState` enums are authoritative; the
`protocol/outputspool` port surface mirrors `contracts/ports.ts` interfaces while
sourcing its enum members from the schema modules so a single vocabulary is enforced
(see the Traceability note).

## Task Breakdown

### Schema and protocol foundation (Phase 1)

- [x] T001 [S0] Author `packages/schema/src/outputspool/ids.ts` and
  `packages/schema/src/outputspool/correlation.ts` with the branded identifiers from
  `data-model.md`: `GroupId`, `OutputRef`, `ChannelId`, `ProcessId`, `RootSessionId`,
  `SessionId`, `ProjectId`, `EventId` (the EventV2 `evt_` id), `LeaseId`, `HolderRef`,
  plus `CorrelationId`, `CausationId`, `Principal`, `SecretRef`, and the retention
  reference-edge handles (`TranscriptRef`, `TodoRef`, `HandoffRef`, `NotificationRef`,
  `RowTelemetryRef`); each built base-then-annotate-then-check-then-brand
  (`Schema.String.annotate({ identifier }).check(...).pipe(Schema.brand("OutputSpool.*"))`),
  mirroring `ids.cue` and `correlation.cue` one-to-one with no cross-feature import;
  `OutputRef` stays a bounded opaque non-empty handle, never a path and never a saved
  permission resource, and secrets are never raw values (FR12, FR14, FR17, FR28, FR47,
  FR48, Security 5, C5, C18, C22). Acceptance: `tsgo --noEmit` on `packages/schema` and
  the schema contract-hygiene test assert annotate-before-check identity is retained on
  every brand.
- [x] T002 [S0] Author `packages/schema/src/outputspool/values.ts` and
  `packages/schema/src/outputspool/text-values.ts` with the byte-offset/length/counter
  ValueObjects (`ByteOffset`, `ByteLength`, `CommittedBytes`, `NextOffset`, `PageLimit`,
  `QueueDepthBytes`, `Sequence`, `SchemaVersion`, `Generation`, `Attempt`) folding
  `Schema.isInt()` into the bound check so the canonical offset unit is uncompressed
  bytes and no field is real-valued, and the bounded content-classified text/flag
  ValueObjects (`ContentType`, `IntegrityTag`, `LanguageTag` on the canonical BCP 47
  pattern, `Reason`, `TraceId`, `SpanId`, `CaughtUp`, `Eof`, `Disposable`) excluding
  file text, diffs, prompts, messages, paths, snippets, and secrets, mirroring
  `values.cue` and `text-values.cue` (FR5, FR12, FR20, FR33, FR40, Security 5, C8, C15,
  C22). Acceptance: `tsgo --noEmit` green and the redaction test confirms no free-form
  content field is exported and every offset/length counter is integer-checked.
- [x] T003 [S0] Author `packages/schema/src/outputspool/enums.ts`,
  `enums-event.ts`, and `event-types.ts` with the closed enums as `Schema.Literals([...])`:
  the 7-member `Channel`
  (`assistant-text|reasoning|stdout|stderr|tool-result|error|artifact`), the 7-member
  `GroupState` (`open|sealing|sealed|aborted|corrupt|expired|unknown`), `ActionScope`,
  the 5-member `QuotaScope`, `DurabilityTier`, the 6-member `AdmissionFault`, the
  7-member `ErrorCode`, `CursorState`, the 6-member `RetentionEdgeKind`
  (`transcript|todo|handoff|notification|row_telemetry|lease`), `LegalHoldState`;
  `EventClass`, `EventSource`, `ActorKind`, `Visibility`, `SettlementOutcome`,
  `LanguageProvenance`, `ExportEncoding`; and the closed **11-member** `OutputEventType`
  `output.*` vocabulary, mirroring `enums.cue`, `enums-event.cue`, and `event-types.cue`
  (FR4, FR10, FR15, FR19, FR22, FR40, FR43, FR44, C4, C7, C14, C17, C20). Acceptance:
  `tsgo --noEmit` green and the schema test asserts the 11-member vocabulary is closed
  and the `output.channel_sealed`/`_aborted`/`settlement_recorded`/`reconciled`/
  `generation_fenced`/`group_released`/`group_reclaimed` durable members are distinct
  from the `chunk_appended`/`backpressure_signalled`/`admission_degraded`/`unknown`
  live members.
- [x] T004 [S0] Author `packages/schema/src/outputspool/cursor.ts` composing
  `OutputCursor` (`group_id`, `generation`, `channel`, byte `offset`, `integrity_tag`)
  and `CursorStatus` (`state`, nullable `error_code`), the opaque follow token bound to a
  group generation and byte offset with an integrity tag and exposing no client-visible
  internals beyond the opaque contract, mirroring `cursor.cue` (FR17, FR22, C14, C18).
  Acceptance: `tsgo --noEmit` green and the schema test asserts the cursor carries a
  generation and an integrity tag and no path field.
- [x] T005 [S1] Author `packages/schema/src/outputspool/page.ts` and
  `packages/schema/src/outputspool/stat.ts` composing `PageRange`, `ReadRequest`
  (`output_ref`, `offset`, mandatory server-capped `limit`; no path is ever accepted),
  and `ReadPage` (`range`, `next_offset`, `committed_bytes`, `caught_up`, `eof`), plus
  `StatProvenance` and the content-free `OutputStat` read model (`output_ref`, `channel`,
  `state`, `committed_bytes`, `durability_tier`, provenance) with the Feature 004 language
  tag/provenance and no path or content, mirroring `page.cue` and `stat.cue` (FR12, FR18,
  FR20, FR21, FR40, FR41, C8, C15, C18). Acceptance: `tsgo --noEmit` green and the schema
  test asserts `limit` is required, `eof` and `caught_up` are distinct boolean fields, and
  no path field exists.
- [x] T006 [S1] Author `packages/schema/src/outputspool/preview.ts` composing
  `PreviewText`, the first-class `SecretRefList` collection, and `BoundedPreview`
  (`content_type`, `byte_cap`, `line_cap`, `head`, `secrets`) — the byte-and-line-capped
  redacted head slice attached to EventV2 payloads, UI cards, and NotificationEnvelope
  summaries alongside the opaque OutputRef only, never a path and never a full channel,
  with secret material represented as a Feature 007 SecretRef and never inline plaintext,
  mirroring `preview.cue` (FR4, FR5, FR33, C8, C22). Acceptance: `tsgo --noEmit` green and
  the redaction test asserts the preview carries a `SecretRef` list and no raw secret,
  path, or full-content field.
- [x] T007 [S2] Author `packages/schema/src/outputspool/quota.ts` and
  `packages/schema/src/outputspool/retention.ts` composing `QuotaDescriptor`
  (`scope`, `byte_cap`, `queue_depth_cap`, `page_cap`) and the `QuotaSet` collection, plus
  `TtlMs`, `RetentionLease`, `ReferenceEdge`, the `ReferenceEdgeSet` collection, and
  `RetentionDescriptor` (`ttl_ms`, `legal_hold`, nullable `lease`, `edges`), so caps apply
  at global/root/session/process/channel scopes and retention is reference-aware over
  TTL/lease/reference-edge/legal-hold, mirroring `quota.cue` and `retention.cue` (FR10,
  FR28, FR29, FR30, C3, C5). Acceptance: `tsgo --noEmit` green and the schema test asserts
  the five quota scopes and the six retention edge kinds are present and numeric caps are
  integer-checked.
- [x] T008 [S1] Author `packages/schema/src/outputspool/group.ts` and
  `packages/schema/src/outputspool/channel.ts` composing `OutputGroupRef`
  (`project_id`/`root_session_id`/`process_id`/`attempt`/`generation` fencing key),
  `GroupLineage`, `GroupDurability`, `GroupSettlement`, the `ChannelRefSet` collection, and
  the `OutputGroup` aggregate root (identity `id`), plus `ChannelContent`,
  `ChannelState`, `ChannelProvenance`, and the `OutputChannel` entity (identity
  `OutputRef`) carrying the Feature 004 language provenance on textual channels, each
  sub-object within the seven-field calisthenics bound, mirroring `group.cue`,
  `group-parts.cue`, `channel.cue`, and `channel-parts.cue` (FR14, FR15, FR16, FR23, FR25,
  FR40, C1, C8, C9, C12, C18, C21). Acceptance: `tsgo --noEmit` green and the schema test
  constructs an OutputGroup and an OutputChannel value and asserts the fencing key carries
  attempt and generation.
- [x] T009 [S1] Author `packages/schema/src/outputspool/envelope.ts` composing the
  bounded sub-structs `EventKind` (`event_type`, `schema_version`, `event_class`,
  `source`, `actor_kind`, `visibility`), `EventSubject` (`group_id`, nullable
  `output_ref`, nullable `channel`, `generation`), `Ordering` (per-aggregate `sequence`
  only, `correlation_id`, nullable `causation_id`), and `Delivery` (`visibility`,
  `timestamp`, redacted key/value `redacted_metadata`) into the content-free
  `OutputEnvelope`, mirroring `envelope.cue` and `envelope-parts.cue` (FR5, FR12,
  Observability, C20, C22). Acceptance: `tsgo --noEmit` green and the schema test asserts
  `redacted_metadata` carries no prompt, path, or payload key and `actor_kind` admits only
  `runtime`/`operator`.
- [x] T010 [S3] Author `packages/schema/src/outputspool/events.ts`,
  `events-settlement.ts`, `events-live.ts`, and `event-definitions.ts` with the detail
  sub-objects (`SealDetail`, `AbortDetail`, `SettlementDetail`, `ReconcileDetail`,
  `FenceDetail`, `RetentionEventDetail`, `AdmissionEventDetail`) and one `Schema.Struct`
  per closed 11-member vocabulary entry (each carrying `envelope`; a distinct-payload
  member adds one `detail`; the `chunk_appended` and `unknown` members are envelope-only),
  then the closed `Schema.TaggedUnion("type", ...)` `OutputEvent`, plus the per-member
  `EventV2.define` `Definition`s in `event-definitions.ts` carrying
  `durable {version: 1, aggregate: "correlation_id"}` on the seven durable settlement
  members and omitting `durable` on the four live members, keeping seal/abort/settlement/
  reconciliation/fencing/retention distinct and never collapsed, mirroring `events.cue`,
  `events-settlement.cue`, and `events-live.cue` (FR4, FR5, FR23, C13, C20, C22).
  Acceptance: `tsgo --noEmit` green and the schema test asserts every vocabulary member has
  a distinct Struct, the union is exhaustive, and only the seven durable members carry the
  durable annotation.
- [x] T011 [S3] Author `packages/schema/src/outputspool/admin.ts` composing
  `MigrationState` (`enabled`, `dual_read`) for the C16 dual-read window, `ExportRequest`
  (`output_ref`, `scope`, `encoding`, `principal`), and `ShareRequest` (`output_ref`,
  `scope`, `principal`), so export/share are deny-by-default across projects and a
  cross-project transfer is a bounded encoding and never a raw path, mirroring `admin.cue`
  (FR31, FR44, C16, C17). Acceptance: `tsgo --noEmit` green and the schema test asserts the
  export encoding is a bounded enum and no request carries a filesystem path.
- [x] T012 [S0–S3] Author the barrel `packages/schema/src/outputspool/index.ts`
  re-exporting every outputspool schema module and register the barrel in
  `packages/schema/src/index.ts`. Acceptance: `tsgo --noEmit` on `packages/schema` green
  and `bun test packages/schema` imports the barrel without a duplicate-export error.
- [x] T013 [S3] Extend `packages/schema/src/durable-event-manifest.ts` to join the seven
  durable `output.*` settlement definitions from `event-definitions.ts` into the canonical
  `Durable` inventory through `Event.durable([...])`, leaving the four live
  append/backpressure/admission/unknown members out of the durable set, so no second event
  authority is introduced (C20). Acceptance: `bun test packages/schema` durable-manifest
  test green with the seven output settlement members present and the four live members
  absent.
- [x] T014 [S4] Author `packages/protocol/src/outputspool/ports.ts`,
  `packages/protocol/src/outputspool/commands.ts`, and
  `packages/protocol/src/outputspool/index.ts` mirroring `contracts/ports.ts`: the
  `SpoolWriterPort` (`open`/`append`/`seal`/`abort`), `SpoolReaderPort`
  (`stat`/`read`/`follow`), `RetentionPort` (`lease`/`release`/`cleanup`), and `AdminPort`
  (`export`/`share`/`release`/`delete`/`purge`/`setRetention`/`setQuota`) interfaces, the
  `OutputGroupRef`/`OutputStat`/`ReadPage`/`BoundedPreview`/`QuotaDescriptor`/
  `RetentionDescriptor`/`Lease` read models, the `OperatorPrincipal` shape, the native
  `begin`/`append`/`read`/`follow`/`seal`/`abort`/`stat`/`release`/`cleanup` and `output.*`
  operator command/query payloads, and the typed `SpoolWriterError`/`SpoolReaderError`/
  `RetentionError`/`AdminError` unions (including `stale_generation`, `offset_conflict`,
  `enospc`, `fd_exhaustion`, `quota`, `corrupt`, `denied`, `expired`, `invalid_cursor`,
  `referenced`, `legal_hold`, `cross_project_denied`, `version_conflict`, `reserved_name`),
  sourcing the enum members from the `packages/schema/src/outputspool/*` modules (the
  7-member `Channel`/`GroupState`, 5-member `QuotaScope`, 6-member `RetentionEdgeKind`,
  11-member vocabulary) so the transport contract never diverges from the wire shape, and
  never redefining the event payload schemas (FR9, FR18, FR20, FR22, FR41, FR42, FR44, C7,
  C14, C17, C19, C20). Acceptance: `tsgo --noEmit` on `packages/protocol` green and the
  protocol parity test asserts each interface member matches `contracts/ports.ts` and the
  reconciled vocabulary matches the schema modules.

### Domain spool engine (Phase 2)

- [x] T015 [S5] Author `packages/core/src/outputspool/identity.ts` minting
  `OutputGroupRef`/`OutputRef` over the injected entropy port and enforcing stale-generation
  fencing so a new attempt/generation never overwrites a predecessor's committed content
  and a superseded writer's append/seal is rejected, mapping one OutputGroupRef to exactly
  one generation subtree, mirroring the `group.cue`/`ids.cue` fencing semantics (FR1, FR3,
  FR14, FR17, FR27, FR34, C18, C21, AC11). Acceptance: `bun test packages/core` covers a
  mint round-trip, a stale-generation reject, and one-subtree-per-ref with a deterministic
  entropy port and no I/O.
- [x] T016 [S6] Author `packages/core/src/outputspool/cursor-codec.ts` encoding and
  decoding the opaque `OutputCursor` with its integrity tag, binding generation and byte
  offset, so a reconnect within validity resumes without a full re-read and a stale or
  superseded token returns a stable `expired`/`invalid_cursor` code rather than rewinding
  or leaking a later generation, mirroring `cursor.cue` (FR17, FR22, C14, C18, AC4).
  Acceptance: `bun test packages/core` covers encode/decode round-trip, integrity-tag
  tamper reject, generation-supersession invalidation, and idle-TTL expiry with a
  deterministic clock.
- [x] T017 [S7] Author `packages/core/src/outputspool/group-state.ts` implementing the
  closed `open->sealing->sealed/aborted/corrupt/expired/unknown` machine so seal commits
  finality of committed bytes, abort stops append while preserving committed bytes, a
  persistent admission fault or failed reconciliation reaches `corrupt`, an indeterminate
  recovery reaches `unknown`, and a released/expired group reaches `expired`, with
  `sealed`/`aborted`/`corrupt`/`expired`/`unknown` terminal, mirroring the `group.cue`
  state machine (FR19, FR24, FR26, FR27, C20, AC8, AC10). Acceptance: `bun test
  packages/core` asserts every legal transition, rejects illegal transitions, and confirms
  abort preserves committed bytes.
- [x] T018 [S8] Author `packages/core/src/outputspool/writer-queue.ts` implementing the
  bounded producer queue and batched-writer contract: file-backed from the first observable
  chunk, producer → bounded queue → batched async writer with no filesystem write per
  token/delta, expected-offset idempotent append tolerating short and partial writes, and a
  backpressure signal when the depth/byte bound is hit, over the injected filesystem port
  (FR6, FR7, FR8, FR9, C2, C3, AC1, AC5). Acceptance: `bun test packages/core` covers
  batched drain, expected-offset idempotent retry, short/partial-write handling, and
  bounded-queue backpressure with a deterministic port.
- [x] T019 [S9] Author `packages/core/src/outputspool/paging.ts` implementing
  server-capped `read(offset, limit)` byte-offset paging that is UTF-8 safe and never
  splits a codepoint, returns page bytes, `next_offset`, `committed_bytes`, and `caught_up`,
  and reports `eof` true only when the channel is sealed or aborted and the reader has
  consumed through committed end while an open stream reports `caught_up` never `eof`,
  mirroring `page.cue` (FR20, FR21, C15, AC2, AC3). Acceptance: `bun test packages/core`
  covers a codepoint straddling a page boundary, `caught_up`-without-`eof` on an open
  stream, and `eof` on a sealed consumed channel.
- [x] T020 [S10] Author `packages/core/src/outputspool/admission.ts` classifying ENOSPC,
  fd exhaustion, quota exceed, permission denial, and sustained disk latency as first-class
  observable admission/fault states, applying the degrade-then-fence policy so a persistent
  fault backpressures the producer and then transitions to `aborted` or `corrupt` past a
  bounded window while preserving already-committed bytes and never reporting seal as
  success when bytes were lost, mirroring `enums.cue` `AdmissionFault` (FR10, C4, AC5, AC6,
  AC7). Acceptance: `bun test packages/core` covers each fault class, degrade-then-fence to
  aborted/corrupt, and seal-never-lies with a deterministic fault-injecting port.
- [x] T021 [S11] Author `packages/core/src/outputspool/retention-graph.ts` evaluating
  reclaim eligibility so a group is reclaimable only when its TTL has elapsed AND it holds
  no live lease, no active reader/writer, no inbound reference edge (transcript, Todo,
  handoff, NotificationEnvelope `output_ref`, Feature 002 `RowTelemetry.output_ref`), AND
  no legal/privacy hold applies, with `release` dropping one holder edge and bounded-batch
  selection for cleanup, mirroring `retention.cue` (FR28, FR29, FR30, C5, AC16, AC17).
  Acceptance: `bun test packages/core` covers reclaim-when-fully-unreferenced,
  referenced-blocks-reclaim, legal-hold-blocks-reclaim, and bounded-batch selection.
- [x] T022 [S12] Author `packages/core/src/outputspool/reconcile.ts` reconciling the
  filesystem data extent against the control-store committed length into exactly `sealed`,
  `open`, `aborted`, `corrupt`, or `unknown`: when the extent is at least the committed
  length the group recovers as sealed/open, when it is shorter or the seal record is absent
  after committed appends the group recovers as `corrupt` or `unknown` with a bounded
  recovery scan, never silent empty-success, mirroring the C12 reconciliation rule (FR25,
  C12, AC8, AC9). Acceptance: `bun test packages/core` covers extent≥committed→sealed,
  extent<committed→corrupt, absent-seal→unknown, and the bounded scan limit.
- [x] T023 [S25] Author `packages/core/src/outputspool/spool-instruments.ts` adding the
  `output.append|read|seal|reconcile|cleanup` spans linked to the Feature 001
  session-execution/LLM/tool/process spans, and the content-free metrics (bytes
  appended/read buckets, queue-depth buckets, writer/read-latency buckets,
  open/sealed/aborted/corrupt/expired counts, spill count, quota faults, disk faults,
  cleanup batches) with bounded-enum/bucket labels, reusing the Feature 001 cardinality
  allowlist so content, path, OutputRef, `session_id`, `process_id`, and `user_id` never
  appear as metric labels, over-budget dynamic values map to `other`, the `reasoning`
  channel is never emitted to OTEL, and async bounded export never blocks the hot path
  (Observability, FR5, C9, C22, AC18). Acceptance: `bun test packages/core` cardinality
  audit asserts no id appears as a metric label and the reasoning channel is not exported.
- [x] T024 [S5–S25] Author the barrel `packages/core/src/outputspool/index.ts`
  re-exporting the identity, cursor-codec, group-state, writer-queue, paging, admission,
  retention-graph, reconcile, and spool-instruments modules. Acceptance: `tsgo --noEmit` on
  `packages/core` green and the barrel imports without a duplicate-export error.

### Application, adapters, and operator wiring (Phase 3)

- [x] T025 [S13] Author `packages/opencode/src/outputspool/spool-layout.ts` establishing
  the managed private tree under the `Global`-rooted data directory
  (`packages/core/src/global.ts:15-39`), replacing the flat `tool-output`, keyed
  project/root-session/process-attempt/generation/channel so one OutputGroupRef maps to one
  generation subtree, with `0700` directories / `0600` files on Unix and owner-only ACL on
  Windows/macOS, path-traversal/symlink-escape/TOCTOU guards on every open/read/write/delete
  so no path-like input opens a file outside the spool, OS-tmp used only for disposable
  channels, optional encryption-at-rest as a non-relaxing configuration hook, and the
  Feature 004 language tag/provenance read from the trusted execution envelope onto textual
  channels — never a public path exposed to any consumer (FR11, FR12, FR13, FR40, FR45,
  FR46, FR49, C1, C6, C8, AC14, AC22). Acceptance: `bun test packages/opencode` asserts
  private permissions, a rejected traversal/symlink escape, and no path returned to a
  consumer.
- [x] T026 [S14] Author `packages/opencode/src/outputspool/file-sink-writer.ts` as the Bun
  `FileSink` (`Bun.file(path).writer()` `write`/`flush`/`end`/`ref`/`unref`) batched-append
  adapter driving the domain writer queue, applying the tiered fsync posture over the
  verified `node:fs` `fsyncSync`/`fdatasyncSync` and `FileHandle.sync()`/`datasync()`
  surface — durable channels (`assistant-text`/`reasoning`/`tool-result`/`error`/`artifact`)
  fsync the data extent and control commit at seal/abort and at a bounded batched interval,
  console channels (`stdout`/`stderr`) fsync at seal only, disposable OS-tmp channels never
  fsync — with no per-token filesystem write, mirroring the C2 durability tiers (FR6, FR8,
  FR24, FR26, C2, AC1, AC10). Acceptance: `bun test packages/opencode` under a sandbox spool
  tree asserts batched append with no per-token syscall and the per-tier fsync posture.
- [x] T027 [S15] Author `packages/opencode/src/outputspool/page-reader.ts` as the
  positional reader over the verified `node:fs/promises` `open(path,"r+")`
  `FileHandle.read(buf, off, len, pos)` and `Bun.file(path).slice(start,end)` surface,
  reading exactly the requested byte window under the domain pager, trimming to a UTF-8
  codepoint boundary, and allowing concurrent reads during append, mirroring the C15 raw
  byte-stream contract (FR9, FR20, C15, AC2). Acceptance: `bun test packages/opencode` under
  a sandbox spool tree asserts a bounded positional page and a concurrent read during append.
- [x] T028 [S16] Author `packages/opencode/src/outputspool/control-store.ts` as the
  SQLite/control metadata store recording per channel generation the committed length (the
  recovery authority), durability tier, seal/abort fence record, and reference edges, with
  atomic commit ordering and generation records so a new attempt never overwrites a
  predecessor and exactly-once FS+DB commit is not attempted, mirroring the C12
  committed-length authority (FR25, FR27, C12, C18, AC8). Acceptance: `bun test
  packages/opencode` under a sandbox store asserts committed-length monotonicity per
  generation and fence-record persistence.
- [x] T029 [S17] Author `packages/opencode/src/outputspool/reconciler.ts` running startup
  recovery over open groups, applying the domain reconciliation policy against the
  control-store committed length and the filesystem extent, marking each group
  sealed/open/aborted/corrupt/unknown and emitting the `output.reconciled` durable event,
  never silent empty-success, mirroring C12 (FR25, C12, AC8, AC9). Acceptance: `bun test
  packages/opencode` under injected crash points asserts recovery into each state and a
  visible sealed ref after crash-after-seal-before-event.
- [x] T030 [S18] Author `packages/opencode/src/outputspool/retention-sweeper.ts` running
  ref-aware cleanup in bounded per-cycle batches over the domain retention evaluator so
  `release` drops one holder edge, `cleanup` reclaims only fully unreferenced expired groups,
  a still-referenced output is never deleted solely because mtime is old, and deletion/
  legal-hold/privacy-erasure are explicit content-free audited operations, replacing the
  ToolOutputStore mtime cleanup (FR28, FR29, FR30, FR37, FR50, C5, AC16, AC17). Acceptance:
  `bun test packages/opencode` asserts a referenced output survives an expired mtime and a
  bounded batch reclaims only unreferenced expired groups.
- [x] T031 [S19] Author `packages/opencode/src/outputspool/durable-events.ts` projecting
  the seven durable `output.*` settlement events over the new `publishOutputEvent` boundary
  added to `packages/opencode/src/event-v2-bridge.ts` (mirroring
  `publishLifecycleEvent`/`publishJobEvent`/`publishLangLockEvent`: location attach, single
  publish boundary), keeping the four live append/backpressure/admission/unknown signals on
  the bounded live channel droppable under `allBounded` load, carrying OutputRef and bounded
  preview but never full content chunks or paths, so `output.*` events ride the existing
  bridge and no second channel exists, mirroring C20 (FR2, FR4, FR5, FR23, C20, C22, AC9,
  AC18). Acceptance: `bun test packages/opencode` asserts a durable settlement event reaches
  the bridge boundary once, a live signal is droppable, and no payload carries content or a
  path.
- [x] T032 [S20] Author `packages/opencode/src/outputspool/authorization.ts` re-evaluating
  authorization per action over Feature 007 principals and PermissionV2 scopes
  (`self`/`child`/`tree`/`session`/`project`/`operator-global`) so a raw OutputRef is never
  a saved permission resource, metadata authorization is enforced before any content page is
  returned, an unauthorized sibling read is denied without content leak, and the interim gap
  is closed conservatively (consume-plane reads authorized by the owning session/tree
  principal, admin-plane actions denied by default), mirroring C7 (FR42, FR43, FR47, FR48,
  C7, AC15). Acceptance: `bun test packages/opencode` covers authorized consume, unauthorized
  sibling deny, admin deny-by-default, and per-action re-evaluation.
- [x] T033 [S21] Author `packages/opencode/src/outputspool/compat-boundary.ts` providing the
  native tool/process streaming sink into OutputSpool and the bounded plugin/MCP/legacy
  compatibility boundary that spills to the spool before full LLM-facing materialization when
  the source allows, caps materialization at explicit size/time/memory limits and marks the
  channel truncated/degraded otherwise, and never embeds a public path in the result,
  replacing the `tool-output-store.ts` path-in-preview (FR1, FR7, FR35, FR36, FR37, C11,
  AC13). Acceptance: `bun test packages/opencode` asserts an oversized non-streaming source
  is spilled under caps with no path in the result and a native source streams into the sink.
- [x] T034 [S22] Author `packages/opencode/src/outputspool/migration-bridge.ts` and migrate
  `packages/core/src/background-job.ts` and `packages/core/src/tool-output-store.ts` behind
  the C16 feature flag with a bounded dual-read window: BackgroundJob stores OutputRef/stat/
  status while still reading legacy `output`/`error` strings, ToolOutputStore consumers read
  either path-preview or OutputRef during cutover, and runner/registry/message-part carry
  OutputRef plus bounded preview, then the legacy fields retire, sharing one canonical V1/V2
  seam with no second executor or store authority (FR3, FR31, FR32, FR34, FR37, C16, AC1,
  AC12). Acceptance: `bun test packages/opencode` asserts BackgroundJob writes an OutputRef
  and reads the legacy string under the flag, and no per-content-proportional string is
  retained after cutover.
- [x] T035 [S23] Author the Feature 005 context-slice materialization seam materializing only
  budgeted byte/token ranges of a sealed channel through `read(offset, limit)`, recording the
  exact ranges used into the durable transcript reference set feeding retention, so the LLM
  never receives an entire spool file automatically and a Manager/Architect handoff carries
  summary plus OutputRef and reads bounded pages, mirroring C10 (FR32, FR33, FR34, FR38, C10,
  AC12, AC19). Acceptance: `bun test packages/opencode` asserts only selected ranges are
  materialized, the ranges used are recorded, and no full-file injection occurs.
- [x] T036 [S13–S23] Author the barrel `packages/opencode/src/outputspool/index.ts`
  re-exporting the spool-layout, file-sink-writer, page-reader, control-store, reconciler,
  retention-sweeper, durable-events, authorization, compat-boundary, and migration-bridge
  modules. Acceptance: `tsgo --noEmit` on `packages/opencode` green and the barrel imports
  without a duplicate-export error.
- [x] T037 [S24] Author `packages/opencode/src/operator/outputspool/**` with the typed
  `SpoolReaderPort`/`RetentionPort`/`AdminPort` domain implementations for the reserved
  consume-plane `output.stat`, `output.read`, `output.follow` and admin-plane
  `output.export`, `output.share`, `output.release`, `output.delete`, `output.purge`,
  `output.retention.set`, `output.quota.set` operations, each registered through the Feature
  007 registry with zero provider/model calls, tokens, or cost, redacted/versioned human and
  JSON output, consume actions re-evaluating authorization per call and admin actions
  requiring operator principal plus explicit scope plus version/CAS plus idempotency plus
  audit; the existing reserved catalog `packages/core/src/operator/catalog.ts` already
  declares the `output` domain and all ten IDs at `RESERVED_CATALOG_VERSION = 1.3.0`, so no
  catalog bump is performed and plugin/MCP/custom registration of these IDs is rejected with
  a structured `reserved_name` error, with export/share deny-by-default across projects
  (FR2, FR30, FR41, FR42, FR43, FR44, FR47, FR50, C7, C17, C19, AC13, AC15, AC21). Acceptance:
  `bun test packages/opencode` under the Feature 007 sandbox asserts the ten operations
  dispatch with zero model calls, a reserved-ID collision is rejected, and cross-project
  share is denied by default.

### CLI and TUI paging surfaces (Phase 4)

- [x] T038 [S26] Author `packages/cli/src/**/output/**` for `opencode op output
  stat|read|follow|release|delete|purge|export|share` plus `retention set` / `quota set`,
  each dispatching through the Feature 007 registry to the `SpoolReaderPort`/`RetentionPort`/
  `AdminPort` with registry-generated names (no divergent hardcoded verbs), emitting
  redacted/versioned human and JSON output, resuming a follow from an opaque cursor on
  reconnect, working offline, and making zero provider/model calls with no path exposure
  (FR41, FR42, C19, C23, AC13). Acceptance: `bun test packages/cli` asserts human and JSON
  output, cursor-resumed follow, and no model call or path in output.
- [ ] T039 [S26] Author `packages/tui/src/**/operator/output/**` rendering the paged
  read/follow/tail panel over `output.stat`/`output.read`/`output.follow` as a thin adapter
  over the Feature 007 registry with registry-generated names, loading content only on
  authorized expand/read (never the complete output by default), resuming from an opaque
  cursor on reconnect, showing direct children only for the Feature 002 hierarchy, and with
  screen-reader text independent of color and no path exposure (FR38, FR41, C23, AC20).
  Acceptance: `bun test packages/tui` asserts the panel loads a bounded page on expand,
  resumes a follow cursor, and shows only direct children.

### Tests and validation (Phase 5)

- [ ] T040 [S27] Add pure deterministic unit tests under `packages/core/test/outputspool/**`
  for identity minting and stale-generation fencing (mint/reject/one-subtree), the cursor
  codec and integrity tag (round-trip/tamper/supersession/idle-TTL), the group state machine
  (legal/illegal transitions, abort preserves bytes), byte-offset paging (codepoint boundary,
  caught_up-without-eof, eof-when-sealed), admission classification (each fault,
  degrade-then-fence, seal-never-lies), the retention-graph evaluator (reclaim/referenced-
  blocks/legal-hold/bounded-batch), and reconciliation (sealed/corrupt/unknown/scan-limit),
  with deterministic ports and no I/O (AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC11, AC16, AC17).
  Acceptance: `bun test packages/core` green.
- [ ] T041 [S27] Add schema and protocol tests under `packages/schema/test/outputspool/**`
  and `packages/protocol/test/outputspool/**` asserting contract hygiene
  (annotate-before-check identifiers), the closed 11-member `output.*` vocabulary and the
  durable-versus-live split, envelope/preview/stat redaction (no prompt/result/payload/path/
  secret), the read-page shape (mandatory `limit`, `eof` distinct from `caught_up`), and
  `protocol/outputspool` parity against `contracts/ports.ts` reconciled to the schema
  modules (FR4, FR5, FR20, FR21, Security 5, C8, C20, C22, AC18). Acceptance: `bun test
  packages/schema` and `bun test packages/protocol` green.
- [ ] T042 [S27] Add integration tests under `packages/opencode/test/outputspool/**` through
  the Feature 007 sandbox spool trees under `.dev/` for the FileSink batched writer plus
  tiered fsync, the positional page reader under concurrent append with bounded memory, the
  control-store committed-length ordering, the ref-aware retention sweeper, authorization
  re-evaluation, the C16 migration dual-read, and budgeted context-slice materialization with
  range recording (AC1, AC2, AC12, AC16, AC17, AC19, AC22). Acceptance: `bun test
  packages/opencode` green under the sandbox wrapper.
- [ ] T043 [S27] Add fault-injection tests under `packages/opencode/test/outputspool/**`
  driving the crash matrix per C12 (crash before seal → committed bytes or corrupt/unknown;
  crash after seal before event → settling yields a sealed ref; reconciliation into
  sealed/open/aborted/corrupt/unknown) and the quota/ENOSPC matrix per C4 (ENOSPC on append,
  fd exhaustion, per-scope quota exceed, sustained latency degrade-then-fence, seal never
  reports lost bytes as success) through the injected filesystem port, mirroring the plan
  testing matrix (FR10, FR25, C4, C12, AC6, AC7, AC8, AC9, AC10). Acceptance: `bun test
  packages/opencode` green with every crash and fault point asserted.
- [ ] T044 [S27] Add contract and end-to-end tests through the Feature 007 sandbox wrapper
  covering the `output.*` IDs versus the existing reserved catalog (already at 1.3.0) with
  reserved-ID collision rejection, the CLI human plus JSON `op output` output with zero
  admin-time model calls, the TUI paged read/follow/tail panel with cursor reconnect and
  direct-children-only, a huge-output bounded-memory run, handoff refs, a plugin oversized
  spill, path-traversal denial, unauthorized-sibling denial, and a Feature 003 scheduled
  occurrence owning its OutputGroup with a bounded summary/ref notification (AC1, AC12, AC13,
  AC14, AC15, AC20, AC21). Acceptance: `bun test packages/opencode`/`packages/cli`/
  `packages/tui` green under the sandbox.
- [ ] T045 [S27] Run per-package `tsgo --noEmit` typecheck and `bun test` for
  `packages/schema`, `packages/protocol`, `packages/core`, `packages/opencode`,
  `packages/cli`, and `packages/tui`, plus a telemetry cardinality audit under
  `packages/core/test/outputspool/**` asserting content/path/OutputRef/`session_id`/
  `process_id`/`user_id` never appear as metric labels, over-budget dynamic values map to
  `other`, the `reasoning` channel is never exported to OTEL, `output.*` spans correlate with
  the Feature 001 spans, and OTEL-down does not block seal/read; every package must typecheck
  and test green (Observability, FR5, C9, C22, AC18). Acceptance: all six packages typecheck
  and test green.
- [ ] T046 [S0–S27] Close-out: tick every checkbox above once its task is complete and
  verified, confirm `speckit validate` is green with only the four pre-existing waived
  hygiene findings, and mark the Feature 005 workflow phase complete (every FR1–FR50 and
  AC1–AC22 mapped to a task per the Traceability section). Acceptance: `speckit validate`
  green and the Traceability tables fully mapped.

## Traceability

Requirements-to-task and acceptance-to-task coverage. The closed **11-member**
`output.*` content-plane event vocabulary, the 7-member `Channel`/`GroupState`, the
6-member `RetentionEdgeKind`, and the 5-member `QuotaScope` are the CUE/`data-model.md`
authority; `contracts/ports.ts` presented a divergent provisional surface (a 13-member
`output.*` vocabulary — `output.sealed|aborted|settled_sealed|settled_unknown|
settled_corrupt|released|purged` durable plus `output.append_progress|backpressure|
admission_fault|cursor_invalidated|reconcile_started|unknown` live — and a 5-member
`ReferenceEdgeKind`). T014 reconciles it to the CUE authority (11 event names, 7 durable
+ 4 live, the 6-member retention edge set) and sources the `protocol/outputspool` enums
directly from the `packages/schema/src/outputspool/*` modules so the transport contract
cannot drift; T041 pins that parity across the draft, the protocol mirror, and the schema
modules.

| Requirement | Tasks |
| ----------- | ----- |
| FR1 sole content plane | T015, T033, T034 |
| FR2 separate from lifecycle/EventV2/OTEL | T031, T037 |
| FR3 no second executor/store | T015, T028, T034 |
| FR4 EventV2 refs OutputRef + preview only | T006, T009, T010, T031, T041 |
| FR5 OTEL content-free aggregates | T002, T006, T009, T023, T031, T045 |
| FR6 file-backed first chunk | T018, T026 |
| FR7 bounded memory | T018, T019, T033 |
| FR8 producer → queue → batched writer | T018, T026 |
| FR9 short/partial/idempotent append, concurrent read | T018, T027 |
| FR10 backpressure/quotas + admission faults | T007, T020, T043 |
| FR11 managed private recovery authority | T025, T026 |
| FR12 no path exposure | T001, T005, T025, T031 |
| FR13 private managed authority / recovery | T025, T026 |
| FR14 OutputGroupRef process/attempt/generation | T001, T008, T015 |
| FR15 typed channel set | T003, T008 |
| FR16 content type + provenance metadata | T003, T008 |
| FR17 OutputRef + opaque cursor | T001, T004, T016 |
| FR18 native contract operations | T005, T014, T017, T018, T027 |
| FR19 state machine states | T003, T017 |
| FR20 bytes / mandatory server-capped limit / UTF-8 | T002, T005, T014, T019, T027 |
| FR21 read response fields / eof-when-sealed | T005, T019 |
| FR22 follow cursor / reconnect / expiry | T004, T014, T016 |
| FR23 settlement precedes terminal | T008, T010, T031 |
| FR24 seal finality / abort preserves bytes | T017, T026 |
| FR25 crash reconcile corrupt/unknown/recovered | T022, T028, T029 |
| FR26 cancel seal/abort preserve bytes | T017, T026 |
| FR27 stale generation fencing | T015, T017, T028 |
| FR28 ref-aware retention | T007, T021, T030 |
| FR29 bounded cleanup / referenced not mtime-deleted | T021, T030 |
| FR30 release/cleanup/legal hold | T021, T030, T037 |
| FR31 BackgroundJob OutputRef not strings | T011, T034 |
| FR32 handoff summary + ref / read offset/limit | T034, T035 |
| FR33 transcript refs + bounded previews / slices | T006, T035 |
| FR34 handoff/resume preserve refs / no overwrite | T015, T034, T035 |
| FR35 native streaming sink | T033 |
| FR36 bounded plugin/MCP/legacy boundary | T033 |
| FR37 replace ToolOutputStore path/mtime | T030, T033, T034 |
| FR38 Process panel opens OutputRef / direct-child | T035, T039 |
| FR39 Feature 003 occurrence owns OutputGroup | T015, T037 |
| FR40 Lang Lock tag on textual channels | T005, T008, T025 |
| FR41 stat/read/follow/pagination/tail w/ auth, no path | T014, T037, T038, T039 |
| FR42 consume vs admin plane | T032, T037, T038 |
| FR43 scope enumeration / PermissionV2 | T003, T032, T037 |
| FR44 export/share not raw cross-project | T011, T037 |
| FR45 private permissions | T025 |
| FR46 traversal/symlink/TOCTOU | T025 |
| FR47 metadata authorization before content | T032, T037 |
| FR48 raw OutputRef not saved permission | T001, T032 |
| FR49 optional encryption at rest | T025 |
| FR50 explicit audited deletion/retention/legal hold | T030, T037 |

| Acceptance | Tasks |
| ---------- | ----- |
| AC1 huge output constant memory | T018, T026, T034, T042, T044 |
| AC2 concurrent append/read | T019, T027, T042 |
| AC3 UTF-8 boundary | T019, T040 |
| AC4 reconnect cursor | T016, T040 |
| AC5 slow reader backpressure | T018, T020, T040 |
| AC6 ENOSPC | T020, T043 |
| AC7 quota | T007, T020, T043 |
| AC8 crash before seal | T017, T022, T028, T029, T040, T043 |
| AC9 crash after seal before event | T022, T029, T031, T043 |
| AC10 cancel preserves bytes | T017, T026, T043 |
| AC11 stale generation | T015, T040 |
| AC12 handoff refs | T034, T035, T042, T044 |
| AC13 plugin legacy oversized | T033, T037, T038, T044 |
| AC14 path traversal | T025, T044 |
| AC15 unauthorized sibling | T032, T037, T044 |
| AC16 retention refs | T021, T030, T040, T042 |
| AC17 cleanup batch | T021, T030, T040, T042 |
| AC18 OTEL down | T023, T031, T041, T045 |
| AC19 context slice budget | T035, T042 |
| AC20 direct/manager hierarchy | T039, T044 |
| AC21 scheduled occurrence | T037, T044 |
| AC22 Lang Lock metadata | T008, T025, T042 |

## Dependencies

**Sequencing (internal):**

- Schema and protocol (T001–T014) precede every domain, application, and surface
  task. Within Phase 1: T001 and T002 precede T003–T011 (identifiers and value objects
  are referenced by every enum and struct); T003 (enums + vocabulary) precedes T004–T011;
  T004 (cursor) depends on T002–T003; T005 (page/stat) depends on T002–T003; T006
  (preview) depends on T001–T002; T007 (quota/retention) depends on T002–T003; T008
  (group/channel) depends on T001–T003; T009 (envelope) depends on T001–T003; T010 (events
  + definitions) depends on T003 and T009; T011 (admin) depends on T001–T003; T012 (schema
  barrel) depends on T001–T011; T013 (durable manifest) depends on T010; T014 (protocol)
  depends on T003–T011.
- Domain engine (T015–T024) depends on the schemas (T001–T012). T015 (identity) depends on
  T001 and T008; T016 (cursor codec) depends on T004; T017 (group state) depends on T003
  and T008; T018 (writer queue) depends on T002 and T017; T019 (paging) depends on T005 and
  T017; T020 (admission) depends on T003 and T017; T021 (retention graph) depends on T007;
  T022 (reconcile) depends on T017 and T008; T023 (instruments) depends on T003 and T010;
  T024 (core barrel) depends on T015–T023.
- Application and adapters (T025–T037) depend on the domain engine and schemas. T025
  (spool layout) depends on T015; T026 (FileSink writer) depends on T018 and T025; T027
  (page reader) depends on T019 and T025; T028 (control store) depends on T022 and T026;
  T029 (reconciler) depends on T028; T030 (retention sweeper) depends on T021 and T028;
  T031 (durable events) depends on T010, T013, and T017; T032 (authorization) depends on
  T025; T033 (compat boundary) depends on T026 and T032; T034 (migration bridge) depends on
  T026 and T033; T035 (context slice) depends on T027 and T032; T036 (application barrel)
  depends on T025–T035; T037 (operator commands) depends on T014, T031, and T032.
- CLI/TUI surfaces (T038–T039) depend on the operator commands (T037); T039 additionally
  depends on T035 for the paged slice materialization.
- Tests and validation (T040–T046) depend on their corresponding implementation tasks;
  T042–T044 run only through the Feature 007 sandbox wrapper; T045 (typecheck + test)
  depends on T001–T044; T046 (close-out) depends on every prior task and a green
  `speckit validate`.

**External dependencies (must be available or accepted first):**

- **ADR-0006 (OutputSpool Content Plane and Paged ArtifactStore, proposed)** is the
  required decision record; its provisional constants — page/queue/quota caps, the batched
  fsync interval, the admission persistence window, the reconciliation fence-record format
  and scan limit, the cursor idle-TTL, preview caps, per-channel retention TTLs, adapter
  caps, and the migration dual-read window — are plan constants in `data-model.md` fixed by
  acceptance testing (AC1, AC4, AC6, AC7, AC12, AC13, AC16, AC17, AC19) and deferred to the
  ADR and its successors (C2, C3, C4, C8, C11, C12, C14).
- **EventV2 remains the single event authority**: `packages/schema/src/event.ts`
  (`EventV2.define`), `packages/core/src/event.ts` (`Service`, `readAggregate`,
  `allBounded`), the `packages/schema/src/durable-event-manifest.ts` inventory, and the
  existing `packages/opencode/src/event-v2-bridge.ts` publish boundary are reused, not
  replaced. The seven durable `output.*` settlement events register through `EventV2.define`
  and publish through the new `publishOutputEvent` boundary; the four live signals ride the
  bounded live channel; no second bus or channel is introduced (C20).
- **Feature 001 (Smart Agent Routing and Telemetry)** supplies the bounded context (Workers
  write, Managers read offset/limit), the telemetry instruments plus cardinality allowlist,
  and the async content-free OTLP exporter reused by T023 and T045 (FR1, FR5, C22, AC18).
- **Feature 002 (Task Lifecycle Event Bus and Process Table)** owns lifecycle terminal
  status and supplies `Lifecycle.OutputRef`/`BoundedOutputRef`, the
  `RowTelemetry.output_ref` settlement seam already reserved by Feature 002 C20, the
  direct-child Session hierarchy, and the root-tree Ctrl+C cancel boundary. Feature 005 owns
  content-plane settlement (seal/abort/OutputRef/committed bytes) and supplies pages on
  expand, never bytes; the shared clarify is ordering and crash reconciliation only, not a
  reassignment of ownership (FR2, FR23, FR26, FR38, C13, C21).
- **Feature 003 (Scheduled Jobs and Async Notification)** owns the scheduled occurrence,
  which owns its OutputGroup for that occurrence's execution; NotificationEnvelope carries a
  bounded summary plus `output_ref` only (FR39, C21).
- **Feature 004 (Lang Lock)** owns the language tag/version/provenance; T025 attaches the
  Feature-004-owned tag/provenance read from the trusted execution envelope onto textual
  channels, never recomputed by the content plane and never a content-telemetry export
  (FR40, C8).
- **Feature 007 (Operator Control Plane, ADR-0003 accepted)** is the sole management
  authority: its Config.Service quota/retention/flag persistence, PermissionV2 principals and
  scopes, the SecretPort SecretRef redaction, the reserved
  `output.stat|read|follow|export|share|release|delete|purge|retention.set|quota.set` catalog
  already present at `RESERVED_CATALOG_VERSION = 1.3.0` (no bump required), the registry, CAS,
  idempotency, audit, and the `.dev/opencode-operator/` sandbox wrapper (env prefix
  `OPENCODE_DEV_OPERATOR_=1`, isolated spool root `.dev/opencode-operator/outputspool`,
  loopback port 14096) are the only path for `output.*` registration (T037–T039) and for
  integration/fault/e2e tests (T042–T044). Feature 005 registers no parallel command
  registry, permission system, or store authority (C3, C5, C7, C17, C19).
- **Feature 008 (MCP Tools)** crosses the T033 compatibility boundary: every MCP call/read
  creates an OutputGroup and surfaces as preview + OutputRef, never a path (spec Related).

**Shared seams already in `specScopeGlobs` and NOT duplicated:**
`packages/opencode/src/event-v2-bridge.ts` (Feature 001) for `publishOutputEvent`;
`packages/schema/src/durable-event-manifest.ts` and `packages/core/src/event.ts` and
`packages/core/src/operator/**` and `packages/core/test/operator/**` and
`packages/opencode/src/operator/**` and `packages/opencode/test/operator/**` (Feature 007)
for the durable manifest, the EventV2 authority, the reserved `output.*` catalog
(`packages/core/src/operator/catalog.ts`, already at 1.3.0), and the operator command
impls; `packages/tui/src/**/operator/**` (Feature 007) for the paged panel host;
`packages/schema/src/index.ts` and `packages/schema/test/**` (Feature 001) and
`packages/protocol/test/**` (Feature 001) for the schema barrel and schema/protocol tests.
The C16 migration seams `packages/core/src/background-job.ts` and
`packages/core/src/tool-output-store.ts` are NOT covered by any existing glob and are added
as real globs in this feature's `specScopeGlobs` block so T034 can write them.
