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

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below).

- [ ] T001 — Remove the suggested-row spread in `app.tsx` (one Operator entry)
- [ ] T002 — Retire the `suggest` field + `listOperatorSuggestedEntries` + `operatorSuggestedEntries`
- [ ] T003 — Centralise the unique row-title copy contract in `palette.ts`
- [ ] T004 — Silent status read on open → inline generic key/value StatusSection
- [ ] T005 — Wire the rich panels as the status section for jobs/output/langlock/semantic/mcp
- [ ] T006 — Remove the non-rich View toast branch (`dialog-settings.tsx:185`)
- [ ] T007 — Refetch the StatusSection after every on-screen mutation
- [ ] T008 — Collapse on/off verb pairs into one ToggleRow (state badge, opposite verb)
- [ ] T009 — Render the smart on/off/auto TriStateRow pre-selected picker
- [ ] T010 — Operator-scoped modal component over the Dialog push/back-stack
- [ ] T011 — Edit modal pre-fill from current value + fix the `descriptor.ts` empty-input residual
- [ ] T012 — Edit modal field validation + Save dispatch + in-modal error
- [ ] T013 — Structural view modal (key/value tree, Esc closes)
- [ ] T014 — Jobs entity CRUD: list → item → edit/reschedule/toggle/delete(confirm)/create
- [ ] T015 — Semantic entity CRUD: providers/models list → add/edit/rotate-secret/disable/delete
- [ ] T016 — MCP entity CRUD: servers list → add/edit/connect-disconnect/delete
- [ ] T017 — Honest availability on every control (per-verb `Partial` marked + inert)
- [ ] T018 — Toast discipline: toasts only for a mutation's final outcome
- [ ] T019 — Palette tests (one entry, no spread, `suggest` removed, unique titles)
- [ ] T020 — Screen composition tests (inline status, no toast branch, refetch, conflict keeps state)
- [ ] T021 — Controls tests (toggle opposite-verb, inert unavailable, tri-state pre-selected)
- [ ] T022 — Modal tests (pre-fill, in-modal validation/error, view tree, Esc)
- [ ] T023 — Entity CRUD tests (jobs/semantic/mcp list → item → actions; typed gaps marked)
- [ ] T024 — Parity + honest-availability test (same id, no new path/id/version bump)
- [ ] T025 — Guard scope confirm (no new `speckit.toml` glob) + doc sync
- [ ] T026 — `speckit analyze` + `speckit validate --json` green

---

## Group A — Single Operator entry and unique titles (FR1, FR2, FR3)

- [ ] **T001 — Remove the suggested-row spread in `app.tsx`**
- **Depends:** none
- **Paths:** `packages/tui/src/app.tsx`
- **Deliverable:** delete the `...operatorSuggestedEntries().map(...)` block
  (`packages/tui/src/app.tsx:981`) so exactly one `Operator` Commands entry (opening
  `DialogOperatorSettingsHome`) is registered; drop the now-unused
  `operatorSuggestedEntries` import (FR1).
- **Acceptance:** the top-level Commands palette lists exactly one Operator-category
  entry; no `View: Status …` suggested rows appear.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T002 — Retire the `suggest` machinery**
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

- [ ] **T003 — Centralise the unique row-title copy contract**
- **Depends:** T002
- **Paths:** `packages/core/src/operator/palette.ts`, `packages/core/test/operator/**`
- **Deliverable:** centralise the row-title copy so no two rows on a surface share a
  human title — scope a verb title to its domain screen (action-only where the
  domain is implicit, domain-qualified where not), keep the dotted command id as the
  secondary line, and eliminate the `View: Status` ×8 duplication (FR3).
- **Acceptance:** a uniqueness assertion over each domain panel's rows passes; the
  dotted id is never the primary label.
- **Verification:** `bun test packages/core/test/operator/**`.

---

## Group B — Domain screen composition: inline status (FR4, FR5, FR6)

- [ ] **T004 — Silent status read on open → inline generic StatusSection**
- **Depends:** T003
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/**`
- **Deliverable:** on domain-screen open, issue the domain's status read through
  `executeOperatorCommand` with the silent option and render an inline
  **StatusSection** using a generic key/value renderer projected from the effective
  payload for the plain domains; no toast on the silent read (FR4, FR18).
- **Acceptance:** opening a plain domain screen renders its status inline; no toast
  is emitted for the silent read.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T005 — Wire the rich panels as the status section**
- **Depends:** T004
- **Paths:** `packages/tui/src/operator/{jobs,output,langlock,semantic,mcp}/**`, `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** render the existing rich read panels as the status section for
  `jobs`/`output`/`langlock`/`semantic`/`mcp`, fed by the Feature 012 result signal,
  falling back to their honest empty state when no signal exists (FR4).
- **Acceptance:** each rich domain's screen shows its panel inline as status on
  open; honest empty fallback holds.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T006 — Remove the non-rich View toast branch**
- **Depends:** T004, T013
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`
- **Deliverable:** delete the branch that dispatches a toast for a non-rich domain's
  View verb (`dialog-settings.tsx:185`); route detail verbs to the view modal (T013)
  instead (FR5).
- **Acceptance:** no View path emits a toast; a plain domain's detail verb opens the
  view modal.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T007 — Refetch the StatusSection after every on-screen mutation**
- **Depends:** T004, T012
- **Paths:** `packages/tui/src/operator/dialog-settings.tsx`, `packages/tui/src/operator/**`
- **Deliverable:** after any on-screen mutation returns, re-issue the silent status
  read so the StatusSection reflects the commit; on a `version_conflict`/typed gap
  keep the prior state and surface the typed reason (FR6, FR15).
- **Acceptance:** a successful mutation refreshes the status; a stale mutation leaves
  the prior state and surfaces the typed reason.
- **Verification:** `bun test packages/tui/test/operator/**`.

---

## Group C — Toggle and tri-state controls (FR7, FR8)

- [ ] **T008 — Collapse on/off verb pairs into one ToggleRow**
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

- [ ] **T009 — Render the smart on/off/auto TriStateRow pre-selected picker**
- **Depends:** T008
- **Paths:** `packages/tui/src/operator/**`, `packages/core/src/operator/palette.ts`
- **Deliverable:** render smart-routing `on`/`off`/`auto` as a **TriStateRow** whose
  action opens a three-option picker (a `DialogSelect` over the three verbs)
  pre-selected to the current mode, dispatching the selected mode — never a binary
  toggle (FR8).
- **Acceptance:** the picker opens pre-selected to the current mode; selecting a
  mode dispatches that mode's verb.
- **Verification:** `bun test packages/tui/test/operator/**`.

---

## Group D — Edit and view modal component (FR9, FR10, FR11, FR16)

- [ ] **T010 — Operator-scoped modal component over the Dialog push/back-stack**
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

- [ ] **T011 — Edit modal pre-fill from current value + fix the empty-input residual**
- **Depends:** T010
- **Paths:** `packages/tui/src/operator/form/**`
- **Deliverable:** on edit-modal open, silently read the current effective value and
  pre-fill each field (no empty text inputs; honest empty + placeholder when absent),
  fixing the Feature 014 `descriptor.ts` empty-input residual (FR9, FR10).
- **Acceptance:** an editable setting with a current value opens pre-filled; an
  absent value renders an empty field with a placeholder, not a fabricated default.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T012 — Edit modal validation + Save dispatch + in-modal error**
- **Depends:** T011
- **Paths:** `packages/tui/src/operator/form/**`, `packages/tui/src/operator/execute.ts`
- **Deliverable:** validate each field in-modal before dispatch; Save dispatches
  through `executeOperatorCommand`, closes on success, and surfaces a typed error
  **in the modal** (not a toast) on failure (FR9, FR16, FR18).
- **Acceptance:** invalid input is rejected in-modal; Save closes on success; a typed
  failure surfaces in-modal, not as a toast.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T013 — Structural view modal**
- **Depends:** T010
- **Paths:** `packages/tui/src/operator/form/**`, `packages/tui/src/operator/**`
- **Deliverable:** render a detail verb's effective payload as a **structural
  key/value tree** in a read-only view modal that closes on Esc; honest empty tree
  when the payload is absent (FR11, FR18).
- **Acceptance:** a detail verb opens the tree view modal; Esc closes it; no toast
  is emitted; an absent payload renders the honest empty tree.
- **Verification:** `bun test packages/tui/test/operator/**`.

---

## Group E — Entity CRUD: jobs, semantic, mcp (FR12, FR13, FR14)

- [ ] **T014 — Jobs entity CRUD**
- **Depends:** T007, T008, T012, T013
- **Paths:** `packages/tui/src/operator/jobs/**`, `packages/tui/src/operator/**`
- **Deliverable:** render the jobs list; a job pushes an item screen offering edit
  (edit modal), reschedule (edit modal), an enable/disable toggle, and delete behind
  the confirm gate; the list offers create; `run-now` renders a marked typed gap
  (Feature 014 FR9/FR10) (FR12).
- **Acceptance:** list → item → edit/reschedule/toggle/delete(confirm)/create all
  dispatch the canonical ids; `run-now` is marked inert.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T015 — Semantic entity CRUD**
- **Depends:** T007, T008, T012, T013
- **Paths:** `packages/tui/src/operator/semantic/**`, `packages/tui/src/operator/**`
- **Deliverable:** render providers and models as lists; provider
  add/edit/rotate-secret/disable/delete and model register/disable/delete through
  the toggle/edit-modal/confirm contract; secrets `SecretRef`-only (Feature 014
  FR11); Milvus-gated index ops marked typed gaps (FR13).
- **Acceptance:** provider/model CRUD dispatches canonical ids; secrets stay
  `SecretRef`; index ops marked inert.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T016 — MCP entity CRUD**
- **Depends:** T007, T008, T012, T013
- **Paths:** `packages/tui/src/operator/mcp/**`, `packages/tui/src/operator/**`
- **Deliverable:** render servers as a list; add/edit/connect-disconnect/delete,
  where connect/disconnect is a toggle over the live service state; unreachable ops
  marked typed gaps (FR14).
- **Acceptance:** server CRUD dispatches canonical ids; connect/disconnect toggles
  the live state; unreachable ops marked inert.
- **Verification:** `bun test packages/tui/test/operator/**`.

---

## Group F — Honesty and parity wiring (FR15, FR17, FR18)

- [ ] **T017 — Honest availability on every control**
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

- [ ] **T018 — Toast discipline**
- **Depends:** T004, T012, T013
- **Paths:** `packages/tui/src/operator/**`
- **Deliverable:** ensure a toast fires only for a user-invoked mutation's final
  outcome; silent status reads, status sections, and view modals never toast (FR18).
- **Acceptance:** no view/status path emits a toast; a mutation's final outcome may
  toast.
- **Verification:** `bun test packages/tui/test/operator/**`.

---

## Group G — Tests and doc sync (Phase 7)

- [ ] **T019 — Palette tests**
- **Depends:** T001, T002, T003
- **Paths:** `packages/tui/test/operator/**`, `packages/core/test/operator/**`
- **Deliverable:** assert exactly one Operator palette entry, no suggested rows
  spread, the `suggest` machinery removed, and unique row titles per surface (FR1-FR3).
- **Acceptance:** all palette assertions pass.
- **Verification:** `bun test packages/core/test/operator/** packages/tui/test/operator/**`.

- [ ] **T020 — Screen composition tests**
- **Depends:** T004, T005, T006, T007
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert status renders inline on open (no toast), the non-rich View
  toast branch is gone, the StatusSection refetches after a mutation, and a
  `version_conflict` keeps the prior state (FR4-FR6).
- **Acceptance:** all composition assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T021 — Controls tests**
- **Depends:** T008, T009
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert an on/off pair renders one toggle row dispatching the
  opposite verb, an unavailable toggle is inert, and the tri-state picker opens
  pre-selected and dispatches the selected mode (FR7, FR8, FR15).
- **Acceptance:** all control assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T022 — Modal tests**
- **Depends:** T010, T011, T012, T013
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert the edit modal pre-fills from the current value, rejects
  invalid input in-modal, closes on success, surfaces a typed error in-modal (not a
  toast), and the view modal renders the key/value tree and closes on Esc
  (FR9-FR11, FR16, FR18).
- **Acceptance:** all modal assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T023 — Entity CRUD tests**
- **Depends:** T014, T015, T016
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** assert jobs/semantic/mcp list → item → edit/toggle/delete/create
  over the reused pickers, with `run-now`, Milvus index, and unreachable ops marked
  as typed gaps (FR12-FR15).
- **Acceptance:** all entity-CRUD assertions pass.
- **Verification:** `bun test packages/tui/test/operator/**`.

- [ ] **T024 — Parity + honest-availability test**
- **Depends:** T017, T018
- **Paths:** `packages/tui/test/operator/**`, `packages/core/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert each screen action
  rides the same command id / same `OperatorClient` loopback with no new dispatch
  path, no new catalog id, and no catalog version bump (FR17).
- **Acceptance:** parity holds; no new path/id/version-bump is detected.
- **Verification:** `bun test packages/tui/test/operator/** packages/core/test/operator/**`.

- [ ] **T025 — Guard scope confirm + doc sync**
- **Depends:** T001–T024
- **Paths:** `doc/arch/speckit.toml`, `doc/arch/sdd/015-*/**`, `doc/arch/schemas/operator-crud-screens/**`, `doc/arch/statecharts/operator-crud-screen.md`, `doc/arch/functional/product-overview.md`
- **Deliverable:** confirm the Feature 015 surface is fully covered by the existing
  Feature 007 / 011 / 012 `speckit.toml` globs — no genuinely-new implement path, so
  no guard change is required; keep the spec, ADR-0015, the CRUD schema corpus, the
  statechart, and the product-overview de-orphan bullet in sync with the shipped
  shapes.
- **Acceptance:** no `speckit.toml` glob change; docs match the shipped shapes.
- **Verification:** `speckit validate` green; guard writes stay in scope.

- [ ] **T026 — `speckit analyze` + `speckit validate --json` green**
- **Depends:** T025
- **Paths:** `doc/arch/**`
- **Deliverable:** run `speckit analyze` and resolve any new Critical/High/Medium
  blocker; run `speckit validate --json` and confirm 0 new findings on Feature 015
  artifacts.
- **Acceptance:** analyze clean of new blockers; validate green.
- **Verification:** `speckit analyze`; `speckit validate --json`.
