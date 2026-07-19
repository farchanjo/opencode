# Tasks: Complete MCP Client Tools and Resources Lifecycle (Feature 008)

Ordered, measurable work breakdown derived from `plan.md` slices S0–S26, the
`data-model.md` entity definitions, `contracts/ports.ts`, ADR-0009, and the
`doc/arch/schemas/mcp/*.cue` mirrors (37 files). Every task stays inside the
`specScopeGlobs` declared in `doc/arch/speckit.toml`. Phase 1 (schema/protocol) is
additive and non-breaking; the only Phase-1 runtime change is the `mcp.tools.changed` →
`mcp.tools_changed` rename (C3), and no other runtime behavior changes until the Phase 3
adapters, operator wiring, and the honest Feature 001/006 seams. Feature 008 adds no second
management authority (007), content-plane identity (005), lifecycle/Process Table (002), or
Smart-routing decider (001): it delivers the MCP domain schemas, a framework-free lifecycle
engine at `packages/core/src/mcp/**`, the reworked application/adapter host at
`packages/opencode/src/mcp/**` behind the existing `MCP.Service` seams (C27), and the typed
`mcp.*` domain impls for the 30 reserved operator IDs registered through the Feature 007
registry — **no catalog bump** (`RESERVED_CATALOG_VERSION = "1.3.0"`, C25). The module name
is `mcp` across every package. No consumer ever receives a secret, a raw token, a filesystem
path, or an unsanitized body.

The canonical wire shape is the CUE corpus under `doc/arch/schemas/mcp/*.cue` mirrored
one-to-one by `data-model.md`: the closed **15-member** `mcp.*` event vocabulary
(`event-types.cue` / `events-server.cue` / `events-resource.cue` / `events-call.cue` /
`events-live.cue` / `events-log.cue`, **10 durable + 5 live**, single `mcp.tools_changed`
spelling), the `ConnectionState`/`TerminalBranch`/`CatalogState`/`SubscriptionState`/
`CallOutcome`/`CancelOutcome`/`CancelWirePath`/`EventClass` enums, the `RecordedCapabilitySet`
record, the `ResourceUpdatePolicy` / `OutputSchemaMode` / `AnnotationTrustMode` policy enums,
the `UriAllowlist`/`MimeAllowlist` descriptors, the `ExperimentalFlag` set with the reserved
`experimental/opencode.contentStream` capability string, and the `McpCallOutput`/`McpReadOutput`
OutputGroup descriptors. The `protocol/mcp` port surface mirrors `contracts/ports.ts`
interfaces while **sourcing its enum members from the schema modules** so one vocabulary is
enforced (see the Traceability reconciliation note).

## Task Breakdown

### Schema and protocol foundation (Phase 1)

- [x] T001 [S0] Author `packages/schema/src/mcp/ids.ts` and `packages/schema/src/mcp/refs.ts`
  with the branded identifiers and opaque handles from `data-model.md`: `ServerId`,
  `ConnectionId`, `RequestId`, `ToolName`, `ResourceUri`, `TaskId`, `SubscriptionId`,
  `EventId` (the EventV2 `evt_` id), plus the runtime/secure refs `OutputRef` (Feature 005),
  `SecretRef`/`HeaderRef` (Feature 007), `PermissionRef`, `OperatorRef`, and the
  `CorrelationId`/`CausationId` correlation refs, each built base-then-annotate-then-check-
  then-brand (`Schema.String.annotate({ identifier }).check(...).pipe(Schema.brand("Mcp.*"))`),
  mirroring `ids.cue`, `refs.cue`, and `correlation.cue` one-to-one with no cross-feature
  import, `SecretRef`/`HeaderRef` staying opaque non-empty handles that never carry raw
  material and `OutputRef` never a path (FR32, FR33, FR34, C15, C16). Acceptance:
  `tsgo --noEmit` on `packages/schema` and the schema contract-hygiene test assert the root
  identifier is retained (annotate-before-check) on every brand and no ref exposes raw
  secret/path material.
- [x] T002 [S0] Author `packages/schema/src/mcp/values.ts`, `text-values.ts`, and `uri.ts`
  with the integer counter/byte/bound ValueObjects (`SchemaVersion`, `Sequence`, `Progress`,
  `Total`, `ByteLength`, `ByteOffset`, `ByteLimit`, `PageCursor`, `PageIndex`, `MaxPageBound`,
  `QueueDepth`, `DebounceMs`, `BackoffBaseMs`, `BackoffCapMs`, `JitterRatio`, `AttemptCount`)
  folding `Schema.isInt()` into the bound check where integral, the bounded content-classified
  text/flag ValueObjects (`ServerName`, `DisplayName`, `Description`, `ProtocolVersion`,
  `DeprecationLabel`, `Reason`, `Enabled`, `Recorded`) excluding secrets/full-content/paths,
  and the `ResourceUri`/`UriScheme`/`MimeType` value grammar, mirroring `values.cue`,
  `text-values.cue`, and `uri.cue`; `Progress` is a real-valued monotonic wire counter and
  `Total` is nullable (FR14, FR15, C7). Acceptance: `tsgo --noEmit` green and the schema test
  asserts counters/bytes are integer-checked, `Progress` is continuous, and no free-form
  content/secret/path field is exported.
- [x] T003 [S0] Author `packages/schema/src/mcp/capability.ts` and
  `packages/schema/src/mcp/connection.ts` composing `RecordedCapabilitySet` (negotiated
  `ProtocolVersion`, per-server capability flags for tools/resources/prompts/logging/roots/
  sampling/elicitation/tasks/subscribe/listChanged, `recorded_at`) and the additive
  `ConnectionState` (`configured|connecting|negotiating|recording|connected|reconnecting`) +
  `TerminalBranch` (`disabled|failed|needs_auth|needs_client_registration`) enums that extend
  the existing `Status` union additively, so a capability the server never advertised is never
  exercised and `mcp_unavailable` is representable as a typed gap, mirroring `capability.cue`,
  `connection.cue`, and `connection-parts.cue` (FR7, FR8, C2). Acceptance: `tsgo --noEmit`
  green and the schema test asserts the recorded set captures the negotiated protocol version
  and every server capability flag, and the `Status` union extends without breaking the prior
  members.
- [x] T004 [S1] Author `packages/schema/src/mcp/enums.ts`, `enums-state.ts`, `enums-event.ts`,
  and `event-types.ts` with the closed enums as `Schema.Literals([...])`: `CatalogState`
  (`stale|walking|fresh|guard_tripped`), `SubscriptionState`
  (`unsubscribed|subscribing|subscribed|unsubscribing|fail_closed`), `CallOutcome`
  (tool-execution `isError` distinct from protocol error), `CancelOutcome`
  (`acknowledged|cancel_requested|unknown_remote`), `CancelWirePath` (`standard|task`),
  `TaskStatus` (terminal set plus `input_required`), `TaskSupport`
  (`required|optional|forbidden`), `CatalogKind` (`tools|resources|prompts`), `ContentKind`
  (`text|image|audio|resource|resource_link|structured`), `TransportKind`
  (`streamable_http|sse|stdio`), `DegradationGap` (`none|mcp_unavailable` and peers),
  `EventClass` (`durable|live`), `EventSource`, `ActorKind`, `Visibility`; and the closed
  **15-member** `McpEventType` `mcp.*` vocabulary with the single `mcp.tools_changed` spelling,
  mirroring `enums.cue`, `enums-state.cue`, `enums-event.cue`, and `event-types.cue` (FR7,
  FR12, FR38, C2, C3, C5, C8). Acceptance: `tsgo --noEmit` green and the schema test asserts
  the 15-member vocabulary is closed with the **ten durable** members (`mcp.server.status`/
  `mcp.server.capabilities_changed`/`mcp.tools_changed`/`mcp.resources_changed`/
  `mcp.resource_updated`/`mcp.call.settled`/`mcp.call.cancelled`/`mcp.task.settled`/
  `mcp.subscription.subscribed`/`mcp.subscription.unsubscribed`) distinct from the **five live**
  members (`mcp.call.started`/`mcp.call.progress`/`mcp.call.cancel_requested`/`mcp.task.status`/
  `mcp.log`), and that tool-execution `isError` is distinct from a protocol error.
- [x] T005 [S2] Author `packages/schema/src/mcp/policy.ts` composing `ResourceUpdatePolicy`
  (default `notify_cache`; opt-in `conditional_reread`/`semantic_reindex`/`wake` gates),
  `OutputSchemaMode` (`tolerant` default / `strict` per-server opt-in), and
  `AnnotationTrustMode` (`untrusted` default / operator-elevated `trusted`) plus the
  `TrustProfile` shape, so annotations are never a safety guarantee unless the operator
  elevates them and no policy produces an automatic turn per update, mirroring `flags.cue` and
  the C5/C6/C9 stances (FR13a, FR23, FR24, C5, C6, C9). Acceptance: `tsgo --noEmit` green and
  the schema test asserts the default policy is `notify_cache`, `tolerant` is the default
  validation mode, and `untrusted` is the default annotation-trust mode.
- [x] T006 [S3] Author `packages/schema/src/mcp/uri-allowlist.ts` and `collections.ts`
  composing `UriAllowlist` (default `https` + server-declared URIs within negotiated roots;
  `file` only within authorized project/session roots; every other scheme deny-by-default) and
  `MimeAllowlist` (MIME allowlist + size caps + decompression-bomb limit) plus the first-class
  collections (`CapabilityFlagSet`, `SchemeSet`, `MimeSet`, `RootSet`) that replace bare
  arrays, mirroring `uri.cue`, `refs.cue`, and `collections.cue`; the allowlist prevents
  sibling-session and cross-project leakage (FR25, FR36, C12, C17). Acceptance: `tsgo --noEmit`
  green and the schema test asserts `https` and roots-scoped URIs are allowed, `file` is
  confined to authorized roots, bare non-loopback `http` is deny-by-default, and every set
  wraps a branded element.
- [x] T007 [S4] Author `packages/schema/src/mcp/experimental.ts` and `spool-descriptor.ts`
  composing the `ExperimentalFlag` set (`tasks|sampling|elicitation|content_stream`, per-server,
  off by default) with the reserved namespaced capability string
  `experimental/opencode.contentStream`, and the `McpCallOutput`/`McpReadOutput` OutputGroup
  descriptors (bounded `Preview` + `OutputRef` + `ByteLength` + `ContentKind`, never a path),
  mirroring `experimental.cue`, `content.cue`, and `values.cue`; absence of the content-stream
  extension falls back to a final `CallToolResult` + progress metadata (FR6, FR33, FR41, FR45,
  C16, C18). Acceptance: `tsgo --noEmit` green and the schema test asserts each experimental
  flag is per-server and defaults off, the content-stream capability string is exactly
  `experimental/opencode.contentStream`, and the spool descriptors carry a bounded preview +
  `OutputRef` and no filesystem path.
- [x] T008 [S1] Author `packages/schema/src/mcp/events.ts` plus the member files
  `events-server.ts`, `events-resource.ts`, `events-call.ts`, `events-live.ts`, and
  `events-log.ts` composing the content-free common carrier `McpEventEnvelope` (`event_id`,
  `EventKind` = `event_type`/`schema_version`/`event_class`/`source`/`actor_kind`/`visibility`
  with **no LLM actor**, `EventSubject` = nullable `connection_id`/`request_id`/`resource_uri`
  plus `server_id`, `Ordering` = `sequence`/`correlation_id`/nullable `causation_id`,
  `Delivery` = `visibility`/`timestamp`/redacted key-value metadata), the detail sub-objects
  (`CatalogChangedDetail`, `ResourceUpdatedDetail`, `CallSettledDetail`, `CallProgressDetail`,
  `CancelRequestedDetail`, `CallCancelledDetail`, `TaskStatusDetail`, `TaskSettledDetail`,
  `SubscriptionDetail`, `LogDetail`), one `Schema.Struct` per closed 15-member vocabulary entry
  (each carrying `envelope`; distinct-payload members add one `detail`), and the closed
  `Schema.TaggedUnion("type", ...)` `McpEvent`, so call settlement carries `OutputRef`+
  `ByteLength` never a body, progress is monotonic metadata only, and no member carries content/
  URI-as-content/paths, mirroring `envelope.cue`, `events-server.cue`, `events-resource.cue`,
  `events-call.cue`, `events-live.cue`, and `events-log.cue` (FR14, FR17, FR23, FR38, FR42,
  FR56, C3, C7, C8, C26). Acceptance: `tsgo --noEmit` green and the schema test asserts every
  vocabulary member has a distinct Struct, the union is exhaustive over the 15 members, and no
  detail/envelope carries a body, URI-as-content, secret, or path.
- [x] T009 [S1] Author `packages/schema/src/mcp/events.ts` per-member `EventV2.define`
  `Definition`s carrying `durable {version: 1, aggregate: "correlation_id"}` on the **ten**
  durable members and omitting `durable` on the **five** live members, then extend
  `packages/schema/src/durable-event-manifest.ts` to join the ten durable `mcp.*` definitions
  into the canonical `Durable` inventory through `Event.durable([...])`, leaving the five live
  members (`mcp.call.started`/`mcp.call.progress`/`mcp.call.cancel_requested`/`mcp.task.status`/
  `mcp.log`) out of the durable set, so no second event authority is introduced (C3, C26).
  Acceptance: `bun test packages/schema` durable-manifest test green with the ten durable `mcp.*`
  members present and the five live members absent.
- [x] T010 [S0–S4] Author the barrel `packages/schema/src/mcp/index.ts` re-exporting every mcp
  schema module and register the barrel in `packages/schema/src/index.ts`. Acceptance:
  `tsgo --noEmit` on `packages/schema` green and `bun test packages/schema` imports the barrel
  without a duplicate-export error.
- [x] T011 [S1] Execute the `mcp.tools.changed` → `mcp.tools_changed` rename migration (C3):
  rename the schema literal `ToolsChanged.type` in `packages/schema/src/mcp-event.ts`; update
  the re-export and both publishers in `packages/opencode/src/mcp/index.ts`
  (`export const ToolsChanged` and the two `events.publish(ToolsChanged, …)` call sites);
  regenerate `packages/sdk/js/src/v2/gen/types.gen.ts` so its three `mcp.tools.changed`
  occurrences follow (generated-artifact step, run the codegen, do not hand-edit); and align the
  new durable `mcp.tools_changed` schema member (T008/T009) to the single spelling so the wire
  id, FR38, and the Feature 009 reindex-trigger consumer agree — no dual spelling survives.
  Acceptance: `grep -r "mcp.tools.changed" packages` returns zero matches, `bun test
  packages/schema` and `bun test packages/opencode` green, and the regenerated SDK types emit
  `mcp.tools_changed`.
- [x] T012 [S5] Author `packages/protocol/src/mcp/ports.ts` mirroring `contracts/ports.ts`: the
  `TransportPort`, `ClockPort`, `EntropyPort`, `SpoolPort`, `PermissionReadPort`,
  `EventPublishPort`, `ConfigReadPort`, and `SecretResolvePort` interfaces and the typed error
  unions (`ssrf_blocked`, `uri_not_allowlisted`, `fail_closed`, `mcp_unavailable`,
  `guard_tripped`, `unknown_remote`, and peers), **sourcing every enum member from the
  `packages/schema/src/mcp/*` modules** so the transport contract never diverges from the wire
  shape, and **reconciling the event vocabulary to the CUE authority**: the closed **15-member**
  `mcp.*` vocabulary with the **10 durable / 5 live** split, `mcp.call.cancel_requested`
  classified **live** (its durable audit is the `mcp.call.cancelled` settlement member whose
  `CancelOutcome` records `cancel_requested`/`unknown_remote`, resolving the C8 concern), and no
  `mcp.subscription.fail_closed` event member (the `fail_closed` posture is a `SubscriptionState`
  value) — the resolution recorded in `data-model.md` and the earlier `contracts/ports.ts`
  divergence now corrected in place (FR7, FR17, FR29, FR33, FR38, C2, C3, C8, C12, C16).
  Acceptance: `tsgo --noEmit` on `packages/protocol` green and the protocol parity test asserts
  each interface member matches `contracts/ports.ts` reconciled to the schema modules and the
  reconciled 15-member vocabulary (10 durable / 5 live, `mcp.call.cancel_requested` live, no
  `subscription.fail_closed` member) matches `packages/schema/src/mcp/*`.
- [x] T013 [S5] Author `packages/protocol/src/mcp/commands.ts` and
  `packages/protocol/src/mcp/index.ts` with the **30** operator command/query payloads for the
  reserved `mcp.*` IDs across `mcp.server.*` (11:
  `list|add|update|test|connect|disconnect|reconnect|disable|delete|status|capabilities`),
  `mcp.auth.*` (4: `start|finish|remove|status`), `mcp.resource.admin.*` (7:
  `list|templates|read|subscribe|unsubscribe|policy.show|policy.set`), `mcp.logging.level.*` (2:
  `show|set`), `mcp.experimental.*` (3: `status|enable|disable`), and `mcp.extension.*` (3:
  `status|enable|disable`), plus the `OperatorPrincipal` shape, each redacted/versioned and
  carrying no secret/token/path, never redefining the reserved catalog (which already declares
  the 30 IDs at `RESERVED_CATALOG_VERSION = "1.3.0"`) (FR48–FR50, C25). Acceptance:
  `tsgo --noEmit` on `packages/protocol` green and the protocol test asserts exactly 30 typed
  `mcp.*` payloads across the six sub-namespaces with no secret/token/path field.

### Domain lifecycle engine (Phase 2)

- [x] T014 [S6] Author `packages/core/src/mcp/connection-lifecycle.ts` implementing the closed
  `configured → connecting → negotiating → recording → connected` machine with additive terminal
  branches `disabled`/`failed`/`needs_auth`/`needs_client_registration` over injected transport/
  clock/config/event ports, recording the negotiated protocol version and full server capability
  set per server, never exercising an unadvertised capability, and re-running negotiation on
  reconnect emitting `mcp.server.capabilities_changed` on a recorded-set diff, mirroring the C2
  state machine with no I/O in the hot logic (FR7, FR8, C2). Acceptance: `bun test packages/core`
  asserts every legal transition, rejects illegal transitions, confirms the recorded capability
  set is captured at `recording`, and a reconnect diff emits `capabilities_changed`.
- [x] T015 [S7] Author `packages/core/src/mcp/reconnect-planner.ts` implementing bounded
  exponential backoff with jitter and a capped max delay honoring session resume and
  `Last-Event-ID`, entering `reconnecting` on a Streamable HTTP drop and `failed` on max
  attempts, while a stdio connection restarts under lifecycle control with child cleanup and no
  backoff, over injected clock/entropy ports, mirroring the C14 curve (FR29, FR30, FR31, C14).
  Acceptance: `bun test packages/core` asserts the backoff curve is bounded/jittered/capped,
  resume carries `Last-Event-ID`, max attempts reaches `failed`, and stdio restarts without a
  backoff schedule.
- [x] T016 [S8] Author `packages/core/src/mcp/catalog-policy.ts` implementing the
  `stale → walking → fresh` paginated-walk decision with a **duplicate-cursor guard** (a
  repeated or non-advancing cursor terminates the walk) and a **max-page bound** that enters
  `guard_tripped` and fails closed with a typed error retaining the prior `defs[server]`, so a
  `list_changed` triggers a full refresh and the cached `defs[server]` shape is preserved,
  mirroring the C4 flow (FR10, FR11, C4). Acceptance: `bun test packages/core` asserts a normal
  paginated walk reaches `fresh`, a duplicate/non-advancing cursor and a max-page breach reach
  `guard_tripped` fail-closed retaining prior defs, and `list_changed` restarts at `stale`.
- [x] T017 [S9] Author `packages/core/src/mcp/resource-policy.ts` implementing the default
  `notify_cache` policy — `resources/updated` coalesces/dedupes/debounces into a bounded queue
  with sequence/correlation, updates UI and cache, and emits `mcp.resource_updated` — with the
  `conditional_reread`/`semantic_reindex`/`wake` steps behind separate per-server opt-in gates,
  so no configuration produces an automatic turn per update and wake is admission-gated (C22),
  mirroring the C9/C21/C22 matrix over injected clock/event ports (FR23, FR24, C9, C21, C22).
  Acceptance: `bun test packages/core` asserts the default path is notify+cache only with no
  re-read/reindex/wake, a burst is coalesced into the bounded queue, and each opt-in step is a
  distinct gate that never auto-fires.
- [x] T018 [S10] Author `packages/core/src/mcp/subscription-machine.ts` implementing the closed
  `unsubscribed → subscribing → subscribed → unsubscribing` machine requiring the server
  `resources.subscribe` capability **and** an operator grant to leave `unsubscribed`, moving an
  unauthorized subscribe or a lost capability to `fail_closed`, so the LLM never subscribes and
  any unauthorized subscribe/read/delivery fails closed, mirroring the C10 lifecycle (FR21, C10).
  Acceptance: `bun test packages/core` asserts a subscribe requires capability + operator grant,
  an unauthorized attempt and a lost capability fail closed, and unsubscribe returns to
  `unsubscribed`.
- [x] T019 [S11] Author `packages/core/src/mcp/cancel-selector.ts` implementing the wire-path
  selector: a standard (non-task-augmented) in-flight `tools/call` cancels via
  `notifications/cancelled`, a task-augmented call cancels via `tasks/cancel`, the Feature 002
  root tree covers both classes with the correct wire path per child, and an unacknowledged
  remote is recorded as `cancel_requested`/`unknown_remote` (the durable `mcp.call.cancelled`
  audit) while the pre-settlement `mcp.call.cancel_requested` stays a live signal, mirroring the
  C8 split (FR17, FR18, C8). Acceptance: `bun test packages/core` asserts a standard call selects
  `notifications/cancelled`, a task-augmented call selects `tasks/cancel`, the root tree cancels
  both, and an unacknowledged remote records the typed outcome.
- [x] T020 [S12] Author `packages/core/src/mcp/degradation.ts` implementing the typed
  capability-gap classifier (`none`/`mcp_unavailable` and peers) so a missing SDK/wire feature or
  an unreachable server degrades to a typed gap and the session continues rather than hard-
  failing, never exercising an unadvertised capability, mirroring the C1/C2 degradation stance
  (FR7, C1, C2). Acceptance: `bun test packages/core` asserts each gap code, server unavailability
  yields `mcp_unavailable` not a crash, and the session continues on a degraded capability.
- [x] T021 [S13] Author `packages/core/src/mcp/trust-gate.ts` implementing the annotation-trust
  profile (annotations untrusted unless operator-elevated), the outputSchema tolerant/strict
  decision (tolerant surfaces a typed non-fatal validation warning and still spools/delivers;
  strict converts a mismatch into an `isError`-class failure), the untrusted-content provenance
  labels, and the size/decompression-bomb limit decision that rejects oversized payloads before
  delivery, mirroring the C5/C6/C24 gates (FR13a, FR27, C5, C6, C24). Acceptance:
  `bun test packages/core` asserts unelevated annotations are ignored for gating, tolerant vs
  strict outputSchema outcomes differ correctly, untrusted content is labeled, and a
  decompression bomb is rejected pre-delivery.
- [x] T022 [S14] Author `packages/core/src/mcp/mcp-instruments.ts` adding the `mcp.*` spans
  (connect, capability negotiation, list, call, progress, read, subscribe, reconnect, cancel,
  task status/result) linked to the Feature 001 session/routing/LLM/Process-Table job spans, and
  the content-free bounded-enum metrics (latency histograms, progress count, bytes spooled,
  reconnect count, update-coalesce count, failures) reusing the Feature 001 cardinality allowlist
  so URIs, content, call IDs, and session IDs never appear as metric labels, over-budget dynamic
  values map to `other`, Process Table child IDs correlate on traces not labels, and async
  bounded export never blocks the hot path, mirroring FR54–FR56 and C26 (FR54, FR55, FR56, C26).
  Acceptance: `bun test packages/core` cardinality audit asserts no URI/content/call/session ID
  appears as a metric label and OTEL-down does not block a call.
- [x] T023 [S6–S14] Author the barrel `packages/core/src/mcp/index.ts` re-exporting the
  connection-lifecycle, reconnect-planner, catalog-policy, resource-policy, subscription-machine,
  cancel-selector, degradation, trust-gate, and mcp-instruments modules. Acceptance:
  `tsgo --noEmit` on `packages/core` green and the barrel imports without a duplicate-export
  error.

### Application, adapters, and operator wiring (Phase 3)

- [ ] T024 [S15] **EARLY SDK + transport validation (honest outcome).** Author
  `packages/opencode/src/mcp/sdk-probe.ts` empirically validating that the pinned
  `@modelcontextprotocol/sdk@1.29.0` and its applied 629-line forward patch
  (`patches/@modelcontextprotocol%2Fsdk@1.29.0.patch`) expose, under the Bun runtime, the client
  surface Feature 008 relies on — `subscribeResource`/`unsubscribeResource` (C10),
  `setLoggingLevel` (C23), `ProgressCallback`/`onprogress`/`resetTimeoutOnProgress` (C7), the
  `CancelledNotification`/`ResourceUpdatedNotification`/`SubscribeRequest`/
  `ResourceListChangedNotification`/`ProgressNotification` schemas, `onsessionexpired`
  re-initialization for resume/`Last-Event-ID`, and the `experimental/tasks/**` module — and
  recording a typed capability outcome per surface. **Honest outcome:** a present surface routes
  through the SDK; a missing surface records a typed capability gap (C1/C2) routed through the
  degradation classifier, never a hard failure, and a major SDK jump is a documented ADR/plan
  migration not a silent bump (FR7, C1). Acceptance: `bun test packages/opencode` asserts the
  probe emits a typed present/gap finding per required surface and no path hard-fails routing on
  a missing optional wire feature.
- [ ] T025 [S15] Rework `packages/opencode/src/mcp/index.ts` (`MCP.Service`) in place as the
  application host: instantiate the SDK client and transport adapters (prefer Streamable HTTP,
  keep the existing StreamableHTTP→SSE fallback with an operator-visible **deprecation label** on
  SSE, stdio start/stop with the existing `pgrep -P` SIGTERM child-cleanup finalizer), delegate
  every lifecycle/reconnect decision to the `packages/core/src/mcp` ports (T014/T015/T020), and
  keep the `tools()`/`resources()`/`readResource()`/`Status`-union/OAuth seams shape-compatible
  (C27), mirroring the S15 host over the T012 ports (FR29, FR30, FR31, C14, C27). Acceptance:
  `bun test packages/opencode` asserts a Streamable HTTP connect records capabilities and reaches
  `connected`, an SSE fallback is deprecation-labeled, a stdio disconnect cleans up children, and
  the `tools()`/`resources()`/`readResource()`/`Status` seams keep their prior shape.
- [ ] T026 [S16] Author `packages/opencode/src/mcp/progress-sink.ts` replacing the
  `convertTool` `onprogress: () => {}` no-op with a real sink that supplies a progressToken,
  enforces wire monotonicity per token, updates the Feature 002 Process Table child and OTEL
  counters, preserves `resetTimeoutOnProgress`, coalesces/rate-limits display frames without
  rewriting/inventing/decreasing protocol values, and **never** enters LLM context/turns or is
  persisted as tool output, mirroring the C7 plumbing (FR14, FR15, FR16, FR16a, C7). Acceptance:
  `bun test packages/opencode` asserts a progressToken is supplied, wire progress is monotonic,
  the Process Table child and OTEL update, UI coalescing never decreases/invents values, and no
  progress payload enters the transcript.
- [ ] T027 [S17] Rework `packages/opencode/src/mcp/catalog.ts` to walk `tools/list` paginated
  under the T016 policy (duplicate-cursor guard + max-page fail-closed), refresh the whole
  catalog on `notifications/tools/list_changed` and emit the durable `mcp.tools_changed`, and
  fail closed on a reserved-name collision via the existing `checkReservedRegistrationName` /
  `toolNameIfAllowed` guard with no silent rename, **preserving the cached `defs[server]` shape**
  its consumers read (C27), mirroring C4/C25 (FR10, FR11, C4, C25). Acceptance:
  `bun test packages/opencode` asserts the paginated walk replaces `defs[server]` with its shape
  intact, `list_changed` emits `mcp.tools_changed` without content, a duplicate cursor / max-page
  breach fails closed retaining prior defs, and a reserved-id collision is rejected.
- [ ] T028 [S18] Author `packages/opencode/src/mcp/spool-bridge.ts` routing every `tools/call`
  and `resources/read` through a Feature 005 OutputGroup, delivering a **bounded preview +
  OutputRef only** (never a filesystem path), decoding base64/data-URL content to spool under the
  T006 MIME allowlist and size caps (full data URLs never enter model context), performing the
  **post-parse spill** honestly (the SDK parses the final result in RAM; zero-RAM is never
  promised) and migrating the current path-in-preview truncation and the 10MB inline blob path to
  the OutputRef, mirroring C16/C17 (FR33, FR34, FR35, FR36, FR37, C16, C17). Acceptance:
  `bun test packages/opencode` under the Feature 005 sandbox asserts a ~50MB result yields a
  bounded preview + OutputRef with no path, base64/data-URL content is MIME/size-capped and
  spooled, and the post-parse spill is documented with no zero-RAM claim.
- [ ] T029 [S19] Author `packages/opencode/src/mcp/resource-adapter.ts` exposing runtime
  list/templates/read through the canonical adapter under `mcp:server:*` Permission (the existing
  `list_mcp_resources`/`list_mcp_resource_templates`/`read_mcp_resource` tools, shape-preserved),
  wiring subscribe/unsubscribe to the T018 machine under the server capability + operator grant,
  enforcing the T006 URI allowlist (SSRF-safe, `file` confined to authorized roots, every other
  scheme deny-by-default), keeping `resource_link` lazy (auto-fetch only under policy/Permission/
  Feature 001 budget, routed through the spool bridge), and failing closed on any unauthorized
  subscribe/read/delivery, mirroring C10/C11/C12 (FR19, FR21, FR22, FR25, FR26, C10, C11, C12).
  Acceptance: `bun test packages/opencode` asserts runtime read works under Permission, the LLM
  never subscribes, a cross-project/non-allowlisted URI fails closed, and `resource_link` stays
  lazy unless policy fetches.
- [ ] T030 [S20] Author `packages/opencode/src/mcp/secret-bridge.ts` and rework
  `packages/opencode/src/mcp/auth.ts` to resolve OAuth tokens, headers, and secrets as Feature
  007 SecretRefs through the SecretPort, running a one-time migration that reads existing
  `McpAuth` token entries into secure refs, resolving tokens/headers/secrets through refs at
  connect, and keeping config surfaces backward-compatible, so no plaintext secret enters args,
  history, output, config JSON, plain audit, or a spool preview, mirroring C15 (FR32, C15).
  Acceptance: `bun test packages/opencode` asserts an OAuth start/finish stores tokens as refs,
  the one-time `McpAuth` migration reads existing entries into refs, and no plaintext secret
  appears in any output/preview/audit.
- [ ] T031 [S21] Author `packages/opencode/src/mcp/experimental/tasks.ts` implementing the
  MCP 2025-11-25 Tasks adapter behind the per-server `mcp.tasks` flag (off by default; when off,
  tasks capability is not advertised and task-augmented calls are not accepted): honor tool
  `execution.taskSupport` (`required|optional|forbidden`, rejecting a task-augmented call to a
  `forbidden` tool even when enabled), accept `CreateTaskResult` (not a final body as partial
  content), support `tasks/get|result|list|cancel` and `notifications/tasks/status` including
  terminal and `input_required`, map lifecycle to a Feature 002 Process Table task child and
  final content to a Feature 005 OutputGroup, continue the original progressToken until terminal,
  and cancel via `tasks/cancel` (T019), mirroring C8/C18 (FR41, FR42, FR43, FR44, C8, C18).
  Acceptance: `bun test packages/opencode` asserts default-off advertises no tasks capability, an
  enabled task-augmented call accepts `CreateTaskResult` with a task child and spooled result,
  `taskSupport: forbidden` is rejected, and `tasks/cancel` reaches a terminal status.
- [ ] T032 [S21] Author `packages/opencode/src/mcp/experimental/sampling.ts` implementing the
  server-initiated sampling adapter behind the per-server `mcp.sampling` flag (off by default),
  requiring explicit per-agent/per-model `mcp:<server>:sampling` Permission and passing every
  request through Feature 001 Smart routing, budgets, LangLock, and privacy unchanged — sampling
  never bypasses them — with the approval path audited, **and honestly task the live LLM sampling
  callback as a documented seam**: V1 delivers the adapter module plus its tests plus a documented
  wiring point where the Feature 001 session runtime would service the sampling request, per the
  langlock/semantic injection-seam precedent (the seam may be unreachable in V1 until Feature 001
  wires the model callback), mirroring C19 (FR45, FR46, C19). Acceptance: `bun test
  packages/opencode` asserts default-off does not advertise sampling, an enabled request requires
  `mcp:<server>:sampling` and routes through Smart/budget/LangLock/privacy, the approval path is
  audited, and the documented Feature 001 seam is present and covered by a seam test.
- [ ] T033 [S21] Author `packages/opencode/src/mcp/experimental/elicitation.ts` implementing the
  elicitation and content-stream adapters behind the per-server `mcp.elicitation` and content-
  stream flags (off by default): every elicitation request and every Tasks
  `notifications/tasks/status: input_required` surfaces to the **operator UI** as a lifecycle
  prompt (never partial content), the model never silently auto-answers, sensitive-mode blocks
  model-mediated answers outright, and the nonstandard content-stream extension advertises only
  under the reserved `experimental/opencode.contentStream` capability string with a final-result
  fallback when absent, mirroring C18/C20 (FR45, FR47, C18, C20). Acceptance: `bun test
  packages/opencode` asserts an elicitation/`input_required` always surfaces to the operator with
  no silent model answer, sensitive-mode blocks model-mediated answers, and content-stream is
  namespaced with a final-`CallToolResult` fallback when not negotiated.
- [x] T034 [S22] Author `packages/opencode/src/operator/mcp/**` with the typed domain
  implementations for the **30** reserved `mcp.*` IDs (`mcp.server.*` 11, `mcp.auth.*` 4,
  `mcp.resource.admin.*` 7, `mcp.logging.level.*` 2, `mcp.experimental.*` 3, `mcp.extension.*` 3)
  registered through the Feature 007 registry, operator-only and zero-LLM (zero provider calls
  and zero transcript injection on management paths; explicit `mcp.server.test`/`mcp.auth.*` call
  the endpoint via a fixed probe only), redacted/versioned human and JSON output, mutations
  requiring an operator principal plus scope plus version/CAS plus audit, and a confirmation
  matrix on `disconnect`/`disable`/`delete`/`mcp.experimental.enable`/`mcp.auth.remove`; the
  reserved catalog `packages/core/src/operator/catalog.ts` already declares the 30 IDs at
  `RESERVED_CATALOG_VERSION = "1.3.0"`, so **no catalog bump is performed** and a runtime/plugin/
  MCP/custom/`session.command` registration colliding with a reserved id is rejected with a
  structured `reserved_name` error (no dual authority) (FR48, FR49, FR50, C25). Acceptance:
  `bun test packages/opencode` under the Feature 007 sandbox asserts the 30 operations dispatch
  with zero model tokens on ordinary paths, an LLM attempt on any `mcp.*` id is denied, a
  reserved-id collision is rejected, and confirmation is required on the mutating verbs.
- [ ] T035 [S23] Author `packages/opencode/src/mcp/reindex-trigger.ts` implementing the single
  opt-in semantic-index trigger seam: on a qualifying `resources/updated` (per the T017 policy)
  with operator opt-in **and** a Feature 006 classification decision, emit exactly one reindex
  trigger consumed by Feature 006 under its admission ladder — Feature 008 never embeds, ranks,
  or stores vectors — and **honestly task the live Feature 006 consumption as a documented seam**
  (the trigger may be unreachable until Feature 006 wires the consumer), the single MCP-resource
  reindex trigger Feature 009 references, mirroring C21 (FR53, C21). Acceptance:
  `bun test packages/opencode` asserts no reindex fires without opt-in + classification, a
  qualifying update emits exactly one trigger with no vectors in 008, and the documented Feature
  006 seam is present and covered by a seam test.
- [ ] T036 [S24] Author `packages/opencode/src/mcp/logging-bridge.ts` integrating MCP
  `notifications/message` into native logging under redaction (secrets, tokens, and path-shaped
  fields stripped) and rate limits, following the native logging retention policy (no separate
  MCP store), with operator `logging/setLevel` reached only through the Feature 007
  `mcp.logging.level.set` (audited), mirroring C23 (FR28, C23). Acceptance:
  `bun test packages/opencode` asserts logging notifications are redacted and rate-limited into
  native logging, retention follows the native policy, and `mcp.logging.level.set` changes the
  level via Feature 007 only with audit.
- [ ] T037 [S13–S23] Author the barrel `packages/opencode/src/mcp/index.ts` re-exports (extend
  the reworked service module) to surface the progress-sink, catalog walker, spool-bridge,
  resource-adapter, secret-bridge, experimental adapters, reindex-trigger, and logging-bridge
  modules, and wire `publishMcpEvent` into `packages/opencode/src/event-v2-bridge.ts` (mirroring
  `publishLifecycleEvent`/`publishJobEvent`/`publishLangLockEvent`/`publishOutputEvent`/
  `publishSemanticEvent`: single publish boundary, location attach) so the ten durable `mcp.*`
  events reach the bridge once and the five live signals ride the bounded live channel droppable
  under `allBounded` load, carrying only opaque ids and redacted metadata — never content or a
  path (C3, C26). Acceptance: `tsgo --noEmit` on `packages/opencode` green, the barrel imports
  without a duplicate-export error, and the bridge test asserts a durable `mcp.*` event reaches
  the boundary once while a live signal is droppable and carries no content/path.

### CLI and TUI surfaces (Phase 4)

- [ ] T038 [S25] Rework `packages/opencode/src/cli/cmd/mcp.ts` for `opencode op mcp
  server|auth|resource|logging|experimental|extension <op>`, each dispatching through the Feature
  007 registry (via `packages/opencode/src/cli/cmd/op.ts`) to the operator `mcp.*` impls with
  registry-generated names (no divergent hardcoded verbs), emitting redacted/versioned human and
  JSON output, requiring interactive confirmation for the mutating verbs, and making zero
  management-path provider calls or LLM tokens with no secret/path exposure; **honestly plan the
  coexistence** of the pre-existing standalone `opencode mcp` CLI at this path with the new
  `opencode op mcp` operator verbs — the legacy connect/list surface remains a compatibility shim
  that delegates to the same reworked `MCP.Service`, so the two entry points share one adapter and
  never fork behavior (FR48, FR49, FR50, C25, C27). Acceptance: `bun test packages/opencode`
  asserts human and JSON output, surface parity with the Settings/palette path yielding the same
  effective server/version/audit, confirmation on mutating verbs, zero admin-time model tokens,
  no secret/path in output, and the legacy `opencode mcp` shim delegating to the shared adapter.
- [ ] T039 [S25] Author `packages/tui/src/**/operator/mcp/**` rendering the MCP servers /
  capabilities / resource-admin / experimental panels as thin adapters over the Feature 007
  registry with registry-generated names, showing server cards, capability badges, connection and
  subscription state, SSE deprecation labels, tool/resource/task call cards (status, progress,
  total, message, bytes, elapsed, provider/server, direct-child hierarchy, expand via OutputRef
  offset/limit), reconnect state, untrusted-content labels, and no secret/path/raw-unbounded
  content, with screen-reader text independent of color, mirroring FR57 (FR48, FR57, C14, C24).
  Acceptance: `bun test packages/tui` asserts the panels show connection/subscription/deprecation
  state and capability badges, expand content only via OutputRef offset/limit, label untrusted
  content, and expose no secret, path, or raw unbounded content.

### Tests and validation (Phase 5)

- [ ] T040 [S26] Add pure deterministic unit tests under `packages/core/test/mcp/**` for the
  connection-lifecycle transitions (legal/illegal, recorded capabilities, reconnect diff), the
  reconnect-backoff curve (bounded/jittered/capped, resume `Last-Event-ID`, stdio restart), the
  catalog paginated-walk + duplicate-cursor guard + max-page fail-closed, the resource-update
  coalesce/dedupe/debounce and the notify-cache/re-read/reindex/wake gate matrix, the subscription
  machine (capability + operator authority, fail-closed), the cancel wire-path selection, the
  degradation classifier, and the trust gate (annotation trust, tolerant/strict outputSchema,
  decompression-bomb), with deterministic ports and no I/O (AC4, AC7, AC9, AC10, AC11, AC12, AC16,
  AC19, AC26, AC31, AC33). Acceptance: `bun test packages/core` green.
- [ ] T041 [S26] Add schema and protocol tests under `packages/schema/test/mcp/**` and
  `packages/protocol/test/mcp/**` asserting contract hygiene (annotate-before-check identifiers on
  every brand), the closed **15-member** `mcp.*` vocabulary and the **10 durable / 5 live** split
  with the single `mcp.tools_changed` spelling (and zero `mcp.tools.changed` survivors), the
  recorded-capability and policy/trust/allowlist/experimental/spool value objects, envelope/detail
  redaction (no body/URI-as-content/secret/path), the durable-manifest join (ten durable members
  present, five live absent), and `protocol/mcp` parity against `contracts/ports.ts` **reconciled
  to the schema modules** — the 15-member vocabulary, `mcp.call.cancel_requested` **live**, no
  `mcp.subscription.fail_closed` event member, and the 30 `mcp.*` command payloads (FR32, FR38,
  FR48, C3, C8, C16, C25, C26). Acceptance: `bun test packages/schema` and `bun test
  packages/protocol` green with the reconciled vocabulary pinned across CUE, the schema modules,
  the protocol mirror, and `data-model.md`.
- [ ] T042 [S26] Add integration tests under `packages/opencode/test/mcp/**` driving the reworked
  SDK client against a **fake MCP server per transport** — Streamable HTTP (connect/negotiate/
  record, session resume with `Last-Event-ID`), legacy SSE (deprecation-labeled fallback), and
  stdio (start/stop child cleanup) — covering `tools/list` pagination, `list_changed` refresh,
  `resources/read`, subscribe/updated, progress (UI/OTEL not LLM, wire monotonic), prompts
  list/get/list_changed as runtime content under Permission, roots scoped to project/session, and
  the canonical-adapter parity of top-level vs code-mode (FR7, FR10, FR11, FR14, FR27, FR29, FR31,
  C2, C4, C7, C13, C14, AC1, AC2, AC3, AC4, AC5, AC12, AC14, AC23, AC25). Acceptance:
  `bun test packages/opencode` green against the fake servers per transport.
- [ ] T043 [S26] Add fault-injection tests under `packages/opencode/test/mcp/**` driving the
  lifecycle-fault matrix (connect timeout, `needs_auth`, `needs_client_registration`, mid-call
  disconnect, `mcp_unavailable` typed gap, capability lost on reconnect → session continues), the
  pagination edges (duplicate/non-advancing cursor, max-page breach fail-closed, empty catalog,
  `list_changed` mid-walk, `defs[server]` shape preserved), the notification storms (high-rate
  `resources/updated` and `tools/list_changed` → bounded queue, coalesce/dedupe/debounce, no
  automatic turn, at most one admission-controlled wake), the reconnect/resume path, and the
  cancel wire paths (standard `notifications/cancelled`, task `tasks/cancel`, root tree covers
  both, spool sealed, unacknowledged remote recorded), through injected ports (FR10, FR17, FR18,
  FR24, FR30, C4, C8, C9, C22, AC4, AC7, AC9, AC10, AC11, AC12, AC16, AC31). Acceptance:
  `bun test packages/opencode` green with every lifecycle, pagination, storm, reconnect, and
  cancel point asserted.
- [ ] T044 [S26] Add spool-integration and security/privacy tests under
  `packages/opencode/test/mcp/**` through the Feature 005 sandbox and a Permission sandbox: an
  OutputGroup per call/read with a bounded preview + OutputRef never a path, base64/data-URL
  decode-to-spool under MIME/size caps with the 10MB migration baseline and the post-parse spill
  (no zero-RAM claim); and the SecretRef-only OAuth cutover (no plaintext in args/history/output/
  config/audit/preview), the URI allowlist + SSRF controls (metadata/link-local/private ranges
  blocked, cross-project fail-closed), untrusted-content/provenance labels, decompression-bomb
  rejection, and content-free spans/metrics (no URI/content/call/session labels) (FR13a, FR25,
  FR27, FR32, FR33, FR34, FR36, FR51, FR52, FR54, FR55, FR56, C12, C15, C16, C17, C24, C26, AC6,
  AC8, AC13, AC20, AC21, AC22, AC27). Acceptance: `bun test packages/opencode` green with the
  spool, secret, SSRF, trust, and content-free-telemetry points asserted.
- [ ] T045 [S26] Add contract and consumer-compatibility tests through the Feature 007 sandbox
  covering the **30** `mcp.*` IDs versus the existing reserved catalog (already at 1.3.0) with
  reserved-id collision rejection and zero admin-time LLM tokens/transcript (AC15), the operator-
  vs-runtime plane separation (an LLM attempt on `mcp.resource.admin.*` or any `mcp.*` id denied,
  a canonical-adapter read under Permission succeeding without an admin audit, AC29), the
  experimental flags default-off and rollout order tasks → sampling → elicitation → content-stream
  with `mcp:<server>:sampling` gating and operator-surfaced elicitation/`input_required` (AC16,
  AC17, AC18, AC19, AC32), the Tasks lifecycle (`CreateTaskResult`, `tasks/get|result|list`,
  `taskSupport: forbidden` rejection, AC30, AC33), the logging setLevel via Feature 007 (AC24),
  the semantic-index opt-in (AC28), and the `tools()`/`describeCatalog`/`list_mcp_resources`/
  `read_mcp_resource` seam-shape compatibility (AC14, AC29) (FR41–FR50, FR53, C18, C19, C20, C21,
  C23, C25, C27). Acceptance: `bun test packages/opencode`/`packages/tui` green under the sandbox.
- [ ] T046 [S26] Run per-package `tsgo --noEmit` typecheck and `bun test` for `packages/schema`,
  `packages/protocol`, `packages/core`, `packages/opencode`, and `packages/tui`, plus the
  telemetry cardinality audit under `packages/core/test/mcp/**` asserting URIs, content, call IDs,
  and session IDs never appear as metric labels, over-budget dynamic values map to `other`, the
  `mcp.*` spans correlate with the Feature 001 spans on traces (not labels), and OTEL-down does
  not block a call; then close out: tick every checkbox above once its task is complete and
  verified, confirm `speckit validate` is green with only the four pre-existing waived hygiene
  findings (no placeholder findings), and confirm every FR1–FR57 and AC1–AC33 is mapped to a task
  per the Traceability section (FR54, FR55, FR56, C26). Acceptance: all five packages typecheck
  and test green, `speckit validate` green, and the Traceability tables fully mapped.

## Traceability

Requirements-to-task and acceptance-to-task coverage. The closed **15-member** `mcp.*` event
vocabulary (10 durable + 5 live, single `mcp.tools_changed` spelling), the `ConnectionState`/
`TerminalBranch`/`CatalogState`/`SubscriptionState`/`CallOutcome`/`CancelOutcome`/`CancelWirePath`
enums, and the recorded-capability/policy/allowlist/experimental/spool value objects are the CUE /
`data-model.md` authority.

**Reconciliation note.** The CUE corpus (`event-types.cue` + `events-live.cue`) is the wire-shape
authority: a **15-member** vocabulary, **10 durable / 5 live**, with `mcp.call.cancel_requested`
classified **live**. An earlier `contracts/ports.ts` draft diverged — classifying
`mcp.call.cancel_requested` **durable** and adding an extra `mcp.subscription.fail_closed` durable
member (a 16-member, 12-durable/4-live surface) with an inline comment flagging the gap. This tasks
phase **resolved** the divergence in place: `contracts/ports.ts` and `data-model.md` now match CUE
(15 members, 10/5, `mcp.call.cancel_requested` live), because the C8 audit requirement — an
unacknowledged-remote cancel outcome must be **recorded** — is satisfied by the **durable**
`mcp.call.cancelled` settlement member whose `CancelOutcome` (`acknowledged`/`cancel_requested`/
`unknown_remote`) carries the audit, and the subscription `fail_closed` posture is a
`SubscriptionState` value not a persisted event. **T012 re-derives the `protocol/mcp` enums from the
`packages/schema/src/mcp/*` modules** so the transport contract cannot drift; **T041 pins that
parity** across the CUE corpus, the schema modules, the protocol mirror, and `data-model.md`.

| Requirement | Tasks |
| ----------- | ----- |
| FR1 distinguish streams; no partial-content claim | T004, T008, T028 |
| FR2 one final CallToolResult; progress metadata only | T008, T026, T028 |
| FR3 resources/updated notify+cache+policy | T005, T017 |
| FR4 Tasks lifecycle mapped to 002/005; no partial content | T031 |
| FR5 OutputSpool offset/limit app-side | T028, T039 |
| FR6 content-stream nonstandard, off by default, fallback | T007, T033 |
| FR7 negotiate + record capabilities; typed gap | T003, T014, T020, T024 |
| FR8 client caps off unless operator-enabled | T003, T031, T032, T033 |
| FR9 roots scoped to project/session | T006, T042 |
| FR10 paginated tools/list + cursor guards | T016, T027 |
| FR11 tools.listChanged refresh | T016, T027 |
| FR12 content types / structuredContent / outputSchema | T004, T021, T028 |
| FR13 one canonical adapter; presentation differs | T029, T038, T042 |
| FR13a annotations untrusted unless elevated | T005, T021, T044 |
| FR14 progressToken supplied | T008, T026 |
| FR15 wire monotonic; UI coalesce no rewrite | T002, T026 |
| FR16 bounded progress; Process Table child; not LLM | T026 |
| FR16a progress via UI/EventBus/OTEL no content labels | T022, T026 |
| FR17 standard cancel notifications/cancelled | T019, T043 |
| FR18 task cancel tasks/cancel; root tree both | T019, T031, T043 |
| FR19 runtime resources via canonical adapter under Permission | T029 |
| FR20 operator resource admin via mcp.resource.admin.* | T034 |
| FR21 subscribe requires capability + operator grant; fail closed | T018, T029 |
| FR22 resources/list_changed refresh under permission | T029, T042 |
| FR23 resources/updated coalesce/dedupe/debounce + policy | T005, T017 |
| FR24 wake only under budget/admission; no turn per update | T017, T043 |
| FR25 URI scheme + root scope; no cross-project leak | T006, T029, T044 |
| FR26 resource_link lazy; auto-fetch under budget | T029 |
| FR27 prompts as runtime content under permission | T029, T042 |
| FR28 logging notifications redaction/rate limit; setLevel via 007 | T036 |
| FR29 Streamable HTTP session/reconnect/resume/Last-Event-ID | T015, T025 |
| FR30 stdio lifecycle no child leak | T015, T025 |
| FR31 legacy SSE compatible with deprecation | T015, T025 |
| FR32 OAuth/headers/secrets as Feature 007 refs | T030, T044 |
| FR33 OutputGroup per call/read; preview + OutputRef | T007, T028 |
| FR34 final content spooled; never a path | T028 |
| FR35 SDK RAM parse; post-parse spill; no zero-RAM | T024, T028 |
| FR36 base64 decode to spool; MIME/size limits | T006, T028 |
| FR37 offset/limit/cursor/follow app-side | T028, T039 |
| FR38 bounded EventV2 event set; no content/paths | T004, T008, T009 |
| FR39 Process Table child per call/task | T026, T031 |
| FR40 todo/evidence reference OutputRef; gate on settlement | T028, T031 |
| FR41 mcp.tasks default off; no tasks cap | T007, T031 |
| FR42 Tasks 2025-11-25 full surface | T031 |
| FR43 Tasks map to 002/005; not partial content | T031 |
| FR44 task cancel tasks/cancel vs notifications/cancelled | T019, T031 |
| FR45 sampling/elicitation/content-stream separate flags off | T007, T032, T033 |
| FR46 sampling no bypass Smart/budget/LangLock; permission | T032 |
| FR47 elicitation operator-surfaced; never silent | T033 |
| FR48 native mcp.* schemas; 30 IDs; Feature 007 register | T013, T034, T038, T039 |
| FR49 native slash pre-prompt zero tokens/transcript | T034, T038 |
| FR50 runtime LLM only via canonical adapter; no 007 IDs | T029, T034 |
| FR51 security controls (trust/scope/OAuth/SSRF/limits) | T021, T029, T030, T044 |
| FR52 MCP content external LangLock exemption | T021, T044 |
| FR53 semantic reindex opt-in + classification | T035 |
| FR54 spans connect..task | T022 |
| FR55 metrics bounded | T022 |
| FR56 no URI/content/call/session labels | T022, T044 |
| FR57 UI cards/state/OutputRef expand; no path | T039 |

| Acceptance | Tasks |
| ---------- | ----- |
| AC1 Streamable HTTP connect + record | T014, T025, T042 |
| AC2 stdio connect + cleanup | T015, T025, T042 |
| AC3 legacy SSE fallback deprecation | T015, T025, T042 |
| AC4 tools list_changed refresh | T016, T027, T040, T043 |
| AC5 progress UI not LLM; wire monotonic | T026, T042 |
| AC6 50MB result bounded preview | T028, T044 |
| AC7 standard call cancel notifications/cancelled | T019, T040, T043 |
| AC8 structuredContent/resource_link/audio | T021, T028, T029, T044 |
| AC9 resources subscribe/update/list_changed | T017, T018, T040, T043 |
| AC10 policy no wake | T017, T040, T043 |
| AC11 policy conditional wake | T017, T040, T043 |
| AC12 reconnect backoff/resume | T015, T020, T040, T042, T043 |
| AC13 OAuth secure refs | T030, T044 |
| AC14 canonical adapter parity | T029, T042, T045 |
| AC15 native admin zero tokens | T034, T045 |
| AC16 experimental flags default off | T031, T032, T033, T045 |
| AC17 sampling with permissions | T032, T045 |
| AC18 elicitation operator | T033, T045 |
| AC19 content-stream extension absent fallback | T033, T042, T045 |
| AC20 malicious resource / prompt injection | T006, T021, T044 |
| AC21 cross-project isolation | T029, T044 |
| AC22 OTEL content-free | T022, T044 |
| AC23 prompts list/get/list_changed | T029, T042 |
| AC24 logging notification + setLevel | T036, T045 |
| AC25 roots scope / no path overexposure | T006, T029, T042 |
| AC26 tool annotations untrusted | T021, T040 |
| AC27 LangLock external content | T021, T044 |
| AC28 Feature 006 semantic index opt-in | T035, T045 |
| AC29 operator vs runtime resource plane | T029, T034, T045 |
| AC30 Tasks CreateTaskResult and lifecycle | T031, T045 |
| AC31 task cancel tasks/cancel | T019, T031, T043 |
| AC32 tasks/status input_required | T031, T033, T045 |
| AC33 taskSupport forbidden | T031, T045 |

## Dependencies

Internal sequencing and cross-feature seams.

- **Phase order.** Phase 1 (T001–T013, schema/protocol) precedes Phase 2 (T014–T023, domain)
  precedes Phase 3 (T024–T037, application/adapters/operator) precedes Phase 4 (T038–T039,
  CLI/TUI) precedes Phase 5 (T040–T046, tests). The barrels (T010, T023, T037) gate their
  package's downstream tasks.
- **Additive-first migration (C27).** The reworked `packages/opencode/src/mcp/index.ts`,
  `catalog.ts`, and `auth.ts` are a **live** `MCP.Service` with many consumers (the tool registry
  via `tools()`, code-mode `describeCatalog`, the `list_mcp_resources`/`read_mcp_resource` runtime
  tools). Sequence: the new ports/schemas/domain (T001–T023) land first and additive; the SDK
  probe (T024) fixes the substrate; the host rework (T025) delegates to the ports while keeping
  the seams shape-compatible; the catalog walker (T027) preserves `defs[server]`; the OAuth
  cutover (T030) keeps config surfaces backward-compatible. The consumer-compatibility regression
  suite is **T045** (seam-shape) and **T042** (adapter parity); no cutover ships without them green.
- **Rename migration (T011).** `mcp.tools.changed` → `mcp.tools_changed` touches
  `packages/schema/src/mcp-event.ts`, `packages/opencode/src/mcp/index.ts`, and the generated
  `packages/sdk/js/src/v2/gen/types.gen.ts` (regenerate, do not hand-edit); the Feature 009
  reindex consumer reads the single spelling. T011 depends on the new durable member (T008/T009).
- **Reconciliation (T012, T041).** The `protocol/mcp` port module sources enums from the schema
  modules; T041 pins the 15-member / 10-durable-5-live parity across CUE, schema, protocol, and
  `data-model.md`, with `mcp.call.cancel_requested` live and no `mcp.subscription.fail_closed`
  event member.
- **Cross-feature seams.** EventV2 + durable manifest for the ten durable `mcp.*` members
  (T009, T037; `packages/schema/src/durable-event-manifest.ts` + `packages/opencode/src/
  event-v2-bridge.ts`, both already in scope); Feature 002 Process Table child + cancel root tree
  (T019, T026, T031); Feature 005 OutputSpool for every call/read and for C16/C17 spill (T028);
  Feature 007 SecretPort/PermissionV2/Config.Service + the reserved catalog's 30 `mcp.*` IDs at
  1.3.0 (T013, T030, T034 — **no bump**); Feature 001 Smart/budget/LangLock for sampling and the
  content-free telemetry allowlist (T022, T032); Feature 003 admission for the conditional wake
  (T017); Feature 006 semantic stack for the opt-in reindex consumer (T035); Feature 009 consumes
  the durable `mcp.tools_changed` (T011, T027).
- **Honest-provenance seams.** The live LLM sampling callback (T032) and the live Feature 006
  reindex consumer (T035) are delivered as module + tests + a documented wiring point per the
  langlock/semantic injection-seam precedent; each may be an unreachable path in V1 until the
  owning feature (001 session runtime / 006 stack) wires it, and its acceptance is the seam test,
  not a live end-to-end call.
