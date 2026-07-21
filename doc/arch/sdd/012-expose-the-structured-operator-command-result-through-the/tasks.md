# Tasks: Expose the Structured Operator Command Result Through the TUI (Feature 012)

Synced with plan.md (Phase 1 forward seam, Phase 2 context/dispatch thread, Phase 3
per-domain projections, Phase 4 panel feed, Phase 5 picker loaders, Phase 6 Dialog
push, Phase 7 tests + doc sync) and the specScopeGlobs in doc/arch/speckit.toml.
ADR-0012 proposed.

Consumption ONLY. NO new dispatch path, NO backend behavior change, NO new command
id, NO new flag — the Feature 007 `OperatorClient` loopback parity invariant (FR9)
is preserved; only the inbound adapter `tui-port.ts` is touched under the operator
backend. No code is executed in this documentary pass; tasks are the implement
backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below).

- [x] T001 — Forward `outcome`/`effective`/`version` on the `tui-port.ts` tryHandle return
- [x] T002 — Extend `OperatorSlashHandled` with an optional structured result
- [x] T003 — Return the structured result from `executeOperatorCommand`
- [x] T004 — `projectLangLockSignal` — effective → `LangLockPanelSignal` | empty
- [x] T005 — `projectJobsSignal` — effective → `JobsPanelSignal` | empty
- [x] T006 — `projectOutputSignal` — effective → `OutputPanelSignal` | empty
- [x] T007 — `projectSemanticSignal` — effective → `SemanticPanelSignal` | empty
- [x] T008 — `projectMcpSignal` — effective → `McpPanelSignal` | empty
- [x] T009 — Feed the projected signal into `DialogOperatorReadPanel`
- [x] T010 — Jobs entity-picker loader from `jobs.list` (jobDefinitionId)
- [x] T011 — Process/task entity-picker loaders from `process.tree`/`task.tree`
- [x] T012 — Dialog `push(input, onClose?)` back-stack primitive
- [x] T013 — Adopt `push` in operator navigation (Home → domain → panel/form)
- [x] T014 — Unit tests: five projections (projected / empty_fallback / shape_mismatch)
- [x] T015 — Unit tests: picker loaders (loaded / empty / unavailable)
- [x] T016 — Integration tests: forward+thread, live panel, navigation back stack
- [x] T017 — Parity test: structured result rides same command id as slash/CLI (FR9)
- [x] T018 — Doc sync + `speckit validate` green
- [x] T019 — Forward the structured result on the two PRODUCTION ports (rpc + http)
- [x] T020 — Production-port forwarding tests + quiet auto-issued reads

---

## Group A — Forward and thread the structured result

- [x] **T001 — Forward `outcome`/`effective`/`version` at the inbound seam**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/adapters/inbound/tui-port.ts`
- **Deliverable:** in the handled branch (currently lines 114-135) add the typed
  `outcome`, the optional `effective` payload, and the `version` from
  `result.result` to the returned object, alongside the existing `display` and
  `currentVersion`; update the `TuiOperatorSlashPort` return type to match. A pure
  widening of the SAME return object — no new method, route, or command name (FR1,
  FR9). This is the ONLY operator-backend file this feature touches.
- **Acceptance:** the return carries `outcome` + optional `effective` + `version`;
  no new dispatch path or command id is introduced.
- **Verification:** unit assertion on the widened return shape for a success result
  carrying `effective`.
- **Evidence:** 2026-07-19 — `packages/opencode/src/operator/adapters/inbound/tui-port.ts:44-56`
  (return type) + `:130-139` (handled branch forwards `{ outcome, effective?, version }`
  from `result.result`, display fields byte-identical); assertion at
  `test/operator/slash-runtime-wire.test.ts:101-102`. `bun test test/operator/{slash-runtime-wire,mutation-parity,surface-parity,slash-intercept}.test.ts` → 42 pass / 1 skip / 0 fail; `bun run typecheck` clean.
  **Correction (T019):** this task widened ONLY `tui-port.ts` (the test/embedded
  path); the assertion at `:101-102` exercises `wireTestOperatorSlashPort`, not a
  production port, so Feature 012 shipped inert on the two PRODUCTION paths
  (worker-RPC + HTTP) until T019 widened `rpc-slash-port.ts`/`http-slash-port.ts`.
  The production-path forwarding is now pinned by the structured assertions in
  `slash-runtime-wire.test.ts` (worker-RPC `:191-192`, HTTP `:354-355`).

- [x] **T002 — Extend `OperatorSlashHandled` with an optional structured result**
- **Depends:** T001
- **Paths:** `packages/tui/src/context/operator-slash.tsx`
- **Deliverable:** add an optional structured result to `OperatorSlashHandled` — the
  typed `outcome`, an optional `effective` payload (`unknown`), and the `version` —
  kept structurally separate from `display`. Absence of `effective` is representable
  and is not an error (FR2). Mirror the type on `OperatorSlashPort`.
- **Acceptance:** `OperatorSlashHandled` carries the optional structured fields; a
  handled result with no `effective` type-checks.
- **Verification:** typecheck + unit assertion on a handled result with and without
  `effective`.
- **Evidence:** 2026-07-19 — `packages/tui/src/context/operator-slash.tsx:22-60`
  adds `OperatorResultOutcome` (13-member union mirroring `enums.cue #ResultOutcome`)
  + `OperatorStructuredResult { outcome; effective?; version? }` and an optional
  `result?` on `OperatorSlashHandled` (mirrored on `OperatorSlashPort` via
  `OperatorSlashResult`). `bun run typecheck` (tui) clean; existing
  `test/operator/dispatch.test.ts` handled results with no `effective` type-check + pass.

- [x] **T003 — Return the structured result from `executeOperatorCommand`**
- **Depends:** T002
- **Paths:** `packages/tui/src/operator/execute.ts`
- **Deliverable:** widen the return type from `{ outcome?; cancelled? }` to also
  carry the structured result (typed `outcome`, optional `effective`, `version`);
  populate it from `first`/`second`/`result` on every handled branch. The dispatch
  path (preflight, idempotency key, confirm gate) is unchanged (FR3, FR9).
- **Acceptance:** callers receive the structured result on a handled dispatch; the
  dispatch path is byte-for-byte unchanged.
- **Verification:** unit assertion that a handled read dispatch returns the
  structured result.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/execute.ts:62` widens the
  return to `{ outcome?; cancelled?; result?: OperatorStructuredResult }`; every
  handled branch now attaches `first.result`/`second.result`/`result.result`
  (`:183,:186,:190,:203`) — preflight/confirm/idempotency path unchanged, toast
  display unchanged. `bun run typecheck` (tui) clean; `test/operator/{dispatch,parity}.test.ts`
  → 8 pass / 0 fail.

---

## Group B — Per-domain projection functions (FR4)

- [x] **T004 — `projectLangLockSignal`**
- **Depends:** T003
- **[P]** with T005, T006, T007, T008
- **Paths:** `packages/tui/src/operator/langlock/state.ts`
- **Deliverable:** pure `projectLangLockSignal(effective: unknown): LangLockPanelSignal`
  — valid shape → typed signal (`projected`); absent/unavailable → `EMPTY_LANGLOCK_SIGNAL`
  (`empty_fallback`); mismatched shape → `EMPTY_LANGLOCK_SIGNAL` (`shape_mismatch`);
  never throws; respects existing row bounds (FR4, FR8).
- **Acceptance:** the three outcomes resolve as specified; malformed input does not
  throw.
- **Verification:** unit assertions per outcome.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/langlock/state.ts:56-102`
  (`projectLangLockSignal` + `isPolicySummary`/`isAdvisoryRecord` guards) returns
  `PanelProjection<LangLockPanelSignal>` (`{ outcome, signal }`) via the shared
  `packages/tui/src/operator/projection.ts` outcome model; maps a bare
  `LangLockPolicySummary` (status/show) or `{ policy, advisories }` → `projected`,
  absent → `empty_fallback`, malformed → `shape_mismatch`, both → the byte-identical
  `EMPTY_LANGLOCK_PANEL_SIGNAL`. Tests `langlock/state.test.ts` cover all three
  outcomes + no-throw. `bun test src/operator/langlock/state.test.ts` green;
  `bun run typecheck` clean; oxlint 0 warnings on the source.

- [x] **T005 — `projectJobsSignal`**
- **Depends:** T003
- **[P]** with T004, T006, T007, T008
- **Paths:** `packages/tui/src/operator/jobs/state.ts`
- **Deliverable:** pure `projectJobsSignal(effective: unknown): JobsPanelSignal` over
  `JobDefinitionSummary`/`Occurrence`/`NotificationEnvelope`; same three-outcome
  contract and `MAX_VISIBLE_*` bounds as T004 (FR4, FR8).
- **Acceptance:** valid `jobs.list` payload projects definitions/occurrences/
  notifications; absent/mismatched → `EMPTY_JOBS_PANEL_SIGNAL`; never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/jobs/state.ts:67-121`
  (`projectJobsSignal` + `collectDefinitions` handling `jobs.list` `definitions[]`
  and `jobs.status`/`show` `definition`, plus `isOccurrence`/`isNotificationEnvelope`
  guards) returns `PanelProjection<JobsPanelSignal>`; valid → `projected` (occurrences/
  notifications are optional supplementary sections), absent → `empty_fallback`,
  malformed → `shape_mismatch`, both → `EMPTY_JOBS_PANEL_SIGNAL`; render bounds stay
  on the existing `deriveVisible*` derivers. `bun test src/operator/jobs/state.test.ts`
  green; `bun run typecheck` clean; oxlint 0 warnings on the source.

- [x] **T006 — `projectOutputSignal`**
- **Depends:** T003
- **[P]** with T004, T005, T007, T008
- **Paths:** `packages/tui/src/operator/output/state.ts`
- **Deliverable:** pure `projectOutputSignal(effective: unknown): OutputPanelSignal`;
  same three-outcome contract (FR4, FR8). `output` reads are honest-unavailable
  today (FR8), so the runtime path resolves to `empty_fallback` until a later backend feature —
  the projection is written total regardless.
- **Acceptance:** three outcomes resolve; unavailable read → `EMPTY_OUTPUT_SIGNAL`;
  never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/output/state.ts:110-143`
  (`projectOutputSignal` + `isOutputStat`/`isOutputPanelEntry` guards) returns
  `PanelProjection<OutputPanelSignal>`; a well-formed `{ currentSessionId, entries }`
  → `projected` (`pages` stays `{}` — a stat/read list never carries loaded page
  bodies; the panel loads them lazily on an authorized expand), absent →
  `empty_fallback` (the honest runtime path today), malformed → `shape_mismatch`,
  both → `EMPTY_OUTPUT_PANEL_SIGNAL`. `bun test src/operator/output/state.test.ts`
  green; `bun run typecheck` clean; oxlint 0 warnings on the source.

- [x] **T007 — `projectSemanticSignal`**
- **Depends:** T003
- **[P]** with T004, T005, T006, T008
- **Paths:** `packages/tui/src/operator/semantic/state.ts`
- **Deliverable:** pure `projectSemanticSignal(effective: unknown): SemanticPanelSignal`;
  same three-outcome contract (FR4, FR8). `semantic` reads honest-unavailable today
  → runtime `empty_fallback` until a later backend feature; projection written total.
- **Acceptance:** three outcomes resolve; unavailable read → `EMPTY_SEMANTIC_SIGNAL`;
  never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/semantic/state.ts:84-132`
  (`projectSemanticSignal` + `isModelDescriptor`/`isModelBinding`/`isDegradationOutcome`
  guards, `collectDescriptors`) returns `PanelProjection<SemanticPanelSignal>`;
  `semantic.model.list` `descriptors[]` and/or `binding.status`
  `embedding`/`reranker`/`degradation` → `projected`, absent → `empty_fallback`,
  a payload naming neither read or a malformed one → `shape_mismatch`, both →
  `EMPTY_SEMANTIC_PANEL_SIGNAL` (never re-embeds, never substitutes a binding).
  `bun test src/operator/semantic/state.test.ts` green; `bun run typecheck` clean;
  oxlint 0 warnings on the source.

- [x] **T008 — `projectMcpSignal`**
- **Depends:** T003
- **[P]** with T004, T005, T006, T007
- **Paths:** `packages/tui/src/operator/mcp/state.ts`
- **Deliverable:** pure `projectMcpSignal(effective: unknown): McpPanelSignal`; same
  three-outcome contract (FR4, FR8). `mcp` reads honest-unavailable today → runtime
  `empty_fallback` until a later backend feature; projection written total.
- **Acceptance:** three outcomes resolve; unavailable read → `EMPTY_MCP_SIGNAL`;
  never throws.
- **Verification:** unit assertions per outcome.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/mcp/state.ts:155-203`
  (`projectMcpSignal` + `isServerProfile`/`isCapabilitySet`/`isDegradationGap`
  guards) returns `PanelProjection<McpPanelSignal>`; `mcp.server.list` `servers[]` →
  `projected`, `mcp.server.capabilities` keys the negotiated set (and any
  `degradationGap`) by its own `serverId`, absent → `empty_fallback`, malformed →
  `shape_mismatch`, both → `EMPTY_MCP_PANEL_SIGNAL`. `bun test src/operator/mcp/state.test.ts`
  green; `bun run typecheck` clean; oxlint 0 warnings on the source.

---

## Group C — Feed panels and populate pickers

- [x] **T009 — Feed the projected signal into `DialogOperatorReadPanel`**
- **Depends:** T004, T005, T006, T007, T008
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** `DialogOperatorReadPanel` takes the structured result from the
  read-verb dispatch, runs the domain projection, and passes the resulting
  `*PanelSignal` into the panel `signal` prop — replacing Feature 011's omitted
  wiring. `empty_fallback`/`shape_mismatch` → the panel's `EMPTY_*_SIGNAL` baseline;
  a view selection dispatches no mutation (FR5, FR8).
- **Acceptance:** a langlock/jobs read renders a populated panel; an unavailable
  read renders the baseline; no mutation on view.
- **Verification:** integration assertion on one panel with and without effective.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/dialog-settings.tsx:82-134`.
  `READ_PANEL_BY_DOMAIN` pairs each domain's primary read (`jobs.list`,
  `output.stat`, `langlock.status`, `semantic.model.list`, `mcp.server.list`) with
  a render closure that projects the dispatch's `effective` through the T004–T008
  projection into the panel `signal` prop. `DialogOperatorReadPanel` issues that
  read `onMount` via the SAME `executeOperatorCommand` (no new dispatch path, FR9),
  stores `result.result?.effective`, and feeds it; absent/unavailable/mismatched →
  the honest `EMPTY_*_SIGNAL` baseline (FR8). A view verb never mutates (read-only
  catalog id). `bun test test/operator/ src/operator/` → 110 pass / 0 fail;
  `bun run typecheck` (tui) clean; oxlint 0 new findings.
  **Correction (T019/T020):** the panel wiring here consumes `result.result?.effective`,
  which was empty on the DEFAULT `opencode tui` (worker-RPC) and remote/attach (HTTP)
  paths until T019 made the production ports forward it — the panel only renders live
  data end-to-end once T019 lands. The panel-mount dispatch also now passes
  `{ silent: true }` (T020/P1) so the newly-live read raises no toast on open.

- [x] **T010 — Jobs entity-picker loader from `jobs.list`**
- **Depends:** T005, T009
- **Paths:** `packages/tui/src/operator/form/descriptor.ts`, `packages/tui/src/operator/form/index.tsx`
- **Deliverable:** replace `NO_OPTIONS` for `jobs.enable`/`disable`/`delete`/`run-now`
  with a loader that issues `jobs.list` through the SAME `executeOperatorCommand`
  path and projects the `effective` payload into `#PickerOption`s keyed by
  `jobDefinitionId`. No effective / unavailable → empty option set + honest empty
  picker; `value` is the entity id only, never a command id or free text (FR6, FR8).
- **Acceptance:** picker lists job definitions from `jobs.list`; unavailable read →
  empty picker; selected value is `jobDefinitionId`.
- **Verification:** integration assertion on the jobs picker loaded and empty.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/form/descriptor.ts:56-118`
  adds `OperatorPickerSource` (`{ read, project }`) + `projectJobDefinitionOptions`
  (reuses `projectJobsSignal(effective).signal.definitions` → `{ title: name,
  description, value: jobDefinitionId }`); the four `jobs.*` value_picker specs
  carry `JOBS_PICKER_SOURCE`. `form/index.tsx:44-88` loads it `onMount` via the SAME
  `executeOperatorCommand` (read entry resolved from `listOperatorPaletteEntries`)
  and renders `loaded() ?? []` (honest-empty while pending / on unavailable). Option
  `value` is only the `jobDefinitionId`. `bun test test/operator/ src/operator/` →
  110 pass / 0 fail; `bun run typecheck` (tui) clean; oxlint 0 new findings.
  **Correction (T019/T020):** the loader projects `result.result?.effective`, which
  the production ports dropped until T019 — so the jobs picker populated live only
  after T019. The loader dispatch now passes `{ silent: true }` (T020/P1) so an
  auto-issued picker read raises no toast on open.

- [x] **T011 — Process/task entity-picker loaders**
- **Depends:** T009, T010
- **Paths:** `packages/tui/src/operator/form/descriptor.ts`, `packages/tui/src/operator/form/index.tsx`
- **Deliverable:** loaders for `process.cancel` (from `process.tree` → `processId`)
  and `task.cancel` (from `task.tree` → `taskId`), same contract as T010: project
  the `effective` payload into options keyed by the entity id; no effective /
  unavailable → honest empty picker (FR6, FR8). Sequenced after T010 because both
  edit `form/descriptor.ts` + `form/index.tsx` (no parallel write).
- **Acceptance:** process/task pickers populate from their tree read when effective
  is present, else render honest-empty; value is `processId`/`taskId`.
- **Verification:** integration assertion on the process/task pickers loaded and
  empty.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/form/descriptor.ts:70-121`
  adds `treeViews` (reads `{ nodes: [{ view }] }`, the `ProcessTreeResult`/
  `OperatorProcessView` shape), `projectProcessOptions` (→ `processId`) and
  `projectTaskOptions` (→ `taskId`, de-duplicated); `process.cancel`/`task.cancel`
  carry `PROCESS_PICKER_SOURCE`/`TASK_PICKER_SOURCE` reading `process.tree`/
  `task.tree` through the SAME loader as T010. Backend `process.tree`/`task.tree`
  require a `rootProcessId` the form does not supply, so today they resolve
  `invalid_argument` → no effective → honest empty picker (FR8); the projection is
  written total for when a tree effective is present. `bun test test/operator/
  src/operator/` → 110 pass / 0 fail; typecheck clean; oxlint 0 new findings.

---

## Group D — Dialog back stack (FR7)

- [x] **T012 — Dialog `push(input, onClose?)` primitive**
- **Depends:** none
- **[P]** with Group A/B (distinct file)
- **Paths:** `packages/tui/src/ui/dialog.tsx`
- **Deliverable:** add `push(input, onClose?)` to the public API — it appends
  `{ element, onClose }` to `store.stack` instead of resetting it (the `escape`/
  `ctrl+c` binding at lines 118/132 already pops one level); `replace` stays for
  root/reset use (FR7).
- **Acceptance:** `push` appends a level; the stack length grows by one; `escape`
  pops exactly one.
- **Verification:** unit assertion on stack length after push/pop.
- **Evidence:** 2026-07-19 — `packages/tui/src/ui/dialog.tsx:166-178` adds `push`
  appending via `setStore("stack", store.stack.length, { element, onClose })`
  (levels beneath stay mounted; blurs the underlying focus on first level; leaves
  `size` untouched). The existing `escape`/`ctrl+c` binding (`:118/:132`) pops
  exactly one via `store.stack.slice(0, -1)`. `replace` unchanged for root/reset.
  Test harness `createFakeDialog` (`test/operator/harness.ts:86`) gains the no-op
  `push` so `DialogContext` stays satisfied. `bun run typecheck` (tui) clean;
  `bun test test/operator/` green; oxlint on `dialog.tsx` → 0 new findings (the one
  `no-unsafe-enum-comparison` warning at `:221` is pre-existing, untouched code).

- [x] **T013 — Adopt `push` in operator navigation**
- **Depends:** T009, T012
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** Home → domain → panel/form descends via `push` so `escape`
  unwinds exactly one level, retiring Feature 011's `replace`-plus-manual-affordance
  pattern (recorded in the Feature 011 plan implementation notes) (FR7).
- **Acceptance:** Home → domain → panel; `escape` returns to the domain panel, not a
  closed dialog.
- **Verification:** integration assertion on the back-navigation path.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/dialog-settings.tsx`: Home
  row `ctx.push` (`:56`), domain→read-panel `dialog.push` (`:190`), domain→form
  `dialog.push` (`:172`) with the manual `back` param dropped; the read panel's
  manual "back" text affordance removed (`DialogOperatorReadPanel` header now a
  bare title, `:126-131`). `openOperatorSettings` keeps `replace` as the root
  reset. Escape (global binding) unwinds Home ← domain ← panel/form one level per
  press. `bun test test/operator/` (incl. `navigation.test.ts`) → all green;
  `bun run typecheck` (tui) clean; oxlint 0 new findings.

---

## Group E — Tests and doc sync

- [x] **T014 — Unit tests: five projections**
- **Depends:** T004, T005, T006, T007, T008
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** for each of the five domains assert `projected` (valid effective
  → typed signal), `empty_fallback` (absent/unavailable → `EMPTY_*_SIGNAL`), and
  `shape_mismatch` (malformed → `EMPTY_*_SIGNAL`, no throw).
- **Acceptance:** suite green; each domain covers all three outcomes.
- **Verification:** `bun test` (tui) green.
- **Evidence:** 2026-07-19 — `packages/tui/test/operator/projection.test.ts`. A
  shared `describeProjection` harness pins all five domains
  (`projectLangLockSignal`/`projectJobsSignal`/`projectOutputSignal`/
  `projectSemanticSignal`/`projectMcpSignal`) on the uniform contract: valid →
  `projected` (+ a spot-check that the typed row is actually carried), `undefined`/
  `null` → `empty_fallback` returning the exact `EMPTY_*_PANEL_SIGNAL` identity,
  malformed → `shape_mismatch` returning the same baseline, plus a never-throws
  battery over hostile inputs. Also covers the shared `projection.ts` outcome model
  (`projected`/`emptyFallback`/`shapeMismatch`/`isRecord`/`isPresent`). `bun test
  test/operator/projection.test.ts` → 25 pass / 0 fail / 192 expect().

- [x] **T015 — Unit tests: picker loaders**
- **Depends:** T010, T011
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert `jobs.list`/`process.tree`/`task.tree` results project into
  options keyed by the entity id (`loaded`), and that an unavailable/empty read
  yields the honest empty option set (`empty`/`unavailable`).
- **Acceptance:** suite green across loaded and empty/unavailable cases.
- **Verification:** `bun test` (tui) green.
- **Evidence:** 2026-07-19 — `packages/tui/test/operator/picker.test.ts`. Drives each
  entity picker through the public `resolveOperatorFormField(entry).source`: the four
  `jobs.*` verbs read `jobs.list` and project a `{ definitions }` effective into
  options keyed by `jobDefinitionId`; `process.cancel` reads `process.tree` →
  `processId`; `task.cancel` reads `task.tree` → de-duplicated `taskId`. Absent
  (`undefined`/`null`) and malformed effectives project to `[]` (honest empty picker)
  without throwing, and `langlock.set` keeps its static allowlist source (no dynamic
  `source`). `bun test test/operator/picker.test.ts` → 10 pass / 0 fail / 51 expect().

- [x] **T016 — Integration tests: forward+thread, live panel, navigation back stack**
- **Depends:** T009, T013
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert the widened `tui-port.ts` return carries
  `outcome`/`effective`/`version`; that `OperatorSlashHandled` and
  `executeOperatorCommand` surface them; that a live langlock/jobs read renders a
  populated panel and an unavailable read renders the baseline; and that `push`
  appends a level while `escape` pops exactly one.
- **Acceptance:** suite green across forward/thread, live-panel, and back-stack cases.
- **Verification:** `bun test` (tui) green.
- **Evidence:** 2026-07-19 — `packages/tui/test/operator/integration.test.tsx` (+
  `harness.ts` extended with an optional `structured` provider on `createSpyPort`,
  modelling the `tui-port.ts` structured half without weakening existing callers —
  the field is optional). (1) Forward+thread: a spy port carrying
  `{ outcome, effective?, version }` is surfaced verbatim by `executeOperatorCommand`
  on a read and a mutation (single preflight + single `tryHandle`), and an
  effective-less result confirms FR2 absence is representable; the opencode-side
  `tui-port.ts` widening itself stays pinned in
  `packages/opencode/test/operator/slash-runtime-wire.test.ts`. (2) Live panel: the
  exact `DialogOperatorReadPanel` pipeline (dispatch → `result.result?.effective` →
  `projectJobsSignal` → `deriveVisibleDefinitionCards`) renders live definition rows
  from a stubbed structured result and the honest empty baseline when absent. (3) Back
  stack: a real `testRender` mount of `DialogProvider` proves `dialog.push` appends
  Home → domain → panel (length 3) and `mockInput.pressEscape()` pops exactly one per
  press (3 → 2 → 1), running each level's `onClose` once. `bun test
  test/operator/integration.test.tsx` → 7 pass / 0 fail / 16 expect().

- [x] **T017 — Parity test: same command id as slash/CLI (FR9)**
- **Depends:** T003
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert the structured
  result rides the SAME canonical command id through the SAME `OperatorClient`
  loopback as slash/CLI, introducing no new dispatch path, parallel registry, or
  divergent name (FR9).
- **Acceptance:** command id parity holds for one read and one mutation; no new path.
- **Verification:** parity assertion green.
- **Evidence:** 2026-07-19 — `packages/tui/test/operator/structured-parity.test.ts`.
  Dispatches through a spy port that carries the structured half (via the extended
  `createSpyPort`) and pins the wire token to the canonical `/op.<id>`: a structured
  read (`langlock.status`) and a structured mutation (`langlock.set`) each resolve the
  exact `entry.slashAlias` (`= /op.${id}`, the same alias slash/CLI resolve) with
  exactly one `tryHandle` on the wire — the effective payload never forks the id and
  no second dispatch path is added; a sample of five reads confirms token parity.
  `bun test test/operator/structured-parity.test.ts` → 3 pass / 0 fail / 17 expect().

- [x] **T018 — Doc sync + `speckit validate` green**
- **Depends:** T014, T015, T016, T017
- **Paths:** docs under allowed globs (spec, ADR-0012, `operator-result-signal/*.cue`,
  `operator-result-projection.md`; `AGENTS.md`/`README.md` only if a surface
  description drifts)
- **Deliverable:** reconcile the shipped shapes and node names with the spec, ADR,
  schema, and statechart; run `speckit analyze` and `speckit validate --json` clean
  of new Feature 012 findings.
- **Acceptance:** `speckit validate --json` → 0 new findings on Feature 012
  artifacts; `speckit status` completeness ok.
- **Verification:** `speckit analyze` + `speckit validate --json`.
- **Evidence:** 2026-07-19 — spec.md `status: analyzed` → `implemented`; ADR-0012
  stays `proposed` (matches Feature 011's ADR-0011 convention — ADRs are not
  flipped to `accepted` at implement time in this repo); `operator-result-signal/
  {enums,projection}.cue` and `operator-result-projection.md` already matched the
  shipped shapes (`ProjectionOutcome` = `projected`/`empty_fallback`/
  `shape_mismatch`; `#PanelProjection` mirrored by
  `packages/tui/src/operator/projection.ts`'s `PanelProjection<Signal>`) — no CUE
  edits were required. Full test sweep: `packages/opencode` `bun test
  test/operator/{slash-runtime-wire,mutation-parity,surface-parity,slash-intercept}.test.ts`
  → 42 pass / 1 skip / 0 fail; `packages/tui` `bun test test/operator/ src/operator/`
  → 153 pass / 0 fail / 813 expect(); `bun run typecheck` clean in both packages;
  `oxlint` on all Feature 012 net-new files (`projection.ts`,
  `integration.test.tsx`, `picker.test.ts`, `projection.test.ts`,
  `structured-parity.test.ts`) → 0 warnings / 0 errors. `speckit validate --json`
  → 4 findings, all pre-existing waived `hygiene.empty-file` (0 new Feature 012
  findings). Implementation notes recorded in plan.md.

---

## Group F — Production-port forwarding (post-implement correction)

An adversarial review found Feature 012 inert in production: only `tui-port.ts` (the
test/embedded path) forwarded the structured half. The two PRODUCTION ports parsed
the typed `CommandResult` and then discarded it in their `displayHandled` helpers,
so the DEFAULT `opencode tui` (worker-RPC) and remote/attach (HTTP) paths shipped
display-only. T019/T020 close the gap; the spec/plan FR1 text now covers all three
TUI-facing slash-port adapters.

- [x] **T019 — Forward the structured result on the two production ports**
- **Depends:** T001
- **Paths:** `packages/opencode/src/operator/adapters/inbound/rpc-slash-port.ts`,
  `packages/opencode/src/operator/adapters/inbound/http-slash-port.ts`
- **Deliverable:** add the optional `result` field (`{ outcome; effective?; version }`)
  to the handled return of both production ports' `displayHandled` helpers (and the
  `needsConfirmation` branch), forwarding from the already-parsed `CommandResult`
  with byte-identical display fields and `tui-port.ts` semantics (`outcome`;
  `effective` only when defined; `version ?? null`). No new dispatch path, route, or
  command id (FR1, FR9).
- **Acceptance:** a handled read through `createWorkerRpcSlashPort` and
  `createHttpOperatorSlashPort` carries `result.outcome` + `result.effective`;
  display fields unchanged.
- **Verification:** production-port assertions in `slash-runtime-wire.test.ts`.
- **Evidence:** 2026-07-19 — `rpc-slash-port.ts:105-113` (`structuredResult` helper)
  wired into `displayHandled` (`:125`) and the confirmation branch (`:377`);
  `http-slash-port.ts:375-381` (`structuredResult`) wired into `displayHandled`
  (`:364`) and the confirmation branch (`:344`). Both read the `CommandResult` they
  already map to display; `effective` omitted when undefined, `version ?? null`.
  `bun test test/operator/slash-runtime-wire.test.ts` green; `bun run typecheck`
  (opencode) clean; oxlint touched files 0 new findings (18 pre-existing = 18 post).

- [x] **T020 — Production-port forwarding tests + quiet auto-issued reads**
- **Depends:** T019
- **Paths:** `packages/opencode/test/operator/slash-runtime-wire.test.ts`,
  `packages/tui/src/operator/execute.ts`, `packages/tui/src/operator/dialog-settings.tsx`,
  `packages/tui/src/operator/form/index.tsx`
- **Deliverable:** (a) extend the existing `wireLocalOperatorSlashPort` (worker-RPC)
  and `createHttpOperatorSlashPort` `langlock.status` cases to assert
  `result.result?.outcome === "success"` and `result.result?.effective` presence —
  never weakening existing display assertions; (b) add an internal `{ silent: true }`
  option to `executeOperatorCommand` that suppresses the toast for auto-issued reads
  (errors also silent — the surface's honesty is the empty state, per FR5/FR6/FR8),
  and pass it from the panel-mount and picker-loader dispatches so newly-live reads
  do not flash a toast (or an `invalid_argument` warning for the process/task
  pickers) on every open; user-invoked commands keep their toasts.
- **Acceptance:** production-port structured assertions green; panel/picker opens
  emit no toast; user-invoked command toasts unchanged.
- **Verification:** `bun test packages/opencode/test/operator/` +
  `packages/tui` operator suite green; `bun run typecheck` both packages.
- **Evidence:** 2026-07-19 — `slash-runtime-wire.test.ts:191-192` (worker-RPC) +
  `:354-355` (HTTP) assert `result.result?.outcome === "success"` + `effective`
  presence, existing display assertions untouched; `execute.ts:71` derives a
  silenced `toast` from the new `silent?: boolean` option (guards every `toast.show`
  / `showDisplay`); `dialog-settings.tsx` panel-mount dispatch and `form/index.tsx`
  picker loader pass `{ silent: true }`, user-invoked verbs unchanged. `bun test
  packages/opencode/test/operator/` → 262 pass / 2 skip / 0 fail; `packages/tui`
  operator suite → 153 pass / 0 fail (full tui suite 384 pass / 1 skip); `bun run
  typecheck` clean both packages; oxlint 0 new findings on touched files.

---

## Dependencies summary

```
T001 → T002 → T003
T003 → (T004 ∥ T005 ∥ T006 ∥ T007 ∥ T008)
T004+T005+T006+T007+T008 → T009
T005+T009 → T010 → T011
T012 → T013 (needs T009)
T004..T008 → T014 ; T010+T011 → T015 ; T009+T013 → T016 ; T003 → T017
T014+T015+T016+T017 → T018
T001 → T019 → T020   (post-implement production-port correction)
```

## Parallelism rules

- Only `[P]` tasks may run concurrently, and only when path sets do not overlap.
- The five projection tasks (T004-T008) touch five distinct `state.ts` modules and
  are safely parallel; T010/T011 both touch `form/**` and are sequenced.
- T012 (`ui/dialog.tsx`) is a distinct file and may run alongside Group A/B.
- Never parallelize two tasks writing the same module (`dialog-settings.tsx`,
  `form/descriptor.ts`).

## Task counts

| Group                        | Tasks              | Phase |
| ---------------------------- | ------------------ | ----- |
| A Forward + thread           | T001–T003 (3)      | 1-2   |
| B Per-domain projections     | T004–T008 (5)      | 3     |
| C Panel feed + pickers       | T009–T011 (3)      | 4-5   |
| D Dialog back stack          | T012–T013 (2)      | 6     |
| E Tests + doc sync           | T014–T018 (5)      | 7     |
| F Production-port forwarding | T019–T020 (2)      | 1-7   |
| **Total actionable**         | **T001–T020 (20)** |       |

## Definition of done

- FR1–FR9 covered; the structured result forwarded at the seam and threaded to the
  panels and pickers.
- Five total projections (projected | empty_fallback | shape_mismatch) that never
  throw and never fabricate rows.
- Entity pickers populate from their read queries; honest-empty when unavailable.
- Dialog `push` primitive added and adopted; `escape` pops one level.
- Honest availability everywhere; no fabricated data or synthesized success (FR8).
- No new dispatch path, registry, divergent command id, or feature flag (FR9); only
  the three inbound TUI slash-port adapters (`tui-port.ts`, `rpc-slash-port.ts`,
  `http-slash-port.ts`) touched under the operator backend, each widening its
  handled return with the already-parsed structured half.
- Test suites green; `speckit validate --json` clean of new Feature 012 findings.
