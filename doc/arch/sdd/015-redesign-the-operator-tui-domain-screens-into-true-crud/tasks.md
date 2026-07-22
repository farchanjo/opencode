# Tasks: Redesign the Operator TUI Domain Screens into True CRUD (Feature 015)

Synced with plan.md (Phase 1 single entry + titles, Phase 2 screen composition +
inline status, Phase 3 toggle + tri-state controls, Phase 4 edit + view modal
component, Phase 5 entity CRUD, Phase 6 honesty + parity, Phase 7 tests + doc
sync) and the specScopeGlobs in doc/arch/speckit.toml. ADR-0015 proposed.

Presentation-and-composition ONLY. NO new catalog id, NO catalog version bump, NO
new dispatch path, NO new flag, NO new dialog primitive — the Feature 007
registration + `OperatorClient` loopback parity invariant (FR17) is preserved.
Every screen action dispatches the SAME command id through the SAME
`executeOperatorCommand` path under CAS and honest-degrades to a typed envelope
(FR15). An unavailable verb (the Feature 014 per-verb `Partial` truth) renders
marked + inert, never a fabricated success. No code is executed in this
documentary pass; tasks are the implement backlog. All items start unchecked.

## Task Breakdown

Checkbox backlog (details under each group below).

- [x] T001 — Remove the suggested-row spread in `app.tsx` (one Operator entry)
- [x] T002 — Retire the `suggest` field + `listOperatorSuggestedEntries` + `operatorSuggestedEntries`
- [x] T003 — Centralise the unique row-title copy contract in `palette.ts`
- [x] T004 — Silent status read on open → inline generic key/value StatusSection
- [x] T005 — Wire the rich panels as the status section for jobs/output/langlock/semantic/mcp
- [x] T006 — Remove the non-rich View toast branch (`dialog-settings.tsx:185`)
- [x] T007 — Refetch the StatusSection after every on-screen mutation
- [x] T008 — Collapse on/off verb pairs into one ToggleRow (state badge, opposite verb)
- [x] T009 — Render the smart on/off/auto TriStateRow pre-selected picker
- [x] T010 — Operator-scoped modal component over the Dialog push/back-stack
- [x] T011 — Edit modal pre-fill from current value + fix the `descriptor.ts` empty-input residual
- [x] T012 — Edit modal field validation + Save dispatch + in-modal error
- [x] T013 — Structural view modal (key/value tree, Esc closes)
- [x] T014 — Jobs entity CRUD: list → item → edit/reschedule/toggle/delete(confirm)/create
- [x] T015 — Semantic entity CRUD: providers/models list → add/edit/rotate-secret/disable/delete
- [x] T016 — MCP entity CRUD: servers list → add/edit/connect-disconnect/delete
- [x] T017 — Honest availability on every control (per-verb `Partial` marked + inert)
- [x] T018 — Toast discipline: toasts only for a mutation's final outcome
- [x] T019 — Palette tests (one entry, no spread, `suggest` removed, unique titles)
- [x] T020 — Screen composition tests (inline status, no toast branch, refetch, conflict keeps state)
- [x] T021 — Controls tests (toggle opposite-verb, inert unavailable, tri-state pre-selected)
- [x] T022 — Modal tests (pre-fill, in-modal validation/error, view tree, Esc)
- [x] T023 — Entity CRUD tests (jobs/semantic/mcp list → item → actions; typed gaps marked)
- [x] T024 — Parity + honest-availability test (same id, no new path/id/version bump)
- [x] T025 — Guard scope confirm (no new `speckit.toml` glob) + doc sync
- [x] T026 — `speckit analyze` + `speckit validate --json` green

---

## Group A — Single Operator entry and unique titles (FR1, FR2, FR3)

- [x] **T001 — Remove the suggested-row spread in `app.tsx`**
- **Depends:** none
- **Paths:** `packages/tui/src/app.tsx`
- **Deliverable:** delete the `...operatorSuggestedEntries().map(...)` block
  (`packages/tui/src/app.tsx:981`) so exactly one `Operator` Commands entry (opening
  `DialogOperatorSettingsHome`) is registered; drop the now-unused
  `operatorSuggestedEntries` import (FR1).
- **Acceptance:** the top-level Commands palette lists exactly one Operator-category
  entry; no `View: Status …` suggested rows appear.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** removed the `...operatorSuggestedEntries().map(...)`
  spread (`packages/tui/src/app.tsx` ~977-1009) leaving only the single
  `operator.settings` entry that opens `DialogOperatorSettingsHome`; dropped the
  now-dead `operatorSuggestedEntries`/`executeOperatorCommand` import
  (`app.tsx:74`), the orphaned `useOperatorSlash` import (`app.tsx:76`) and its
  local `const operatorSlash` (`app.tsx:395`). `bun test --cwd=packages/tui
  test/operator/` → 64 pass / 0 fail; `bun run typecheck` (tui) clean.

- [x] **T002 — Retire the `suggest` machinery**
- **Depends:** T001
- **Paths:** `packages/core/src/operator/palette.ts`, `packages/tui/src/operator/execute.ts`
- **Deliverable:** remove the `suggest` field from `OperatorPaletteEntry`
  (`palette.ts:44`), delete `listOperatorSuggestedEntries` (`palette.ts:332`) and the
  `suggest` computation in `listOperatorPaletteEntries`, and delete the
  `operatorSuggestedEntries` re-export in `operator/execute.ts` — leaving no dead
  code path. Keep `buildOperatorGroupList`/`buildOperatorDomainPanel` (FR2).
- **Acceptance:** no symbol references the retired `suggest` machinery; typecheck
  clean; the retirement is recorded in ADR-0015.
- **Verification:** `bun run typecheck`; `grep` finds no `operatorSuggestedEntries`/`listOperatorSuggestedEntries` residue.
- **Evidence (2026-07-19):** dropped `readonly suggest` from `OperatorPaletteEntry`
  and its `suggest` computation + object key in `listOperatorPaletteEntries`;
  deleted `listOperatorSuggestedEntries` and the `suggested: e.suggest` field
  (and its type) from `buildOperatorPaletteCommands`
  (`packages/core/src/operator/palette.ts`); removed the
  `listOperatorSuggestedEntries` re-export (`packages/core/src/operator/index.ts`);
  deleted the `operatorSuggestedEntries` re-export + its import
  (`packages/tui/src/operator/execute.ts`). Retired-machinery tests replaced
  (`palette-menu.test.ts`, `navigation.test.ts`) with retirement assertions,
  never weakened. `grep` for `operatorSuggestedEntries`/`listOperatorSuggestedEntries`/
  `.suggest`/`suggest:` across src+test → only the intentional
  `"operatorSuggestedEntries" in executeModule` retirement assertion remains.
  Typecheck (core + tui) clean; `buildOperatorGroupList`/`buildOperatorDomainPanel`
  untouched. ADR-0015 update is deferred to T025 doc-sync (per its scope).

- [x] **T003 — Centralise the unique row-title copy contract**
- **Depends:** T002
- **Paths:** `packages/core/src/operator/palette.ts`, `packages/core/test/operator/**`
- **Deliverable:** centralise the row-title copy so no two rows on a surface share a
  human title — scope a verb title to its domain screen (action-only where the
  domain is implicit, domain-qualified where not), keep the dotted command id as the
  secondary line, and eliminate the `View: Status` ×8 duplication (FR3).
- **Acceptance:** a uniqueness assertion over each domain panel's rows passes; the
  dotted id is never the primary label.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence (2026-07-19):** replaced `verbTitleFor` (which emitted the
  duplicated `View: {label}`/`Configure: {label}`) with `entryTitleFor(domainLabel,
  verbLabel)` in `packages/core/src/operator/palette.ts` — the entry-level `title`
  (surface where the domain is NOT implicit) is now the domain-qualified,
  globally-unique `{Domain} {action}` (e.g. `Telemetry status`, `Langlock set`),
  eliminating the `View: Status` ×8 duplication. Domain-screen rows keep the
  action-only `verbLabel` as the row title (domain implicit) via the unchanged
  `toVerbItem`, with the dotted id only in `subtitle`/`description`. New tests in
  `palette-menu.test.ts` assert: entry titles are domain-qualified and never a
  dotted id; entry titles are globally unique with no `View: Status`; and each of
  the 12 domain panels has unique row labels with the id only as the secondary
  line. `bun test --cwd=packages/core test/operator/` → 98 pass / 0 fail;
  typecheck clean.
- **Fix (2026-07-19):** the TUI `verbOption` (`packages/tui/src/operator/dialog-settings.tsx:398`)
  had rendered `entry?.title ?? item.label`; since the entry always resolves it
  always used the domain-qualified `entry.title` (`{Domain} {action}`, e.g.
  `Telemetry status`) on the domain screen — the domain-implicit surface whose
  header already reads `Operator · Telemetry` — contradicting FR3 ("where the
  domain is implicit, a verb title reads as its action") and this task's own
  claim that the action-only `verbLabel` is the row title. Changed to
  `title: item.label` so the domain screen renders the action-only label; the
  domain-qualified `entry.title` stays reserved for the domain-explicit top-level
  command. Pinned by a new `Feature 015 T003/T020` block in
  `packages/tui/test/operator/screen-composition.test.ts` asserting every
  domain-screen row title equals the action-only `item.label`, is never the
  domain-qualified `entry.title` nor a dotted id, and is unique per surface. `bun
  test --cwd=packages/tui test/operator/` → 130 pass / 0 fail; `bun test
  --cwd=packages/core test/operator/` → 103 pass / 0 fail; typecheck (tui + core)
  + oxlint clean.

---

## Group B — Domain screen composition: inline status (FR4, FR5, FR6)

- [x] **T004 — Silent status read on open → inline generic StatusSection**
- **Depends:** T003
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/**`
- **Deliverable:** on domain-screen open, issue the domain's status read through
  `executeOperatorCommand` with the silent option and render an inline
  **StatusSection** using a generic key/value renderer projected from the effective
  payload for the plain domains; no toast on the silent read (FR4, FR18).
- **Acceptance:** opening a plain domain screen renders its status inline; no toast
  is emitted for the silent read.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** added the pure, total projection module
  `packages/tui/src/operator/status.ts` (`toStatusNodes` → bounded key/value nodes
  from an opaque effective payload; non-record/absent → honest empty list, nested
  objects/arrays → `{n}`/`[n]` summaries, values truncated at 80, ≤`MAX_STATUS_NODES`
  rows; `plainStatusReadId(domain)` = `<domain>.status`). New component
  `OperatorStatusSection` (`packages/tui/src/operator/dialog-settings.tsx`) issues the
  domain's status read via `executeOperatorCommand({ silent: true })` on `onMount`,
  and `StatusKeyValue` renders the generic projection for plain domains with distinct
  Loading/`Status unavailable`/`No status reported`/rows states. Wired at the TOP of
  `DialogOperatorDomainPanel` (now a column wrapping the inline section + the
  `DialogSelect`). No toast on the silent read (`silent:true` routes the toast to a
  no-op). New `packages/tui/test/operator/status.test.ts` (6 tests) pins the
  projection + the `<domain>.status` convention for every plain domain. `bun test
  --cwd=packages/tui test/operator/` → 70 pass / 0 fail; typecheck (tui + core) clean;
  oxlint on changed files → 0 warnings / 0 errors.

- [x] **T005 — Wire the rich panels as the status section**
- **Depends:** T004
- **Paths:** `packages/tui/src/operator/{jobs,output,langlock,semantic,mcp}/**`, `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** render the existing rich read panels as the status section for
  `jobs`/`output`/`langlock`/`semantic`/`mcp`, fed by the Feature 012 result signal,
  falling back to their honest empty state when no signal exists (FR4).
- **Acceptance:** each rich domain's screen shows its panel inline as status on
  open; honest empty fallback holds.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** `OperatorStatusSection` branches on the existing
  `READ_PANEL_BY_DOMAIN` map — for `jobs`/`output`/`langlock`/`semantic`/`mcp` it reads
  the mapped read id (`jobs.list`/`output.stat`/`langlock.status`/`semantic.model.list`/
  `mcp.server.list`) silently and renders that domain's rich panel
  (`rich.render(() => status().value)`) fed by the Feature 012 per-domain projection,
  which degrades to each panel's honest `EMPTY_*_SIGNAL` when the effective is
  absent/mismatched. The rich-read id stays sourced solely from `READ_PANEL_BY_DOMAIN`
  (no duplication); `status.ts` owns only the plain `<domain>.status` convention. The
  existing `DialogOperatorReadPanel` is kept for rich domains' detail View verbs.
  `bun test --cwd=packages/tui test/operator/` → 70 pass / 0 fail; typecheck clean.

- [x] **T006 — Remove the non-rich View toast branch**
- **Depends:** T004, T013
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** delete the branch that dispatches a toast for a non-rich domain's
  View verb (`dialog-settings.tsx:185`); route detail verbs to the view modal (T013)
  instead (FR5).
- **Acceptance:** no View path emits a toast; a plain domain's detail verb opens the
  view modal.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** removed the `void run(entry)` toast branch from
  `DialogOperatorDomainPanel.onSelectVerb`'s `section === "view"` arm. A rich domain's
  detail verb still pushes `DialogOperatorReadPanel`; every other domain's detail verb
  now pushes the new `DialogOperatorViewPanel` — an IN-INTERFACE placeholder over the
  Dialog push/back-stack for the T013 structural view modal that silently reads the
  specific detail verb and renders its effective payload as a read-only key/value tree
  (`StatusKeyValue`), Esc-closable, never a toast. T013 (Group D) will formalise this
  as the FR11/FR16 structural view modal component; the placeholder is the in-screen
  renderer the stage brief called for while T013 is pending. No View path emits a
  toast. `bun test --cwd=packages/tui test/operator/` → 70 pass / 0 fail.

- [x] **T007 — Refetch the StatusSection after every on-screen mutation**
- **Depends:** T004, T012
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/**`
- **Deliverable:** after any on-screen mutation returns, re-issue the silent status
  read so the StatusSection reflects the commit; on a `version_conflict`/typed gap
  keep the prior state and surface the typed reason (FR6, FR15).
- **Acceptance:** a successful mutation refreshes the status; a stale mutation leaves
  the prior state and surfaces the typed reason.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** added a `statusVersion` signal in
  `DialogOperatorDomainPanel` passed as `refreshKey` to `OperatorStatusSection`, which
  reloads via `createEffect(on(refreshKey, load, { defer: true }))` (initial load stays
  on `onMount`). `run()` (the on-screen direct-dispatch mutation path) now inspects the
  dispatch outcome and bumps `statusVersion` ONLY on a committed outcome
  (`SUCCESS_OUTCOMES = {success, idempotent_replay}`); a `version_conflict`/typed gap
  does NOT refetch, keeping the prior state while `executeOperatorCommand` surfaces the
  typed reason — mirroring the statechart `outcome_success → refetch` vs.
  `outcome_typed_gap → screen (prior state kept)`. The toggle/edit-modal mutation paths
  (T008/T012) will bump the same signal when built. `bun test --cwd=packages/tui
  test/operator/` → 70 pass / 0 fail; typecheck clean.

---

## Group C — Toggle and tri-state controls (FR7, FR8)

- [x] **T008 — Collapse on/off verb pairs into one ToggleRow**
- **Depends:** T003
- **Paths:** `packages/core/src/operator/palette.ts`, `packages/tui/src/operator/**`
- **Deliverable:** classify enable/disable verb pairs (`telemetry.on`/`off`,
  `smart.on`/`off`, per-entity `jobs.enable`/`disable`, `mcp.experimental`/
  `extension` `enable`/`disable`) and render ONE **ToggleRow** with a current-state
  badge whose action dispatches the opposite verb of the current state; an
  unavailable backend renders the row inert and marked (FR7, FR15).
- **Acceptance:** an on/off pair renders one toggle row; its action dispatches the
  opposite verb; an unavailable toggle never dispatches.
- **Verification:** `bun test packages/tui/test/operator/**`, `packages/core/test/operator/**`.
- **Evidence (2026-07-19):** added the pure classifier
  `buildOperatorScreenControls(domain)` +
  `OperatorToggleControl`/`OperatorTriStateControl`/`OperatorScreenControls`
  (`packages/core/src/operator/palette.ts`, re-exported from
  `operator/index.ts`): it groups a domain's **payload-free** (`inputMode ===
  "none"`) Configure verbs by control base and collapses each `on`+`off`
  (`enable`+`disable`) pair into one toggle (`telemetry` → `Telemetry`,
  `mcp.experimental`/`mcp.extension` → `Experimental`/`Extension`), folding member
  availabilities so a `honest_unavailable` backend yields an inert `unavailable`
  control (FR15). Per-entity `jobs.enable`/`disable` (`value_picker`, select an
  id) are EXCLUDED from domain toggles — they belong to the entity CRUD screens
  (T014). New pure `packages/tui/src/operator/controls.ts` derives the live badge:
  `toggleStateFrom` reads the domain status `effective.enabled`
  (enabled/disabled/unavailable/honest-`unknown`), `toggleBadge`, and
  `toggleTargetId` resolves the **opposite** verb (enabled→disable, else→enable).
  `DialogOperatorDomainPanel` (`dialog-settings.tsx`) lifts a single silent
  `<domain>.status` read shared by the inline section and the control badges,
  renders toggles in a `Controls` group, and `onToggle` dispatches
  `toggleTargetId` through the SAME `executeOperatorCommand`/`run` loopback
  (opposite verb; an unavailable toggle still rides the loopback and surfaces the
  typed envelope, never a fabricated success). Tests:
  `packages/core/test/operator/screen-controls.test.ts` (telemetry single toggle;
  mcp two inert toggles; jobs excluded; controls partition the Configure verbs) +
  `packages/tui/test/operator/controls.test.ts` (state/badge/opposite-verb
  derivation) + `modal.test.ts` (opposite verb rides `/op.telemetry.off`). Core
  103 pass, tui 88 pass; typecheck + oxlint clean.

- [x] **T009 — Render the smart on/off/auto TriStateRow pre-selected picker**
- **Depends:** T008
- **Paths:** `packages/tui/src/operator/**`, `packages/core/src/operator/palette.ts`
- **Deliverable:** render smart-routing `on`/`off`/`auto` as a **TriStateRow** whose
  action opens a three-option picker (a `DialogSelect` over the three verbs)
  pre-selected to the current mode, dispatching the selected mode — never a binary
  toggle (FR8).
- **Acceptance:** the picker opens pre-selected to the current mode; selecting a
  mode dispatches that mode's verb.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** `buildOperatorScreenControls` classifies a base with
  an `auto` pole (smart `on`/`off`/`auto`) as a `tristate` control (never a binary
  toggle, FR8) carrying its three canonical mode ids. `controls.ts`
  `triStateModeFrom` derives the current mode from `smart.status` effective
  (`auto` wins, else `enabled` → on/off, else honest `unknown`); `triStateBadge` +
  `triStateOptionLabel` render the copy. In `dialog-settings.tsx` a tri-state row
  renders in the `Controls` group with the mode badge; `openTriStatePicker` pushes
  a `DialogSelect` over the three modes with `current` pre-selected to the derived
  mode, and each option dispatches its mode verb through `run` (same loopback)
  then pops back to the screen. Tests: `screen-controls.test.ts` (smart is one
  tri-state with `smart.on/off/auto`, never a toggle) + `controls.test.ts`
  (mode/badge derivation) + `modal.test.ts` (selection dispatches `/op.smart.auto`).

---

## Group D — Edit and view modal component (FR9, FR10, FR11, FR16)

- [x] **T010 — Operator-scoped modal component over the Dialog push/back-stack**
- **Depends:** T003
- **Paths:** `packages/tui/src/operator/form/**`, `packages/tui/src/ui/dialog.tsx`
- **Deliverable:** add a small operator-scoped modal component under
  `operator/form/` built over the existing `ui/dialog.tsx` push/back-stack — NOT a
  new dialog primitive — defining a title, fields (label + pre-filled value + input
  kind + validation), footer Save/Cancel, a busy state, and an in-modal error
  surface (FR16).
- **Acceptance:** the component renders title/fields/footer/busy/error and pushes/
  pops on the existing back-stack without a new primitive.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** added `OperatorEditModal`/`openOperatorEditModal`
  (`packages/tui/src/operator/form/edit-modal.tsx`) — a small operator-scoped
  component over the EXISTING Dialog push/back-stack, NOT a new dialog primitive.
  It composes the existing `DialogPrompt` (text branch: title, pre-filled `value`,
  `busy`, `description` slot repurposed as the in-modal error surface, Save via
  `onConfirm`, Cancel via `onCancel` → `dialog.pop`) and `DialogSelect` (picker
  branch: `current` pre-selected + an in-modal error box below). To close a modal
  back to the screen on success without `clear`ing the whole operator stack, added
  the complementary back-stack op **`pop()`** to `DialogContext`
  (`packages/tui/src/ui/dialog.tsx`) — mirrors the escape binding (runs the top
  level's `onClose` once, slices one level, refocuses); the fake dialog in
  `test/operator/harness.ts` gained a `pop` no-op. New render test in
  `integration.test.tsx` asserts `dialog.pop()` unwinds exactly one level and runs
  that level's `onClose` once. `bun test test/operator/integration.test.tsx` → 8
  pass; typecheck + oxlint clean.

- [x] **T011 — Edit modal pre-fill from current value + fix the empty-input residual**
- **Depends:** T010
- **Paths:** `packages/tui/src/operator/form/**`
- **Deliverable:** on edit-modal open, silently read the current effective value and
  pre-fill each field (no empty text inputs; honest empty + placeholder when absent),
  fixing the Feature 014 `descriptor.ts` empty-input residual (FR9, FR10).
- **Acceptance:** an editable setting with a current value opens pre-filled; an
  absent value renders an empty field with a placeholder, not a fabricated default.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** added the pure pre-fill descriptor
  `packages/tui/src/operator/form/edit-descriptor.ts` —
  `resolveOperatorEditPrefill(id)` maps an editable verb to `{ readId,
  extract(effective) }`, a TOTAL extraction of the current value string from the
  verb's redacted status read: `langlock.set` → `langlock.status`.`tag`,
  `output.retention.set`/`output.quota.set` → `output.stat`.`retention`/`quota`
  re-serialised as compact JSON. `OperatorEditModal` issues the descriptor's read
  **silently** on mount and seeds the field (`DialogPrompt` `value` for text; a
  `current` pre-selection for the picker), closing the Feature 014 residual where
  the text input opened blank. An honest absence (no descriptor, or a read that
  carries no effective) resolves to `undefined` → an empty field with a
  placeholder, never a fabricated default (FR10); secret-bearing verbs
  (`semantic.provider.rotate-secret`) are intentionally NOT pre-filled so no
  resolved secret is ever seeded (FR15). Verbs whose current value has no
  well-defined redacted read (`routing.configure`, telemetry endpoint/transport,
  budget/pools honest-unavailable, semantic selects) open honest-empty rather than
  guess a shape — the descriptor map is the single extension point as those reads
  land. Tests: `packages/tui/test/operator/modal.test.ts` (langlock/output
  extraction; honest-empty on absent effective; no-descriptor + secret verbs
  yield `undefined`). `bun test test/operator/` → 88 pass; typecheck clean.

- [x] **T012 — Edit modal validation + Save dispatch + in-modal error**
- **Depends:** T011
- **Paths:** `packages/tui/src/operator/form/**`, `packages/tui/src/operator/execute.ts`
- **Deliverable:** validate each field in-modal before dispatch; Save dispatches
  through `executeOperatorCommand`, closes on success, and surfaces a typed error
  **in the modal** (not a toast) on failure (FR9, FR16, FR18).
- **Acceptance:** invalid input is rejected in-modal; Save closes on success; a typed
  failure surfaces in-modal, not as a toast.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** `OperatorEditModal.submitText` runs the field's
  `validate` BEFORE dispatch and, on an invalid value, sets the in-modal `error`
  signal (rendered in the `DialogPrompt` `description` slot) — NOT a toast.
  `dispatchPayload` dispatches through the SAME `executeOperatorCommand` loopback
  with `silent: true` so no toast fires; on a committed outcome
  (`success`/`idempotent_replay`) it `dialog.pop()`s the modal (close-on-success),
  and on a typed failure it surfaces `failureReason(result)` IN-MODAL. To give the
  modal the exact typed reason, `executeOperatorCommand` now additively returns the
  dispatch `display` (populated at every mutation return site + synthesized for
  preflight/conflict); `failureReason` prefers `display.message`, else the typed
  `outcome`, always bounded and secret-free (FR18). A `cancelled` confirm keeps the
  modal open with no error. Tests: `modal.test.ts` — `failureReason` precedence; a
  committed silent Save returns the display + emits zero toasts; a failed silent
  Save forwards `"tag not in allowlist"` with zero toasts. `bun test
  test/operator/` → 88 pass; the existing `dispatch.test.ts` parity assertions
  (display forwarding is additive) stay green.

- [x] **T013 — Structural view modal**
- **Depends:** T010
- **Paths:** `packages/tui/src/operator/form/**`, `packages/tui/src/operator/**`
- **Deliverable:** render a detail verb's effective payload as a **structural
  key/value tree** in a read-only view modal that closes on Esc; honest empty tree
  when the payload is absent (FR11, FR18).
- **Acceptance:** a detail verb opens the tree view modal; Esc closes it; no toast
  is emitted; an absent payload renders the honest empty tree.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** added `OperatorViewModal`/`openOperatorViewModal`
  (`packages/tui/src/operator/form/view-modal.tsx`) — a read-only modal over the
  Dialog push/back-stack that silently reads the detail verb through the SAME
  `executeOperatorCommand` loopback (no new dispatch path, FR17) and renders its
  `effective` as a structural key/value tree via the pure `toStatusNodes`
  projection (mirrors `view.cue #ViewTree`/`#ViewNode`); it never dispatches a
  mutation and never toasts, and an absent effective renders the honest empty tree
  (`No detail reported`), never a synthesized value. Esc pops it (Dialog escape
  binding; the `esc` affordance calls `dialog.pop`). This FORMALISES and REPLACES
  the T006 `DialogOperatorViewPanel` placeholder: it is removed and
  `DialogOperatorDomainPanel.onSelectView` now pushes `openOperatorViewModal` for
  a plain domain's detail verb (rich domains still push their read panel). No View
  path emits a toast (FR5/FR18). `bun test test/operator/` → 88 pass; typecheck +
  oxlint clean.

---

## Group E — Entity CRUD: jobs, semantic, mcp (FR12, FR13, FR14)

- [x] **T014 — Jobs entity CRUD**
- **Depends:** T007, T008, T012, T013
- **Paths:** `packages/tui/src/operator/jobs/**`, `packages/tui/src/operator/**`
- **Deliverable:** render the jobs list; a job pushes an item screen offering edit
  (edit modal), reschedule (edit modal), an enable/disable toggle, and delete behind
  the confirm gate; the list offers create; `run-now` renders a marked typed gap
  (Feature 014 FR9/FR10) (FR12).
- **Acceptance:** list → item → edit/reschedule/toggle/delete(confirm)/create all
  dispatch the canonical ids; `run-now` is marked inert.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** added the pure classifier
  `packages/tui/src/operator/entity.ts` — `resolveOperatorEntityScreen("job")`
  (`listRead=jobs.list`, `createId=jobs.create`, `idKey=jobDefinitionId`),
  `projectEntityRows("job", …)` (total, from `projectJobsSignal(...).definitions`,
  honest-empty on absence), and `buildOperatorEntityActions("job", row)` which
  yields ONE enable/disable **toggle** dispatching the OPPOSITE of the row's live
  `active` state (`jobs.disable` when enabled, `jobs.enable` when disabled) plus
  `edit`(`jobs.update`, modal), `reschedule`(`jobs.reschedule`, modal),
  `delete`(`jobs.delete`, confirm), and `run_now`(`jobs.run-now`) folded to
  `unavailable` via the presentation `TYPED_GAP_IDS` set so it renders marked +
  inert (Feature 014 FR9/FR10) while still riding the loopback to surface the typed
  envelope. New TUI screens `DialogOperatorEntityList`/`DialogOperatorEntityItem`
  (`packages/tui/src/operator/entity-screens.tsx`) over the EXISTING Dialog
  push/back-stack (no new primitive): the list silently reads `jobs.list`, renders
  create + rows; a row pushes the item; the item's toggle/direct dispatch through
  the SAME `executeOperatorCommand` loopback then refetch + pop, `edit`/`reschedule`
  push the pre-filled edit modal seeded with `{ jobDefinitionId }` via the new
  additive `basePayload`/`onSaved` modal props, and `delete` rides
  `DialogConfirm.show`. Wired from `DialogOperatorDomainPanel` as a `Manage Jobs`
  Entities row; the per-entity Configure verbs are consumed out of the plain
  settings list (`entityConsumedConfigureIds`) so no verb renders twice. Tests:
  `packages/tui/test/operator/entity.test.ts` — jobs row projection, opposite-verb
  toggle, edit/reschedule/delete verbs, run-now marked inert, and dispatch parity
  (`/op.jobs.disable {"jobDefinitionId":…}`, `/op.jobs.delete …`). `bun test
  --cwd=packages/tui test/operator/` → 104 pass / 0 fail; typecheck + oxlint clean.

- [x] **T015 — Semantic entity CRUD**
- **Depends:** T007, T008, T012, T013
- **Paths:** `packages/tui/src/operator/semantic/**`, `packages/tui/src/operator/**`
- **Deliverable:** render providers and models as lists; provider
  add/edit/rotate-secret/disable/delete and model register/disable/delete through
  the toggle/edit-modal/confirm contract; secrets `SecretRef`-only (Feature 014
  FR11); Milvus-gated index ops marked typed gaps (FR13).
- **Acceptance:** provider/model CRUD dispatches canonical ids; secrets stay
  `SecretRef`; index ops marked inert.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** `entity.ts` exposes two semantic kinds —
  `provider` (`listRead=semantic.provider.list`, `createId=semantic.provider.add`,
  `idKey=id`; `projectProviderRows` reads `{ profiles: [...] }`) and `model`
  (`listRead=semantic.model.list`, `createId=semantic.model.register`;
  `projectModelRows` reuses `projectSemanticSignal(...).models`). Provider actions:
  `edit`(`semantic.provider.update`, modal), `rotate_secret`
  (`semantic.provider.rotate-secret`, modal), `disable`
  (`semantic.provider.disable`, direct), `delete`(`semantic.provider.delete`,
  confirm); model actions: `disable`(`semantic.model.disable`). No
  `semantic.model.delete`/`model.edit` id exists in the reserved catalog, so none
  is fabricated (FR17). `rotate-secret` folds to `unavailable` (`secretRelated` +
  keychain-gated `executable=false`) — the edit modal never pre-fills a resolved
  secret (`resolveOperatorEditPrefill` omits it) and the field edits a `SecretRef`
  reference only (Feature 014 FR11); on Save it surfaces the typed "secret
  unavailable" envelope in-modal, never a fabricated success. The Milvus-gated
  `semantic.index.*`/`embedding.reindex|cutover|rollback` verbs stay the domain's
  `unavailable` (non-persisting) settings/dispatch rows (unchanged, marked typed
  gaps). Wired as two Entities rows (`Manage Providers`/`Manage Models`) on the
  semantic screen; provider/model Configure verbs consumed from settings. Tests:
  `entity.test.ts` — provider action set with the secret rotate marked inert, model
  disable id, `profiles` row projection. Covered by the 104-pass tui run.

- [x] **T016 — MCP entity CRUD**
- **Depends:** T007, T008, T012, T013
- **Paths:** `packages/tui/src/operator/mcp/**`, `packages/tui/src/operator/**`
- **Deliverable:** render servers as a list; add/edit/connect-disconnect/delete,
  where connect/disconnect is a toggle over the live service state; unreachable ops
  marked typed gaps (FR14).
- **Acceptance:** server CRUD dispatches canonical ids; connect/disconnect toggles
  the live state; unreachable ops marked inert.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** `entity.ts` `mcp_server` kind
  (`listRead=mcp.server.list` — the live read; `createId=mcp.server.add`,
  `idKey=id`; `projectServerRows` reuses `projectMcpSignal(...).servers` and derives
  `active = connectionState === "connected"`). The connect/disconnect **toggle**
  reflects the live connection state and dispatches the OPPOSITE verb
  (`mcp.server.disconnect` when connected, `mcp.server.connect` when disconnected);
  actions also include `edit`(`mcp.server.update`, modal→direct when no field) and
  `delete`(`mcp.server.delete`, confirm). Because the whole mcp backend is
  honest-unavailable today (mcp is not a persisting domain), every mutating action
  folds to `unavailable` and renders marked + inert — invoking one still rides the
  SAME `executeOperatorCommand` loopback and surfaces the typed
  `unavailable`/`mcp_unavailable` envelope, never a fabricated success (FR15). The
  `mcp.server.list` read stays available and honest-empty. Wired as a `Manage
  Servers` Entities row; server CRUD verbs consumed from settings. Tests:
  `entity.test.ts` — connect/disconnect toggle over the live state and every mcp
  action marked inert. Covered by the 104-pass tui run.

---

## Group F — Honesty and parity wiring (FR15, FR17, FR18)

- [x] **T017 — Honest availability on every control**
- **Depends:** T008, T012, T013, T014, T015, T016
- **Paths:** `packages/tui/src/operator/**`, `packages/core/src/operator/palette.ts`
- **Deliverable:** every control (toggle, tri-state, edit, view, entity action)
  consults the Feature 014 per-verb availability
  (`palette.ts` `persistenceFor`/`domainBadge`) and renders an unavailable verb
  marked + inert, surfacing the typed envelope on invocation, never a fabricated
  success (FR15).
- **Acceptance:** an unavailable verb's control is inert and surfaces the typed
  envelope; no control synthesizes state.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** the honest sweep threads the SAME source of truth
  through every screen: domain toggles/tri-states already fold
  `controlAvailabilityOf` (T008/T009); entity actions fold `entityAvailability(id)`
  in `entity.ts`, which reads the Feature 014 palette per-verb `availability` and
  additionally marks a verb inert when it is secret-keychain-gated
  (`!executable || secretRelated`) OR a presentation typed gap (`jobs.run-now`).
  Consequently: jobs CRUD is available with `run-now` inert; semantic providers are
  available with the secret rotate + the Milvus index ops inert; the entire mcp
  server CRUD is inert (honest-unavailable backend). No `packages/opencode/**` or
  `palette.ts` classification change — the palette's per-verb truth is consumed, not
  altered (FR17). Marked-inert rows stay VISIBLE and selectable (footer
  `unavailable`), never `disabled:true` (which would hide them), so invoking one
  rides `executeOperatorCommand` and surfaces the typed envelope, never a fabricated
  success (FR15). Tests: `entity.test.ts` — every mcp action `unavailable`, the
  secret rotate `unavailable`, run-now `unavailable`, create availability honest per
  domain; `screen-controls.test.ts`/`controls.test.ts` pin the domain-control
  availability. Covered by the 104-pass tui run + 103-pass core run.

- [x] **T018 — Toast discipline**
- **Depends:** T004, T012, T013
- **Paths:** `packages/tui/src/operator/**`
- **Deliverable:** ensure a toast fires only for a user-invoked mutation's final
  outcome; silent status reads, status sections, and view modals never toast (FR18).
- **Acceptance:** no view/status path emits a toast; a mutation's final outcome may
  toast.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** every auto-issued/detail read routes through
  `executeOperatorCommand({ silent: true })` (a no-op toast): the inline
  StatusSection load (T004), the entity list load (`entity-screens.ts` `load`), the
  edit-modal pre-fill read (T011), and the view modal (T013). Edit-modal Save is
  silent too — a failure surfaces IN-MODAL via `failureReason`, a success closes the
  modal (T012). Only USER-INVOKED mutations dispatched through the non-silent `run`
  path (a domain toggle/tri-state/direct verb, or an entity toggle/direct/delete)
  toast their final outcome. Tests: `entity.test.ts` — a silent `jobs.list` read
  emits ZERO toasts, while a user-invoked toggle mutation emits exactly one outcome
  toast; `modal.test.ts` — silent Save emits zero toasts on both the committed and
  failed paths. Covered by the 104-pass tui run.

---

## Group G — Tests and doc sync (Phase 7)

- [x] **T019 — Palette tests**
- **Depends:** T001, T002, T003
- **Paths:** `packages/tui/test/operator/**`, `packages/core/test/operator/**`
- **Deliverable:** assert exactly one Operator palette entry, no suggested rows
  spread, the `suggest` machinery removed, and unique row titles per surface (FR1-FR3).
- **Acceptance:** all palette assertions pass.
- **Verification:** `bun test packages/core/test/operator/** packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** the palette contract is pinned across both packages.
  Core `packages/core/test/operator/palette-menu.test.ts` asserts no palette entry
  carries a `suggest` field (T002 retirement), entry-level titles are
  domain-qualified `{Domain} {action}` never a dotted id, titles are globally unique
  (no `View: Status` ×8), and each of the 12 domain panels has unique row labels with
  the id only in the secondary line (T003). TUI
  `packages/tui/test/operator/navigation.test.ts` asserts the `operatorSuggestedEntries`
  re-export is gone from the execute module, every read-only verb stays reachable
  through the grouped panels (single-entry FR1 compensation), and — added here — that
  `buildOperatorPaletteCommands()` (the source app.tsx builds the top-level Commands
  from) carries no retired `suggested` field on any registration and resolves each to
  a unique canonical `operator.<id>` command name (no divergent/duplicated entry).
  Core operator 103 pass / 0 fail; TUI operator 128 pass / 0 fail; typecheck + oxlint
  clean.

- [x] **T020 — Screen composition tests**
- **Depends:** T004, T005, T006, T007
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert status renders inline on open (no toast), the non-rich View
  toast branch is gone, the StatusSection refetches after a mutation, and a
  `version_conflict` keeps the prior state (FR4-FR6).
- **Acceptance:** all composition assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** new
  `packages/tui/test/operator/screen-composition.test.ts` drives the composition off
  the SAME `executeOperatorCommand` spy seam the screen uses (per the repo's
  established harness convention — the operator screens are pinned at the
  dispatch/projection seam, not via a heavy full-context render). It asserts: (a) a
  silent status read on open carries the effective the section projects through
  `toStatusNodes` and emits ZERO toasts, and an `unavailable` read flags the honest
  `Status unavailable` (`outcome === "unavailable"`, empty node list) with no toast;
  (b) the refetch gate — `REFETCH_OUTCOMES = {success, idempotent_replay}` mirrored
  from the three source modules — fires on a committed outcome, while a synthesized
  `version_conflict` (a preflight reporting `configured:true` + missing version) and a
  typed `not_implemented` gap are NOT in the set, so the prior state is kept and the
  typed reason surfaces; (c) a plain-domain View detail read is silent (no toast — the
  retired `void run(entry)` branch is gone) and feeds the structural tree, with an
  absent effective rendering the honest empty tree. TUI operator 128 pass / 0 fail;
  typecheck + oxlint clean.

- [x] **T021 — Controls tests**
- **Depends:** T008, T009
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert an on/off pair renders one toggle row dispatching the
  opposite verb, an unavailable toggle is inert, and the tri-state picker opens
  pre-selected and dispatches the selected mode (FR7, FR8, FR15).
- **Acceptance:** all control assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** the pure derivations were already pinned in
  `packages/tui/test/operator/controls.test.ts` (state/mode/badge/opposite-verb) and
  the collapse classification in `packages/core/test/operator/screen-controls.test.ts`
  (telemetry → one toggle, smart → one tri-state, mcp → two inert toggles, jobs
  per-entity excluded). Added to `controls.test.ts`: (a) the tri-state derived mode is
  exactly the picker's pre-selected `current` (`mode === "unknown" ? undefined :
  mode`), never a synthesized default; and (b) a `Feature 015 T021` dispatch-seam
  block — an enabled toggle dispatches the OPPOSITE `/op.telemetry.off`, an inert
  (`unavailable`) mcp toggle STILL rides the same loopback (`/op.mcp.experimental.enable`)
  and surfaces the typed envelope (outcome ≠ success, variant ≠ success) never a
  fabricated on/off, and a tri-state selection dispatches `/op.smart.auto`. TUI
  operator 128 pass / 0 fail; typecheck + oxlint clean.

- [x] **T022 — Modal tests**
- **Depends:** T010, T011, T012, T013
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert the edit modal pre-fills from the current value, rejects
  invalid input in-modal, closes on success, surfaces a typed error in-modal (not a
  toast), and the view modal renders the key/value tree and closes on Esc
  (FR9-FR11, FR16, FR18).
- **Acceptance:** all modal assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** `packages/tui/test/operator/modal.test.ts` already pinned
  the pre-fill extraction (langlock/output; honest-empty on absence; no-descriptor +
  secret verbs → `undefined`), `failureReason` precedence, and the committed/failed
  silent Save (closes on `success`; forwards the typed reason with zero toasts on
  failure). Added a `Feature 015 T022` block that faithfully models
  `OperatorEditModal.submitText`: an invalid value sets the in-modal error and NEVER
  reaches the wire (0 preflight, 0 tryHandle — no phantom dispatch), while a valid
  value dispatches once carrying the descriptor's EXACT payload keys (the Feature 014
  wrapper-key lesson: `{name,baseUrl,secretRef}`, not `{provider:"…"}`), silently (no
  toast); plus a value_picker edit carries `{ [field.key]: value }`, never free text.
  A second block pins the structural view modal: a detail read projects its effective
  into a bounded key/value tree via `toStatusNodes` SILENTLY (no toast), and an absent
  effective renders the honest empty tree (`No detail reported`); the Esc-close is the
  `dialog.pop()` unwind pinned by the render test in `integration.test.tsx`. TUI
  operator 128 pass / 0 fail; typecheck + oxlint clean.

- [x] **T023 — Entity CRUD tests**
- **Depends:** T014, T015, T016
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert jobs/semantic/mcp list → item → edit/toggle/delete/create
  over the reused pickers, with `run-now`, Milvus index, and unreachable ops marked
  as typed gaps (FR12-FR15).
- **Acceptance:** all entity-CRUD assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence (2026-07-19):** `packages/tui/test/operator/entity.test.ts` already pinned
  the kind map, list/create/idKey descriptors, total row projection (honest-empty on
  absence), the per-entity action sets with the opposite-verb toggle, and the marked
  typed gaps (`jobs.run-now`, secret rotate, every mcp action inert). Added a
  `Feature 015 T023` set: (a) a faithful model of `DialogOperatorEntityItem.confirmDelete`
  — a DECLINED delete confirm dispatches nothing (0 preflight/0 tryHandle, no phantom
  mutation), an ACCEPTED confirm dispatches `/op.jobs.delete {"jobDefinitionId":"ent_1"}`
  exactly once; and (b) the full list → row → item → action dispatch chains for
  semantic providers (disable/delete ride `/op.semantic.provider.* {"id":"prov_a"}`)
  and mcp servers (the connect/disconnect toggle rides the OPPOSITE
  `/op.mcp.server.disconnect {"id":"srv_a"}` over the live `connected` state, marked
  inert yet still surfacing the typed envelope). Every dispatched id is a real catalog
  id (no fabricated path). TUI operator 128 pass / 0 fail; typecheck + oxlint clean.

- [x] **T024 — Parity + honest-availability test**
- **Depends:** T017, T018
- **Paths:** `packages/tui/test/operator/**`, `packages/core/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert each screen action
  rides the same command id / same `OperatorClient` loopback with no new dispatch
  path, no new catalog id, and no catalog version bump (FR17).
- **Acceptance:** parity holds; no new path/id/version-bump is detected.
- **Verification:** `bun test packages/tui/test/operator/** packages/core/test/operator/**`.
- **Evidence (2026-07-19):** `packages/tui/test/operator/parity.test.ts` (the Feature
  007/011 command-id parity harness) already pins that a read and a mutation dispatch
  the exact canonical `/op.<id>` equal to the entry's `slashAlias` and that a payload
  never forks the id. Added a `Feature 015 T024` block: (a) `RESERVED_CATALOG_VERSION`
  is unchanged at `1.3.0` — the presentation redesign never bumped the catalog; and
  (b) a superset invariant — the union of EVERY id any Feature 015 screen surface can
  dispatch, gathered from the pure classifiers (toggle enable/disable ids, tri-state
  mode ids, each collection kind's `listRead`/`createId`/entity-action ids, and every
  edit-modal pre-fill `readId`), is entirely contained in the reserved catalog id set
  — no fabricated dispatch path or new id. Honest availability is pinned by
  `entity.test.ts` (per-verb `entityAvailability` folds the Feature 014 truth + secret
  gate + typed-gap set; every mcp action inert, secret rotate inert, run-now inert) and
  `screen-controls.test.ts`/`controls.test.ts` (control availability). TUI operator
  128 pass / 0 fail; core operator 103 pass / 0 fail; typecheck + oxlint clean.

- [x] **T025 — Guard scope confirm + doc sync**
- **Depends:** T001–T024
- **Paths:** `doc/arch/speckit.toml`, `doc/arch/sdd/015-*/**`, `doc/arch/schemas/operator-crud-screens/**`, `doc/arch/statecharts/operator-crud-screen.md`, `doc/arch/functional/product-overview.md`
- **Deliverable:** confirm the Feature 015 surface is fully covered by the existing
  Feature 007 / 011 / 012 `speckit.toml` globs — no genuinely-new implement path, so
  no guard change is required; keep the spec, ADR-0015, the CRUD schema corpus, the
  statechart, and the product-overview de-orphan bullet in sync with the shipped
  shapes.
- **Acceptance:** no `speckit.toml` glob change; docs match the shipped shapes.
- **Verification:** `speckit validate` green; guard writes stay in scope.
- **Evidence (2026-07-19):** confirmed `packages/tui/src/operator/**`,
  `packages/tui/src/ui/**`, `packages/core/src/operator/**`,
  `packages/tui/src/context/**` (Feature 012), and `packages/tui/test/**`
  (Feature 001) already cover every path touched by T001-T024 — no
  `speckit.toml` glob change made. `plan.md` "Implementation notes" section
  added summarizing the shipped shapes against ADR-0015 and FR1-FR18;
  ADR-0015 content confirmed accurate to what shipped (no edit needed).
  Removed a stray untracked `packages/opencode/config.json` (leaked
  plaintext provider API key from an un-isolated live-CLI spot check, same
  pattern as the Feature 014 close-out) — not a deliverable, never
  committed.

- [x] **T026 — `speckit analyze` + `speckit validate --json` green**
- **Depends:** T025
- **Paths:** `doc/arch/**`
- **Deliverable:** run `speckit analyze` and resolve any new Critical/High/Medium
  blocker; run `speckit validate --json` and confirm 0 new findings on Feature 015
  artifacts.
- **Acceptance:** analyze clean of new blockers; validate green.
- **Verification:** `speckit analyze`; `speckit validate --json`.
- **Evidence (2026-07-19):** `speckit analyze` — 15 features analyzed:
  consistent; 0 ADR overlaps; only pre-existing `info` drift notes on
  unrelated features (001/004/005/006/007/008/009/010/013 H1-vs-slug
  wording), none new and none touching Feature 015. `speckit validate
  --json` — `"ok":true`, `"waivedCount":4`, only the 4 pre-existing waived
  `hygiene.empty-file` findings (`packages/desktop/src/renderer/styles.css`,
  `packages/opencode/test/config/fixtures/no-frontmatter.md`,
  `packages/plugin/.gitignore`, `sdks/vscode/.gitignore`) — 0 new findings.
