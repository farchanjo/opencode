---
id: 019f6f29-1288-7831-8b0b-d4fe981439d8
number: 005
slug: add-a-canonical-file-backed-outputspool-and-paged
status: specified
created_at: 2026-07-17T08:19:50.536031Z
---

# Feature Specification: OutputSpool and ArtifactStore

Feature: 005-add-a-canonical-file-backed-outputspool-and-paged
Created: 2026-07-17

## Scope and intent

Feature 005 defines the **canonical content plane** for all observed outputs produced
by main context, agents, subagents, background jobs, tools, and processes: a
file-backed **OutputSpool** and paged **ArtifactStore**.

Every observable output chunk MUST be file-backed from the first observable chunk.
Process-local memory MUST remain **bounded** and MUST NOT grow proportionally with
total output size. This feature does **not** promise zero RAM; it promises bounded
memory independent of total committed bytes.

The content plane is separate from lifecycle/control (Feature 002), EventV2, and
OpenTelemetry. Lifecycle remains the execution authority. Feature 002/003 depend on
005 content-plane contracts (OutputRef, cursor, seal/abort, paged read) while
Feature 005 MUST NOT introduce a second executor, store authority, or event system.

This feature works for V1 and V2 through one canonical seam.

## Audit summary (001–004 coverage vs gap)

### Already specified (future references)

| Source                 | What exists                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature 001 / ADR-0002 | Bounded context: Workers write future OutputSpool; Managers read offset/limit; Architect gets syntheses/slices/refs. Escalation reuses OutputRefs. |
| Feature 002            | Panel may open OutputRef/cursor; handoff via refs/slices; cancel MUST seal/abort writers preserving committed bytes; definitive contract deferred. |
| Feature 003            | Occurrences own lifecycle/Todo; admitted occurrence owns Feature 005 OutputGroup; notifications carry bounded summary/ref only.                    |
| Feature 004            | Lang Lock tag/provenance SHOULD attach to textual OutputSpool channels; no reserved number before this feature.                                    |
| ADR-0001               | OTEL foundation; no content/path as metric labels.                                                                                                 |

### Confirmed gaps this feature closes

- No file-first OutputSpool contract, channels, or state machine.
- No offset/limit/follow/cursor/pagination native API.
- BackgroundJob holds full `output`/`error` strings in memory
  ([`packages/core/src/background-job.ts:9-32`](../../../../packages/core/src/background-job.ts#L9-L32)).
- ToolOutputStore truncates after full materialization, embeds filesystem paths in
  previews, and cleans by mtime only
  ([`packages/core/src/tool-output-store.ts:14-18`](../../../../packages/core/src/tool-output-store.ts#L14-L18),
  [`:138-188`](../../../../packages/core/src/tool-output-store.ts#L138-L188)).
- EventV2/transcript/message projection carry full content and may surface paths.
- No terminal ↔ seal settlement ordering; no generation fencing.
- No quota/ENOSPC/fd admission signals; no encryption/legal deletion policy surface.
- PermissionV2 lacks operator principal and root-tree auth for output actions.
- Plugin/MCP/legacy tools materialize oversized results without streaming sinks.

## User Stories

### P1 — Bounded memory for huge outputs

- As an operator, I want background/agent/tool/process outputs of arbitrary size to
  keep constant-bounded process memory so that one huge job cannot OOM the runtime.
- As a Manager/Architect, I want offset/limit and follow reads so that I consume only
  selected slices under byte/token budgets.

### P1 — Recovery and identity

- As an operator, I want managed private spool under OpenCode data as recovery
  authority so that restart can resume committed bytes without public path exposure.
- As a system, I want OutputGroupRef per process/attempt/generation with typed
  channels so that concurrent writers and stale generations cannot corrupt identity.

### P1 — Lifecycle consistency

- As a Task parent, I want terminal Task status never to precede output settlement
  without an intermediate settling/reconciliation state so that parents never see
  completed work with missing or corrupt output.
- As an operator, I want Ctrl+C root-tree cancel to seal/abort writers consistently
  while preserving committed bytes (Feature 002 cancel boundary).

### P1 — Security and authorization

- As an operator, I want private directory/file permissions, traversal/symlink/TOCTOU
  protection, and metadata authorization so that sibling sessions and unauthorized
  principals cannot read or delete another tree's output.
- As a security reviewer, I want no public filesystem path exposed to LLM, UI, or
  public API, and no raw OutputRef treated as a saved permission resource.

### P1 — Native consume surfaces

- As a TUI/App/API/CLI user, I want stat/read/follow/pagination/tail against OutputRef
  with authorization and no path exposure, including direct-child hierarchy views
  (Feature 002).

### P2 — Retention, export, observability

- As an operator, I want ref-aware retention (not mtime-only) so that still-referenced
  outputs are not deleted by cleanup.
- As an operator, I want OTEL metrics for bytes, queue depth, latency, open/sealed/
  aborted, spill, quota/disk faults, and cleanup without content/path/ref labels.
- As a maintainer, I want Lang Lock language tag/provenance on textual channels
  (Feature 004) without content telemetry.

### P2 — Compatibility boundary

- As a maintainer, I want streaming sinks for native tools/processes and a bounded
  compatibility boundary for legacy/plugin/MCP/non-streaming adapters that spills
  before full materialization when possible and enforces explicit limits.

## Functional Requirements

### Content plane separation

1. OutputSpool/ArtifactStore MUST be the sole canonical **content plane** for observed
   outputs of main, agent, subagent, background job, tool, and process producers.
2. Content plane MUST be separate from lifecycle/control (Feature 002 Process Table /
   Task Lifecycle Event Bus), EventV2, and OTEL. Lifecycle remains execution authority.
3. Feature 005 MUST NOT introduce a second executor, SessionRunner, EventV2 system,
   or parallel store authority. V1 and V2 MUST use one canonical seam.
4. EventV2 schemas MUST be versioned and MUST reference OutputRef plus metadata and
   bounded preview only. Terminal events MUST NOT carry full content chunks or paths.
5. OTEL MUST export only content-free aggregates (see Observability). Content, path,
   OutputRef, session ID, and process ID MUST NOT be metric labels.

### File-backed first chunk and bounded memory

6. Every observed output MUST be file-backed from the **first observable chunk**.
   Producers MUST NOT accumulate unbounded strings in process memory proportional to
   total output size.
7. Process-local memory for writers/readers MUST be **bounded** (queues, page buffers,
   previews). The system MUST NOT promise zero RAM.
8. Producer path MUST be: producer → bounded queue → batched async writer. The system
   MUST NOT perform a filesystem write per token/delta.
9. Append MUST support short write, partial append, and idempotent retry at the same
   expected offset. Concurrent readers MUST be allowed during append.
10. Backpressure and quotas MUST apply at global, root, session, process, and channel
    scopes. Admission MUST treat ENOSPC, fd exhaustion, quota, permission, and disk
    latency as observable states and admission signals. Fail/degrade/cancel policy
    remains clarification.

### Storage authority and paths

11. Managed private spool under OpenCode data directory MUST be the **authority for
    recovery**. OS tmp MAY be used only for outputs explicitly marked disposable.
12. Filesystem paths MUST NEVER be exposed to LLM, UI chrome, public HTTP API, tool
    results, EventV2 payloads, or transcripts. Consumers receive only OutputRef,
    cursor, metadata, and authorized content pages.
13. Spool layout, durability/fsync policy, and cross-platform semantics remain
    clarification; the requirement is private managed authority with recovery semantics.

### Identity, channels, and provenance

14. Output identity MUST use **OutputGroupRef** scoped to process/attempt/generation.
    A new attempt/generation MUST NOT overwrite a previous generation's committed
    content (stale generation fencing).
15. Each group MUST support channels: `assistant-text`, `reasoning`, `stdout`,
    `stderr`, `tool-result`, `error`, `artifact`.
16. Each channel MUST carry content type and provenance metadata. Textual channels
    SHOULD attach Feature 004 Lang Lock language tag/provenance. Reasoning retention
    and private handling remain clarification.
17. **OutputRef** identifies a sealed or open channel (or artifact) for read/follow/
    stat without revealing path. Opaque **cursor** MUST encode generation and byte
    offset (and any other fencing needed) without client-visible internals beyond the
    opaque token contract.

### Native contract and state machine

18. Native contract operations MUST include: `begin`, `append(expected_offset)`,
    `read(offset, limit)`, `follow(cursor)`, `seal`, `abort`, `stat`, `release`,
    `cleanup`.
19. State machine states MUST include: `open`, `sealing`, `sealed`, `aborted`,
    `corrupt`, `expired`, `unknown`.
20. Canonical offset unit is **bytes**. `limit` is mandatory on read and MUST be
    server-capped. Reads MUST be UTF-8 safe and MUST NOT split a codepoint.
21. Read responses MUST include page bytes, `next_offset`, `committed_bytes`, and
    `caught_up` for open streams. `eof` MUST be true only when the channel is
    **sealed** (or aborted with no further append) and the reader has consumed through
    committed end. Open streams MUST NOT report eof solely because the reader is
    caught up.
22. Follow MUST accept an opaque cursor; reconnect after disconnect MUST resume from
    cursor without requiring full re-read. Cursor expiry policy remains clarification.

### Lifecycle settlement

23. Task terminal status MUST NOT precede output settlement without an intermediate
    **settling** (or equivalent reconciliation) state. Parents MUST observe either
    sealed/aborted output refs or an explicit settling/unknown/corrupt condition.
    Feature 005 owns content-plane settlement (seal/abort/OutputRef/committed bytes);
    Feature 002 owns lifecycle terminal status. Shared clarify is ordering and
    crash reconciliation only — not reassignment of those ownership boundaries.
24. Seal commits finality of committed bytes for a generation. Abort stops further
    append while preserving committed bytes for authorized read.
25. Crash between filesystem commit and SQLite/control metadata MUST be reconcilable
    into `corrupt`, `unknown`, or recovered sealed/open with bounded recovery rules
    (exact algorithm remains clarification). Exactly-once FS+DB is out of scope.
26. Cancel (including Feature 002 root-tree Ctrl+C) MUST seal or abort writers
    consistently and MUST preserve committed bytes.
27. Stale generation fencing MUST reject append/seal from superseded writers.

### Retention and cleanup

28. Retention MUST be **ref-aware**, not mtime-only. Cleanup MUST consider TTL, lease,
    reference graph, active readers/writers, and legal/privacy holds.
29. Completed cleanup MUST be bounded (batch size/time). Referenced outputs MUST NOT
    be deleted solely because mtime is old.
30. `release` drops a holder reference; `cleanup` reclaims unreferenced/expired
    groups under policy. Legal deletion/purge and encryption key policy remain
    clarification surfaces but MUST exist as explicit requirements hooks.

### Consumers: BackgroundJob, Task, transcript, context

31. BackgroundJob MUST store OutputRef/stat/status metadata, NOT full `output`/`error`
    strings proportional to content. Compatibility migration from current string fields
    is required.
32. Task parent handoff MUST receive summary + OutputRef; parent/manager/architect
    MUST read by offset/limit. Todo result/evidence MUST use refs/slices (Feature 002).
33. Durable transcript MUST store refs and bounded previews, not full content by
    default. Context builders MUST materialize only selected slices under byte/token
    budget and MUST record ranges used. LLM MUST NEVER receive an entire spool file
    automatically.
34. Handoff/resume MUST preserve refs. New attempt/generation MUST NOT overwrite old
    content. Manager/Architect reads MUST be bounded pages.

### Tool and process adapters

35. Native tool/process contracts MUST support a streaming sink into OutputSpool.
36. Legacy/plugin/MCP/non-streaming adapters MUST use a bounded compatibility
    boundary: spill before full materialization when possible; enforce explicit
    size/time/memory limits; never embed public paths in results.
37. Existing ToolOutputStore path-embedding and mtime retention are migration baselines
    to replace, not the target contract.

### Feature 002 / 003 / 004 integration

38. Feature 002 Process Table/panel MAY open OutputRef/cursor for authorized content;
    complete output MUST NOT load by default. Direct-child Session hierarchy remains
    Feature 002 ownership; content plane supplies pages only.
39. Feature 003 scheduled occurrence MUST own its OutputGroup for that occurrence's
    execution. Notifications MUST carry bounded summary + OutputRef only.
40. Feature 004 Lang Lock tag/version/provenance MUST be attachable to textual
    channels; content MUST NOT appear in telemetry.

### Native API / server / client / TUI / App

**Normative transversal rule (Feature 007 Operator Control Plane).** All setup,
configuration, and management for OutputSpool admin operations MUST use
[Feature 007](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
unified Operator Control Plane and native Settings/menu/palette/native-slash/CLI/App/
Desktop adapters calling typed core domain commands/queries directly. MUST NOT use
Config.command/custom templates, `session.command` prompt path, ToolRegistry, MCP
tools/prompts, plugins, skills, shell commands issued by an LLM, or free-form model
instructions as management authority. Native slash is intercepted before prompt
admission/transcript; zero provider/model calls/tokens/cost by default; output not
added to Message/Part/context by default. Mutations require operator principal,
explicit scope, version/CAS, idempotency, and audit; secret refs only.
Plugin/MCP/custom registries MUST NOT register reserved operator IDs.

41. Native API/server/client/TUI/App MUST support `stat`, `read`, `follow`,
    pagination, and tail against OutputRef with authorization checks and **no path
    exposure**.
42. Conceptual output actions MUST classify planes:
    - **Consume plane (authorized):** `output.stat`, `output.read`, `output.follow`
      (pagination/tail). Authorization is re-evaluated per action.
    - **Operator admin plane:** `output.export`, `output.share`, `output.release`,
      `output.delete`, `output.purge`, plus retention and quota configuration via
      Feature 007. Admin ops require operator principal and explicit scope.
43. Scope for actions: `self`, `child`, `tree`, `session`, `project`,
    `operator-global`. Operator principal and PermissionV2 root-tree auth are satisfied
    through Feature 007 principals/scopes; this feature does not invent a second
    permission system.
44. Export/share MUST NOT default to raw arbitrary cross-project sharing. Share
    policy remains clarification; raw public path share is out of scope.

### Security requirements (normative)

45. Spool directories and files MUST use private permissions or equivalent cross-platform
    ACLs appropriate to the host.
46. Implementations MUST protect against path traversal, symlink escape, and TOCTOU
    races on open/read/write/delete.
47. Metadata authorization MUST be enforced by operator/system/manager principals and
    project/root/session/tree scope before any content page is returned.
48. A raw OutputRef MUST NOT be treated as a saved permission resource; authorization
    is re-evaluated on each action.
49. Optional encryption-at-rest and key policy MAY be enabled by configuration;
    absence of encryption does not relax path privacy or authorization.
50. Deletion, retention, legal hold, and privacy erasure MUST be explicit operations
    with audit (content-free).

## Non-Functional Requirements

1. **Bounded memory:** writer/reader memory growth MUST be O(queue + page), not O(total
   output), under sustained large streams.
2. **Throughput:** batched async writer MUST absorb high-rate producers without
   per-token syscalls.
3. **Latency:** read/follow of small pages MUST remain interactive under concurrent
   append; quantitative budgets remain clarification.
4. **Durability:** managed spool is recovery authority; fsync/durability level is
   clarification; disposable OS-tmp outputs need not survive restart.
5. **Cardinality:** OTEL labels bounded enums/buckets only (ADR-0001).
6. **Compatibility:** V1/V2 single seam; phased migration from BackgroundJob strings
   and ToolOutputStore paths.

## Acceptance Scenarios

1. **Huge background output constant memory.** Given a background job emitting multi-GB
   stdout, when the job runs, then process RSS attributable to the content plane stays
   within configured queue/page bounds and does not grow with total bytes.
2. **Concurrent append/read.** Given an open channel being appended, when a reader
   reads offset/limit, then committed pages are returned without blocking the writer
   indefinitely and without torn UTF-8 sequences.
3. **UTF-8 boundary.** Given a multi-byte codepoint straddling a page boundary, when
   read(limit) is issued, then the server returns a page that does not split the
   codepoint and advances next_offset accordingly.
4. **Reconnect cursor.** Given a follow cursor at offset N, when the client disconnects
   and reconnects with the same cursor, then reading resumes at generation-consistent
   offset N (or reports expired/invalid cursor).
5. **Slow reader.** Given a fast producer and slow follower, when the queue hits
   backpressure, then producer experiences backpressure/admission signal and committed
   bytes remain consistent; no unbounded in-memory buffer.
6. **ENOSPC.** Given disk full on append, when the writer fails, then ENOSPC is an
   observable admission/fault state, channel can move to degraded/aborted/corrupt per
   policy, and no silent data loss is reported as sealed success.
7. **Quota.** Given session/process/channel quota exceeded, when further append is
   attempted, then admission rejects or degrades with observable quota fault.
8. **Crash before seal.** Given crash after some committed appends but before seal,
   when recovery runs, then committed bytes are available or channel is
   corrupt/unknown with reconciliation, never silently empty-success.
9. **Crash after seal before event.** Given seal committed on FS but terminal EventV2
   not yet published, when recovery runs, then settling/reconciliation yields sealed
   ref visible to parent without requiring full re-execution.
10. **Cancel preserves bytes.** Given root-tree Ctrl+C during write, when cancel
    completes, then writers are sealed or aborted and committed bytes remain readable
    via OutputRef.
11. **Stale generation.** Given generation G superseded by G+1, when a stale writer
    appends or seals G, then the operation is rejected by fencing.
12. **Handoff refs.** Given Worker completion, when Manager receives handoff, then
    envelope carries OutputRef/summary only and Manager reads offset/limit pages.
13. **Plugin legacy oversized.** Given a non-streaming plugin returning oversized
    content, when the compatibility boundary runs, then content is spilled under limits
    before full LLM-facing materialization and no path is embedded in the result.
14. **Path traversal.** Given a hostile OutputRef or path-like input, when read is
    attempted, then traversal/symlink escape is denied and no file outside spool is
    read.
15. **Unauthorized sibling.** Given Session A and sibling Session B, when A requests
    B's OutputRef without authorization, then the action is denied without content leak.
16. **Retention refs.** Given an output still referenced by transcript/Todo/handoff,
    when mtime-based age exceeds TTL, then cleanup MUST NOT delete it solely by mtime.
17. **Cleanup batch.** Given many expired unreferenced groups, when cleanup runs, then
    work is bounded per cycle and system remains responsive.
18. **OTEL down.** Given OTEL export unavailable, when spool operates, then content
    plane continues; metrics loss does not block seal/read.
19. **Context slice budget.** Given a large sealed assistant-text channel, when context
    builder selects slices under budget, then only selected ranges are materialized and
    ranges used are recorded; full file is not injected.
20. **Direct/manager hierarchy.** Given Architect → Manager → Worker, when Architect
    Session UI lists children, then only direct children appear (Feature 002) and
    output pages load only on authorized expand/read.
21. **Scheduled occurrence.** Given Feature 003 occurrence execution, when it produces
    output, then the occurrence owns its OutputGroup and notification carries bounded
    summary/ref only.
22. **Lang Lock metadata.** Given textual channel under Lang Lock, when content is
    spooled, then language tag/provenance metadata is attached without content
    telemetry.

## Security Requirements

- **Data sensitivity/classification.** OutputSpool holds model outputs, tool results,
  stderr/stdout, reasoning, and artifacts. Classification is sensitive by default
  (may include secrets, PII, proprietary code). Treat as private project/runtime data.
- **Authentication/authorization.** Actions require re-evaluated authorization by
  principal and scope (self/child/tree/session/project/operator-global). Operator
  principal and PermissionV2 root-tree auth are an explicit dependency/gap; this
  feature does not invent a parallel permission system.
- **Input validation.** Offsets, limits, cursors, refs, and channel IDs are
  schema-validated and server-capped. Path-like inputs never open arbitrary files.
- **Cryptography in transit/at rest.** Optional encryption-at-rest and key policy are
  configuration hooks. In-process and local IPC still must not expose paths. Remote
  transport follows existing product TLS policy.
- **Logging/audit.** Audit records action type, scope, result, and bounded enums only.
  No content, path, prompt, or secret material in logs/metrics.
- **Error-handling information exposure.** Errors return stable codes
  (not_found, denied, quota, enospc, corrupt, expired, invalid_cursor) without
  filesystem paths or content snippets.

## Privacy Requirements

1. Retention, release, delete, and purge MUST support privacy erasure and legal hold
   without requiring content export to operators by default.
2. Reasoning channel privacy/retention is stricter by default pending clarification;
   it MUST NOT appear in OTEL or unauthorized previews.
3. Share/export is deny-by-default across projects.

## Observability

Integrate with Feature 001 / ADR-0001. Metrics MAY include:

- bytes appended / bytes read (buckets)
- queue depth (buckets)
- writer latency / read latency (buckets)
- open / sealed / aborted / corrupt / expired counts (enums)
- spill count, quota faults, disk faults (ENOSPC/fd/permission), cleanup batches

Labels MUST be bounded enums/buckets only. MUST NOT label with content, path,
OutputRef, session ID, process ID, or user ID. Spans MAY carry opaque correlation IDs
without content.

## Compatibility and Migration

- Migrate BackgroundJob `output`/`error` strings to OutputRef/stat/status.
- Replace ToolOutputStore path-in-preview and mtime-only cleanup with OutputSpool
  refs, bounded previews, and ref-aware retention.
- Version EventV2 and transcript schemas to carry OutputRef + bounded preview instead
  of full content/path.
- Feature 001/002/003/004 references to “future OutputSpool/ArtifactStore” resolve to
  this Feature 005.
- Feature 002 lifecycle remains execution authority; 002/003 consume 005 content-plane
  contracts.
- Rollout flags, dual-read windows, and V1/V2 adapter order remain clarification.
- Must work on V1 and V2 with one canonical seam.

## Out of Scope

- Zero-RAM operation.
- Public filesystem path exposure to LLM/UI/API.
- Full output content in EventV2, OTEL, or terminal events.
- Event or write per token/delta.
- Second executor, SessionRunner, EventV2 system, or parallel content authority.
- Raw arbitrary cross-project sharing.
- Exactly-once dual commit across filesystem and SQLite.
- Automatic blind retry of failed generations without fencing.
- Unbounded page size, queue depth, or retention.
- Owning Smart Agent Routing classification (Feature 001) or Task lifecycle execution
  (Feature 002) or Job Definition scheduling (Feature 003).
- Final numeric quotas, fsync level, encryption defaults, and ENOSPC fail/degrade/
  cancel policy before clarification.

## Clarification Questions

1. What exact managed spool path layout and naming under OpenCode data is canonical?
2. What durability/fsync policy applies per channel class (assistant-text vs stdout vs
   disposable tmp)?
3. What max page size, queue depth, and global/root/session/process/channel quotas are
   the numeric defaults?
4. What ENOSPC/fd/quota policy applies: fail, degrade, cancel, or operator prompt?
5. What retention TTL, lease, and reference-graph rules apply per channel, including
   reasoning?
6. What encryption-at-rest, key management, and cross-platform ACL model is required
   for V1?
7. Which PermissionV2 principal and root-tree auth model authorizes output actions, and
   what is the interim gap handling?
8. What bounded preview policy (lines/bytes/redaction) applies for events, UI, and
   notifications?
9. How is reasoning channel retained, redacted, and authorized relative to
   assistant-text?
10. How does context selection choose slices under token/byte budget, and how are used
    ranges recorded?
11. What explicit limits apply to plugin/MCP/legacy non-streaming adapters?
12. What FS↔SQLite reconciliation algorithm marks corrupt/unknown/recovered after crash?
13. What exact terminal settlement ordering and intermediate settling states integrate
    with Feature 002?
14. What cursor expiry and invalidation rules apply after seal, abort, release, or
    generation change?
15. Are compression and dedup in scope for V1, and with what CPU/memory trade-offs?
16. What cross-platform permission/ACL semantics (POSIX, Windows ACL, macOS) are
    mandatory?
17. What rollout/migration flags and dual-read window apply for BackgroundJob and
    ToolOutputStore replacement?
18. What export/share policy is allowed within a project versus denied across projects?

## Related Features and Decisions

- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [Feature 003 Scheduled Jobs and Async Main-Context Notification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- [Feature 004 Lang Lock](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — context slices and index job outputs via spool
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — output consume vs admin command IDs, auth, audit
- [Feature 008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — every MCP call/read creates OutputGroup; preview+OutputRef never path; content-plane authority remains Feature 005
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003 Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — proposed
- [Feature 005 research](research.md) — evidence only, not a decision.

## Initial Traceability Matrix

| Outcome                         | Requirements    | Acceptance scenarios | Phase |
| ------------------------------- | --------------- | -------------------- | ----- |
| Content plane separation        | FR1–FR5         | 18, 20–21            | 1     |
| File-backed + bounded memory    | FR6–FR10        | 1–3, 5–7             | 1     |
| Private storage authority       | FR11–FR13       | 14–15                | 1     |
| Identity/channels/provenance    | FR14–FR17       | 11–12, 22            | 1     |
| Native contract + state machine | FR18–FR22       | 2–5, 8–11            | 1     |
| Lifecycle settlement            | FR23–FR27       | 8–11                 | 1–2   |
| Retention ref-aware             | FR28–FR30       | 16–17                | 2     |
| Consumers migration             | FR31–FR34       | 1, 12, 19            | 1–2   |
| Tool/process adapters           | FR35–FR37       | 13                   | 1–2   |
| Feature 002/003/004 integration | FR38–FR40       | 10, 20–22            | 1–2   |
| Native API/UI/actions           | FR41–FR44       | 12, 15, 19–20        | 1–2   |
| Security/privacy/observability  | FR45–FR50, NFRs | 6–7, 14–18           | 1–2   |
