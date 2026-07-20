---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0020 — Replace The Free Text Model Id Entry In The Operator

## Context and Problem Statement

The Operator admin palette still asks the operator to **hand-type a model id** as
free text in two config forms, even though the TUI already holds a live, reactive,
connected-provider catalog and already ships a searchable, provider-grouped picker
over it. A gap sweep (2026-07-20, every `file:line` verified) found:

- **Two free-text `Model id` seams, both in the Operator admin palette.**
  `pools.set` role→model bindings — `BindingRowEditor.addModel()`
  (`packages/tui/src/operator/form/multi-field-modal.tsx:474-478`) calls
  `promptText(dialog, "Model id", "e.g. anthropic/claude-…")` (`:100-118`) and
  appends the raw trimmed string to `row.models[]` (the `+ Add model` action at
  `:485-496`; payload `{ bindings: [{ role, models: string[] }] }`,
  `field-list.ts:310-313`). And `semantic.model.disable`
  (`packages/tui/src/operator/form/descriptor.ts:213`,
  `{ mode:"text_input", key:"id", placeholder:"Model id" }`; payload `{ id: string }`).
- **The connected catalog is already live and reactive.** `sync.data.provider`
  (`packages/tui/src/context/sync.tsx:452-453`, via
  `sdk.client.config.providers` + `sdk.client.provider.list`) holds the
  connected-only provider catalog; each `Provider.Info.models` exposes
  `Provider.Model` metadata (`provider.ts:1029-1044`), and the id format is
  `provider/model` (`Provider.parseModel`, `:1990`). A Solid memo over it stays
  always current as providers connect/disconnect.
- **A proven picker already exists.** The `/models` switcher `DialogModel`
  (`packages/tui/src/component/dialog-model.tsx`) renders a searchable,
  provider-grouped, `fuzzysort`-filtered picker over `sync.data.provider`; the
  `DialogSelect` primitive (`dialog-select.tsx:23-72`) supports grouped,
  searchable options natively.

The user asked: "quero a lista de modelos, já tem isso dentro do opencode. Então
eu quero poder escolher com lista sempre atualizada dos conectados." — replace the
free-text entry with an always-up-to-date selectable list of the connected models.

The question: how to replace both free-text entries with a live selectable list
**without** changing any operator payload/command id/dispatch path, and **without**
regressing the ability to enter a model id that is not in the connected catalog.

## Decision Drivers

- Reuse the shipped `DialogSelect` primitive, the reactive `sync.data.provider`
  catalog, `fuzzysort`, and the `promptText`/`DialogPrompt` raw prompt — compose,
  do not re-author (the `DialogModel` pattern already proves it).
- Keep it a **TUI presentation change only**: no operator payload, command id,
  catalog version, dispatch path, or feature flag change (Feature 007 registration
  invariant preserved).
- Never regress: a model id absent from the connected catalog MUST stay enterable.
- Honest catalog: the list reflects only connected/authenticated providers; an id
  outside it is only reachable through an explicit escape hatch, never fabricated.
- Single source of truth for both seams so the two forms cannot diverge.

## Considered Options

- **Option A — One shared `DialogSelect` picker fed by a connected-models memo,
  reused by both seams, with a `Custom id…` raw-text escape hatch (chosen).**
  Author `ModelPicker` on `DialogSelect` over a reactive memo of
  `sync.data.provider` (patterned on `DialogModel`); rewire `pools.set`
  `+ Add model` and `semantic.model.disable` to open it; keep the existing raw
  `promptText` reachable via a `Custom id…` action. Payloads unchanged.
- **Option B — Keep the raw free-text prompt as the primary entry.** Rejected: it
  is exactly the status quo the user asked to remove; a typo yields a
  `provider/model` id no connected provider serves and the operator learns nothing
  about availability at bind time.
- **Option C — Offer the full models.dev universe (all known models, not just
  connected).** Rejected: the user asked specifically for the **connected** list
  ("lista sempre atualizada dos conectados"); listing disconnected models would
  invite binding to a provider that is not authenticated, and it does not reflect
  the live catalog the sync store already holds.
- **Option D — Server-side validation of the free-text id.** Rejected as the
  primary fix: it changes the operator port contract (out of scope, FR5) and still
  forces hand-typing; the connected catalog already tells the TUI which ids are
  valid, so validation-by-selection is simpler and contract-free. (Existing
  server-side validation on the unchanged payload is retained, not weakened.)

## Decision Outcome

Chosen option: **Option A**, because it satisfies the user's request with the
smallest surface — one shared picker over the catalog the TUI already holds — while
keeping every contract, parity, and non-regression invariant intact.

Key decisions recorded:

1. **One shared picker, reused by both seams.** `ModelPicker`
   (`packages/tui/src/operator/form/model-picker.tsx`, in guard scope) is authored
   once on `DialogSelect` over a reactive `connectedModelOptions()` memo of
   `sync.data.provider`, patterned on `DialogModel`. Both `pools.set`
   `+ Add model` (`multi-field-modal.tsx:474-478`) and `semantic.model.disable`
   (`descriptor.ts:213`) open it, so the two forms cannot diverge.
2. **Payloads unchanged — TUI presentation only.** `pools.set` still composes
   `{ bindings: [{ role, models: string[] }] }` with each entry a `provider/model`
   id string; `semantic.model.disable` still composes `{ id: "provider/model" }`.
   No operator command id, catalog version, dispatch path, server/port surface, or
   feature flag is added or altered (Feature 007 registration invariant).
3. **The list is the live connected catalog.** The picker reads only
   `sync.data.provider` through a reactive memo, so it is always up to date and
   reflects only connected/authenticated providers; each option resolves the
   `provider/model` id (`Provider.parseModel` format). The memo re-derives on
   connect/disconnect while the picker is open.
4. **A `Custom id…` raw-text escape hatch is mandatory (non-regression).** An
   `Actions`-category `Custom id…` action reopens the existing
   `promptText`/`DialogPrompt` raw prompt (`multi-field-modal.tsx:100-118`), which
   accepts the same trimmed non-empty string as today (`:477`). Nothing that works
   today regresses; an id absent from the catalog stays enterable.
5. **`semantic.model.disable` sources the connected provider catalog.** For
   consistency across both seams, `disable` uses the connected provider catalog —
   not the semantic-registered model set. The residual case (a
   registered-but-disconnected id) is covered by the `Custom id…` escape hatch.
   This trade-off is recorded in the consequences below rather than hidden.
6. **Honest edge behavior, no dead-end, no fabrication.** An empty catalog / no
   connected providers still renders the picker with the `Custom id…` action (never
   an empty dead-end); a model already in the bindings list is indicated/skippable;
   esc/cancel returns without mutation (the current `null`-on-cancel no-op). No
   option, escape-hatch entry, or reactive update fabricates a model id or a
   connected provider absent from the live catalog.

### Consequences

- Good: the operator picks a real, connected model by name instead of hand-typing
  `anthropic/claude-…`; typos that bind to a non-served id are eliminated for the
  common path, and the list is always current because it rides the reactive sync
  catalog.
- Good: zero contract surface — no operator payload, command id, catalog version,
  dispatch path, or flag changes, so no server, SDK, or catalog work is needed and
  parity across surfaces is preserved.
- Good: one shared picker means the two Operator forms cannot drift; it reuses the
  shipped `DialogSelect`/`sync.data.provider`/`fuzzysort`/`promptText` machinery,
  so the added surface is thin.
- Bad (documented boundary): `semantic.model.disable` lists the **connected
  provider catalog**, not the semantic-**registered** model set that is the
  semantically-precise source for "disable". A registered-but-disconnected model
  id must be entered through the `Custom id…` escape hatch rather than picked from
  the list — an accepted trade-off for one consistent picker across both seams,
  not a reconciliation of the two SSOTs (out of scope).
- Bad (residual): the `Custom id…` escape hatch preserves free-text entry, so a
  typo is still possible on that path — by design, because a catalog-absent id must
  remain enterable (non-regression). The escape hatch is a secondary action, not
  the primary path.
- Bad (reactivity nuance): the list reflects only what `sync.data.provider`
  currently reports as connected; a provider that is authenticated but not yet
  synced into the store will not appear until the store updates — acceptable given
  the reactive memo re-derives on the next sync tick and the escape hatch covers
  the gap.
