---
status: accepted
date: 2026-07-18
deciders: [project maintainers]
---

# 0006 — OutputSpool Content Plane and Paged ArtifactStore

## Context and Problem Statement

Feature 005 (OutputSpool and ArtifactStore) defines the canonical content plane
for every observed output produced by main context, agents, subagents,
background jobs, tools, and processes: a file-backed **OutputSpool** and paged
**ArtifactStore**. Every observable output chunk is file-backed from the first
observable chunk, and process-local memory stays bounded independent of total
committed bytes. The feature `spec.md` names this ADR — **OutputSpool Content
Plane and Paged ArtifactStore** — as the required decision record that formalizes
the clarify package (Session 2026-07-18, C1–C23) before `plan` completion and any
implementation.

The research base (`research.md`) confirms that OpenCode carries no canonical
content plane today. `BackgroundJob` holds full `output`/`error` strings in
process memory (`packages/core/src/background-job.ts:9-32`), so a single large
job grows RAM proportionally to total output. `ToolOutputStore` materializes the
whole contextual text before it spills, embeds the absolute filesystem path in
the truncation marker (`packages/core/src/tool-output-store.ts:138-173`), and
cleans by `mtime` alone (`:176-188`), so a still-referenced output is deleted by
age. The V2 runner and tool registry propagate `outputPaths` into message parts
(`packages/core/src/session/runner/llm.ts:229-267`,
`packages/core/src/tool/registry.ts:46-80`,
`packages/core/src/session/message-updater.ts:309-337`), so full results and
filesystem paths remain first-class in projection. EventV2 already provides a
single durable/live authority (`packages/core/src/event.ts:63-108`, `:152-164`)
and the reserved operator catalog already declares the `output.*` IDs at
`RESERVED_CATALOG_VERSION = "1.3.0"` (`packages/core/src/operator/catalog.ts`).

Without one decision record, Feature 005 risks a second executor or store
authority beside Feature 002 lifecycle, a second event system beside EventV2, a
public filesystem path exposed to the LLM/UI/API, full output content carried in
terminal events or telemetry, `mtime`-only retention that deletes referenced
output, a parallel permission system beside Feature 007, and an unbounded
per-token write path. This ADR fixes those decisions so `plan` and `tasks`
proceed against a stable content-plane/identity/state-machine/retention/security
contract without reopening Feature 001 bounded-context gates, Feature 002
lifecycle/Todo execution authority, Feature 003 occurrence/notification
ownership, Feature 004 Lang Lock provenance ownership, or Feature 007 native-only
operator authority and reserved catalog.

## Decision Drivers

- One content-plane authority; Feature 005 introduces no second executor,
  SessionRunner, EventV2 system, or parallel store, and V1 and V2 share one
  canonical seam.
- File-backed from the first observable chunk with bounded process memory:
  producer → bounded queue → batched async writer, never a filesystem write per
  token or delta.
- A managed private spool under the OpenCode data directory as the sole recovery
  authority; no public filesystem path reaches the LLM, UI chrome, HTTP API, tool
  result, EventV2 payload, or transcript.
- Stable identity: `OutputGroupRef` scoped to process/attempt/generation with
  stale-generation fencing; opaque `OutputRef` and opaque `cursor` that never
  reveal a path and are never saved permission resources.
- A closed native contract and state machine with byte-offset paged reads,
  UTF-8-safe pages, and `eof` true only when a channel is sealed and consumed.
- Durability tiered by channel class, with a committed-length authority and
  crash reconciliation into `sealed`, `open`, `aborted`, `corrupt`, or `unknown`
  — never silent empty-success.
- Reference-aware retention (TTL, lease, reference graph, active readers/writers,
  legal hold), never `mtime`-only cleanup.
- Feature 002 owns lifecycle terminal status; Feature 005 owns content-plane
  settlement; a terminal status never precedes settlement without an
  intermediate settling/unknown/corrupt reconciliation state.
- Authorization through Feature 007 operator principals and PermissionV2 scopes,
  re-evaluated per action; no parallel permission system.
- One event authority (EventV2) and content-free telemetry per ADR-0001; events,
  audit, previews, and metrics carry no content, path, or secret material —
  SecretRef only.

## Considered Options

- **Managed private file-backed spool with OutputGroupRef identity, a closed
  native begin/append/read/follow/seal/abort/stat/release/cleanup contract,
  tiered durability, reference-aware retention, Feature 002 settlement split,
  Feature 007 authorization, and content-free EventV2/telemetry** — selected:
  one content authority, bounded memory, no path exposure, generation fencing,
  and no second executor, store, event system, or permission system.
- **Keep BackgroundJob/ToolOutputStore string-and-path storage and grow it** —
  rejected: strings scale with total bytes and OOM the runtime, `mtime`-only
  cleanup deletes referenced output, and the truncation marker embeds a public
  filesystem path (`tool-output-store.ts:138-188`).
- **Expose spool filesystem paths to consumers (LLM, UI, API, tool results)** —
  rejected: a public path is an authorization and traversal hazard and leaks
  private managed storage; consumers receive only OutputRef, cursor, metadata,
  and authorized content pages.
- **A second executor or store authority for the content plane** — rejected:
  splits execution authority away from Feature 002 lifecycle and the single
  canonical seam; Feature 005 supplies content pages only, never bytes, and
  never a parallel runner.
- **A parallel event/telemetry channel for output settlement** — rejected:
  splits the EventV2 authority; durable settlement events register through
  `EventV2.define` into the durable-event manifest, and live append/progress
  signals use the bounded live channel that may be dropped under load.
- **Carry full output content or filesystem paths in terminal events, previews,
  or OTEL labels** — rejected: violates content-free telemetry (ADR-0001) and
  leaks sensitive output; events and previews carry only OutputRef plus a
  bounded, redacted, path-free, secret-free preview.
- **A per-token filesystem write or fsync** — rejected: destroys throughput
  under high-rate producers; a batched async writer is mandatory and per-token
  fsync is prohibited.
- **`mtime`-only retention** — rejected: deletes still-referenced transcript,
  Todo, handoff, and notification outputs; retention is reference-aware over a
  reference graph with leases and legal holds.
- **A parallel permission system for output actions** — rejected: Feature 007
  operator principals and PermissionV2 scopes already model authorization;
  Feature 005 re-evaluates authorization per action and invents no second system.
- **Transparent compression or content dedup in V1** — rejected: changes the
  byte-offset cursor contract and adds CPU/memory cost; the canonical offset unit
  is uncompressed bytes and compression is deferred to a post-V1 configuration
  hook.

## Decision Outcome

Chosen option: **a managed private file-backed OutputSpool and paged
ArtifactStore that is the sole content-plane authority — OutputGroupRef identity
with generation fencing, a closed native contract and state machine, tiered
durability with a committed-length recovery authority, reference-aware retention,
a Feature 002 settlement split, Feature 007 authorization, and content-free
EventV2/telemetry**.

- **Content plane and single seam.** OutputSpool/ArtifactStore is the sole
  canonical content plane for observed outputs of main, agent, subagent,
  background-job, tool, and process producers, separate from lifecycle/control
  (Feature 002), EventV2, and OTEL. Feature 005 introduces no second executor,
  SessionRunner, EventV2 system, or parallel store authority, and V1 and V2 use
  one canonical seam (FR1–FR3).
- **Managed spool layout (C1).** The recovery authority is a managed private tree
  under the OpenCode global data directory — the same `Global`-rooted data path
  that today hosts `tool-output` (`packages/core/src/global.ts:15-39`) — that
  replaces the flat `tool-output` directory. The layout keys by project, root
  session, process/attempt, generation, and channel so one OutputGroupRef maps to
  exactly one generation subtree and stale generations never share a file with a
  successor (FR11, FR14). OS-tmp holds only channels marked disposable. The
  directory-segment grammar, opaque group/segment naming, and shard fan-out are
  provisional plan constants with acceptance hooks AC1/AC14; the fixed requirement
  is a private managed tree with recovery semantics and no public path exposure
  (FR12).
- **Tiered durability (C2).** Durability is tiered by channel class. Durable
  channels (`assistant-text`, `reasoning`, `tool-result`, `error`, `artifact`)
  fsync the data extent and its control commit at `seal`/`abort` and at a bounded
  batched interval during long appends; high-rate console channels (`stdout`,
  `stderr`) fsync at `seal` and rely on batched async writes between; disposable
  OS-tmp outputs are never fsynced. A batched async writer is mandatory in every
  tier and per-token fsync is prohibited (FR8). Exactly-once FS+DB commit is out
  of scope; the durability contract is committed-bytes-or-corrupt, never silent
  empty-success (FR25, AC6, AC8). The batched fsync interval and per-class
  overrides are provisional plan constants with acceptance hook AC1.
- **Page, queue, and quota bounds (C3).** `limit` is mandatory on every read and
  server-capped; the provisional server page cap is 1 MiB with a 64 KiB
  interactive default, the per-writer bounded queue is depth- and byte-capped, and
  quotas apply at global, root, session, process, and channel scopes (FR10, FR20).
  Exact byte values are provisional plan constants owned by `plan` and
  Config.Service (Feature 007) with acceptance hooks AC1, AC5, and AC7. Unbounded
  page size, queue depth, or retention is prohibited.
- **Admission and fault policy (C4).** ENOSPC, fd exhaustion, quota exceed,
  permission denial, and sustained disk latency are first-class observable
  admission/fault states, never swallowed. The default policy is
  degrade-then-fence: the affected channel enters a degraded admission state,
  backpressures the producer, and — if the fault persists past a bounded window —
  transitions to `aborted` or `corrupt` while preserving committed bytes (FR10,
  FR24, AC6, AC7). Seal is never reported as success when bytes were lost.
  Operator-prompt and hard-cancel variants are Feature 007 configuration, not the
  default; the persistence window and per-fault mapping are provisional plan
  constants with acceptance hooks AC6/AC7.
- **Reference-aware retention (C5).** Retention is reference-aware, never
  `mtime`-only, replacing the `ToolOutputStore` `mtime` cleanup
  (`tool-output-store.ts:176-188`). A group is reclaimable only when its TTL has
  elapsed AND it holds no live lease, no active reader/writer, and no inbound edge
  in the reference graph (transcript ref, Todo evidence, handoff envelope,
  NotificationEnvelope `output_ref`, Feature 002 `RowTelemetry.output_ref`) AND no
  legal/privacy hold applies (FR28–FR30, AC16). `release` drops one holder edge;
  `cleanup` reclaims only fully unreferenced expired groups in bounded batches
  (FR29, AC17). Per-channel TTL defaults (reasoning stricter per C9) are
  provisional plan constants with acceptance hooks AC16/AC17.
- **Private permissions and traversal safety (C6).** V1 mandates private
  filesystem permissions on the managed tree — POSIX `0700` directories / `0600`
  files on Unix and the equivalent owner-only ACL on Windows and macOS (FR45) — as
  the baseline confidentiality control; encryption-at-rest and key management are
  optional configuration hooks whose absence never relaxes path privacy or
  authorization (FR49). Traversal, symlink-escape, and TOCTOU protection on
  open/read/write/delete is mandatory on every platform (FR46, AC14). The per-OS
  ACL API and the optional encryption key-policy surface are provisional plan
  constants with acceptance hooks AC14/AC15.
- **Authorization via Feature 007 (C7).** Output actions authorize through
  Feature 007 operator principals and PermissionV2 scopes; Feature 005 invents no
  parallel permission system (FR43). The scope enumeration is `self`, `child`,
  `tree`, `session`, `project`, `operator-global`, re-evaluated per action — a raw
  OutputRef is never a saved permission resource (FR48, AC15). Until the
  Feature 007 principal/root-tree model lands, the interim gap is closed
  conservatively: consume-plane reads authorize by the owning session/tree
  principal and admin-plane actions deny by default. The interim-to-final
  migration is a provisional plan step with acceptance hook AC15.
- **Bounded preview policy (C8).** Previews are bounded and content-classified,
  never a path and never a full channel: a byte-and-line-capped, redacted head
  slice (secret material stripped to SecretRef per C22) attached to EventV2
  payloads, UI cards, and NotificationEnvelope summaries alongside the opaque
  OutputRef only (FR4, FR33). Terminal EventV2 payloads carry no full content
  chunk and no path. Exact preview caps and the redaction ruleset are provisional
  plan constants with acceptance hooks AC12/AC19.
- **Reasoning channel privacy (C9).** The `reasoning` channel is stricter than
  `assistant-text`: never emitted to OTEL, never surfaced in unauthorized
  previews, carries a shorter default TTL, and requires an explicit authorized
  principal before any content page is returned (FR16, Privacy 2). It remains a
  first-class spool channel so bounded memory and paged read apply. The precise
  reasoning TTL and authorized-viewer principal set are provisional plan constants
  with acceptance hook AC22.
- **Budgeted context materialization (C10).** Context builders materialize only
  selected byte/token-budgeted ranges of a sealed channel and record the exact
  ranges used; the LLM never receives an entire spool file automatically (FR33,
  AC19). Selection operates on sealed channels through the same
  `read(offset, limit)` contract under an explicit budget, and the recorded ranges
  become part of the durable transcript reference set feeding C5 retention. The
  selection heuristic and budget-accounting format are provisional plan constants
  with acceptance hook AC19.
- **Compatibility boundary (C11).** Non-streaming plugin, MCP, and legacy tool
  adapters use a bounded compatibility boundary that spills to the spool before
  full LLM-facing materialization when the source allows and enforces explicit
  size, time, and memory limits with no public path embedded in the result (FR36,
  FR37, AC13), replacing `tool-output-store.ts` path-in-preview. A source that
  cannot stream is capped at the configured bound and the channel is marked
  truncated/degraded rather than growing unbounded memory (FR7). The numeric caps
  are provisional plan constants owned by Config.Service with acceptance hook
  AC13. Feature 008 MCP call/read outputs each create an OutputGroup and cross the
  boundary as preview+OutputRef.
- **Crash reconciliation (C12).** Recovery reconciles the filesystem data extent
  against the control/SQLite metadata into exactly `sealed`, `open`, `aborted`,
  `corrupt`, or `unknown` (FR25). The committed length recorded in control
  metadata is the authority: when the data extent is at least that length the
  group recovers as sealed/open; when it is shorter or the seal record is absent
  after committed appends the group recovers as `corrupt` or `unknown` with
  bounded recovery, never silent empty-success (AC8, AC9). Exactly-once FS+DB is
  out of scope. The fence-record format and bounded recovery-scan limit are
  provisional plan/ADR constants with acceptance hooks AC8/AC9.
- **Settlement ordering (C13).** Feature 002 owns lifecycle terminal status;
  Feature 005 owns content-plane settlement (seal/abort/OutputRef/committed
  bytes). A Task terminal status never precedes output settlement without an
  intermediate `settling` (or `unknown`/`corrupt`) reconciliation state — the seam
  reserved by Feature 002 C20 and `RowTelemetry.output_ref` (FR23). Parents
  observe either sealed/aborted refs or an explicit settling/unknown/corrupt
  condition (AC9). This decision fixes ordering and crash reconciliation only and
  does not move the ownership boundary. Acceptance hooks AC8/AC9.
- **Cursor invalidation (C14).** A follow cursor is an opaque token bound to the
  group generation and byte offset. It is invalidated by generation supersession
  (fencing, FR27), by group `release`/`cleanup`/expiry, and by an absolute idle-TTL
  after seal; a reconnect with a stale or superseded cursor returns a stable
  `expired`/`invalid_cursor` code rather than silently rewinding or leaking a later
  generation (FR22, AC4). Reconnect within validity resumes from the cursor without
  full re-read. The absolute cursor idle-TTL is a provisional plan constant with
  acceptance hook AC4.
- **No compression in V1 (C15).** Compression and content dedup are out of scope
  for V1: the canonical offset unit is uncompressed bytes and paged read/UTF-8
  boundary safety operate on the raw byte stream (FR20, AC2, AC3). Optional
  transparent compression and dedup are deferred to a post-V1 configuration hook
  so they never change the byte-offset cursor contract; V1 optimizes memory via
  bounded queues and batched writes. Deferred with acceptance hook AC1.
- **Phased migration behind a flag (C16).** Migration is phased behind a feature
  flag with a bounded dual-read window: BackgroundJob keeps reading legacy
  `output`/`error` strings (`background-job.ts:9-32`) while writing OutputRef, and
  ToolOutputStore consumers read either path-preview or OutputRef during cutover,
  then the legacy fields are retired (FR31, Compatibility). V1 and V2 share one
  canonical seam with no second executor or store authority (FR3). The flag names,
  dual-read window, and cutover order are provisional plan constants with
  acceptance hooks AC1/AC12.
- **Export/share deny-by-default (C17).** Share and export are deny-by-default
  across projects (Privacy 3, FR44). Within a project, `output.export` and
  `output.share` are admin-plane operations requiring an operator principal,
  `project` scope, version/CAS, idempotency, and audit (Feature 007; reserved
  catalog entries `output.export`/`output.share`, both `mutates:true`,
  `scopesAllowed:["project"]`). Raw arbitrary cross-project sharing and public
  filesystem path share are out of scope; a cross-project transfer requires
  explicit operator authorization and a content-bounded export, never a raw path
  (FR44). The allowed export encodings are a provisional plan constant with
  acceptance hook AC13.
- **Opaque identity and fencing (C18).** Identity is `OutputGroupRef` scoped to
  process/attempt/generation (FR14); `OutputRef` identifies a sealed or open
  channel/artifact within a group for read/follow/stat and is a bounded opaque
  token, never a filesystem path and never a saved permission resource (FR12,
  FR17, FR48). The opaque `cursor` encodes at minimum group id, generation,
  channel, and byte offset plus an integrity tag, exposing no client-visible
  internals beyond the opaque contract (FR17). This matches the existing consumers
  that already treat OutputRef as opaque: Feature 002 `Lifecycle.OutputRef`/
  `BoundedOutputRef`, Feature 003 `ids.#OutputRef`, and Feature 004
  `langlock/correlation.cue #OutputRef`. The token codec and integrity-tag
  algorithm are provisional plan constants with acceptance hooks AC4/AC11/AC14.
- **Reserved operator surface (C19).** All OutputSpool management flows
  exclusively through the Feature 007 reserved catalog dotted IDs already
  registered in `@opencode-ai/core/operator`
  (`packages/core/src/operator/catalog.ts`): consume plane `output.stat`,
  `output.read`, `output.follow` (`mutates:false`,
  `scopesAllowed:["session","project"]`) and admin plane `output.export`,
  `output.share`, `output.release`, `output.delete`, `output.purge`,
  `output.retention.set`, `output.quota.set`, read live from
  `RESERVED_CATALOG_VERSION = "1.3.0"` with additive-only bumps, never a second
  SDK list (FR41–FR43). Consume actions re-evaluate authorization per call; admin
  actions require operator principal and explicit scope (FR42). Plugin/MCP/custom
  registries never register these reserved IDs and no new operator bus is created.
- **Native contract and durable/live split (C20).** The native contract
  operations are exactly `begin`, `append(expected_offset)`, `read(offset, limit)`,
  `follow(cursor)`, `seal`, `abort`, `stat`, `release`, `cleanup` (FR18) over
  states `open`, `sealing`, `sealed`, `aborted`, `corrupt`, `expired`, `unknown`
  (FR19). Durable settlement events (seal, abort, settlement, corrupt/unknown
  reconciliation) register via `EventV2.define` into
  `packages/schema/src/durable-event-manifest.ts` through the single EventV2
  authority, mirroring Feature 002 C2 / Feature 003 C5 / Feature 004 C8; live
  append/progress/backpressure signals use the bounded live channel and are droppable
  under `allBounded` load without affecting durable seal/read
  (`event.ts:152-164`). `eof` is true only when a channel is sealed (or aborted
  with no further append) and the reader has consumed through committed end (FR21).
  Content is never an event payload (FR4, FR5). Acceptance hooks AC2/AC8/AC18.
- **Producer owns its OutputGroup (C21).** The producer that owns a Feature 002
  Process writes its own OutputGroup; Feature 002 remains execution authority and
  supplies pages only, never bytes (FR2, FR38). A Feature 003 scheduled occurrence
  owns the OutputGroup for that occurrence's execution (FR39,
  `jobs/occurrence-parts.cue output_ref`); main context, agents, subagents,
  background jobs, tools, and processes each own a group scoped to
  process/attempt/generation (FR1, FR14). No producer shares a generation subtree
  with a stale generation (C1, FR14) and no second executor or store authority is
  introduced (FR3). Direct-child Session hierarchy stays Feature 002 ownership; the
  content plane supplies authorized pages on expand (AC20).
- **Content-free events and SecretRef (C22).** Events, telemetry, audit records,
  and previews are content-free and secret-free: no file text, diff, prompt,
  message, path, snippet, reasoning, or tool payload leaves the content plane
  except as an authorized paged read (FR5, FR33, Observability, Security Logging).
  Secret material detected in a preview or notification is a Feature 007 SecretPort
  `SecretRef`, never inline plaintext (`telemetry/config.cue #SecretRef`, Feature 003
  SecretRefList posture). OTEL labels are bounded enums/buckets only and never
  content, path, OutputRef, session id, process id, or user id (NFR Cardinality 5).
  Audit is content-free with stable error codes (`not_found`, `denied`, `quota`,
  `enospc`, `corrupt`, `expired`, `invalid_cursor`).
- **TUI/App/CLI paging UX (C23).** Native TUI, App, and CLI consume `output.stat`,
  `output.read`, `output.follow`, pagination, and tail against OutputRef with
  authorization and no path exposure (FR41), rendering bounded pages and a
  follow/tail mode that resumes from an opaque cursor on reconnect (C14, C18). The
  paged UX loads content only on authorized expand/read, never the complete output
  by default, and shows direct children only for the Feature 002 hierarchy (FR38,
  AC20). Native slash/menu/palette entry points are intercepted before prompt
  admission with zero provider tokens. The key bindings, page-size affordances, and
  tail-follow indicators are a plan/UX contract with acceptance hooks AC19/AC20.

### V1 decisions accepted with this ADR (Feature 005 clarify package C1–C23)

Declarative clarify resolutions (Session 2026-07-18); full matrices live in
Feature 005 `spec.md` Clarifications. Numeric limits, layout details, and the
reconciliation algorithm this feature defers are provisional plan constants with
named acceptance hooks, never open placeholders:

1. **Managed spool layout.** Private tree under the OpenCode global data
   directory keyed project/root-session/process-attempt/generation/channel;
   OS-tmp only for disposable channels. Hooks AC1/AC14 (C1).
2. **Tiered durability.** Durable channels fsync at seal/abort plus batched
   interval; console channels fsync at seal; disposable never fsynced; batched
   async writer mandatory; committed-bytes-or-corrupt. Hooks AC1/AC6/AC8 (C2).
3. **Page/queue/quota bounds.** Mandatory server-capped `limit`; 1 MiB page cap /
   64 KiB default; depth- and byte-capped queue; quotas at
   global/root/session/process/channel. Hooks AC1/AC5/AC7 (C3).
4. **Admission and fault policy.** ENOSPC/fd/quota/permission/latency are
   observable states; default degrade-then-fence preserving committed bytes;
   seal never lies. Hooks AC6/AC7 (C4).
5. **Reference-aware retention.** Reclaim only when TTL elapsed AND no
   lease/reader/writer/reference-edge/legal-hold; bounded cleanup batches. Hooks
   AC16/AC17 (C5).
6. **Private permissions and traversal safety.** POSIX `0700`/`0600` or
   owner-only ACL; traversal/symlink/TOCTOU protection mandatory; encryption
   optional and non-relaxing. Hooks AC14/AC15 (C6).
7. **Authorization via Feature 007.** Operator principals + PermissionV2 scopes
   `self|child|tree|session|project|operator-global` re-evaluated per action;
   interim consume-by-owner, admin deny-by-default. Hook AC15 (C7).
8. **Bounded preview policy.** Byte/line-capped redacted head slice with SecretRef
   plus opaque OutputRef only; no path, no full channel in events/UI/notifications.
   Hooks AC12/AC19 (C8).
9. **Reasoning channel privacy.** Stricter than assistant-text: no OTEL, no
   unauthorized preview, shorter TTL, explicit authorized principal. Hook AC22 (C9).
10. **Budgeted context materialization.** Only selected byte/token-budgeted ranges
    of a sealed channel; ranges recorded; no automatic full-file injection. Hook
    AC19 (C10).
11. **Compatibility boundary.** Plugin/MCP/legacy adapters spill before full
    materialization, enforce size/time/memory caps, mark truncated/degraded, embed
    no path. Hook AC13 (C11).
12. **Crash reconciliation.** Committed-length authority reconciles into
    sealed/open/aborted/corrupt/unknown with bounded recovery; never silent
    empty-success. Hooks AC8/AC9 (C12).
13. **Settlement ordering.** Feature 002 owns terminal status; Feature 005 owns
    settlement; intermediate settling/unknown/corrupt state before terminal. Hooks
    AC8/AC9 (C13).
14. **Cursor invalidation.** Opaque cursor bound to generation+offset; invalidated
    by fencing/release/cleanup/expiry/idle-TTL; stable expired/invalid_cursor code.
    Hook AC4 (C14).
15. **No compression in V1.** Uncompressed-byte offset unit; raw-byte paged read;
    compression/dedup deferred post-V1. Hook AC1 (C15).
16. **Phased migration behind a flag.** Bounded dual-read for BackgroundJob and
    ToolOutputStore; write OutputRef, then retire legacy fields; one seam. Hooks
    AC1/AC12 (C16).
17. **Export/share deny-by-default.** Deny across projects; in-project admin ops
    require operator principal, `project` scope, CAS, idempotency, audit; no raw
    path share. Hook AC13 (C17).
18. **Opaque identity and fencing.** OutputGroupRef (process/attempt/generation),
    opaque OutputRef and cursor with integrity tag; matches Feature 002/003/004
    consumers. Hooks AC4/AC11/AC14 (C18).
19. **Reserved operator surface.** `output.*` consume+admin IDs live at
    `RESERVED_CATALOG_VERSION = 1.3.0`; additive-only; no second SDK list; no new
    bus. No catalog bump required (C19).
20. **Native contract + durable/live split.** Closed
    begin/append/read/follow/seal/abort/stat/release/cleanup over
    open/sealing/sealed/aborted/corrupt/expired/unknown; durable events via
    `EventV2.define`; droppable live signals; eof-only-when-sealed. Hooks
    AC2/AC8/AC18 (C20).
21. **Producer owns its OutputGroup.** Feature 002 supplies pages, never bytes;
    Feature 003 occurrence owns its group; no second executor. Hook AC20 (C21).
22. **Content-free events and SecretRef.** No content/path/secret in
    events/telemetry/audit/previews; SecretRef only; bounded-enum OTEL labels;
    stable error codes (C22).
23. **TUI/App/CLI paging UX.** Bounded pages, cursor-resumed follow/tail,
    authorized expand/read, direct-children-only, zero-token native entry points.
    Hooks AC19/AC20 (C23).

This ADR is **proposed**; it is the required decision record that unblocks
Feature 005 `plan`/`tasks`. ADR-0001 and ADR-0002 remain proposed; ADR-0003 is
accepted; ADR-0004 and ADR-0005 are proposed.

### Consequences

#### Positive

- One content-plane authority, one event authority, one operator surface, and one
  permission system; no second executor, store, event channel, or command bus.
- Process memory stays bounded independent of total output size; a multi-GB job
  cannot OOM the runtime, replacing the BackgroundJob string and ToolOutputStore
  post-materialization behavior.
- No public filesystem path reaches the LLM, UI, HTTP API, tool result, EventV2
  payload, or transcript; identity is opaque and re-authorized per action.
- Committed-bytes-or-corrupt durability and generation fencing eliminate silent
  empty-success and stale-generation overwrite; retention stops deleting
  referenced output.
- Audit and telemetry are content-free per ADR-0001; the reserved `output.*`
  surface closes LLM/plugin/MCP/prompt administration paths.

#### Trade-offs

- Numeric quotas, the batched fsync interval, preview caps, adapter caps, cursor
  idle-TTL, and the reconciliation fence-record format remain provisional plan
  constants with named acceptance hooks, fixed in the tasks phase.
- Compression and dedup are deferred to a post-V1 configuration hook; V1 stores
  uncompressed bytes and optimizes memory only through bounded queues and batched
  writes.
- Exactly-once FS+DB commit is out of scope; recovery yields
  sealed/open/aborted/corrupt/unknown rather than a single guaranteed state.
- The interim authorization model authorizes consume-plane reads by the owning
  session/tree principal and denies admin-plane actions by default until the
  Feature 007 root-tree principal model lands.

#### Follow-ups

- Feature 005 `plan`/`tasks` implement the schema/protocol modules, the
  framework-free domain spool engine, the application/adapter seams and operator
  wiring, the CLI/TUI paging surfaces, and the BackgroundJob/ToolOutputStore
  migration behind the C16 flag.
- The FS↔SQLite reconciliation algorithm, cursor idle-TTL, quota/fsync/preview
  constants, and per-OS ACL API require plan-phase contracts with named acceptance
  hooks.
- The Feature 007 root-tree principal model closes the interim authorization gap;
  optional encryption-at-rest is a later configuration decision.

## Related

- Feature specification: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Feature research: [005 research](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/research.md)
- Feature plan: [005 plan](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/plan.md)
- Routing/telemetry dependency: [001 Smart Agent Routing and Telemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Lifecycle/settlement dependency: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Scheduled-execution dependency: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Provenance consumer: [004 Lang Lock](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- MCP content-plane consumer: [008 Complete MCP Client Tools and Resources Lifecycle](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0004 — Scheduled Job Runtime and Async Notification Channel](0004-scheduled-job-runtime-and-async-notification-channel.md)
- Related ADR: [0005 — Lang Lock Artifact-Language Policy and Progressive Enforcement](0005-lang-lock-artifact-language-policy-and-progressive-enforcement.md)
</content>

## Links

- Related: ADR-0017.
