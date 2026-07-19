# Tasks: Restructure the Operator Control Plane TUI From a Flat List (Feature 011)

Synced with plan.md (Phase 1 core copy/metadata, Phase 2 navigation, Phase 3
editable forms, Phase 4 read panels, Phase 5 tests + doc sync) and the
specScopeGlobs in doc/arch/speckit.toml. ADR-0011 proposed.

Presentation and navigation only. NO new dispatch path, NO backend change, NO new
flag — the Feature 007 `OperatorClient` loopback parity invariant (FR8) is
preserved. No code is executed in this documentary pass; tasks are the implement
backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below).

- [x] T001 — Static persisting-domains + availability map in `palette.ts`
- [x] T002 — Per-verb input-mode descriptor map in `palette.ts`
- [x] T003 — Normative label copy (view/configure/confirm/unavailable/secret)
- [x] T004 — Extend `OPERATOR_SETTINGS_DOMAINS` from 8 to 12
- [x] T005 — Keep curated `suggest` subset; drop the flat wall from the projection
- [x] T006 — Group-list + domain-panel projection builders (`#GroupList`/`#DomainPanel`)
- [x] T007 — Collapse the flat spread in `app.tsx` to one `Operator` entry
- [x] T008 — Home group list of 12 domains with availability badges
- [x] T009 — Domain panel View/Configure split with confirm/secret markers
- [x] T010 — Generalise `DialogLangLockPicker` into a reusable operator form
- [x] T011 — Wire persisting-domain Configure verbs to the form + payload dispatch
- [x] T012 — Direct dispatch for no-payload verbs; honest-unavailable envelope
- [x] T013 — Wire the five read panels into their View section (honest-empty fallback)
- [x] T014 — Unit tests: palette metadata, normative copy, 12 domains
- [x] T015 — Unit/integration tests: navigation, form dispatch, honest-unavailable
- [x] T016 — Parity test: palette/form dispatch same command id as slash/CLI (FR8)
- [x] T017 — Doc sync + `speckit validate` green

---

## Group A — Core palette metadata and copy (`palette.ts`)

- [x] **T001 — Static persisting-domains + availability map**
- **Depends:** none
- **[P]** with T002
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** static map `{langlock, jobs, routing, process, task} = persists_today`,
  all other domain mutations `honest_unavailable`; derive `#VerbAvailability`
  (`available` | `confirm_required` | `unavailable`) per verb from
  `mutates` + `requiresConfirmation` + persistence class.
- **Acceptance:** honest-unavailable mutation → `unavailable`; persisting
  confirm-required mutation → `confirm_required`; persisting plain mutation and
  read-only query → `available`.
- **Verification:** unit assertions on the derived availability for a sample per class.
- **Evidence:** 2026-07-19 — `packages/core/src/operator/palette.ts:105` (`OPERATOR_PERSISTING_DOMAINS` = {langlock,jobs,routing,process,task}), `:172` `persistenceFor` and `:180` `availabilityFor` derive `#VerbAvailability` from `mutates`+`confirmRequired`+persistence. Smoke run: semantic.provider.add (honest-unavailable mutation) → `unavailable`; jobs.delete (persisting confirm leaf) → `confirm_required`; langlock.set/langlock.status → `available`. `bun test test/operator/` 63 pass; `bun run typecheck` exit 0.

- [x] **T002 — Per-verb input-mode descriptor map**
- **Depends:** none
- **[P]** with T001
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** static descriptor map assigning `#InputMode`
  (`none` | `value_picker` | `text_input`) to the persisting Configure verbs —
  `langlock`(`set`,`reset`), `jobs`(`create`,`update`,`enable`,`disable`,`delete`,
  `reschedule`,`run-now`), `routing`(`configure`), `process`(`cancel`,`steer`,
  `handoff`), `task`(`cancel`); every other verb stays `none`.
- **Acceptance:** listed verbs report their input mode; verbs with no payload → `none`.
- **Verification:** unit snapshot of the input-mode map.
- **Evidence:** 2026-07-19 — `packages/core/src/operator/palette.ts:113` `OPERATOR_INPUT_MODES` maps the 14 persisting Configure verbs (langlock.set→value_picker, langlock.reset→none, jobs.create/update/reschedule→text_input, jobs.enable/disable/delete/run-now→value_picker, routing.configure→text_input, process.cancel→value_picker, process.steer/handoff→text_input, task.cancel→value_picker); `inputModeFor` (`:203`) returns `none` for every other verb. Verified via smoke run + surfaced on `OperatorVerbItem.inputMode`.

- [x] **T003 — Normative label copy**
- **Depends:** T001
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** replace `titleFor` / the `"Operator query|mutation: <id>"` ternary
  with the verbatim spec copy — top entry `Operator` / `Grouped operator settings and
  views`; domain row `{Available|Partial|Unavailable} · {view_count} views ·
  {configure_count} settings`; view `View: {verbLabel}` / `Read-only view ·
  {commandId}`; configure `Configure: {verbLabel}` / `Editable setting · {commandId}`
  (+ `· confirm required`); unavailable `Unavailable · not implemented yet ·
  {commandId}`; secret rows append ` · secret`. Dotted id stays in the subtitle, never
  the primary label.
- **Acceptance:** each row class renders its exact copy; no `"Operator query: <id>"`
  string remains; secret suffix present only for `isOperatorSecretMutationId` verbs.
- **Verification:** unit string assertions matching `operator-menu/text-values.cue`.
- **Evidence:** 2026-07-19 — `titleFor`/`"Operator query|mutation: <id>"` ternary removed; replaced by `verbTitleFor` (`:212`), `verbSubtitleFor` (`:217`), `domainGroupSubtitle` (`:342`) and `OPERATOR_TOP_TITLE`/`OPERATOR_TOP_SUBTITLE` (`:98`). Smoke output matches spec verbatim: top `Operator` / `Grouped operator settings and views`; domain row `Available · 2 views · 2 settings`; `View: Show` / `Read-only view · langlock.show`; `Configure: Set` / `Editable setting · langlock.set`; jobs.delete `Editable setting · confirm required · jobs.delete`; semantic.provider.add `Unavailable · not implemented yet · semantic.provider.add`; mcp.auth.start appends ` · secret`. `grep "Operator query"` over palette.ts → 0 matches.

- [x] **T004 — Extend `OPERATOR_SETTINGS_DOMAINS` from 8 to 12**
- **Depends:** none
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** add `process`, `task`, `jobs`, `output` so all 12 reserved domains
  project into the group menu (FR2).
- **Acceptance:** `OPERATOR_SETTINGS_DOMAINS.length === 12`; the four added domains
  return their verbs from `listOperatorSettingsEntries`.
- **Verification:** unit assertion on domain count + membership.
- **Evidence:** 2026-07-19 — `packages/core/src/operator/palette.ts:288` `OPERATOR_SETTINGS_DOMAINS` now lists all 12 reserved domains (added `process`, `task`, `jobs`, `output`). Smoke run: `OPERATOR_SETTINGS_DOMAINS.length === 12`; the four added domains return verbs via `listOperatorSettingsEntries` (process 7, task 4, jobs 12, output 10).

- [x] **T005 — Curated `suggest` subset; drop the flat wall from the projection**
- **Depends:** T003
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** keep `listOperatorSuggestedEntries()` (read-only `status`/`show`)
  as the only top-level quick-access set; ensure the projection no longer expects the
  full flat entry list at top level (FR1).
- **Acceptance:** suggested set is read-only queries only; full flat wall not surfaced
  as top-level commands.
- **Verification:** unit assertion suggested ⊆ read-only queries.
- **Evidence:** 2026-07-19 — `listOperatorSuggestedEntries()` (`:283`) retained as the only curated top-level quick-access set (read-only `status`/`show`, non-secret). Smoke run: 25 suggested entries, all `mutates === false`. The full flat wall is no longer the top-level projection — `buildOperatorGroupList()`/`buildOperatorDomainPanel()` (T006) are the grouped-entry projections; `listOperatorPaletteEntries` kept only for existing back-compat call sites (execute.ts, buildOperatorPaletteCommands).

- [x] **T006 — Group-list + domain-panel projection builders**
- **Depends:** T001, T002, T003, T004
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** builders assembling the `#GroupList` (12 `#DomainGroup` rows with
  badge, `view_count`, `configure_count`) and the per-domain `#DomainPanel`
  (`view`/`configure` `#VerbList`) matching `operator-menu/navigation.cue`.
- **Acceptance:** each domain group carries correct counts + badge; panel splits verbs
  by `mutates` into View/Configure.
- **Verification:** unit assertion of one representative domain projection.
- **Evidence:** 2026-07-19 — `buildOperatorGroupList()` (`:345`) returns 12 `#DomainGroup` rows (domain, label, badge, availability, viewCount, configureCount, composed subtitle); `buildOperatorDomainPanel(domain)` (`:363`) splits verbs by `section` into `view`/`configure` `#VerbList`s of `#VerbItem`. New types `OperatorDomainGroup`/`OperatorDomainPanel`/`OperatorVerbItem` mirror `operator-menu/navigation.cue`. Smoke run: langlock → view 2 / configure 2, badge `Available`; jobs → view 5 / configure 7; semantic configure rows carry availability `unavailable` + honest subtitle. All exported via `operator/index.ts`.

---

## Group B — TUI navigation (`app.tsx` + `dialog-settings.tsx`)

- [x] **T007 — Collapse the flat spread to one `Operator` entry**
- **Depends:** T005
- **Paths:** `packages/tui/src/app.tsx`
- **Deliverable:** remove the unconditional `listOperatorPaletteEntries()` top-level
  spread; register exactly ONE `Operator` palette entry that opens
  `DialogOperatorSettingsHome`; the curated `suggest` set MAY remain (FR1).
- **Acceptance:** exactly one top-level operator entry; no per-verb rows at top level.
- **Verification:** integration assertion on the top-level command set.
- **Evidence:** 2026-07-19 — `packages/tui/src/app.tsx:966` the single `operator.settings` entry now carries the normative copy `OPERATOR_TOP_TITLE`/`OPERATOR_TOP_SUBTITLE` (`Operator` / `Grouped operator settings and views`) and opens `DialogOperatorSettingsHome`. The flat `...operatorPaletteEntries().map(...)` wall (was `:976`) is removed; replaced by `...operatorSuggestedEntries().map(...)` — read-only `status`/`show` quick access only (new `operatorSuggestedEntries()` in `operator/execute.ts:24` wrapping `listOperatorSuggestedEntries`). `bun run typecheck` exit 0; `bun test` 305 pass / 0 fail; `oxlint` 0 errors on app.tsx.

- [x] **T008 — Home group list of 12 domains with badges**
- **Depends:** T006, T007
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** `DialogOperatorSettingsHome` renders the `#GroupList` — 12 rows,
  each with human label + availability-badge subtitle; `domain_selected` pushes the
  domain panel via `ctx.push` (FR2).
- **Acceptance:** home shows 12 rows with badges; selecting one pushes `domain_panel`.
- **Verification:** integration assertion on the home node.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/dialog-settings.tsx:29` `DialogOperatorSettingsHome` maps `buildOperatorGroupList()` → 12 rows, each `title = group.label`, `description = group.subtitle` (`{Available|Partial|Unavailable} · {n} views · {m} settings`); dialog title `OPERATOR_TOP_TITLE` + `titleView` subtitle `OPERATOR_TOP_SUBTITLE`. Selecting a domain routes to `DialogOperatorDomainPanel domain={group.domain}`. NOTE: `ctx.push` is not exposed by the in-scope Dialog API (`packages/tui/src/ui/dialog.tsx` is OUT of the Feature 011 guard scope — only `replace`/`clear`/`stack` are public), so navigation uses `ctx.replace`, the same API the prior code used; adding a real `push` needs a scope decision (flagged, not bypassed). `bun run typecheck` exit 0; `oxlint` 0 warnings on dialog-settings.tsx.

- [x] **T009 — Domain panel View/Configure split with markers**
- **Depends:** T008
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** `DialogOperatorDomainPanel` renders the `view` and `configure`
  `#VerbList`s as two labelled sections; confirm-required and secret markers baked into
  each subtitle; row selection routes per `#VerbAvailability`/`#InputMode`
  (view→result/panel; confirm→`DialogConfirm`; input→form; unavailable→result) (FR3).
- **Acceptance:** both sections present; markers shown; routing matches the statechart.
- **Verification:** integration assertion on a domain with both sections.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/dialog-settings.tsx:79` `DialogOperatorDomainPanel` consumes `buildOperatorDomainPanel(domain)` and renders `[...panel.view, ...panel.configure]` under DialogSelect categories `View` then `Configure` (remeda `groupBy` preserves first-seen order → two labelled sections). Row title = the centralised `entry.title` (`View:`/`Configure: {verbLabel}`), subtitle = `item.subtitle` (normative copy with `· confirm required` / `· secret` / `Unavailable · not implemented yet` baked in by T003); `verbFooter` adds a `view`/`configure`/`confirm`/`secret`/`unavailable` marker. Selection dispatches through the SAME `executeOperatorCommand` path (FR8) — which already gates secret/confirm (via `DialogConfirm`) and surfaces the honest-unavailable envelope (FR7); no new dispatch path. FORMS SEAM for T010/T011: `resolveConfigureAction(item)` (`:73`) returns an optional form-dialog factory (`(() => JSX.Element) | undefined`); today it returns `undefined` so every verb dispatches directly, and `onSelectVerb` already branches `if (form) dialog.replace(form)` — the forms stage only has to make that helper return a factory for `inputMode !== "none"` verbs. `bun run typecheck` exit 0; `bun test` (tui) 305 pass / 0 fail; `oxlint` 0 warnings on the file.

---

## Group C — Editable configuration forms

- [x] **T010 — Generalise `DialogLangLockPicker` into a reusable operator form**
- **Depends:** T002
- **Paths:** `packages/tui/src/operator/form/**`
- **Deliverable:** extract the value-picker + text-input pattern from
  `packages/tui/src/settings/langlock/index.tsx` into a form component driven by the
  per-verb `#InputMode` descriptors; it collects a typed payload and calls
  `executeOperatorCommand({ ..., payload })` — the SAME dispatch path (FR5, FR8).
- **Acceptance:** `value_picker` and `text_input` modes both collect and emit a payload;
  form never builds a command id/scope from free text; no secret rendered/echoed.
- **Verification:** unit assertion on collected payload shape per mode.
- **Evidence:** 2026-07-19 — new `packages/tui/src/operator/form/descriptor.ts` (`resolveOperatorFormField`, per-verb `OperatorFormField` map) + `packages/tui/src/operator/form/index.tsx` (`OperatorForm`/`openOperatorForm`). `value_picker` renders `DialogSelect` over `field.options()`; `text_input` reuses `DialogPrompt` with `requireText` non-empty validation; both collect a single `{ [field.key]: value }` payload and dispatch via `executeOperatorCommand({ ..., payload })` (`index.tsx:48` `dispatchPayload`) — the form never constructs a command id/scope (execute builds `/op.${entry.id}`). Secret material never rendered/echoed. Smoke (`resolveOperatorFormField`): `langlock.set`→value_picker key=tag/8 options; `jobs.create`→text_input key=definition; `jobs.enable`/`process.cancel`/`task.cancel`→value_picker honest-empty (0 options, entity signal not wired); `langlock.reset`/`telemetry.status`→no form (inputMode none). `bun run typecheck` exit 0; `oxlint` 0 warnings.

- [x] **T011 — Wire persisting-domain Configure verbs to the form**
- **Depends:** T009, T010
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/form/**`
- **Deliverable:** route `langlock.set`/`reset`, the `jobs` mutations,
  `routing.configure`, `process.cancel`/`steer`/`handoff`, `task.cancel` through the
  form; confirm-required verbs pass through `DialogConfirm` after payload collection
  (FR5).
- **Acceptance:** selected persisting Configure verb opens the form and dispatches the
  collected payload; change persists with a version + audit via Feature 007.
- **Verification:** integration assertion that dispatch carries the payload.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/dialog-settings.tsx` `onSelectVerb` (configure branch): `resolveOperatorFormField(entry)` → when a field exists, `dialog.replace(openOperatorForm({ entry, field, port, projectId, sessionId, dialog, toast, back }))`; the collected payload dispatches through `executeOperatorCommand` (unchanged path, FR8). Confirm-required verbs surface `DialogConfirm` inside that path automatically (execute.ts `first.needsConfirmation` → `DialogConfirm.show`) after payload collection — no duplicated confirm gate. Covers `langlock.set` (value_picker) + the 13 persisting Configure verbs via `OPERATOR_INPUT_MODES`. `packages/tui/src/settings/langlock/index.tsx` `DialogLangLockPicker` rewritten to delegate to `OperatorForm` (title `Artifact language`, category `Lang Lock`) — absorbs the picker, no duplicated dispatch (removed local `apply`/`SUCCESS_OUTCOMES`). `bun run typecheck` exit 0; `bun test src/operator src/settings` 79 pass/0 fail; `oxlint` 0 warnings.

- [x] **T012 — Direct dispatch for no-payload verbs; honest-unavailable envelope**
- **Depends:** T009, T011
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/execute.ts`
- **Deliverable:** verbs with `#InputMode=none` dispatch directly (through
  `DialogConfirm` first when confirm-required); honest-unavailable verbs invoke the
  command and surface the typed `unavailable`/`not_implemented` envelope in the result
  toast without synthesizing success (FR7). No change to `executeOperatorCommand`'s
  dispatch path.
- **Acceptance:** no-payload verb dispatches without a form; unavailable verb shows the
  typed envelope; UI never implies persistence.
- **Verification:** integration assertion on an unavailable verb outcome.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/dialog-settings.tsx` `onSelectVerb`: when `resolveOperatorFormField(entry)` returns `undefined` (inputMode `none` — e.g. `langlock.reset` and every honest-unavailable mutation like `telemetry.*`/`smart.*`/`budget.*`/`pools.*`/`output.*`/`semantic.*`/`mcp.*` mutations), it falls through to `run(entry)` → `executeOperatorCommand` with no payload. That path preflights the mutation and shows the backend's typed envelope via `showDisplay` (warning/error variant) — it never synthesizes success; confirm-required no-payload verbs pass through `DialogConfirm.show` first. `execute.ts` unchanged (no new dispatch path, FR8). Rows already marked `Unavailable · not implemented yet · {id}` + `unavailable` footer (T003/T009). Smoke confirms `telemetry.status`/`langlock.reset` → DIRECT (no form). `bun run typecheck` exit 0; `bun test` (tui) 305 pass/1 skip/0 fail.

---

## Group D — Read-side panel wiring

- [x] **T013 — Wire the five read panels into their View section**
- **Depends:** T009
- **Paths:** `packages/tui/src/operator/{jobs,output,langlock,semantic,mcp}/index.tsx`,
  `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** wire the built `jobs`/`output`/`langlock`/`semantic`/`mcp` panels
  into their domain panel's View section, fed by the operator result signal; fall back
  to each panel's honest-empty baseline (`EMPTY_*_SIGNAL`) when no signal is present;
  no mutation on a view selection (FR6).
- **Acceptance:** each panel renders effective state from the signal, or its honest
  empty state; selecting a view verb dispatches no mutation.
- **Verification:** integration assertion on one panel with and without a signal.
- **Evidence:** 2026-07-19 — `packages/tui/src/operator/dialog-settings.tsx`: `PANEL_BY_DOMAIN` maps `{jobs→JobsPanel, output→OutputPanel, langlock→LangLockPanel, semantic→SemanticPanel, mcp→McpPanel}`; `onSelectVerb` view branch → for a panel-bearing domain `dialog.replace(() => <DialogOperatorReadPanel domain label />)` (new component renders the mapped panel with a `back` affordance), else dispatches the query result toast. No structured signal source is reachable through `OperatorSlashPort` today (it returns only display strings — each panel's header comment documents this seam), so the panels render `signal` omitted → their honest `EMPTY_*_SIGNAL` baseline, not a stub; a view selection dispatches no mutation. Panels unmodified (import-only). `bun run typecheck` exit 0; `bun test` (tui) 305 pass/1 skip/0 fail; `oxlint` 0 warnings.

---

## Group E — Tests and doc sync

- [x] **T014 — Unit tests: palette metadata, normative copy, 12 domains**
- **Depends:** T006
- **Paths:** `packages/core/test/operator/**`
- **Deliverable:** assert the normative copy for every row class
  (view/configure/confirm/unavailable/secret), the 12-domain
  `OPERATOR_SETTINGS_DOMAINS`, the `#GroupList` badge + counts, and the static
  availability/input-mode maps; update/remove any test asserting the old
  `"Operator query: <id>"` copy or the flat entry set.
- **Acceptance:** suite green; no assertion of the retired copy or flat wall remains.
- **Verification:** `bun test test/operator` (core) green.
- **Evidence:** 2026-07-19 — new `packages/core/test/operator/palette-menu.test.ts` (16 tests): top copy `Operator`/`Grouped operator settings and views`; asserts no retired `Operator query|mutation` copy on any of the 122 entries; `buildOperatorGroupList()` → 12 rows in `OPERATOR_SETTINGS_DOMAINS` order with subtitle `{Badge} · {n} views · {m} settings` and per-domain badges (langlock/jobs/routing/task/process=Available, semantic/mcp/telemetry=Unavailable); `buildOperatorDomainPanel` View/Configure split with exact subtitles (`Read-only view · langlock.status`, `Editable setting · langlock.set`, `Editable setting · confirm required · jobs.delete`, `Unavailable · not implemented yet · semantic.provider.add`, secret `· mcp.auth.start · secret`); availability classes per sample; `OPERATOR_INPUT_MODES` 14 keys + `none` fallback; suggested ⊂ read-only. `bun test test/operator/palette-menu.test.ts` 16 pass/0 fail; full `bun test test/operator/` 79 pass/0 fail; `bun run typecheck` exit 0.

- [x] **T015 — Unit/integration tests: navigation, form dispatch, honest-unavailable**
- **Depends:** T012, T013
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert one top-level `Operator` entry with no flat per-verb rows;
  home lists 12 domains; the View/Configure split with markers; the form collects and
  dispatches the payload through the same path; an unavailable verb surfaces the typed
  envelope with no synthesized success.
- **Acceptance:** suite green across navigation, form, and honest-unavailable cases.
- **Verification:** `bun test` (tui) green.
- **Evidence:** 2026-07-19 — new `packages/tui/test/operator/{harness.ts,navigation.test.ts,dispatch.test.ts}`. `navigation.test.ts` (7 tests): `operatorSuggestedEntries()` is read-only-only and strictly smaller than the 122-entry catalog (no flat wall, FR1); Home → 12 domain rows with badge subtitles (FR2); langlock panel exposes both View/Configure sections that partition the domain catalog; every View verb across all 12 domains is `mutates===false` (FR6); the `onSelectVerb` routing decision (`section==="view"` → view, else `resolveOperatorFormField` present → form / absent → direct) resolves `langlock.set`/`jobs.create`/`routing.configure`/`process.cancel` → form, `langlock.reset` → direct, honest-unavailable `semantic.provider.add`/`mcp.resource.admin.policy.set` → direct. `dispatch.test.ts` (5 tests) drives the real `executeOperatorCommand` through a spy `OperatorSlashPort`: value_picker payload `{tag}` and text_input payload `{definition}` reach the wire as `/op.<id> {json}` with an idempotency key + preflight; empty text rejected pre-dispatch; honest-unavailable verb surfaces the typed `not_implemented` warning envelope (outcome `not_implemented`, toast variant `warning`, never `success`); secret `mcp.auth.start` refused with zero tryHandle/preflight calls. `bun test test/operator/` 15 pass/0 fail; full `bun test` (tui) 320 pass/1 skip/0 fail; `bun run typecheck` exit 0; `oxlint` 0 warnings/0 errors.

- [x] **T016 — Parity test: palette/form dispatch same command id as slash/CLI**
- **Depends:** T011
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert the palette/form dispatch resolves the SAME canonical command
  id through the SAME `OperatorClient` loopback as slash/CLI, introducing no new
  dispatch path, parallel registry, or divergent name (FR8).
- **Acceptance:** command id parity holds for one query and one mutation; no new path.
- **Verification:** integration/parity assertion green.
- **Evidence:** 2026-07-19 — new `packages/tui/test/operator/parity.test.ts` (3 tests) spies the wire text `executeOperatorCommand` produces via the fake `OperatorSlashPort`: a read query (`langlock.status`) and a mutation (`langlock.set` with `{tag}`) both dispatch the command token `/op.<id>` equal to the entry's `slashAlias` (which itself is `/op.${id}`), proving payload does not fork the id and no divergent name/registry is introduced (FR8); a sample sweep (`langlock.status`,`jobs.status`,`process.status`,`task.status`,`routing.status`) confirms the token is always `/op.<canonical-id>` on the SAME loopback slash/CLI use. `bun test test/operator/parity.test.ts` 3 pass/0 fail; full `bun test` (tui) 320 pass/0 fail; `oxlint` clean.

- [ ] **T017 — Doc sync + `speckit validate` green**
- **Depends:** T014, T015, T016
- **Paths:** docs under allowed globs (spec, ADR-0011, `operator-menu/*.cue`,
  `operator-menu-navigation.md`; `AGENTS.md`/`README.md` only if a surface description
  drifts)
- **Deliverable:** reconcile the shipped copy and node names with the spec, ADR, schema,
  and statechart; run `speckit analyze` and `speckit validate --json` clean of new
  Feature 011 findings.
- **Acceptance:** `speckit validate --json` → 0 new findings on Feature 011 artifacts;
  `speckit status` completeness ok.
- **Verification:** `speckit analyze` + `speckit validate --json`.
- **Evidence:** 2026-07-19 — Checked `AGENTS.md`/`README.md` for operator-palette surface drift: Feature 007's operator control-plane description (sole management path, reserved catalog, flag) is unchanged and still accurate — no flat-list detail lived there, so no edit needed. Recorded the two implement-time decisions in `plan.md` under a new "Implementation notes" section: (1) navigation uses `ctx.replace` not `push` — the in-scope Dialog API (`packages/tui/src/ui/dialog.tsx`, out of guard scope) has no `push` primitive (T008); (2) the five read panels render honest-empty (`EMPTY_*_SIGNAL`) because `OperatorSlashPort` exposes no structured result signal today (T013). `speckit validate --json` → `"ok":true`, 4 findings, all pre-existing waived `hygiene.empty-file` on unrelated files (`packages/desktop/src/renderer/styles.css`, `packages/opencode/test/config/fixtures/no-frontmatter.md`, `packages/plugin/.gitignore`, `sdks/vscode/.gitignore`) — 0 new Feature 011 findings. `speckit status` → phase `implement`, status `implemented`, completeness `ok`, lock off, next `none`.

---

## Dependencies summary

```
(T001 ∥ T002 ∥ T004) → T003 → T005
T001+T002+T003+T004 → T006
T005 → T007 → T008 (needs T006) → T009
T002 → T010 ; T009+T010 → T011 → T012
T009 → T013
T006 → T014 ; T012+T013 → T015 ; T011 → T016
T014+T015+T016 → T017
```

## Parallelism rules

- Only `[P]` tasks may run concurrently, and only when path sets do not overlap.
- Never parallelize two tasks writing the same module (`palette.ts`,
  `dialog-settings.tsx`).
- Group A (core `palette.ts`) precedes the TUI groups that consume its projection.

## Task counts

| Group                     | Tasks             | Phase |
| ------------------------- | ----------------- | ----- |
| A Core palette metadata   | T001–T006 (6)     | 1     |
| B TUI navigation          | T007–T009 (3)     | 2     |
| C Editable forms          | T010–T012 (3)     | 3     |
| D Read panels             | T013 (1)          | 4     |
| E Tests + doc sync        | T014–T017 (4)     | 5     |
| **Total actionable**      | **T001–T017 (17)** |      |

## Definition of done

- FR1–FR8 covered; the flat wall removed, 12 domains grouped, View/Configure split.
- Persisting-domain Configure verbs dispatch a real payload through the form.
- The five read panels render from the signal with honest-empty fallback.
- Honest-unavailable verbs surface the typed envelope; no synthesized success.
- No new dispatch path, registry, divergent name, or feature flag (FR8 parity).
- Palette metadata copy matches the spec + `operator-menu/text-values.cue`.
- Test suites green; `speckit validate --json` clean of new Feature 011 findings.
