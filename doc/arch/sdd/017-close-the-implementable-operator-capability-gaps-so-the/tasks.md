# Tasks: Close the Implementable Operator Capability Gaps (Feature 017)

Synced with plan.md (Phase 1 operator-TUI editing FIRST, Phase 2 MCP live reads,
Phase 3 MCP mutations, Phase 4 OutputSpool writer + reads, Phase 5 OutputSpool
admin edge, Phase 6 jobs projection, Phase 7 Milvus binding, Phase 8 availability
flip + deferred gaps + repo health, Phase 9 tests + guard + doc sync) and the
specScopeGlobs in doc/arch/speckit.toml. ADR-0017 proposed.

Wiring + TUI-editing ONLY. NO new catalog id, NO catalog version bump, NO new
dispatch path, NO new flag — the Feature 007 registration + `OperatorClient`
loopback parity invariant (FR17) is preserved. Config-backed mutations commit
through `mutateAuthority` under CAS; the OutputSpool admin edge commits through a
store-scoped authority (never a fabricated config CAS version); every read/mutation
honest-degrades to a typed envelope (FR18). The executor (`jobs.run-now`), lifecycle
forced-abort (`cancel`), interactive-OAuth, and Smart Routing edges stay typed
capability gaps (FR16). No code is executed in this documentary pass; tasks are the
implement backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below). Group A (TUI editing) is FIRST —
the user's burning pain on every screen.

- [x] T001 — Extend the edit descriptor from one field to an ordered field list
- [x] T002 — Render the multi-field edit modal (per-field validation, enum pickers)
- [x] T003 — Compose the byte-exact payload, single dispatch, in-modal error
- [x] T004 — `pools.set` bindings-list editor
- [x] T005 — `routing.configure` structured sub-form + advanced-JSON fallback
- [x] T006 — Detail view tree renderer (distinct from the compact status strip)
- [x] T007 — MCP `liveServerPort` over `MCP.Service.status()`/`clients()`
- [x] T008 — Convert config-backed MCP mutations to the `mutation_plan` contract
- [x] T009 — Live-service MCP action plans (`connect`/`disconnect`/`reconnect`)
- [x] T010 — MCP auth headless verdict (`start`/`finish` gap; `remove` convert)
- [ ] T011 — OutputSpool production writer at the session message-part seam
- [ ] T012 — `output.stat`/`read` reflect the populated control store
- [ ] T013 — `output.follow` cursor-codec seam
- [ ] T014 — `output.release`/`delete`/`purge` store-scoped admin edge
- [ ] T015 — Jobs occurrence projection over `EventV2Bridge` + bounded watch
- [ ] T016 — Milvus registry binding when an endpoint is configured
- [ ] T017 — Palette availability flip (MCP/output → persists_today/partial)
- [ ] T018 — Keep deferred edges typed gaps + git-ignore `config.json`
- [ ] T019 — TUI editing tests (multi-field modal + detail tree)
- [ ] T020 — MCP tests (reads + `mutation_plan` + no-phantom-write + live action)
- [ ] T021 — OutputSpool tests (writer + reads + admin edge)
- [ ] T022 — Jobs + Milvus tests
- [ ] T023 — Availability + parity tests (FR17)
- [ ] T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green

---

## Group A — Operator TUI editing: multi-field modals + detail view tree (FR19-FR23) — FIRST

- [x] **T001 — Extend the edit descriptor from one field to an ordered field list**
- **Depends:** none
- **Paths:** `packages/tui/src/operator/form/edit-descriptor.ts`, `form/descriptor.ts`
- **Deliverable:** grow the Feature 015 single-field `OperatorEditPrefill` (`extract`
  → one string) into an ordered `EditFieldList` per payload-carrying Configure verb —
  one labeled field per payload property (`#EditField`: key, label, kind, required,
  optional `SecretRef`), each pre-filled from the read the descriptor already issues,
  enum properties typed as `picker`. Secret-bearing fields are never pre-filled from a
  resolved value (FR19, FR21, schema `operator-capability-gaps/editform.cue`).
- **Acceptance:** each covered verb resolves an ordered field list; a secret field
  carries no resolved value; a verb absent from the registry keeps the honest empty
  behavior.
- **Verification:** `bun test packages/tui/test/operator/**`; `bun run typecheck`.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/form/field-list.ts` new
  `EditField`/`EditFieldListDescriptor` + `resolveOperatorFieldList` registry covering
  telemetry.configure / budget.set / pools.set / routing.configure / mcp.server.add+update /
  output.retention.set / output.quota.set / jobs.create+update / semantic.provider.add+update;
  secret fields (`field-list.ts:283,325` secretRef) carry no `prefill`. Tests
  `packages/tui/test/operator/multi-field.test.ts` (T001 blocks) green; tui + core typecheck clean.

- [x] **T002 — Render the multi-field edit modal (per-field validation, enum pickers)**
- **Depends:** T001
- **Paths:** `packages/tui/src/operator/form/edit-modal.tsx`, `form/index.tsx`
- **Deliverable:** render the ordered field list in the modal — one labeled input per
  field, enum properties as pickers, per-field validation — keeping the Feature 015
  modal contract unchanged (title, in-modal error, busy state, Save/Cancel, `esc`).
  Replaces the single-field raw-JSON prompt (FR19).
- **Acceptance:** `telemetry.configure` opens a labeled endpoint field + transport
  picker (not a raw JSON prompt); an invalid field shows an in-modal error; the modal
  contract is unchanged.
- **Verification:** `bun test packages/tui/test/operator/modal.test.ts`.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/form/multi-field-modal.tsx`
  `MultiFieldForm` renders the ordered list (one `<input>`/`<textarea>` per text field,
  enum properties as `DialogSelect` pickers, toggles, bindings editor) with a silent
  pre-fill read, per-field validation, in-modal error, busy state, `esc`/Save, unchanged
  Feature 015 modal contract. Wired via `dialog-settings.tsx onSelectSetting` +
  `entity-screens.tsx` create/edit ahead of the single-field path. `modal.test.ts`
  (Feature 015) + `multi-field.test.ts` green; full tui suite 500/500.

- [x] **T003 — Compose the byte-exact payload, single dispatch, in-modal error**
- **Depends:** T002
- **Paths:** `packages/tui/src/operator/form/**`
- **Deliverable:** on Save compose exactly the port-contract payload — byte-exact keys
  (the Feature 014 lesson: not a naive `{ [field.key]: rawText }` spread) — and
  dispatch ONCE through `executeOperatorCommand`. A payload the form cannot compose,
  or a per-field validation failure, surfaces an **in-modal error**, never a global
  toast (FR20).
- **Acceptance:** Save composes the exact typed payload and dispatches once; a
  non-composable payload stays in-modal (no global toast).
- **Verification:** `bun test packages/tui/test/operator/dispatch.test.ts`.
- **Evidence:** 2026-07-19 — `field-list.ts composePayload` + per-verb `compose`
  build byte-exact payloads (the 014 lesson: `mcp.server.add` → `{name,transportKind,endpoint}`,
  NOT `{id,url,transport}`; budget nests under `limits`; update verbs nest under `patch`;
  CAS `expectedVersion` rides the existing dispatch preflight, not hand-composed).
  `MultiFieldForm.submit` composes once and dispatches once through `executeOperatorCommand`
  (silent); a required/parse/JSON failure sets the in-modal error, never a toast. Tests
  `multi-field.test.ts` (byte-exact compose per verb + single-dispatch spy on pools.set +
  in-modal error paths) green.

- [x] **T004 — `pools.set` bindings-list editor**
- **Depends:** T003
- **Paths:** `packages/tui/src/operator/form/**`
- **Deliverable:** a bindings-list editor managing an ordered list of `{role, models}`
  rows — role picker/text over the known role vocabulary; models a bounded add/remove
  list of model-id entries — pre-filled from `pools.show`/`status` `bindings`, with
  add-binding/remove-binding actions inside the modal. Save composes exactly
  `{bindings:[{role,models}], expectedVersion}` (`pools-command-port.ts:77`
  `parseBindings`; `packages/protocol/src/pools/commands.ts` `PoolsSetInput`) and
  dispatches once (FR22).
- **Acceptance:** the editor pre-fills from current bindings, adds/removes rows, and
  composes the exact `{bindings, expectedVersion}` payload; the previous global
  `requires a bindings array of { role, models }` toast is gone (surfaced in-modal if
  incomposable).
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — `field-list.ts` `bindings_list` field + `prefillBindings`
  (from `pools.show` effective) + `composeBindingsPayload` → exactly `{bindings:[{role,models}]}`
  (blank-role rows dropped, model ids trimmed). `multi-field-modal.tsx` `BindingsEditor` +
  `BindingRowEditor` add/remove binding rows and add/remove model entries in-modal; a
  non-composable payload surfaces in-modal. The old `requires a bindings array` global toast
  path is bypassed. Tests `multi-field.test.ts` (T004 block: prefill, add/remove flows,
  compose, single dispatch) green.

- [x] **T005 — `routing.configure` structured sub-form + advanced-JSON fallback**
- **Depends:** T003
- **Paths:** `packages/tui/src/operator/form/**`
- **Deliverable:** because the routing policy is a large document, render a structured
  sub-form for the common fields (`enabled` toggle, `mode` picker) plus an explicit
  labeled **advanced JSON field** carrying the remaining policy/`budgetPolicy`
  document — never a bare unlabeled JSON prompt as the only path (FR21, ADR-0017).
  Where the `routing.configure` port persistence is a documented backend boundary,
  the modal still replaces the raw prompt and surfaces the typed outcome in-modal.
- **Acceptance:** `routing.configure` opens the structured common fields + a labeled
  advanced JSON field; no bare unlabeled JSON prompt path remains.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — `field-list.ts` `routing.configure` descriptor: `enabled`
  toggle + `mode` picker (`always`/`auto`/`never`, verbatim `RoutingConfig.RoutingMode`) +
  labeled `advanced_json` field; `compose` spreads the advanced policy over the structured
  fields. Confirmed the `routing.configure` port is an unconditional `not_implemented`
  documented boundary (`routing/adapters/inbound/routing-command-port.ts`) — the modal
  replaces the raw prompt and surfaces the typed outcome in-modal. Tests `multi-field.test.ts`
  (T005 block) green.

- [x] **T006 — Detail view tree renderer (distinct from the compact status strip)**
- **Depends:** none
- **Paths:** `packages/tui/src/operator/status.ts`, `packages/tui/src/operator/**` (view modal)
- **Deliverable:** a new detail-tree renderer for the view modal that expands records/
  arrays to a bounded depth (~4) + bounded total rows, with an honest `... N more`
  truncation marker; scalars render verbatim under the existing string cap; NO
  `{n}`/`[n]` count placeholder appears within the bound. Kept DISTINCT from the
  compact strip (`toStatusNodes`/`formatStatusValue`, `status.ts:46-62`), which stays
  unchanged. Applies to detail verbs, probe results (`telemetry.test` `target`), and
  entity item views (FR23, schema `#DetailTree`).
- **Acceptance:** `telemetry.test` `target` expands to `endpoint`/`transport` in the
  view modal (not `{2}`); depth/row bounds truncate with `... N more`; the inline
  status strip keeps its compact `{n}` summary.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — `status.ts` new `toDetailTree`/`OperatorDetailRow`
  (`MAX_DETAIL_DEPTH=4`, `MAX_DETAIL_ROWS=200`): records/arrays expand indented; a
  depth-bound or row-budget overflow collapses to an honest `… N more` marker (never a
  `{n}` within the bound); scalars verbatim under the shared string cap. The compact strip
  (`toStatusNodes`/`formatStatusValue`/`toStatusGroups`) is UNCHANGED. `form/view-modal.tsx`
  renders the tree with per-row indentation. Tests `multi-field.test.ts` (T006 block:
  `telemetry.test` target expansion vs strip `{2}`, depth collapse, row-budget truncation)
  green.

---

## Group B — MCP live reads (FR1, FR2)

- [x] **T007 — MCP `liveServerPort` over `MCP.Service.status()`/`clients()`**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/mcp/backend-live.ts`, `operator/stack-live.ts`
- **Deliverable:** add a `liveServerPort` to `createMcpServiceOverride`
  (`mcp/backend-live.ts:186`) reading `MCP.Service.status()` (`mcp/index.ts:165`) +
  `clients()` (`:166`) and projecting each server onto `{serverId, connection status,
  capabilities-present}` (`#LiveServerRead`), backing `mcp.server.list`/`status`/
  `capabilities`. SSOT-only fields (CAS version, `auditId`, trust profile, timestamps)
  stay absent — never fabricated; guarded reads degrade to typed `mcp_unavailable`
  (FR1, FR2). Inject over `MCP.Service` in the composition root.
- **Acceptance:** `mcp.server.list`/`status` reflect the live connection status +
  capabilities-present; no SSOT-only field is fabricated; an unbound service degrades
  to `mcp_unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — `mcp-port.ts` new `McpLiveServerReader`/`LiveServerRead`
  (content-free: `serverId`, `connectionStatus`, `transportPresent`, `capabilitiesPresent`);
  `backend-live.ts:liveServerReader` projects `MCP.Service.status()` + `clients()`
  (`McpLiveServerSource`) and degrades to typed `mcp_unavailable` via `guardedLiveRead`.
  `mcp-command-port.ts` routes `mcp.server.list`/`status`/`capabilities` to `port.liveServer`
  when bound. Wired in `stack-live.ts` (`mcpLiveServers` over `svc.status()`/`svc.clients()`,
  `client.transport != null` / `getServerCapabilities() != null`). Tests
  `test/operator/mcp-service-backend.test.ts` "T007" block: list/status projection, no SSOT
  field (`version`/`auditId`/`trustProfile`/timestamps absent), unbound → `mcp_unavailable`
  no-leak. `bun test test/operator/` 394 pass / 2 skip; `bun run typecheck` clean.

---

## Group C — MCP mutations (FR3, FR4, FR5)

- [x] **T008 — Convert config-backed MCP mutations to the `mutation_plan` contract**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/mcp/**`, `operator/application/handler.ts`
- **Deliverable:** convert the config-backed MCP verbs (`server.add`/`update`/`delete`,
  `logging.level.set`, `experimental.enable`/`disable`, `extension.enable`/`disable`,
  `resource.admin.policy.set`) to return a validated `OperatorMutationPlan` over the
  `store.config` MCP authority (the `telemetry-command-port.ts` `runPlan` + Feature 014
  conversions are the template) so `mutateAuthority` owns the single committed CAS
  write + audit correlation — eliminating the phantom-write trap
  (`mcp/backend-live.ts:128-135`). Reads unchanged (FR3).
- **Acceptance:** a config-backed MCP mutation commits through `mutateAuthority`; a
  stale CAS yields `version_conflict` with no phantom write; no self-committed `query`
  is rejected after a write.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — `mcp-port.ts` new `McpMutationBackend`/`McpMutationError` +
  input types; `backend-live.ts:createMcpMutations` returns validated `OperatorMutationPlan`s
  over the `store.config` authority `"global:mcp"` — `planServerAdd`/`update`/`delete`/
  `disable`, `planLoggingSet`, `planExperimentalToggle`, `planExtensionToggle`,
  `planResourcePolicySet` (pure `apply` transforms `{servers}` doc; `requireServer` reads
  current → typed `not_found`, so a rejection is BEFORE any plan). `mcp-command-port.ts`
  new `planRunner`/`mutationInvoke` (routed first) audits only on failure; the FR5 phantom
  trap (`kind:"query"` for a `mutates` descriptor) is eliminated. **FIXED the latent port
  bug**: `mcp-command-port.ts:151` default `"streamable_http"` → `"streamable-http"` (the
  only valid `TransportKind` streamable member), pinned by the transportKind-validity test.
  Wired in `stack-live.ts` (`mutations: { config: store.config, ... }`). Tests "T008" blocks:
  add/logging/experimental round-trip via `dispatchRequest → mutateAuthority`, re-read of
  `config.get("global:mcp")`; invalid transportKind + absent-server `not_found` write NOTHING.

- [x] **T009 — Live-service MCP action plans (`connect`/`disconnect`/`reconnect`)**
- **Depends:** T008
- **Paths:** `packages/opencode/src/operator/mcp/**`
- **Deliverable:** dispatch the live-service MCP actions as `OperatorMutationPlan`s
  whose `apply` calls the live `MCP.Service` connection APIs (`mcp/index.ts`),
  returning an honest typed outcome (`success` reflecting the resulting `Status`, or a
  typed `mcp_unavailable`/`invalid_argument` gap). No self-committed `query`, no
  phantom write (FR4).
- **Acceptance:** `mcp.server.reconnect` reflects the live resulting `Status`; an
  unbound service degrades to `mcp_unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — `backend-live.ts:createMcpMutations` `planConnect`/`planDisconnect`/
  `planReconnect` run the live `McpLiveActions` op (`liveActionPlan`) then record the resulting
  status under the store-scoped authority `"global:mcp-connections"`; a `not_found` outcome
  or unbound service fails BEFORE any plan (no phantom write). `stack-live.ts:mcpLiveActions`
  binds `MCP.Service.connect`/`disconnect` (reconnect = disconnect ▸ connect), reads back
  `svc.status()`, maps `MCP.NotFoundError` → `not_found`. Note (design): `apply` is a pure sync
  transform, so the live op executes at plan time and `apply` records the resulting `Status` —
  a rejection returns a typed failure (no config write). Tests "T009" block: connect/disconnect
  record status; `missing` → no write; no-actions → typed `unavailable`.

- [x] **T010 — MCP auth headless verdict (`start`/`finish` gap; `remove` convert)**
- **Depends:** T008
- **Paths:** `packages/opencode/src/operator/mcp/**`, `packages/opencode/src/mcp/index.ts` (read-only)
- **Deliverable:** confirm the `McpAuth` API surface. `auth.start`/`finish` stay typed
  capability gaps (interactive OAuth cannot run headless through the operator
  loopback); `auth.remove`, a local credential clear, converts to the `mutation_plan`
  contract IF `McpAuth` exposes a clear/delete API. Record the final split in this
  file's Evidence (FR5, ADR-0017).
- **Acceptance:** `auth.start`/`finish` return the typed gap; `auth.remove` either
  commits through `mutateAuthority` or is documented as a gap with the reason — never
  a fabricated success.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — **Confirmed `McpAuth` surface** (`packages/opencode/src/mcp/auth.ts:45`):
  `McpAuth.Service` exposes `remove(mcpName): Effect<void>` (a real local credential clear),
  and `MCP.Service.removeAuth(mcpName)` (`mcp/index.ts:965`) wraps it (clears the auth entry,
  cancels pending OAuth, deletes stored transports). **Auth split (ADR-0017 verdict):**
  `auth.remove` CONVERTS — `backend-live.ts:createMcpMutations.planAuthRemove` runs the injected
  `McpAuthClear` (`stack-live.ts:mcpAuthClear` over `svc.removeAuth`) then records the outcome
  under the store-scoped authority `"global:mcp-auth"`; unbound → typed `mcp_unavailable`, no
  fabricated success. `auth.start`/`finish` STAY typed gaps (interactive OAuth cannot run
  headless through the operator loopback — the live flow needs a browser redirect + callback
  server; `liveAuthPort.start`/`finish` remain `Effect.fail`). Tests "T010" block: `auth.remove`
  clears + records; `auth.start` → typed `unavailable`.

---

## Group D — OutputSpool production writer + reads (FR6, FR7, FR8, FR10)

- [ ] **T011 — OutputSpool production writer at the session message-part seam**
- **Depends:** none
- **Paths:** `packages/opencode/src/session/**`, `packages/opencode/src/outputspool/**`,
  `packages/opencode/src/operator/outputspool/**`
- **Deliverable:** subscribe a production writer at the session message-part seam
  (`session/message-v2.ts` `PartUpdated`/`PartDelta`, `session.ts`, `processor.ts`)
  driving `createChannelWriter` (`outputspool/file-sink-writer.ts:139`) per channel
  generation, writing to the SAME control store the operator reads
  (`operator-control.db`, `stack-live.ts:413-428`). Honor the Feature 005 producer
  ownership (C21), content-free events (C22), bounded memory, and stale-generation
  fencing; seal/abort on cancel preserving committed bytes. REUSE the `outputspool/`
  machinery; do not re-author it (FR6, FR10, statechart `output-spool-writer.md`).
- **Acceptance:** a session's output populates the control store the operator reads;
  bounded memory; a stale generation's append/seal is fenced; cancel seals/aborts
  preserving committed bytes; no content byte on any event.
- **Verification:** `bun test packages/opencode/test/outputspool/** packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T012 — `output.stat`/`read` reflect the populated control store**
- **Depends:** T011
- **Paths:** `packages/opencode/src/operator/outputspool/backend-live.ts`
- **Deliverable:** with the store populated, `output.stat`/`read` project real session
  output over `control-store.ts` + `page-reader.ts`, replacing the empty-store gap
  (FR7). Guarded reads degrade to typed `unavailable` when the store is unbound.
- **Acceptance:** `output.stat`/`read` reflect real output; an unbound store degrades
  to a typed gap.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T013 — `output.follow` cursor-codec seam**
- **Depends:** T012
- **Paths:** `packages/opencode/src/operator/outputspool/backend-live.ts`
- **Deliverable:** bind `output.follow`'s cursor-codec seam
  (`outputspool/backend-live.ts:103`, `FOLLOW_GAP`) so a follower streams committed
  pages from the populated store; a slow follower sees the Feature 005 backpressure/
  `eof` semantics, never blocking the writer (FR8).
- **Acceptance:** `output.follow` streams committed pages with bounded backpressure/
  `eof`; it never blocks the writer.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

---

## Group E — OutputSpool admin edge (FR9)

- [ ] **T014 — `output.release`/`delete`/`purge` store-scoped admin edge**
- **Depends:** T012
- **Paths:** `packages/opencode/src/operator/outputspool/**`, `operator/application/handler.ts`
- **Deliverable:** wire `output.release`/`delete`/`purge` (`backend-live.ts:100-102`,
  `CONTROL_STORE_ONLY`) through a control-store admin port whose plans ride the
  `OperatorMutationPlan` contract but commit through a **store-scoped authority**: the
  `apply` performs the control-store op and emits the Feature 007 audit correlation,
  and the settled version is the control-store generation, NOT a fabricated config CAS
  version — preserving the audit + no-phantom-write invariants (FR9, ADR-0017).
- **Acceptance:** `release`/`delete`/`purge` act on the real control store; the audit
  is emitted; no config CAS version is fabricated; the deny-by-default export/share
  guard is preserved.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

---

## Group F — Jobs occurrence projection (FR11, FR12)

- [ ] **T015 — Jobs occurrence projection over `EventV2Bridge` + bounded watch**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/jobs/backend-live.ts`
- **Deliverable:** project the durable `job.*` occurrence events for `jobs.history`/
  `show-occurrences`/`watch` (`jobs/backend-live.ts:59-62`) through the same
  `EventV2Bridge.Service` seam the lifecycle domain uses
  (`lifecycle/stack-wiring.ts:180-259`), returning the bounded, content-free
  occurrence read model; `jobs.watch` opens a **bounded**, closable subscription and
  degrades to typed `unavailable` when the bridge is unbound (FR11, FR12). No new store
  or executor.
- **Acceptance:** `jobs.history`/`show-occurrences` project real occurrence events;
  `jobs.watch` is bounded + closable; an unbound bridge degrades to a typed gap.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

---

## Group G — Milvus registry binding (FR13, FR14)

- [ ] **T016 — Milvus registry binding when an endpoint is configured**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/semantic/backend-live.ts`, `operator/stack-live.ts`
- **Deliverable:** bind an `override.index`/`override.provider` over
  `semantic/milvus-adapter.ts` in `createLiveSemanticBackend` WHEN a Milvus endpoint
  is configured (the Feature 006/009 config shape), backing `semantic.index`/`validate`/
  `reindex`/`cutover` under bounded gRPC probes (`semantic/grpc-probe.ts`,
  `url-guard.ts`); unconfigured degrades to the same typed `milvus_unavailable` gap.
  Semantic stays a mixed domain; no fabrication (FR13, FR14).
- **Acceptance:** with an endpoint configured, the index verbs bind over the live
  adapter under a bounded probe; with none configured they return
  `milvus_unavailable`; no endpoint/credential leaks.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

---

## Group H — Availability flip + deferred gaps + repo health (FR15, FR16, FR18)

- [ ] **T017 — Palette availability flip (MCP/output → persists_today/partial)**
- **Depends:** T007, T008, T012, T014
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** update `OPERATOR_PERSISTING_DOMAINS`/`OPERATOR_PERSISTING_VERBS`/
  `persistenceFor`/`domainBadge` so the now-working MCP + output verbs flip from
  `honest_unavailable` to `persists_today` (or the domain to `Partial` where it stays
  mixed). No verb advertises persistence it still lacks; no verb that now works reads
  as `unavailable` (FR15).
- **Acceptance:** the grouped menu shows the flipped MCP/output verbs truthfully; a
  still-gapped verb keeps `honest_unavailable`.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T018 — Keep deferred edges typed gaps + git-ignore `config.json`**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/**`, `packages/opencode/.gitignore`
- **Deliverable:** confirm `jobs.run-now` (Feature 002 executor composition —
  `jobs/trigger-service.ts:122-131` never composed), the lifecycle process/task
  forced-abort `cancel` (`SessionRunCoordinator`, `run-coordinator.ts:14`, not exposed
  to the operator `AppRuntime`; first-press cancel already real via
  `stack-wiring.ts:291-295`), and the Smart Routing consumption edge stay typed
  capability gaps (FR16). Ensure `packages/opencode/config.json` is git-ignored (FR18).
- **Acceptance:** the deferred verbs return typed gaps; `git check-ignore
  packages/opencode/config.json` matches.
- **Verification:** `bun test packages/opencode/test/operator/**`; `git check-ignore packages/opencode/config.json`.
- **Evidence:** _(implement)_

---

## Group I — Tests + guard scope + doc sync (FR17)

- [ ] **T019 — TUI editing tests (multi-field modal + detail tree)**
- **Depends:** T001, T002, T003, T004, T005, T006
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** test the multi-field modal render/pre-fill/validation per covered
  verb; the byte-exact payload composition + single dispatch + in-modal error; the
  `pools.set` bindings editor; the `routing.configure` structured + advanced-JSON; and
  the detail tree bounded-depth/rows + `... N more`, distinct from the compact strip
  (FR19-FR23).
- **Acceptance:** all TUI editing behaviors pass; the compact strip is unchanged.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T020 — MCP tests (reads + `mutation_plan` + no-phantom-write + live action)**
- **Depends:** T007, T008, T009, T010
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** test the live server reads over a `MCP.Service` double (no
  fabricated SSOT field); the config-mutation `mutation_plan` commit + a stale-CAS
  no-phantom-write case; the live-action plan; and the auth verdict split (FR1-FR5).
- **Acceptance:** all MCP behaviors pass; no phantom write on a stale CAS.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T021 — OutputSpool tests (writer + reads + admin edge)**
- **Depends:** T011, T012, T013, T014
- **Paths:** `packages/opencode/test/outputspool/**`, `packages/opencode/test/operator/**`
- **Deliverable:** test the writer subscribed at a message-part seam populating a real
  control store; stat/read/follow reflecting it; stale-generation fencing; seal/abort
  on cancel; and the admin edge committing through the store-scoped authority with
  audit + no fabricated config CAS version (FR6-FR10).
- **Acceptance:** all OutputSpool behaviors pass; content-free events; no phantom
  config write on the admin edge.
- **Verification:** `bun test packages/opencode/test/outputspool/** packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T022 — Jobs + Milvus tests**
- **Depends:** T015, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** test the occurrence projection over an `EventV2Bridge` double + the
  bounded closable watch; and the Milvus binding when configured + the
  `milvus_unavailable` gate when not (FR11-FR14).
- **Acceptance:** all jobs + Milvus behaviors pass; bounded watch; honest gate.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(implement)_

- [ ] **T023 — Availability + parity tests (FR17)**
- **Depends:** T017
- **Paths:** `packages/core/test/operator/**`, `packages/tui/test/operator/parity.test.ts`
- **Deliverable:** assert the palette availability flip is truthful; reuse the Feature
  007 parity harness to assert each wired verb rides the same command id / same
  loopback with no new dispatch path, no new catalog id, and no catalog version bump
  (FR17).
- **Acceptance:** availability is truthful; parity holds; no catalog id/version change.
- **Verification:** `bun test packages/core/test/operator/** packages/tui/test/operator/parity.test.ts`.
- **Evidence:** _(implement)_

- [ ] **T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green**
- **Depends:** T001-T023
- **Paths:** `doc/arch/speckit.toml`, `doc/arch/**`
- **Deliverable:** confirm the Feature 017 guard block covers every genuinely-new
  implement path (`packages/opencode/src/session/**`, `packages/opencode/.gitignore`,
  `packages/tui/src/operator/form/**`, `packages/tui/src/operator/status.ts`); keep the
  spec, ADR-0017, the `operator-capability-gaps/*.cue` corpus, and the
  output-spool-writer statechart in sync with the shipped shapes; run `speckit analyze`
  and `speckit validate --json` (FR17).
- **Acceptance:** `speckit analyze` clean of new Critical/High/Medium; `speckit
  validate --json` green (0 new findings on Feature 017 artifacts).
- **Verification:** `speckit analyze`; `speckit validate --json`.
- **Evidence:** _(implement)_

## Dependencies

- Group A (T001-T006) is FIRST and independent of the backend groups — it closes the
  user's burning TUI-editing pain and may proceed immediately.
- The MCP (T007-T010), OutputSpool (T011-T014), jobs (T015), and Milvus (T016) backend
  groups are mutually independent and may run in parallel after Group A.
- T017 (availability flip) depends on the reads/mutations/writer/admin edge landing
  (T007, T008, T012, T014).
- The test tasks (T019-T023) depend on their respective implementation tasks.
- T024 (guard + analyze + validate) depends on all prior tasks.
- External reused seams: `MCP.Service` + `McpAuth` (Feature 008), the `outputspool/`
  machinery (Feature 005), the `EventV2Bridge` durable seam (Feature 002/003), the
  `semantic/milvus-adapter` stack (Feature 006), and the Feature 015 edit-modal
  machinery — all already in the codebase; no new dependency is introduced.
