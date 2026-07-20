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
- [x] T011 — OutputSpool production writer at the session message-part seam
- [x] T012 — `output.stat`/`read` reflect the populated control store
- [x] T013 — `output.follow` cursor-codec seam
- [x] T014 — `output.release`/`delete`/`purge` store-scoped admin edge
- [x] T015 — Jobs occurrence projection over `EventV2Bridge` + bounded watch
- [x] T016 — Milvus registry binding when an endpoint is configured
- [x] T017 — Palette availability flip (MCP/output → persists_today/partial)
- [x] T018 — Keep deferred edges typed gaps + git-ignore `config.json`
- [x] T019 — TUI editing tests (multi-field modal + detail tree)
- [x] T020 — MCP tests (reads + `mutation_plan` + no-phantom-write + live action)
- [x] T021 — OutputSpool tests (writer + reads + admin edge)
- [x] T022 — Jobs + Milvus tests
- [x] T023 — Availability + parity tests (FR17)
- [x] T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green

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

- [x] **T011 — OutputSpool production writer at the session message-part seam**
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
- **Evidence:** 2026-07-19 — new `packages/opencode/src/session/output-spool-writer.ts`
  `createSessionSpoolWriter` + `subscribeSessionSpoolWriter`: subscribes the production
  writer to the session message-part seam via the `GlobalBus` fan-out (`@/bus/global`, the
  process-wide mirror of the `EventV2Bridge` stream `session.ts:639` `updatePart` publishes
  `message.part.updated` onto). `onPartUpdated` maps a part → channel (`deriveChannel`:
  text→assistant-text, reasoning→reasoning, completed tool→tool-result) and drives
  `FileSinkWriter.createChannelWriter` (`file-sink-writer.ts:139`) per channel generation
  (`groupId = partID`, one channel per part, C21), appending ONLY the growing byte suffix
  (bounded, monotonic). Writes to the SAME control store + spool root the operator reads
  (wired at `stack-live.ts` outputspool region over `outputControlStore`). Honors
  stale-generation fencing (`ControlStore.openGeneration` `accepted:false` → no append),
  seal/abort preserving committed bytes, content-free events (C22), and a bounded
  concurrent-writer cap. FAILS OPEN — every ingest is guarded and the `GlobalBus` listener
  swallows throws, so a spool write never breaks the session loop. Tests
  `test/operator/outputspool/feature017-outputspool-writer.test.ts` "T011" block (part→row,
  suffix-only append, reasoning/skip, tool seal, fencing, store-throw isolation) green;
  `bun test test/operator/ test/outputspool/` 499 pass / 2 skip; typecheck clean.

- [x] **T012 — `output.stat`/`read` reflect the populated control store**
- **Depends:** T011
- **Paths:** `packages/opencode/src/operator/outputspool/backend-live.ts`
- **Deliverable:** with the store populated, `output.stat`/`read` project real session
  output over `control-store.ts` + `page-reader.ts`, replacing the empty-store gap
  (FR7). Guarded reads degrade to typed `unavailable` when the store is unbound.
- **Acceptance:** `output.stat`/`read` reflect real output; an unbound store degrades
  to a typed gap.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — the Feature 014 `readerMethods` over the injected control
  store + `page-reader.ts` already project `stat`/`read`; T012 PROVES the round-trip
  end-to-end: `feature017-outputspool-writer.test.ts` "T012" block seeds bytes THROUGH the
  production writer (real `openBunSink` files under a temp spool root) and dispatches
  `output.stat`/`read` through the real dispatcher — `stat.committedBytes === 11`, `read`
  decodes back to `"hello world"`, `caughtUp` true. An unbound store keeps `output.stat` a
  typed `unavailable` gap. No backend code change needed beyond the writer populating the
  store; the empty-store gap is closed by real data.

- [x] **T013 — `output.follow` cursor-codec seam**
- **Depends:** T012
- **Paths:** `packages/opencode/src/operator/outputspool/backend-live.ts`
- **Deliverable:** bind `output.follow`'s cursor-codec seam
  (`outputspool/backend-live.ts:103`, `FOLLOW_GAP`) so a follower streams committed
  pages from the populated store; a slow follower sees the Feature 005 backpressure/
  `eof` semantics, never blocking the writer (FR8).
- **Acceptance:** `output.follow` streams committed pages with bounded backpressure/
  `eof`; it never blocks the writer.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — `outputspool/backend-live.ts` new `followMethod` binds the
  cursor-codec seam (replacing `FOLLOW_GAP`): an opaque `{ outputRef, offset }` cursor
  (base64url JSON, `encodeFollowCursor`/`decodeFollowCursor`) reads exactly one bounded
  `FOLLOW_PAGE_SIZE` (64 KiB) page through `page-reader.ts` over an INDEPENDENT read-only
  handle (never blocking the writer) and re-encodes the cursor at `page.next_offset`;
  `caughtUp`/`eof` follow the Feature 005 semantics. Bound behind `deps.enableFollow` (+
  store present) so an unbound seam stays a typed gap. `feature017-outputspool-writer.test.ts`
  "T013" block: a follower streams `"hello world"` then catches up with an empty page from
  the returned cursor; an invalid cursor → typed `invalid_argument`; unenabled → typed
  `unavailable`. `stack-live.ts` sets `enableFollow: outputControlStore !== undefined`.

---

## Group E — OutputSpool admin edge (FR9)

- [x] **T014 — `output.release`/`delete`/`purge` store-scoped admin edge**
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
- **Evidence:** 2026-07-19 — followed the MCP T009 recorded pattern (the store op runs at
  plan-build time, `apply` records the outcome, rejection = typed failure + no write).
  `outputspool-port.ts` adds `planRelease`/`planDelete`/`planPurge`
  (`Effect<OperatorMutationPlan, AdminError>`); `backend-live.ts` `adminMethods` runs the
  REAL control-store op — `release` = drop reference edges (`removeEdge`), `delete` =
  `deleteGeneration`, `purge` = `SessionSpoolWriter.removeChannelData` (on-disk bytes) +
  `deleteGeneration` — after `require(outputRef)` (a missing/store-outage record fails BEFORE
  any op, so NO phantom write). The plan's `apply` records `{ action, generation, committedBytes }`
  under the STORE-SCOPED authority `OUTPUT_ADMIN_AUTHORITY = "global:output-admin"`, so the
  settled version is the real control-store generation, never a fabricated config CAS version
  (FR9, ADR-0017). `outputspool-command-port.ts` routes `output.release`/`delete`/`purge` through
  `runPlan(port.planX)`, so `mutateAuthority` owns the single committed record + the Feature 007
  audit. Bound behind `deps.adminAuthority` (+ store) so an unbound edge stays a typed gap;
  export/share deny-by-default is UNCHANGED. `feature017-outputspool-writer.test.ts` "T014"
  block: `delete` removes the record + records generation 3; `release` drops the edge; a missing
  ref → typed `invalid_argument` with `config.get("global:output-admin") === null` (no phantom
  write); unbound authority → typed `unavailable`. `stack-live.ts` sets
  `adminAuthority: OUTPUT_ADMIN_AUTHORITY`. The Feature 014 `feature014-outputspool-wire.test.ts`
  gap assertions stay green (unbound follow/admin still degrade to `unavailable`).

---

## Group F — Jobs occurrence projection (FR11, FR12)

- [x] **T015 — Jobs occurrence projection over `EventV2Bridge` + bounded watch**
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
- **Evidence:** 2026-07-19 — new `packages/opencode/src/operator/jobs/occurrence-projection.ts`
  `createJobOccurrenceProjection` over a `JobOccurrenceSource` seam (`readAggregate` =
  `readDurablePage`, `subscribe` = `EventBus.subscribeBounded`) — the SAME seams
  `lifecycle/stack-wiring.ts:180-259` uses. It folds the durable `job.*` vocabulary
  (`STATE_BY_TYPE`) into one bounded `Occurrence` per occurrence id (latest state wins,
  terminal→outcome), projects notification events into redacted `NotificationEnvelope`s,
  and filters every event by `job_definition_id` (defence in depth); a malformed event is
  skipped (`parseEvent` returns null), never crashed on. `backend-live.ts:createLiveJobsBackend`
  gains `occurrences?`: `history`/`watch` route to the projection when bound (else stay the
  typed `unavailable` gap), and `show()` attaches `showOccurrences` to the persisted definition.
  `watch` filters + maps the bounded live stream (`Stream.map`/`filter`), degrading to
  `unavailable` when the bridge is unbound. Wired in `stack-live.ts` jobs region: resolve the
  `EventV2Bridge.Service` singleton once, bind `readDurablePage` (guarded → `unavailable`) +
  `EventBus.subscribeBounded` (capacity 1024). Tests `test/operator/feature017-jobs-milvus.test.ts`
  "T015" block (history fold + foreign-definition filter, bounded limit, notification projection,
  showOccurrences cap, bounded filtered watch via `Stream.runCollect`, unbound-bridge typed gap,
  show()-routes-through-projection) green. `bun test test/operator/` 421 pass / 2 skip; typecheck clean.

---

## Group G — Milvus registry binding (FR13, FR14)

- [x] **T016 — Milvus registry binding when an endpoint is configured**
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
- **Evidence:** 2026-07-19 — new `packages/opencode/src/operator/semantic/milvus-binding.ts`
  `createMilvusIndexPort(deps)` binds an `IndexPort` over the shipped Milvus stack under a
  BOUNDED probe (`MilvusEndpointConfig` = address/ssl/timeoutMs/secretRef; timeout hard-capped
  10s). Honest MIXED split (spec "readiness: mixed"): `index.test` runs the probe → the real
  `{ reachable, latencyMs }`; `status`/`reindex`/`reconcile`/`show-collections` run the SAME
  probe gate then return a typed `milvus_unavailable` (the full index-maintenance pipeline is not
  composed from the operator runtime — never a fabricated generation/count). A probe-seam outage
  or unreachable endpoint → typed `milvus_unavailable` with a bounded, secret-free reason (no
  address/credential/stack trace crosses the seam). `backend-live.ts:createLiveSemanticBackend`
  gains `milvus?`: when present `index` binds the port; when absent it stays the exact `indexGap`
  identity. Wired in `stack-live.ts` semantic region: resolve the endpoint from
  `OPENCODE_SEMANTIC_MILVUS_ADDRESS` (ssl on unless `_INSECURE=1`, `SecretRef` from `_SECRET_REF`);
  the live probe runs the shipped adapter health call (no gRPC client bound yet → honest
  `reachable:false`, never rejects). **FIXED the latent port bug**: `semantic-command-port.ts:160`
  `semantic.provider.add` residency default `"unrestricted"` (not a `ResidencyProfile` member,
  schema `enums-state.ts:49` = `local-offline|local|remote`) → `"remote"`, pinned by the T016
  binding tests + the full semantic suite. Tests `test/operator/feature017-jobs-milvus.test.ts`
  "T016" block (probe path when configured, maintenance verbs stay typed gap, unreachable degrades
  test + gates rest, probe-outage → typed gap with no secret leak, unconfigured degradation
  identity) green. Typecheck clean.

---

## Group H — Availability flip + deferred gaps + repo health (FR15, FR16, FR18)

- [x] **T017 — Palette availability flip (MCP/output → persists_today/partial)**
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
- **Evidence:** 2026-07-19 — `packages/core/src/operator/palette.ts` `OPERATOR_PERSISTING_VERBS`
  gains the 14 newly-real MCP mutations (server.add/update/delete/disable, connect/disconnect/
  reconnect, logging.level.set, experimental.enable/disable, extension.enable/disable,
  resource.admin.policy.set, auth.remove) + the 3 output admin-edge verbs (release/delete/purge),
  so `persistenceFor`/`domainBadge` flip mcp `Unavailable → Partial` and keep output `Partial`.
  The deferred gaps stay honest: auth.start/finish + resource.admin.subscribe/unsubscribe and
  output export/share are NOT added (still `honest_unavailable`); jobs.run-now stays inert via the
  TUI `entity.ts` `TYPED_GAP_IDS` (unchanged). MCP server reads + jobs history/show/watch are
  non-mutating → already `persists_today`. The now-real verbs cascade through the TUI palette
  consumers automatically (`entity.ts` folds palette availability), so mcp entity connect/
  disconnect/add + experimental/extension toggles are no longer inert. Tests: new
  `packages/core/test/operator/feature017-availability.test.ts` (mcp Partial, 14 real verbs
  persists_today, 4 gapped verbs honest, output release/delete/purge persist + export/share gated,
  every persisting verb rides a real catalog id — parity FR17); updated
  `feature014-availability.test.ts` + `palette-menu.test.ts` (mcp → Partial, output admin edge),
  `screen-controls.test.ts` (mcp toggles real), tui `entity.test.ts` (mcp actions real). core 118
  pass / tui 175 pass / 0 fail; typecheck clean.

- [x] **T018 — Keep deferred edges typed gaps + git-ignore `config.json`**
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
- **Evidence:** 2026-07-19 — deferred edges confirmed still typed gaps (matches the boundary list):
  `jobs.run-now` (`jobs/backend-live.ts:planRunNow` → `Effect.fail(unavailable(...))`, unchanged;
  TUI `entity.ts TYPED_GAP_IDS` keeps it inert); the lifecycle forced-abort `cancel`
  (`lifecycle/stack-wiring.ts:283-289` `rootInterruptor` records unavailability, first-press cancel
  real, unchanged); the Smart Routing consumption edge (untouched — repo rule). The T015 jobs
  projection + T016 Milvus binding introduce NO catalog id and NO dispatch path; the persisting-set
  additions all ride existing catalog ids (`feature017-availability.test.ts` "parity" asserts every
  `OPERATOR_PERSISTING_VERBS` entry ∈ `RESERVED_CATALOG.entries`, and the catalog `version` is
  unchanged). `packages/opencode/.gitignore:12` already carries `config.json` and
  `git check-ignore packages/opencode/config.json` matches (IGNORED-OK). `/Users/farchanjo/bin/speckit
  validate --json` → `ok:true` (only 4 pre-existing waived hygiene warnings, none on Feature 017).

---

## Group I — Tests + guard scope + doc sync (FR17)

- [x] **T019 — TUI editing tests (multi-field modal + detail tree)**
- **Depends:** T001, T002, T003, T004, T005, T006
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** test the multi-field modal render/pre-fill/validation per covered
  verb; the byte-exact payload composition + single dispatch + in-modal error; the
  `pools.set` bindings editor; the `routing.configure` structured + advanced-JSON; and
  the detail tree bounded-depth/rows + `... N more`, distinct from the compact strip
  (FR19-FR23).
- **Acceptance:** all TUI editing behaviors pass; the compact strip is unchanged.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-19 — the coverage landed alongside each Group A task (T001-T006
  evidence above) rather than as a separate end-of-phase pass: `packages/tui/test/operator/
  multi-field.test.ts` carries the T001-T005 blocks (field-list resolution, per-field
  validation/enum pickers, byte-exact compose + single-dispatch spy + in-modal error,
  bindings-list editor add/remove/compose, routing structured+advanced-JSON) and
  `packages/tui/test/operator/status.test.ts` carries the T006 detail-tree block
  (`telemetry.test` target expansion vs the compact `{2}` strip, depth collapse, row-budget
  `… N more` truncation, compact-strip non-regression). `modal.test.ts` (Feature 015 modal
  contract: title/in-modal error/busy/Save-Cancel/esc) stays green, unchanged. This task
  closes as a verification pass, not new authorship: `cd packages/tui && bun test
  test/operator/` → 175 pass / 0 fail across 13 files (1646 `expect()` calls), re-confirmed
  2026-07-19.

- [x] **T020 — MCP tests (reads + `mutation_plan` + no-phantom-write + live action)**
- **Depends:** T007, T008, T009, T010
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** test the live server reads over a `MCP.Service` double (no
  fabricated SSOT field); the config-mutation `mutation_plan` commit + a stale-CAS
  no-phantom-write case; the live-action plan; and the auth verdict split (FR1-FR5).
- **Acceptance:** all MCP behaviors pass; no phantom write on a stale CAS.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — `packages/opencode/test/operator/mcp-service-backend.test.ts`
  carries the full block set: `describe("T007 — mcp.server.list/status/capabilities project
  the live host (no fabricated SSOT field)")`, `describe("T008 mcp service backend — faithful
  live reads via the DomainInvoke")` + `describe("T008 — config-backed mcp mutations commit
  through mutateAuthority + round-trip")` + `describe("T008 — no phantom write: a rejected
  config-backed mutation persists NOTHING (FR5)")`, `describe("T009 — live-service action
  plans (connect/disconnect/reconnect)")`, `describe("T010 — auth split: remove converts to a
  mutation, start/finish stay typed gaps")`. The fix-round's stale-CAS/no-phantom-write and
  preflight-authority-resolution regressions are covered separately by
  `packages/opencode/test/operator/feature017-fixround.test.ts` (FR-1/FR-2 blocks: a 2nd
  `mcp.server.connect` without the right CAS token does not re-run the live op; two
  consecutive `mcp.server.add` calls succeed through the real dispatcher with the
  preflight-threaded CAS token). Verification: `cd packages/opencode && bun test
  test/operator/` → 429 pass / 2 skip / 0 fail across 42 files (2655 `expect()` calls),
  re-confirmed 2026-07-19.

- [x] **T021 — OutputSpool tests (writer + reads + admin edge)**
- **Depends:** T011, T012, T013, T014
- **Paths:** `packages/opencode/test/outputspool/**`, `packages/opencode/test/operator/**`
- **Deliverable:** test the writer subscribed at a message-part seam populating a real
  control store; stat/read/follow reflecting it; stale-generation fencing; seal/abort
  on cancel; and the admin edge committing through the store-scoped authority with
  audit + no fabricated config CAS version (FR6-FR10).
- **Acceptance:** all OutputSpool behaviors pass; content-free events; no phantom
  config write on the admin edge.
- **Verification:** `bun test packages/opencode/test/outputspool/** packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — `packages/opencode/test/operator/outputspool/
  feature017-outputspool-writer.test.ts` carries the full block set: `describe("T011 —
  production writer: message part → channel generation rows (FR6)")` (part→row mapping,
  suffix-only append, reasoning/skip routing, tool-result seal, stale-generation fencing,
  store-throw isolation), `describe("T012 — output.stat/read reflect the
  writer-populated store end-to-end (FR7)")`, `describe("T013 — output.follow streams
  committed pages over the cursor codec (FR8)")` (bounded page streaming, catch-up `eof`,
  invalid-cursor `invalid_argument`, disabled-seam `unavailable`), `describe("T014 —
  release/delete/purge commit through the store-scoped admin authority (FR9)")`
  (delete/release act on the real store, missing-ref no-phantom-write, unbound-authority
  gap). The Feature 014 gap-assertion suite
  (`packages/opencode/test/operator/outputspool/feature014-outputspool-wire.test.ts`) stays
  green as a non-regression check. The fix-round's eager-writer independence (FR-3: a
  session output is spooled with no operator stack ever created) is covered separately by
  `packages/opencode/test/operator/feature017-fixround.test.ts`. Verification: `cd
  packages/opencode && bun test test/outputspool/` → 90 pass / 0 fail across 15 files (231
  `expect()` calls); `bun test test/operator/` → 429 pass / 2 skip / 0 fail (see T020);
  both re-confirmed 2026-07-19.

- [x] **T022 — Jobs + Milvus tests**
- **Depends:** T015, T016
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** test the occurrence projection over an `EventV2Bridge` double + the
  bounded closable watch; and the Milvus binding when configured + the
  `milvus_unavailable` gate when not (FR11-FR14).
- **Acceptance:** all jobs + Milvus behaviors pass; bounded watch; honest gate.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-19 — `packages/opencode/test/operator/feature017-jobs-milvus.test.ts`
  carries both blocks: `describe("T015 — jobs occurrence projection over a fake EventV2
  aggregate")` (history fold + foreign-definition filter, bounded limit, notification
  projection, `showOccurrences` cap, bounded filtered watch via `Stream.runCollect`,
  unbound-bridge typed gap, `show()` routes through the projection) and `describe("T016 —
  Milvus registry binding")` (probe path when configured, maintenance verbs stay a typed
  gap, unreachable-endpoint degradation, probe-outage → typed gap with no secret leak,
  unconfigured degradation identity). Verification: `cd packages/opencode && bun test
  test/operator/` → 429 pass / 2 skip / 0 fail (see T020), re-confirmed 2026-07-19.

- [x] **T023 — Availability + parity tests (FR17)**
- **Depends:** T017
- **Paths:** `packages/core/test/operator/**`, `packages/tui/test/operator/parity.test.ts`
- **Deliverable:** assert the palette availability flip is truthful; reuse the Feature
  007 parity harness to assert each wired verb rides the same command id / same
  loopback with no new dispatch path, no new catalog id, and no catalog version bump
  (FR17).
- **Acceptance:** availability is truthful; parity holds; no catalog id/version change.
- **Verification:** `bun test packages/core/test/operator/** packages/tui/test/operator/parity.test.ts`.
- **Evidence:** 2026-07-19 — `packages/core/test/operator/feature017-availability.test.ts`
  `describe("T017 — persisting-set truthfulness + parity (FR15, FR17)")` asserts mcp flips
  `Unavailable → Partial`, the 14 newly-real MCP mutations + 3 output admin-edge verbs read
  `persists_today`, the 4 still-gapped verbs (`auth.start`/`finish`,
  `resource.admin.subscribe`/`unsubscribe`) stay `honest_unavailable`, output
  export/share stay deny-by-default, and every `OPERATOR_PERSISTING_VERBS` entry resolves
  to a real id in `RESERVED_CATALOG.entries` (no fabricated/new catalog id). Parity itself
  reuses the untouched Feature 011 harness `packages/tui/test/operator/parity.test.ts`
  (`describe("T016 command-id parity with slash/CLI (FR8)")`, spies the wire text against
  the canonical `/op.<id>` alias for a read and a mutation) — this feature adds no new
  parity mechanism, per the plan's "no new dispatch path" constraint (FR17). Companion
  non-regressions: `packages/core/test/operator/feature014-availability.test.ts` +
  `palette-menu.test.ts` (mcp → Partial, output admin edge), `packages/tui/test/operator/
  screen-controls.test.ts` (mcp toggles real) and `entity.test.ts` (mcp actions real) all
  stay green. Verification: `cd packages/core && bun test test/operator/` → 118 pass / 0
  fail across 12 files (2121 `expect()` calls); `cd packages/tui && bun test
  test/operator/parity.test.ts` passes as part of the T019 175/175 tui run; both
  re-confirmed 2026-07-19.

- [x] **T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green**
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
- **Evidence:** 2026-07-19 — **Guard scope confirmed sufficient, no `speckit.toml` edit
  needed.** The Feature 017 block (`doc/arch/speckit.toml:473-501`) already declares the
  four genuinely-new top-level globs (`packages/opencode/src/session/**`,
  `packages/opencode/.gitignore`, `packages/tui/src/operator/form/**`,
  `packages/tui/src/operator/status.ts`). Verified every fix-round path resolves under an
  ALREADY-declared glob and needs no addition: `operator/application/{handler,mutation,
  dispatcher,command-authority}.ts`, `operator/http/{handler,mount}.ts`,
  `operator/worker-adapter.ts`, `operator/adapters/inbound/{tui-port,http-slash-port,
  rpc-slash-port}.ts` all resolve under `packages/opencode/src/operator/**` (Feature 007,
  already in scope); `outputspool/spool-process-writer.ts` resolves under
  `packages/opencode/src/outputspool/**` (Feature 005, `speckit.toml:225`, already in
  scope); `server/server.ts` was already an individually-declared path
  (`speckit.toml:110`) predating this feature. **Doc sync.** Added the "Implementation
  notes (recorded during implement)" section to `plan.md` per the Feature 012-016
  convention (group-by-group summary + a dedicated fix-round subsection referencing
  ADR-0017's superseding-decision section — no new ADR). Confirmed no drift in the
  companion artifacts: the `operator-capability-gaps/*.cue` corpus
  (`editform.cue #EditField/#EditFieldList/#DetailTree`, `reads.cue #LiveServerRead/
  #LiveServerReadResult`, plus the mutation/flag/spoolwriter files) already types every
  shape the Evidence blocks above cite, and `doc/arch/statecharts/output-spool-writer.md`
  already matches the shipped writer. `spec.md` FR15/FR16/FR18 wording matches the
  landed behavior (deferred-gap list, availability-flip description) — no edit needed.
  **Gate commands (all re-run 2026-07-19, this closing pass):**
  `/Users/farchanjo/bin/speckit validate --json` → `"ok":true`, `"waivedCount":4`, 0 new
  findings (the 4 are the pre-existing waived `hygiene.empty-file` hits on
  `packages/desktop/src/renderer/styles.css`, `packages/opencode/test/config/fixtures/
  no-frontmatter.md`, `packages/plugin/.gitignore`, `sdks/vscode/.gitignore` — none on a
  Feature 017 artifact). `/Users/farchanjo/bin/speckit analyze` → "analyzed 17 feature(s):
  consistent; 0 ADR overlap(s)" (only pre-existing `info`-level slug-drift notices across
  multiple features, none new, none blocking). `/Users/farchanjo/bin/speckit status` →
  `phase: implement`, `status: implemented`, `next: none`, `completeness: ok`.

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

## Fix-round — adversarial review (2026-07-19)

An adversarial review of the landed backend work confirmed 2 defects + 1 root
mechanism. All fixed spec-first (ADR-0017 superseding decision) then in code; see
that ADR section for the design rationale.

- [x] **FR-1 — Effectful apply: the irreversible op runs AFTER the CAS checks (DEFECT 1)**
- **Was:** `output.release`/`delete`/`purge`, `mcp.server.connect`/`disconnect`/`reconnect`,
  and `mcp.auth.remove` ran their destructive op at plan-BUILD time
  (`dispatcher.ts` `handler(ctx)`), BEFORE `mutateAuthority`'s contract/idempotency/CAS
  validation — a 2nd op on a shared authority destroyed data then failed CAS, and an
  idempotent replay re-ran the op.
- **Paths:** `packages/opencode/src/operator/application/handler.ts` (new `effect` +
  `OperatorMutationEffectResult` on `OperatorMutationPlan`),
  `application/mutation.ts` (runs `effect` after all checks, before the CAS write),
  `application/dispatcher.ts` (threads `plan.effect`),
  `operator/outputspool/backend-live.ts` + `operator/mcp/backend-live.ts` (op deferred
  into `effect`; only the non-destructive pre-read stays at plan build).
- **Evidence:** `test/operator/feature017-fixround.test.ts` — a 2nd `output.delete` /
  `mcp.server.connect` without the CAS token does NOT run the destructive op
  (op-count spy stays 1) and the record survives; threading the right version runs it
  once; an idempotent replay returns the stored result with the live op NOT re-run
  (connect count stays 1). `bun test test/operator/ test/config/` green (614 pass).

- [x] **FR-2 — Preflight resolves the SAME authority the plan commits to (ROOT MECHANISM)**
- **Was:** the preflight read `commandId.split(".")[0]`, which never equals the shared
  global authority (`global:telemetry`/`global:mcp`/`global:output-admin`/…), so the
  client threaded the wrong `expectedVersion` and every 2nd mutation on a shared
  authority failed `mutations require version` — also breaking pre-existing 014 verbs
  (2nd `telemetry.configure`).
- **Paths:** `packages/opencode/src/operator/application/command-authority.ts` (new
  registry sourced from the domains' exported authority constants + the composition
  root's scope resolvers — no re-typed string table), exported constants in
  `telemetry`/`smart`/`budget`/`pools`/`semantic`/`mcp` backends, `http/handler.ts`
  (preflight consults the resolver + scope), `http/mount.ts` + `stack-live.ts` +
  `worker-adapter.ts` + `adapters/inbound/tui-port.ts` (thread the resolver through
  every operator surface), `adapters/inbound/http-slash-port.ts` +
  `rpc-slash-port.ts` (send the resolved scope).
- **Evidence:** `feature017-fixround.test.ts` — resolver maps every shared/scope-dependent
  authority; end-to-end two consecutive `telemetry.configure`, `output.retention.set`,
  and `mcp.server.add` succeed through the real dispatcher with the preflight-threaded
  CAS token (and the buggy prefix fallback is asserted to mis-resolve to null).

- [x] **FR-3 — Eager process spool writer, independent of the operator stack (DEFECT 2)**
- **Was:** the production writer was subscribed only inside the lazy
  `createLiveOperatorStack`, so a session that never opened the operator never spooled;
  output before first operator access was lost.
- **Paths:** `packages/opencode/src/outputspool/spool-process-writer.ts` (new process
  singleton, idempotent, fail-open), `server/server.ts` (armed eagerly at server start),
  `operator/stack-live.ts` (REUSES the shared store + subscription — no second
  `operator-control.db` connection, no duplicate GlobalBus listener; dispose no longer
  tears the writer down).
- **Evidence:** `feature017-fixround.test.ts` — a `message.part.updated` GlobalBus event
  is spooled to the shared control store with NO operator stack ever created; a second
  `ensureProcessSpoolWriter` reuses the same store.

- [x] **FR-4 — Suites + typecheck green**
- **Verification:** `bun run typecheck` (exit 0); `bun test test/operator/ test/config/`
  (614 pass, 0 fail); `bun test test/session/` (368 pass); `bun test test/server/`
  (293 pass); `packages/tui` `bun test test/operator/` (175 pass);
  `speckit validate --json` green.
