---
status: proposed
date: 2026-07-18
deciders: [project maintainers]
---

# 0009 — Complete MCP Client Lifecycle and Content Plane

## Context and Problem Statement

Feature 008 (Complete MCP Client Tools and Resources Lifecycle) completes the OpenCode
**MCP client**: capability negotiation and a recorded per-server capability set, cursor-
paginated tools with list-changed refresh, real progress plumbing to native UI, resource
subscriptions under policy, transport/session/reconnect with resume, OAuth via Feature 007
secure references, experimental Tasks/sampling/elicitation behind per-server flags, and
every `tools/call` and `resources/read` routed through the Feature 005 OutputSpool with a
bounded preview and an OutputRef. It migrates the existing `packages/opencode/src/mcp/`
service in place rather than replacing it, and it never becomes a second management
authority beside Feature 007, a second content-plane identity beside Feature 005, a second
lifecycle/Process Table beside Feature 002, or a Smart-routing decider beside Feature 001.
The feature `spec.md` names this ADR as the required decision record that formalizes the
clarify package (Session 2026-07-18, C1–C27) before `plan` completion and any
implementation.

The research base (`research.md`) confirms the substrate empirically. The pinned SDK
`@modelcontextprotocol/sdk@1.29.0` is already installed and already carries a workspace
forward patch (`patches/@modelcontextprotocol%2Fsdk@1.29.0.patch`) that adds typed
`callTool` result overloads and transport `onsessionexpired` re-initialization — direct
evidence for the C1 forward-patch-not-fork posture. The installed SDK exposes the client
surface Feature 008 consumes: `subscribeResource` / `unsubscribeResource`, `setLoggingLevel`,
`ProgressCallback` / `onprogress` / `resetTimeoutOnProgress`, the `CancelledNotification`,
`ResourceUpdatedNotification`, `SubscribeRequest`, and `ProgressNotification` schemas, and
an `experimental/tasks/**` module for task-augmented calls. The existing service already
performs remote StreamableHTTP→SSE fallback and stdio spawn with a `pgrep -P` SIGTERM
finalizer, one-shot prompts/resources/read, a 10MB inline blob cap, and an
`onprogress: () => {}` no-op in `convertTool`; it watches only
`ToolListChangedNotificationSchema` and publishes an event whose schema literal today is
`mcp.tools.changed` (`packages/schema/src/mcp-event.ts`). The reserved operator catalog
(`packages/core/src/operator/catalog.ts`) already declares exactly **30** `mcp.*` IDs at
`RESERVED_CATALOG_VERSION = "1.3.0"`.

Without one decision record, Feature 008 risks a fork of SDK wire logic, an inline
content-plane beside Feature 005, an auto-subscribe/auto-reindex loop that turns every
resource update into a model turn, a dual event spelling that desynchronizes the Feature
009 reindex trigger, a second `mcp.*` catalog authority beside Feature 007, sampling that
bypasses Smart routing/budgets/LangLock, elicitation the model silently auto-answers, and
resource URIs that reach sibling sessions or private ranges. This ADR fixes those
decisions so `plan` and `tasks` proceed against a stable lifecycle / content / permission
/ degradation / security contract without reopening Feature 001 Smart/budget/OTEL
authority, Feature 002 lifecycle/Process Table ownership, Feature 003 wake/schedule
ownership, Feature 004 LangLock provenance, Feature 005 content-plane identity, Feature
006 semantic-stack ownership, or Feature 007 native operator authority and reserved
catalog.

## Decision Drivers

- One MCP client that completes the 2025-11-25 lifecycle behind the existing `MCP.Service`
  seams, never a second management, content, lifecycle, or routing authority.
- Forward-patch the pinned SDK on its major line; a major jump is an explicit plan/ADR
  migration, never a silent bump or a wire-logic fork.
- Honest capability posture: a capability the server did not advertise is never exercised;
  missing SDK or server support degrades to a typed gap and the session continues.
- No dual authority and no dual spelling: the operator-only `mcp.*` catalog stays a single
  Feature 007 registry over Feature 008 schemas, and the canonical event id
  `mcp.tools_changed` has exactly one spelling that FR38 and the Feature 009 contract share.
- Progress, resources, and content are native-plane by default: progress reaches the
  Process Table / UI / OTEL and never LLM turns; resource updates notify and cache without
  an automatic re-read, reindex, or wake; every call/read result is a Feature 005
  OutputRef with a bounded preview and never a filesystem path.
- Least authority on the wire: subscriptions require the server capability and an operator
  grant and the LLM never subscribes; sampling passes through Smart/budget/LangLock under
  a per-agent Permission; elicitation and `input_required` always surface to the operator
  and the model never silently auto-answers.
- Secure by default: URI allowlist scoped to negotiated roots, SSRF-safe fetch, secrets as
  Feature 007 refs, untrusted-content provenance labels, decompression-bomb limits, and
  content-free telemetry per ADR-0001.

## Considered Options

- **A complete MCP client that forward-patches the pinned SDK, records negotiated
  capabilities per server, splits durable/live events under one `mcp.tools_changed`
  spelling, routes every call/read through Feature 005 OutputSpool, keeps resource updates
  notify-and-cache with opt-in re-read/reindex/wake, gates subscriptions and sampling and
  elicitation at least authority, migrates the existing service in place behind its seams,
  and manages exclusively through the 30 reserved Feature 007 `mcp.*` IDs** — selected: one
  client authority, honest degradation, a single content plane, a single management
  registry, and no fork, inline content plane, auto-loop, dual spelling, or second catalog.
- **Fork `@modelcontextprotocol/sdk` to add session resume, `Last-Event-ID`, and Tasks
  wire logic** — rejected: a fork detaches OpenCode from upstream protocol fixes and
  security patches and duplicates wire logic already patchable; the resolution is a forward
  patch/minor on the same major line, with a major jump as an explicit plan/ADR migration
  note and a missing optional feature degrading to a typed capability gap (C1, C2).
- **An inline MCP content plane that keeps full `CallToolResult` / `resources/read` bodies
  in context and truncates with a filesystem-path hint** — rejected: it duplicates the
  Feature 005 content-plane identity, leaks paths into previews, and re-grows the RAM and
  10MB-blob behavior; every call/read instead creates a Feature 005 OutputGroup delivering a
  bounded preview and an OutputRef, with a documented post-parse spill and no zero-RAM
  promise (C16, C17).
- **Auto-subscribe every resource and auto-reindex/auto-wake on every `resources/updated`**
  — rejected: it turns each server update into a model turn, an unbounded wake, and a
  reindex without classification, and it lets the LLM subscribe; the default is notify +
  cache only, subscribe requires the server capability plus an operator grant, and
  re-read/reindex/wake are separate opt-ins under Feature 001/002/003 admission (C9, C10,
  C21, C22).
- **Keep both event spellings (`mcp.tools.changed` and `mcp.tools_changed`) for backward
  compatibility** — rejected: a dual spelling desynchronizes FR38, the schema literal, and
  the Feature 009 reindex trigger and invites silent drift; the schema literal is renamed to
  the single canonical `mcp.tools_changed` at implementation with its consumers updated, and
  no dual spelling survives (C3).
- **A second `mcp.*` catalog or a runtime/LLM-reachable management path** — rejected: it
  breaks the single-authority model and lets the data plane reach admin IDs; the reserved
  30 `mcp.*` IDs stay a single Feature 007 registry over Feature 008 schemas at 1.3.0, a
  colliding runtime registration fails closed, and any future id is a coordinated 007/008
  bump (C25, C27).
- **Sampling that answers server requests directly and elicitation the model auto-answers**
  — rejected: it bypasses Smart routing, budgets, LangLock, and operator consent; sampling
  requires a per-agent `mcp:<server>:sampling` Permission and passes through Feature 001
  unchanged, and every elicitation and `input_required` surfaces to the operator with the
  model never silently answering (C19, C20).

## Decision Outcome

Chosen option: **a complete MCP client that forward-patches the pinned SDK, records
negotiated capabilities per server, splits durable and live events under one canonical
`mcp.tools_changed` spelling, routes every call and read through the Feature 005
OutputSpool with a bounded preview and an OutputRef, keeps resource updates notify-and-cache
with opt-in re-read/reindex/wake, gates subscriptions, sampling, and elicitation at least
authority, migrates the existing service in place behind its `MCP.Service` seams, and
manages exclusively through the 30 reserved Feature 007 `mcp.*` IDs at
`RESERVED_CATALOG_VERSION = "1.3.0"`**.

- **SDK baseline and forward-patch path (C1).** The pinned baseline is
  `@modelcontextprotocol/sdk@1.29.0` targeting protocol 2025-11-25 with negotiated
  downgrade. Session-resume, `Last-Event-ID`, or Tasks gaps are closed by a forward
  patch/minor on the same major line, never a fork of wire logic; a major SDK jump is an
  explicit plan/ADR decision with a migration note. Missing SDK support for an optional
  wire feature degrades to a typed capability gap, never a hard failure. The resolved SDK
  version is a provisional plan constant with acceptance hooks AC1, AC12.
- **Connection lifecycle and recorded capabilities (C2).** The client lifecycle is a fixed
  sequence `configure → connect(transport) → initialize / protocol-version negotiate →
  capability exchange → record → connected`, with terminal branches `disabled`, `failed`,
  `needs_auth`, and `needs_client_registration`; the existing `Status` union is
  authoritative and extends only additively. Negotiated protocol version and full server
  capabilities are recorded per server for `mcp.server.capabilities` and runtime gating; an
  unadvertised capability is never exercised; reconnect re-runs negotiation and emits
  `mcp.server.capabilities_changed` on a diff; server unavailability is the typed
  `mcp_unavailable` gap and the session continues. Recorded-capability struct fields are
  provisional plan constants with acceptance hooks AC1, AC12, AC16.
- **Event vocabulary, durable/live split, single spelling (C3).** The FR38 event set is
  normative and divides into a durable control-plane class persisted to EventV2/EventBus
  for reindex and audit correlation (`mcp.server.status`, `mcp.server.capabilities_changed`,
  `mcp.tools_changed`, `mcp.resources_changed`, `mcp.resource_updated`, `mcp.call.settled`,
  `mcp.call.cancelled`, `mcp.task.settled`, `mcp.subscription.*`) and a live UI/OTEL class
  that is coalesced and never required to persist (`mcp.call.started`, `mcp.call.progress`,
  `mcp.task.status`, `mcp.log`). The canonical event id is `mcp.tools_changed`; the existing
  schema literal `mcp.tools.changed` is renamed to it at implementation with the SDK-generated
  types and every consumer updated, and no dual spelling survives. No event carries full
  content, URIs, or paths. Payload enums are provisional plan constants with acceptance
  hooks AC4, AC9, AC22.
- **Tools pagination and refresh (C4).** `tools/list` is cursor-paginated with a
  duplicate-cursor guard (a repeated or non-advancing cursor terminates the walk) and a
  max-page bound that fails closed with a typed error; `notifications/tools/list_changed`
  refreshes the whole catalog for that server under the guard and emits `mcp.tools_changed`;
  the single-shot `McpCatalog.defs` path is superseded by the paginated walk without
  changing the cached `defs[server]` shape consumers read. Page bounds are provisional plan
  constants with acceptance hooks AC4.
- **outputSchema validation posture (C5).** The default is tolerant: `structuredContent` is
  validated against `outputSchema` and a mismatch is a typed non-fatal validation warning on
  the call child while the result is still spooled and delivered. Strict is an operator
  per-server opt-in that converts a mismatch into an `isError`-class execution failure;
  protocol errors stay distinct from tool-execution `isError` in both modes. The policy key
  is a provisional plan constant with acceptance hook AC8.
- **Tool annotation trust (C6).** Tool annotations (`readOnlyHint`, `destructiveHint`, and
  peers) are untrusted by default and never relied on as safety guarantees; only an
  operator-elevated server trust profile lets them inform UI hints or policy, and an
  unelevated or unknown profile ignores them for gating. Trust-profile shape is a
  provisional plan constant with acceptance hook AC26.
- **Progress plumbing (C7).** The client always supplies a real progress sink replacing the
  `onprogress: () => {}` no-op in `convertTool`, preserving `resetTimeoutOnProgress`. Wire
  `progress` is enforced monotonic per token; UI/EventBus coalescing drops or merges display
  frames but never rewrites, invents, or decreases protocol values. Progress updates the
  Feature 002 Process Table child and OTEL counters and never enters LLM context/turns or is
  persisted as tool output by default. Coalesce window and bucket bounds are provisional
  plan constants with acceptance hooks AC5, AC22.
- **Cancellation wire-path split (C8).** A standard non-task-augmented in-flight
  `tools/call` cancels via `notifications/cancelled` for that request id, driven by the
  existing `AbortSignal` or the Feature 002 Ctrl+C root tree; a task-augmented call cancels
  via `tasks/cancel`; the Feature 002 root tree cancels both classes with the correct wire
  path per child. Local settlement seals or aborts OutputSpool writers per Feature 005, and
  an unacknowledged remote is recorded `cancel-requested` / `unknown-remote`. Acceptance
  hooks AC7, AC31.
- **Resource-update policy (C9).** The default per-server policy is notify + cache only:
  `resources/updated` coalesces, dedupes, and debounces into a bounded queue with sequence
  and correlation, updates UI and cache, and emits `mcp.resource_updated` with no re-read,
  reindex, or wake. Conditional re-read and semantic reindex are per-server operator
  opt-ins, and wake is a further opt-in gated by Feature 002/003 admission; no configuration
  produces an automatic turn per update. Queue depth and debounce interval are provisional
  plan constants with acceptance hooks AC9, AC10, AC11.
- **Subscribe authority (C10).** Runtime resource list/templates/read reach the LLM only
  through the canonical adapter under `mcp:server:*` Permission via the existing
  `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource` tools;
  subscribe and unsubscribe require the server `resources.subscribe` capability and operator
  `mcp.resource.admin.subscribe` / `unsubscribe`, and the LLM never subscribes; any
  unauthorized subscribe/read/delivery fails closed with a typed error. Acceptance hooks
  AC9, AC21, AC29.
- **resource_link laziness (C11).** `resource_link` content stays lazy: it is surfaced as a
  reference and auto-fetched only under explicit policy, Permission, and the Feature 001
  budget/admission; a fetched link routes through OutputSpool like any read, and arbitrary
  large linked resources are never inlined automatically. Auto-fetch budget bounds are
  provisional plan constants with acceptance hook AC8.
- **URI allowlist (C12).** The default resource URI allowlist is `https` and server-declared
  MCP resource URIs scoped to the negotiated roots; `file` is allowed only within authorized
  project/session roots; every other scheme, including bare `http` to non-loopback, is
  deny-by-default and operator-added per server, preventing sibling-session and cross-project
  leakage. The concrete allow/deny set is a provisional plan constant with acceptance hooks
  AC20, AC21, AC25.
- **Canonical adapter merge (C13).** Top-level tools and code-mode converge on one canonical
  adapter for policy, permissions, lifecycle child, OutputSpool, and settlement; the only
  permitted differences are presentation — code-mode renders the catalog as an API/type
  surface and top-level renders individual tool cards — and both invoke the same adapter path
  with identical behavior. Acceptance hook AC14.
- **Transport defaults and reconnect (C14).** New connections prefer Streamable HTTP; the
  existing StreamableHTTP→SSE fallback stays for compatibility with an operator-visible SSE
  deprecation label, and legacy SSE is removed no earlier than the ADR-defined deprecation
  window (a named future milestone, not this feature). Streamable HTTP reconnect uses bounded
  exponential backoff with jitter and a capped max delay, honoring session resume and
  `Last-Event-ID` where the SDK and spec support them; stdio has no reconnect and restarts
  under lifecycle control with the existing `pgrep -P` SIGTERM child cleanup. Backoff base,
  cap, jitter, and max attempts are provisional plan constants with acceptance hooks AC2,
  AC3, AC12.
- **OAuth and secret cutover (C15).** OAuth tokens, headers, and secrets move from current
  storage to Feature 007 secure references; secrets never appear in args, history, output,
  config JSON, or plain audit, and no plaintext secret enters a spool preview shown to the
  LLM. Cutover is a one-time migration that reads existing `McpAuth` token entries into
  secure refs and leaves config surfaces backward-compatible. Migration mapping is a
  provisional plan constant with acceptance hook AC13.
- **OutputSpool integration and RAM honesty (C16).** Every `tools/call` and
  `resources/read` creates a Feature 005 OutputGroup with typed channels; UI and LLM receive
  a bounded preview and an OutputRef only, never a filesystem path, migrating the current
  path-in-preview and 10MB inline blob behavior. Because the SDK parses the final JSON-RPC
  result in RAM, the plan documents a compatibility post-parse spill now and a future bounded
  transport/parser or negotiated nonstandard extension later; zero-RAM is never promised.
  Preview byte bound and spill threshold are provisional plan constants with acceptance hook
  AC6.
- **Base64 blobs and MIME/size limits (C17).** Base64/data-URL content is decoded and
  streamed to spool under a MIME allowlist and size caps; full data URLs never enter model
  context, and audio/image/resource content is size- and MIME-limited before spooling. The
  existing `MAX_MCP_RESOURCE_BLOB_BYTES` (10MB) and MIME allowlist are the migration
  baseline; final caps are provisional plan constants with acceptance hooks AC8, AC20.
- **Experimental rollout (C18).** `mcp.tasks`, `mcp.sampling`, `mcp.elicitation`, and the
  nonstandard content-stream extension are separate per-server flags, disabled by default
  (a global default off; a server enable never implies another server or flag). Rollout
  order is tasks → sampling → elicitation → content-stream, each requiring capability
  negotiation, operator `mcp.experimental.enable`, and per-server policy. The content-stream
  extension advertises under the reserved namespaced capability string
  `experimental/opencode.contentStream`; its absence falls back to a final `CallToolResult`
  plus progress metadata. The capability string is re-validated at plan against SDK
  experimental conventions with acceptance hooks AC16, AC19.
- **Sampling permission and gates (C19).** With `mcp.sampling` enabled for a server, a
  server-initiated sampling request requires an explicit per-agent/per-model Permission
  `mcp:<server>:sampling` and passes through Feature 001 Smart routing, budgets, LangLock,
  and privacy unchanged — sampling never bypasses them — distinct from the operator
  `mcp.experimental.*` enable authority, with the approval path audited. Permission grammar
  is a provisional plan constant with acceptance hook AC17.
- **Elicitation surfacing (C20).** With `mcp.elicitation` enabled, every elicitation request
  and every Tasks `notifications/tasks/status: input_required` surfaces to the operator UI;
  the model never silently auto-answers, sensitive-mode restrictions block model-mediated
  answers outright, and `input_required` is a lifecycle prompt, never partial tool content.
  Agent-mediated input, when permitted, is an explicit per-server operator policy, not a
  default. Acceptance hooks AC18, AC32.
- **Resource semantic-index opt-in (C21).** Feature 008 owns the opt-in trigger for MCP
  resource semantic indexing; Feature 006 owns the stack, the binding generation, and the
  classification taxonomy. No reindex runs without an operator opt-in and a Feature 006
  classification decision; when enabled, a qualifying `resources/updated` under the C9 policy
  emits a single reindex trigger consumed by Feature 006 under its admission ladder, and
  Feature 008 never embeds, ranks, or stores vectors. This is the single MCP-resource reindex
  trigger Feature 009 references. Acceptance hook AC28.
- **Wake admission (C22).** Conditional wake from a resource update is admission-controlled:
  at most one wake per qualifying semantic-policy event, gated by the Feature 001 budget and
  a Feature 002/003 admission/safe-boundary check, with the decision audited; no update path
  produces an unbounded or per-update wake. Budget and admission thresholds are owned by
  Features 001/002/003 and consumed here, not redefined; the per-server wake ceiling is a
  provisional plan constant with acceptance hooks AC10, AC11.
- **Logging retention and redaction (C23).** MCP `notifications/message` logging integrates
  with native logging under redaction (secrets, tokens, and path-shaped fields stripped) and
  rate limits; retention follows the native logging retention policy, not a separate MCP
  store; operator `logging/setLevel` is Feature 007 `mcp.logging.level.set` only, audited.
  Redaction rule set and rate bound are provisional plan constants with acceptance hook AC24.
- **Prompt/resource trust UX (C24).** Untrusted MCP prompt and resource content carries
  provenance and untrusted-content labels in UI and at the context boundary so injection
  text is never treated as trusted system instruction; size and decompression-bomb limits
  reject oversized payloads before delivery; confirmation is required for auto-fetch of
  linked or elevated-risk content; prompts remain runtime content under Permission, never
  Feature 007 admin IDs. Label vocabulary is a provisional plan constant with acceptance
  hooks AC20, AC23.
- **Reserved catalog and schema ownership (C25).** Feature 008 owns the domain schemas for
  the operator-only `mcp.*` operation IDs and Feature 007 owns the registry and enforces
  principal/auth/CAS/audit/adapters. The reserved set is fixed at `RESERVED_CATALOG_VERSION`
  1.3.0 and comprises exactly the 30 IDs across `mcp.server.*` (11), `mcp.auth.*` (4),
  `mcp.resource.admin.*` (7), `mcp.logging.level.*` (2), `mcp.experimental.*` (3), and
  `mcp.extension.*` (3); the runtime data plane never registers these and the
  LLM/ToolRegistry/MCP/custom/`session.command` paths never reach them. A runtime MCP tool
  registration colliding with a reserved id fails closed with no silent rename via the
  existing `checkReservedRegistrationName` / `toolNameIfAllowed` guard, and any future
  `mcp.*` id is a coordinated 007/008 catalog bump. **No catalog bump is required for
  Feature 008.** Acceptance hooks AC15, AC29.
- **Content-free observability (C26).** Spans cover connect, capability negotiation, list,
  call, progress, read, subscribe, reconnect, cancel, and task status/result; metrics are
  bounded-enum only (latency histograms, progress count, bytes spooled, reconnect count,
  update-coalesce count, and failures). URIs, content, call IDs, and session IDs never
  appear as metric labels, and Process Table child IDs correlate on traces, not labels.
  Metric names and bucket boundaries are provisional plan constants with acceptance hook
  AC22.
- **Migration and consumer compatibility (C27).** Existing `MCP.Service` consumers — the
  tool registry via `tools()`, code-mode `describeCatalog`, and the `list_mcp_resources` /
  `read_mcp_resource` runtime tools — keep their current interface shape while Feature 008
  completes lifecycle behind these seams without breaking operator configs. The cached
  `defs[server]` structure, the `Status` union, and the `mcp:server:*` Permission grammar
  extend additively; operator resource surfaces rename to `mcp.resource.admin.*` (schemas
  owned by 008, registry by 007) with prior behavior preserved. The consumer-migration
  inventory is a provisional plan constant with acceptance hooks AC14, AC29.

### V1 decisions accepted with this ADR (Feature 008 clarify package C1–C27)

Declarative clarify resolutions (Session 2026-07-18); full matrices live in Feature 008
`spec.md` Clarifications. SDK version, struct fields, numeric bounds, capability strings,
and migration mappings this feature defers are provisional plan constants with named
acceptance hooks, never open placeholders:

1. **SDK baseline.** `@modelcontextprotocol/sdk@1.29.0`, protocol 2025-11-25; forward
   patch/minor, no fork; major jump an explicit migration; missing feature a typed gap.
   Hooks AC1/AC12 (C1).
2. **Connection lifecycle.** Fixed negotiate/record sequence; additive `Status` union;
   recorded capabilities; `mcp_unavailable` typed gap; capabilities-changed on reconnect
   diff. Hooks AC1/AC12/AC16 (C2).
3. **Event vocabulary.** Durable/live split; single canonical `mcp.tools_changed`; the
   `mcp.tools.changed` literal renamed, no dual spelling; no content in events. Hooks
   AC4/AC9/AC22 (C3).
4. **Tools pagination.** Cursor walk with duplicate-cursor guard and max-page fail-closed;
   list_changed full refresh; `defs[server]` shape preserved. Hook AC4 (C4).
5. **outputSchema.** Tolerant default (typed warning, still delivered); strict opt-in
   fail-closed; protocol errors distinct from `isError`. Hook AC8 (C5).
6. **Annotation trust.** Untrusted by default; only an operator-elevated trust profile
   informs hints/policy. Hook AC26 (C6).
7. **Progress.** Real sink replaces the no-op; monotonic wire; UI coalesces without
   rewriting; Process Table + OTEL only, never LLM turns. Hooks AC5/AC22 (C7).
8. **Cancellation.** Standard `notifications/cancelled`; task `tasks/cancel`; Feature 002
   root tree covers both; spool sealed; unacknowledged remote recorded. Hooks AC7/AC31 (C8).
9. **Resource-update policy.** Notify + cache only by default; re-read/reindex/wake are
   separate opt-ins; no automatic turn per update. Hooks AC9/AC10/AC11 (C9).
10. **Subscribe authority.** Server capability plus operator grant; LLM never subscribes;
    unauthorized paths fail closed. Hooks AC9/AC21/AC29 (C10).
11. **resource_link.** Lazy reference; auto-fetch only under policy/Permission/budget;
    fetched link routes through OutputSpool. Hook AC8 (C11).
12. **URI allowlist.** `https` plus roots-scoped server URIs; `file` within authorized
    roots; every other scheme deny-by-default. Hooks AC20/AC21/AC25 (C12).
13. **Canonical adapter.** One adapter for policy/permissions/lifecycle/spool/settlement;
    only presentation differs between code-mode and top-level. Hook AC14 (C13).
14. **Transport and reconnect.** Prefer Streamable HTTP; SSE deprecation window with label;
    bounded backoff + jitter + resume/`Last-Event-ID`; stdio restarts. Hooks AC2/AC3/AC12
    (C14).
15. **OAuth cutover.** Tokens/headers/secrets to Feature 007 refs; no plaintext anywhere;
    one-time migration; config backward-compatible. Hook AC13 (C15).
16. **OutputSpool.** OutputGroup per call/read; bounded preview + OutputRef, never a path;
    post-parse spill now; zero-RAM never promised. Hook AC6 (C16).
17. **Base64/MIME.** Decode-to-spool under MIME allowlist + size caps; data URLs never in
    context; 10MB migration baseline. Hooks AC8/AC20 (C17).
18. **Experimental rollout.** Per-server flags off by default; tasks → sampling →
    elicitation → content-stream; `experimental/opencode.contentStream` string. Hooks
    AC16/AC19 (C18).
19. **Sampling.** `mcp:<server>:sampling` per-agent Permission; passes through
    Smart/budget/LangLock; distinct from the enable authority; audited. Hook AC17 (C19).
20. **Elicitation.** Every request and `input_required` surfaces to the operator; no silent
    model answer; sensitive-mode blocks model-mediated answers. Hooks AC18/AC32 (C20).
21. **Semantic-index opt-in.** Feature 008 owns the trigger; Feature 006 owns the stack;
    one reindex trigger per qualifying update; no vectors in 008. Hook AC28 (C21).
22. **Wake admission.** At most one wake per qualifying event under Feature 001/002/003
    admission; audited; no per-update wake. Hooks AC10/AC11 (C22).
23. **Logging.** Native logging with redaction and rate limits; native retention;
    `mcp.logging.level.set` only, audited. Hook AC24 (C23).
24. **Trust UX.** Provenance/untrusted labels; decompression-bomb and size limits;
    confirmation for auto-fetch; prompts stay runtime content. Hooks AC20/AC23 (C24).
25. **Reserved catalog.** Exactly 30 `mcp.*` IDs at 1.3.0; schemas 008 / registry 007;
    collisions fail closed; no bump; future ids coordinated. Hooks AC15/AC29 (C25).
26. **Observability.** Content-free bounded-enum spans/metrics; no URI/content/call/session
    labels; child IDs correlate on traces. Hook AC22 (C26).
27. **Migration.** `MCP.Service` seams keep shape; `defs[server]`/`Status`/`mcp:server:*`
    extend additively; operator surfaces rename to `mcp.resource.admin.*`. Hooks AC14/AC29
    (C27).

This ADR is **proposed**; it is the required decision record that unblocks Feature 008
`plan`/`tasks`. ADR-0001, ADR-0002, and ADR-0003 are accepted; ADR-0004, ADR-0005,
ADR-0006, ADR-0007, and ADR-0008 are proposed.

### Consequences

#### Positive

- One MCP client authority completes the 2025-11-25 lifecycle behind the existing
  `MCP.Service` seams; no second management, content, lifecycle, or routing authority, and
  no fork of SDK wire logic.
- A single durable/live event vocabulary with one `mcp.tools_changed` spelling keeps FR38,
  the schema literal, and the Feature 009 reindex trigger in agreement with no dual-spelling
  drift.
- Progress, resource updates, and content are native-plane by default: progress never
  enters LLM turns, updates notify-and-cache without an automatic re-read/reindex/wake, and
  every call/read is a Feature 005 OutputRef with a bounded preview and never a filesystem
  path.
- Least authority is structural: subscriptions need a server capability plus an operator
  grant, sampling passes through Smart/budget/LangLock under a per-agent Permission, and
  elicitation and `input_required` always surface to the operator.
- Secrets, URIs, and telemetry are secure by default: Feature 007 secret refs, a
  roots-scoped SSRF-safe allowlist, untrusted-content labels, decompression-bomb limits, and
  content-free spans/metrics per ADR-0001.

#### Trade-offs

- SDK version, recorded-capability fields, page/queue/backoff bounds, preview/spill/MIME
  caps, the content-stream capability string, permission grammar, redaction rules, metric
  buckets, and the consumer-migration inventory remain provisional plan constants with named
  acceptance hooks, fixed in the tasks phase.
- The `@modelcontextprotocol/sdk@1.29.0` final-result parse stays in RAM; the compatibility
  post-parse spill delivers the OutputRef contract now, and a bounded transport/parser or a
  negotiated nonstandard extension is deferred, with zero-RAM never promised.
- Legacy SSE remains for a deprecation window with a visible label rather than being removed
  in this feature, and experimental Tasks/sampling/elicitation ship off by default and reach
  parity only as each per-server flag is enabled and validated.
- Renaming `mcp.tools.changed` to `mcp.tools_changed` requires a coordinated update of the
  schema literal, the SDK-generated types, and every consumer in one migration.

#### Follow-ups

- Feature 008 `plan`/`tasks` implement the schema/protocol MCP modules, the framework-free
  domain lifecycle engine, the reworked `packages/opencode/src/mcp/` application/adapters,
  the Feature 007 `mcp.*` operator wiring (30 IDs, no bump), the CLI/TUI surfaces, and the
  lifecycle/fault/spool test matrix.
- The resolved SDK version, recorded-capability and event-payload enums, pagination and
  reconnect bounds, OutputSpool preview/spill and MIME/size caps, the content-stream
  capability string, sampling permission grammar, redaction rules, and metric buckets
  require plan-phase contracts with named acceptance hooks.
- The `mcp.tools_changed` rename, the OutputSpool content cutover, and the OAuth→SecretRef
  migration each require an honest sequencing note and consumer updates in the plan.

## Related

- Feature specification: [008 Complete MCP Client Tools and Resources Lifecycle](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md)
- Feature research: [008 research](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/research.md)
- Feature plan: [008 plan](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/plan.md)
- Smart/budget/OTEL authority: [001 Smart Agent Routing and Telemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Lifecycle/Process Table/cancel: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Wake/schedule dependency: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Language provenance: [004 Lang Lock](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- Content plane: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Semantic stack (opt-in consumer): [006 Semantic Agent and Skill Retrieval (Milvus)](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Tools-changed reindex consumer: [009 Semantic Tool Search](../sdd/009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0004 — Scheduled Job Runtime and Async Notification Channel](0004-scheduled-job-runtime-and-async-notification-channel.md)
- Related ADR: [0005 — Lang Lock Artifact-Language Policy and Progressive Enforcement](0005-lang-lock-artifact-language-policy-and-progressive-enforcement.md)
- Related ADR: [0006 — OutputSpool Content Plane and Paged ArtifactStore](0006-output-spool-content-plane-and-paged-artifact-store.md)
- Related ADR: [0007 — Semantic Tool Search Over the Shared Feature 006 Retrieval Stack](0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md)
- Related ADR: [0008 — Milvus-Backed Multilingual Semantic Retrieval and Reranking Stack](0008-milvus-semantic-retrieval-stack.md)
