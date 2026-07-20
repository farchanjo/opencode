# Tasks: Replace The Free Text Model Id Entry In The Operator (Feature 020)

Synced with plan.md (Phase A shared picker FIRST, Phase B rewire the two seams,
Phase C escape hatch + edge behavior, Phase D tests + guard + doc sync) and the
specScopeGlobs in doc/arch/speckit.toml. ADR-0020 proposed.

TUI presentation change ONLY. NO operator payload change, NO command id, NO
catalog version bump, NO new dispatch path, NO new flag — the Feature 007
registration + `OperatorSlashPort` loopback parity invariant (FR5) is preserved.
The picker is a thin composition over `DialogSelect` + `sync.data.provider` +
`fuzzysort` + `promptText` (reuse, not re-author); the raw-text escape hatch stays
reachable (FR4); the list reflects only connected providers and never dead-ends
(FR1, FR6). No code is executed in this documentary pass; tasks are the implement
backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below). Phase A (the shared picker) is
FIRST — both seams and every edge case depend on it.

- [x] T001 — Author the reactive `connectedModelOptions` memo over `sync.data.provider`
- [x] T002 — Author the shared `ModelPicker` on `DialogSelect` (grouped, searchable)
- [x] T003 — Rewire `pools.set` `+ Add model` to open the picker (payload unchanged)
- [x] T004 — Rewire `semantic.model.disable` `Model id` to the picker (payload unchanged)
- [x] T005 — Wire the `Custom id…` raw-text escape hatch (non-regression)
- [x] T006 — Honest edge behavior (empty catalog, reactive, already-added, cancel)
- [x] T007 — Operator TUI tests over a fake connected catalog
- [x] T008 — Guard scope + doc sync + `speckit analyze` + `validate --json` green

---

## Phase A — The shared connected-models picker (FR1) — FIRST

- [x] **T001 — Author the reactive `connectedModelOptions` memo over `sync.data.provider`**
- **Depends:** none
- **Paths:** `packages/tui/src/operator/form/model-picker.tsx`
- **Deliverable:** a Solid memo `connectedModelOptions()` over `sync.data.provider`
  (`sync.tsx:452-453`) that flat-maps each connected `Provider.Info`'s
  `models: Record<string, Model>` (`provider.ts:1029-1044`) into
  `#ConnectedModelOption` view-models: `modelId = "${provider.id}/${model.id}"`
  (the `Provider.parseModel` format, `provider.ts:1990`),
  `title = model.name ?? model.id`, `description`/`category = provider.name`
  (provider grouping, the `DialogModel` precedent `dialog-model.tsx:62-84`),
  optional `Free` footer (`model.cost?.input === 0`), and an `alreadySelected`
  marker when the caller passes the current id list (FR1).
- **Acceptance:** the memo lists ONLY connected providers, re-derives on a
  `sync.data.provider` change, and yields well-formed `provider/model` ids; no
  fabricated model or provider.
- **Verification:** `bun test packages/tui/test/operator/**` (memo over a fake catalog).
- **Evidence:** 2026-07-20 — `buildConnectedModelOptions` memo in `packages/tui/src/operator/form/model-picker.tsx:53` (over `sync.data.provider`); unit-pinned in `packages/tui/test/operator/multi-field.test.ts` ("020 T001" — grouped/sorted by provider, Free footer, deprecated dropped, alreadySelected, empty→[], no fabrication). Green.

- [x] **T002 — Author the shared `ModelPicker` on `DialogSelect` (grouped, searchable)**
- **Depends:** T001
- **Paths:** `packages/tui/src/operator/form/model-picker.tsx`
- **Deliverable:** a `<ModelPicker onSelect(modelId) onCustom() selected?>` component
  built on the `DialogSelect` primitive (`dialog-select.tsx:23-72`): `options` =
  `connectedModelOptions()` grouped by `category`, fuzzy `onFilter` over
  `title`/`category` (the `DialogModel` behavior), an `Actions`-category
  `Custom id…` option that invokes `onCustom`, and `footerHints` (`esc`/`enter`).
  Selecting a model resolves its `provider/model` id string to `onSelect`. Authored
  ONCE, reused by both seams (FR1).
- **Acceptance:** the picker renders grouped+searchable options, resolves a picked
  `provider/model` id, and exposes the `Custom id…` action; it imports
  `DialogSelect`/`fuzzysort` without modifying them (guard-scope note in plan.md).
- **Verification:** `bun test packages/tui/test/operator/**` (render + select + filter).
- **Evidence:** 2026-07-20 — `ModelPicker` on `DialogSelect` in `model-picker.tsx:88` (grouped, fuzzy `onFilter` over title/category, mandatory `Custom id…` action); driven end-to-end in `packages/tui/test/operator/pools-bindings-flow.test.tsx` ("pick from the provider-grouped list…"). Green.

## Phase B — Rewire the two seams (FR2, FR3)

- [x] **T003 — Rewire `pools.set` `+ Add model` to open the picker (payload unchanged)**
- **Depends:** T002
- **Paths:** `packages/tui/src/operator/form/multi-field-modal.tsx`
- **Deliverable:** replace the direct `promptText(dialog, "Model id", …)` call in
  `BindingRowEditor.addModel()` (`multi-field-modal.tsx:474-478`) with opening
  `<ModelPicker>` seeded with the current `row.models` (so already-added ids are
  marked/skippable, the return-to-remove list precedent `:486-492`). On select,
  append `option.modelId` to `row.models[]` through the existing `onModels`
  callback; the composed `pools.set` payload
  (`field-list.ts:310-313` → `{ bindings: [{ role, models: string[] }] }`) is
  byte-for-byte unchanged (FR2).
- **Acceptance:** picking a model appends its `provider/model` id to `row.models[]`;
  the composed payload shape is identical to today; an already-present id is not
  silently duplicated.
- **Verification:** `bun test packages/tui/test/operator/**` (pools-bindings-flow: select appends, payload shape).
- **Evidence:** 2026-07-20 — `BindingRowEditor.addModel()` rewired to `pickModel(dialog, {alreadySelected})` in `packages/tui/src/operator/form/multi-field-modal.tsx:474`; byte-exact `{bindings:[{role,models}]}` asserted in `pools-bindings-flow.test.tsx`. Green.

- [x] **T004 — Rewire `semantic.model.disable` `Model id` to the picker (payload unchanged)**
- **Depends:** T002
- **Paths:** `packages/tui/src/operator/form/descriptor.ts`, `packages/tui/src/operator/form/multi-field-modal.tsx`
- **Deliverable:** resolve the `semantic.model.disable` `Model id` value
  (`descriptor.ts:213`, `mode:"text_input"`, `key:"id"`) through `<ModelPicker>`
  instead of a bare text input, composing the unchanged `{ id: "provider/model" }`
  payload. Use the connected provider catalog for consistency with T003; a
  registered-but-disconnected id is covered by the T005 escape hatch (the
  documented trade-off, ADR-0020) (FR3).
- **Acceptance:** picking a model composes `{ id: "provider/model" }` unchanged;
  the escape hatch still allows a registered-but-disconnected id.
- **Verification:** `bun test packages/tui/test/operator/**` (multi-field / controls: disable payload).
- **Evidence:** 2026-07-20 — new `model_picker` mode in `packages/tui/src/operator/form/descriptor.ts` (semantic.model.disable → `modelPicker:true`, `toPayload`→`{id}`); rendered inline by `edit-modal.tsx`/`index.tsx`; interactive disable test in `pools-bindings-flow.test.tsx` composes `{id:"anthropic/claude-opus"}`. Green.

## Phase C — Escape hatch + edge behavior (FR4, FR6)

- [x] **T005 — Wire the `Custom id…` raw-text escape hatch (non-regression)**
- **Depends:** T003, T004
- **Paths:** `packages/tui/src/operator/form/model-picker.tsx`, `packages/tui/src/operator/form/multi-field-modal.tsx`
- **Deliverable:** the `Custom id…` action reopens the EXISTING
  `promptText`/`DialogPrompt` raw prompt (`multi-field-modal.tsx:100-118`), which
  accepts the trimmed non-empty string exactly as today (`:477`) — for `pools.set`
  append to `row.models[]`, for `semantic.model.disable` compose `{ id }`. Nothing
  that works today regresses (FR4).
- **Acceptance:** the escape hatch enters a catalog-absent `provider/model` id for
  both seams with the same trimming/non-empty behavior as the current code.
- **Verification:** `bun test packages/tui/test/operator/**` (escape-hatch raw id both seams).
- **Evidence:** 2026-07-20 — `promptCustomModelId` pushed-level escape hatch in `model-picker.tsx:158` (reuses existing `DialogPrompt`); wired in `pickModel`, `edit-modal.tsx`, `index.tsx`. Custom-id raw-entry pinned for both seams in `pools-bindings-flow.test.tsx`. Green.

- [x] **T006 — Honest edge behavior (empty catalog, reactive, already-added, cancel)**
- **Depends:** T003, T004, T005
- **Paths:** `packages/tui/src/operator/form/model-picker.tsx`, `packages/tui/src/operator/form/multi-field-modal.tsx`
- **Deliverable:** (a) empty catalog / no connected providers → the picker renders
  with only the `Custom id…` action (never an empty dead-end); (b) a
  connect/disconnect while the picker is open → the reactive memo re-derives the
  options; (c) a model already in the bindings list → indicated/skippable; (d)
  esc/cancel → close and NO mutation of `row.models[]` or the descriptor value
  (the current `promptText` `null`-on-cancel no-op preserved) (FR6).
- **Acceptance:** each edge case behaves as specified; no path fabricates a model
  id or a connected provider.
- **Verification:** `bun test packages/tui/test/operator/**` (empty-catalog, reactive-update, cancel-no-mutation).
- **Evidence:** 2026-07-20 — empty-catalog (Custom id… still offered), reactive connect-while-open re-derive, already-added skip (disabled→dropped), and esc/cancel no-mutation all pinned in `pools-bindings-flow.test.tsx`. Green.

## Phase D — Tests + guard + doc sync (FR-all)

- [x] **T007 — Operator TUI tests over a fake connected catalog**
- **Depends:** T001-T006
- **Paths:** `packages/tui/test/operator/**`
- **Deliverable:** extend the operator TUI suites (pools-bindings-flow,
  multi-field, controls) over a FAKE connected catalog: assert the list is sourced
  from the fake catalog (FR1), a selection appends `provider/model` to
  `row.models[]` and composes `{ id }` for disable (FR2, FR3), the `Custom id…`
  escape hatch still allows a raw id (FR4), an empty catalog still offers the
  escape hatch (FR6), and a reactive catalog update re-derives options (FR6). No
  test requires a live provider connection.
- **Acceptance:** all new tests green; no live-provider dependency; payload-shape
  assertions prove FR5 (no contract change).
- **Verification:** `bun test packages/tui/test/operator/**`.
- **Evidence:** 2026-07-20 — `bun test test/operator/` → 198 pass, 0 fail (14 files). New unit + interactive cases over an injected fake `sync.data.provider`; `bunx tsc --noEmit` → 0 new errors (only pre-existing `dialog-move-session.tsx`).
- **Post-review hardening (2026-07-20):** two robustness cleanups closed after
  adversarial review, before merge. (1) Added a permanent regression test for
  the `semantic.model.disable` `Custom id…` escape hatch's remount mechanism —
  pushing `promptCustomModelId`'s `DialogPrompt` unmounts the `OperatorEditModal`
  instance underneath (`DialogProvider` only renders `stack.at(-1)`,
  `ui/dialog.tsx:242`), and on confirm the disposed instance's own
  `dispatchPayload` closure still fires and pops the stack (Solid post-dispose
  signal writes are no-ops, the dispatch/pop itself is not) — proven working but
  previously uncovered; now pinned in `pools-bindings-flow.test.tsx`
  ("Custom id… escape hatch dispatches through the disposed-modal remount").
  (2) Traced every caller of `resolveOperatorFormField`/`openOperatorForm`
  (`entity-screens.tsx:121,205` → always `openOperatorEditModal`, never
  `openOperatorForm`; `dialog-settings.tsx:355-377` → a `model_picker` field's
  `source` is structurally always `undefined`, so its
  `field.mode === "text_input" || !field.source` guard always routes to
  `openOperatorEditModal`; `settings/langlock/index.tsx` hardcodes the
  `langlock.set` `value_picker` field) and confirmed the `model_picker` branch in
  `operator/form/index.tsx`'s `OperatorForm` is genuinely unreachable. Removed
  the dead duplicate `ModelPicker`/`promptCustomModelId` rendering and replaced
  it with a loud invariant (`throw`) so a future router change that actually
  reaches this path fails fast instead of silently reviving unmaintained UI.
  `bun test test/operator/` → 199 pass, 0 fail (14 files); `bunx tsc --noEmit` →
  0 new errors (only the pre-existing `dialog-move-session.tsx` set).

- [x] **T008 — Guard scope + doc sync + `speckit analyze` + `validate --json` green**
- **Depends:** T007
- **Paths:** `doc/arch/**`, `AGENTS.md`, `README.md`
- **Deliverable:** confirm every write stayed inside `packages/tui/src/**/operator/**`
  (guard scope); sync `AGENTS.md`/`README`/`doc/arch` with the rewired forms; run
  `speckit analyze` then `speckit validate --json` and resolve any finding this
  feature introduced (FR5 parity + doc-sync).
- **Acceptance:** guard clean; `speckit validate --json` green; docs in sync.
- **Verification:** `speckit validate --json`.
- **Evidence:** 2026-07-20 — all writes inside `packages/tui/src/operator/form/**` + `packages/tui/test/operator/**` (guard scope, speckit.toml:496,500); no doc surface changed. `speckit validate --json` → ok:true (only pre-existing waived hygiene.empty-file). Full tui suite 398 pass/0 fail.

## Dependencies

- **Phase A before all rewires.** T001→T002 build the shared picker every seam and
  edge case consumes; T003/T004 (the two seams) depend on T002; T005/T006 depend on
  both seams; T007 tests the whole surface; T008 gates the commit.
- **External:** the live sync catalog (`sync.data.provider`) is already fetched
  (`sync.tsx:452-453`) — no new SDK call or server change is required. Tests use a
  fake catalog, so no live provider connection is a prerequisite.
- **Invariant:** no task adds an operator payload change, a command id, a catalog
  version bump, a new dispatch path, or a feature flag (FR5).
