# Implementation Plan: Replace The Free Text Model Id Entry In The Operator

Feature: 020-replace-the-free-text-model-id-entry-in-the-operator
Status target: planned (after this plan is complete)
ADR: [ADR-0020](../../adr/0020-replace-the-free-text-model-id-entry-in-the-operator.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR6; domain model; no-contract-change + escape-hatch + honest-catalog invariants)

## Overview

The Operator admin palette still asks the operator to **hand-type a model id** as
free text in two config forms, even though the TUI already holds a live,
reactive, connected-provider catalog (`sync.data.provider`) and already ships a
searchable, provider-grouped picker over it (the `/models` switcher
`DialogModel`). This plan replaces both free-text `Model id` entries with **one
shared selectable picker** built on the `DialogSelect` primitive and fed by a
reactive connected-models memo, reused by both seams, with a mandatory
`Custom id…` raw-text escape hatch. It is a **TUI presentation change only** — the
operator command-port payloads (`pools.set` → `{ bindings: [{ role, models: string[] }] }`;
`semantic.model.disable` → `{ id }`), the `OperatorSlashPort` dispatch, the
command ids, and the catalog version are all unchanged.

**Explicitly out of this plan (invariants preserved):**

- **No contract change (FR5).** No operator payload, command id, catalog version,
  dispatch path, server/port surface, or feature flag is added or altered.
- **Non-regression escape hatch (FR4).** The existing raw `promptText` free-text
  path stays reachable via a `Custom id…` action — nothing that works today is
  removed.
- **Honest catalog (FR1, FR6).** The list reflects only what `sync.data.provider`
  reports as connected; an id outside the catalog is only reachable through the
  explicit escape hatch, never fabricated.
- **Reuse the shipped machinery (NFR).** `DialogSelect`, `sync.data.provider`,
  `fuzzysort`, and `promptText`/`DialogPrompt` are composed, not re-authored,
  patterned on `DialogModel`.

## Technical Approach

### Architecture layers affected

```
Phase A — the shared connected-models picker  (FR1)
  new packages/tui/src/operator/form/model-picker.tsx (in guard scope):
    connectedModelOptions() : Memo<ConnectedModelOption[]> over sync.data.provider
    <ModelPicker onSelect(modelId) onCustom() alreadySelected? />  on DialogSelect
        |
        v
Phase B — rewire the two seams  (FR2, FR3)
  B1: multi-field-modal.tsx BindingRowEditor.addModel() -> open ModelPicker;
      append option.modelId (or escape-hatch string) to row.models[]  (payload UNCHANGED)
  B2: descriptor.ts "semantic.model.disable" resolves its Model id via ModelPicker;
      compose { id: "provider/model" }                                (payload UNCHANGED)
        |
        v
Phase C — escape hatch + edge behavior  (FR4, FR6)
  Custom id… action -> existing promptText/DialogPrompt raw prompt;
  empty catalog -> render with only Custom id…; reactive memo; esc/cancel -> no mutation
        |
        v
Phase D — tests + guard scope + doc sync  (FR-all)
  operator TUI tests over a fake connected catalog; speckit validate --json green
```

The reused runtime — the `DialogSelect` primitive
(`packages/tui/src/ui/dialog-select.tsx:23-72`), the reactive
`sync.data.provider` catalog (`packages/tui/src/context/sync.tsx:452-453`), the
`fuzzysort` grouping/filter, and the `promptText`/`DialogPrompt` raw prompt
(`packages/tui/src/operator/form/multi-field-modal.tsx:100-118`) — is the single
source the new picker composes onto, patterned on `DialogModel`
(`packages/tui/src/component/dialog-model.tsx`). The picker view-model is
specified in `doc/arch/schemas/replace-the-free-text-model-id-entry-in-the-operator.cue`.

### Guard-scope note

The two seams and the new picker live under `packages/tui/src/operator/form/**`
and `packages/tui/src/**/operator/**`, which are **inside** the Feature 007
implement scope (`doc/arch/speckit.toml` `[guard] specScopeGlobs`). The picker
**reads** `sync.data.provider` (a Solid context) and **imports** `DialogSelect`
and `fuzzysort` — those are reads/imports, not writes, so `sync.tsx`,
`dialog-select.tsx`, and `dialog-model.tsx` are not modified and need not be in
scope. Keep the new file at
`packages/tui/src/operator/form/model-picker.tsx` (in scope). If a shared helper
is factored out of `dialog-model.tsx`, that would move `dialog-model.tsx` into
the write set (out of scope) — avoid it; compose by import instead.

### Phase A — The shared connected-models picker (FR1)

- **Build the reactive option memo.** Author `connectedModelOptions()` as a Solid
  memo over `sync.data.provider` that flat-maps each connected `Provider.Info`'s
  `models: Record<string, Model>` into `ConnectedModelOption` view-models:
  `modelId = "${provider.id}/${model.id}"` (the `Provider.parseModel` format,
  `provider.ts:1990`), `title = model.name ?? model.id`,
  `description/category = provider.name` (provider grouping, the `DialogModel`
  precedent at `dialog-model.tsx:62-84`), optional `footer` for a `Free`
  cost hint (`model.cost?.input === 0`), and `disabled`/an `already-selected`
  marker when the caller passes the current list. The memo re-derives as
  `sync.data.provider` updates, so the list is always current and reflects only
  connected providers.
- **Build the picker component.** Author `<ModelPicker>` on `DialogSelect`
  (`dialog-select.tsx:23-72`): `options` = `connectedModelOptions()` grouped by
  `category`, `onFilter`/fuzzy search over `title`/`category` (the `DialogModel`
  behavior), plus an `Actions`-category `Custom id…` option and `footerHints`
  (`esc`/`enter`). It resolves the picked model's `provider/model` id string, or
  invokes the escape-hatch callback for `Custom id…`.

### Phase B — Rewire the two seams (FR2, FR3)

- **B1 — `pools.set` `+ Add model` (FR2).** In `BindingRowEditor.addModel()`
  (`multi-field-modal.tsx:474-478`), replace the direct
  `promptText(dialog, "Model id", …)` call with opening `<ModelPicker>` seeded
  with the current `row.models` (so already-added ids are marked/skippable, the
  return-to-remove list precedent at `:486-492`). On select, append
  `option.modelId` to `row.models[]` via the existing `onModels` callback; the
  composed `pools.set` payload
  (`field-list.ts:310-313` → `{ bindings: [{ role, models: string[] }] }`) is
  unchanged.
- **B2 — `semantic.model.disable` (FR3).** Resolve the `descriptor.ts:213`
  `text_input`/`key:"id"` field through `<ModelPicker>` instead of a bare text
  input, composing the unchanged `{ id: "provider/model" }` payload. The
  connected provider catalog is the source for consistency with B1; a
  registered-but-disconnected id is covered by the FR4 escape hatch (the
  documented trade-off, ADR-0020).

### Phase C — Escape hatch + edge behavior (FR4, FR6)

- **Escape hatch (FR4).** The `Custom id…` action reopens the **existing**
  `promptText`/`DialogPrompt` raw prompt (`multi-field-modal.tsx:100-118`), which
  still accepts the trimmed non-empty string exactly as today (`:477`) — for
  `pools.set` it appends to `row.models[]`, for `semantic.model.disable` it
  composes `{ id }`.
- **Edge behavior (FR6).** Empty catalog / no connected providers → the picker
  renders with only the `Custom id…` action (never an empty dead-end);
  connect/disconnect while open → the reactive memo re-derives; a model already in
  the list → indicated/skippable; esc/cancel → close and no mutation (the current
  `promptText` `null`-on-cancel no-op is preserved).

### Phase D — Tests + guard scope + doc sync

- **Tests.** Extend the operator TUI test suites (pools-bindings-flow,
  multi-field, controls) over a **fake connected catalog**: assert the list is
  sourced from the fake catalog, a selection appends `provider/model` to
  `row.models[]` (and `{ id }` for disable), the `Custom id…` escape hatch still
  allows a raw id, an empty catalog still offers the escape hatch, and a reactive
  catalog update re-derives the options. No test requires a live provider
  connection.
- **Guard + doc sync.** Keep writes inside `packages/tui/src/**/operator/**`;
  keep `AGENTS.md`/`README`/`doc/arch` in sync; run `speckit analyze` then
  `speckit validate --json` green before commit.

## Companion Artifacts

The following optional companion files may be created alongside this plan during
implement to capture additional context:

- `research.md` — the `DialogModel` option-building pattern and the two-seam
  audit (deferred; the anchors are inline in this plan and the spec).
- `data-model.md` — the `ConnectedModelOption` view-model, specified instead in
  `doc/arch/schemas/replace-the-free-text-model-id-entry-in-the-operator.cue`.
- `contracts/` — no new interface contract; the operator payloads are unchanged
  (FR5).
- `quickstart.md` — driving the rewired `pools.set` and `semantic.model.disable`
  forms in the operator sandbox (deferred to implement).
