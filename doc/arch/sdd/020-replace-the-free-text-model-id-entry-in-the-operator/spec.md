---
id: 019f7e65-4ef9-74a3-b7c5-68ab663cb1a7
number: 020
slug: replace-the-free-text-model-id-entry-in-the-operator
status: implemented
created_at: 2026-07-20T07:19:56.410288Z
---
# Feature Specification: Replace The Free Text Model Id Entry In The Operator

Feature: 020-replace-the-free-text-model-id-entry-in-the-operator
Created: 2026-07-20
Scope: The Operator admin palette still asks the user to **hand-type a model id**
as free text in two config forms — the same `provider/model` string the TUI
already knows from its live connected-provider catalog. This feature replaces
both free-text `Model id` entries with an **always-up-to-date, selectable,
provider-grouped, searchable list** of the connected/configured models sourced
from the live sync catalog (`sync.data.provider`), so an operator **picks** a
model instead of typing `anthropic/claude-…` by hand and risking a typo. The
change is **TUI presentation only**: the operator command-port payload contracts
are UNCHANGED (`pools.set` still composes `{ bindings: [{ role, models: string[] }] }`
with each entry a `provider/model` id string; `semantic.model.disable` still
carries `{ id: "provider/model" }`), no operator command id, catalog version, or
dispatch path is added, and a **raw-text escape hatch** MUST remain reachable so
a model id absent from the catalog can still be entered — nothing that works
today may regress.

## Problem

The connected-models catalog is already live in the TUI, yet the Operator config
forms ignore it and fall back to free-text entry:

- **Two free-text `Model id` seams, both in the Operator admin palette.**
  1. **`pools.set` role→model bindings editor.** `BindingRowEditor.addModel()`
     (`packages/tui/src/operator/form/multi-field-modal.tsx:474-478`) calls
     `promptText(props.dialog, "Model id", "e.g. anthropic/claude-…")`
     (the helper at `:100-118` pushes a `DialogPrompt`) and appends the **raw
     trimmed string** to `row.models[]`. The `+ Add model` action lives in the
     per-binding `DialogSelect` list (`:485-496`). The payload contract is
     `pools.set`, field kind `bindings_list` (`field-list.ts:310-313`), composed
     to `{ bindings: [{ role, models: string[] }] }`. This is the screen the user
     showed.
  2. **`semantic.model.disable` field.** The descriptor
     (`packages/tui/src/operator/form/descriptor.ts:213`) is
     `{ mode: "text_input", key: "id", placeholder: "Model id", label: "Model id" }`,
     composing the payload `{ id: string }` — again a hand-typed `provider/model`.
- **The connected-models catalog is already fetched and reactive.** The sync
  store holds the connected-only provider catalog in `sync.data.provider`,
  fetched at `packages/tui/src/context/sync.tsx:452` via
  `sdk.client.config.providers({ workspace })` (GET `/config/providers` →
  `{ providers: Provider.Info[], default }`) and `sdk.client.provider.list` at
  `:453` (GET `/provider` → `{ all, default, connected: string[] }`). Each
  `Provider.Info` carries `models: Record<string, Model>`; a `Provider.Model`
  (`packages/opencode/src/provider/provider.ts:1029-1044`) exposes `id`,
  `providerID`, `name`, `family?`, `capabilities`, `cost`, `limit`. The model id
  format is `provider/model` (`Provider.parseModel`, `provider.ts:1990`). Because
  the sync store is reactive, a Solid memo over `sync.data.provider` stays
  **always updated** as providers connect or disconnect.
- **A proven picker pattern already exists.** The `/models` switcher
  `DialogModel` (`packages/tui/src/component/dialog-model.tsx`) already renders a
  searchable, provider-grouped, fuzzy-filtered (`fuzzysort` over `title`/`category`)
  picker over `sync.data.provider` — favorites/recents, a `Free` cost footer, a
  current-highlight. The `DialogSelect` primitive
  (`packages/tui/src/ui/dialog-select.tsx:23-72`) natively supports options with
  `{ title, value, description, details, footer, category, disabled }`, `onFilter`,
  `skipFilter`, `current`, `actions`, and `footerHints` — searchable and grouped
  out of the box.

So the machinery to pick from a live, connected list is already in the codebase
and shipped for the everyday switcher, but the two Operator config forms still
force free-text entry. Leaving them free-text means a typo produces a
`provider/model` id that no connected provider serves, and the operator learns
nothing about which models are actually available at bind time.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Pick a bound model from the live connected list (pools.set)

- As an operator editing a role pool, I want the `+ Add model` action to open a
  provider-grouped, searchable list of the currently connected/configured models
  so that I choose a real model by name instead of hand-typing
  `anthropic/claude-…`; the chosen entry is appended as its `provider/model` id
  string with the `pools.set` payload contract unchanged.

### P1 — Pick a model to disable from the live connected list (semantic.model.disable)

- As an operator disabling a model, I want the `Model id` field to present the
  same selectable connected list so that I pick the model instead of retyping its
  id; the `semantic.model.disable` payload (`{ id: "provider/model" }`) is
  unchanged.

### P1 — A raw-text escape hatch never regresses

- As an operator who needs a model id that is not (yet) in the connected catalog,
  I want a `Custom id…` action inside the picker that reopens the existing raw
  free-text prompt so that I can still enter any `provider/model` string —
  nothing that works today is lost.

### P1 — The list stays current and never dead-ends

- As an operator, I want the picker to reflect only connected/authenticated
  providers and to update reactively as providers connect/disconnect, and — when
  no providers are connected — to still offer the `Custom id…` escape hatch
  rather than presenting an empty, unusable dialog.

### P2 — No contract or parity drift

- As a maintainer, I want this to be a TUI presentation change only: the operator
  command-port payloads and the `OperatorSlashPort` dispatch are unchanged, no
  command id or catalog version is added, and both seams reuse one shared picker
  so the two forms never diverge.

## Functional Requirements

### Group A — The shared connected-models picker (FR1)

1. **A shared, live, provider-grouped, searchable connected-models picker (FR1).**
   Every Operator `Model id` form field MUST present a **selectable list** of the
   connected/configured models — NOT a free-text prompt as the primary path. The
   list MUST be sourced from the live sync connected catalog
   (`sync.data.provider`, `sync.tsx:452-453`) via a reactive Solid memo, so it
   stays **always up to date** as providers connect/disconnect, and MUST reflect
   ONLY connected/authenticated providers. Each option MUST show the model name
   and its provider (mirroring `DialogModel`: `title` = model name/id,
   `description` = provider name, `category` = provider for grouping), MAY surface
   optional cost/context metadata (e.g. a `Free` footer), and MUST be searchable
   (fuzzy filter over `title`/`category`, the `DialogModel` precedent) — built on
   the `DialogSelect` primitive (`dialog-select.tsx:23-72`). The picker MUST
   resolve to the selected model's `provider/model` id string (the
   `Provider.parseModel` format, `provider.ts:1990`). It is authored once and
   reused by both seams so the two forms never diverge.

### Group B — The two seams rewired (FR2–FR3)

2. **`pools.set` `+ Add model` opens the picker; payload UNCHANGED (FR2).** The
   `BindingRowEditor` `+ Add model` action
   (`multi-field-modal.tsx:474-478,485-496`) MUST open the shared picker instead
   of calling `promptText(dialog, "Model id", …)` directly. The chosen entry MUST
   be appended as its `provider/model` id string into `row.models[]`, so the
   composed `pools.set` payload (`{ bindings: [{ role, models: string[] }] }`,
   `field-list.ts:310-313`) is **byte-for-byte the same shape** it is today. A
   model already present in the binding's `row.models[]` MUST be indicated and/or
   skippable in the picker (mirroring the existing return-to-remove list at
   `:486-492`) so the same id is not silently duplicated.
3. **`semantic.model.disable` uses the picker; payload UNCHANGED (FR3).** The
   `semantic.model.disable` descriptor (`descriptor.ts:213`,
   `mode: "text_input", key: "id"`) MUST resolve its `Model id` value through the
   shared picker rather than a bare text input, composing the unchanged payload
   `{ id: "provider/model" }`. **Design decision (recorded honestly, not hidden):**
   the semantically-precise source for `disable` would be the
   semantic-**registered** models rather than the whole connected provider
   catalog; this feature deliberately uses the **connected provider catalog** for
   consistency across both seams, and the FR4 raw-text escape hatch covers the
   residual case of a **registered-but-disconnected** id that the connected
   catalog does not list. This trade-off is called out in ADR-0020 consequences.

### Group C — Escape hatch, non-regression, and no contract change (FR4–FR5)

4. **A raw-text escape hatch MUST remain reachable (non-regression) (FR4).** The
   picker MUST expose a `Custom id…` action (in the `Actions` category, the
   `DialogModel`/`BindingRowEditor` action-row precedent) that reopens the
   **existing** raw free-text prompt (`promptText` / `DialogPrompt`,
   `multi-field-modal.tsx:100-118`) so a `provider/model` id absent from the
   connected catalog can still be entered by hand. This path MUST accept the same
   trimmed non-empty string the current code accepts — nothing that works today
   may regress.
5. **No contract change — TUI presentation only (FR5).** This feature MUST NOT
   change any operator command-port payload, the `OperatorSlashPort` dispatch, any
   command id, the catalog version, or any server/port surface. `pools.set` and
   `semantic.model.disable` keep their exact request shapes; the only change is
   how the TUI **collects** the `provider/model` string from the operator. No new
   feature flag is introduced.

### Group D — Reactivity, edge cases, and honest states (FR6)

6. **Reactive, non-dead-ending, mutation-safe edge behavior (FR6).** The picker
   MUST handle the honest edge cases: (a) an **empty catalog / no connected
   providers** — the picker still renders and offers the `Custom id…` escape hatch
   (never an empty dead-end); (b) a provider **connects/disconnects while the
   picker is open** — the reactive memo re-derives the option list; (c) a model
   **already in the bindings list** — indicated/skippable per FR2; (d) **cancel /
   esc** — the picker closes and returns **without mutating** `row.models[]` or the
   descriptor value (the current `promptText` resolves `null` on cancel and the
   caller no-ops, `multi-field-modal.tsx:476-477` — that no-mutation behavior is
   preserved). No edge case fabricates a model id or a connected provider that is
   not in the live catalog.

## Non-Functional Requirements

- **Reuse the shipped machinery.** The `DialogSelect` primitive, the
  `sync.data.provider` reactive catalog, the `fuzzysort` grouping/filtering, and
  the `promptText`/`DialogPrompt` raw prompt are REUSED, not re-authored; the new
  picker is a thin composition over them, patterned on `DialogModel`.
- **Single source, no divergence.** Both seams call one shared picker so the two
  Operator forms cannot drift in behavior or presentation.
- **Honest catalog, no fabrication.** The list reflects only what
  `sync.data.provider` reports as connected; an id outside the catalog is only
  reachable through the explicit `Custom id…` escape hatch, never invented.
- **No contract, catalog, dispatch, or flag change.** Payloads, command ids, the
  catalog version, and the dispatch path are untouched; availability is unchanged.

## Acceptance Scenarios

Given the Operator admin palette is open and the sync connected catalog is loaded

- **Pick-from-list append (pools.set).**
  Given a role pool editor with a connected catalog that includes
  `anthropic/claude-…`,
  When the operator triggers `+ Add model` and selects that model from the
  provider-grouped searchable list,
  Then `anthropic/claude-…` is appended to `row.models[]` as its `provider/model`
  id string and the composed `pools.set` payload is
  `{ bindings: [{ role, models: [..., "anthropic/claude-…"] }] }` — the same shape
  as today.

- **Search / filter narrows the list.**
  Given the picker is open over several connected providers,
  When the operator types a query,
  Then the list fuzzy-filters over the model title and provider category
  (the `DialogModel` behavior), and selecting a filtered entry appends that
  `provider/model` id.

- **Escape hatch — custom id.**
  Given a `provider/model` id that is not in the connected catalog,
  When the operator chooses `Custom id…` in the picker,
  Then the existing raw free-text prompt opens, and a trimmed non-empty string is
  accepted exactly as it is today (append to `row.models[]` for `pools.set`, or
  `{ id }` for `semantic.model.disable`).

- **Empty catalog — no dead-end.**
  Given no providers are connected (empty `sync.data.provider`),
  When the operator opens the picker,
  Then the picker still renders and offers `Custom id…` so a model id can be
  entered — it never presents an empty, unusable dialog.

- **Reactive update.**
  Given the picker is open,
  When a provider connects or disconnects (the sync store updates),
  Then the option list re-derives to reflect the new connected set without
  reopening the picker.

- **Cancel leaves state untouched.**
  Given the picker is open,
  When the operator presses esc / cancels,
  Then the picker closes and neither `row.models[]` nor the descriptor value is
  mutated.

- **semantic.model.disable parity.**
  Given the `semantic.model.disable` field,
  When the operator picks a model from the list,
  Then the payload is `{ id: "provider/model" }` — unchanged — and the
  `Custom id…` escape hatch still allows a registered-but-disconnected id.

## Security Requirements

- **Data sensitivity/classification.** This feature reads the already-fetched
  connected-provider catalog (`sync.data.provider`: provider ids, model ids,
  display names, and public capability/cost/limit metadata) and writes the chosen
  `provider/model` id string into the same operator payloads the forms compose
  today. It reads and persists no secret material — provider credentials/`SecretRef`s
  are resolved server-side and never cross this TUI seam; the picker sees only the
  public catalog shape the sync store already holds.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary. Every operator dispatch continues to ride the existing
  `OperatorSlashPort` loopback and operator principal, scope, and CAS/confirmation
  gates unchanged; this feature only changes how the TUI collects a string that
  already flows through those gates.
- **Input validation.** The untrusted input is the operator's selection or the
  raw `Custom id…` string. A picked entry is a `provider/model` id drawn directly
  from the connected catalog (well-formed by construction). The escape-hatch raw
  string is trimmed and non-empty-checked exactly as the current code does
  (`multi-field-modal.tsx:477`); the operator command port performs its existing
  server-side validation of the id — this feature adds no weaker path and removes
  no existing check.
- **Cryptography in transit/at rest.** Not applicable — this feature moves no new
  data across a boundary and persists nothing new. The catalog is already fetched
  over the existing SDK transport; the composed payloads travel the existing
  operator dispatch path.
- **Logging/audit.** No new logging. Operator mutations continue to emit their
  existing Feature 007 audit correlation through the unchanged command port; the
  picker itself logs nothing and records no selection history beyond the reactive
  in-memory option list.
- **Error-handling information exposure.** The picker degrades honestly: an empty
  or unavailable catalog surfaces the `Custom id…` escape hatch rather than an
  error, and cancel returns without mutation. No error path leaks a secret, a
  credential, or a raw provider config fragment — the picker only ever handles
  public catalog fields and the id string.

## Observability

This is a TUI presentation change with no new backend surface, so it emits no new
metrics, log events, or trace spans. Operator dispatches from the rewired forms
continue to project through the existing Feature 007 EventV2 audit and the
ADR-0001 OTLP foundation with content-free, bounded labels (command id, domain,
surface, outcome) — unchanged, because the payload contracts are unchanged.
Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

The picker view-model and its resolution are specified in
`doc/arch/schemas/replace-the-free-text-model-id-entry-in-the-operator.cue`:

```
sync.data.provider (connected catalog, reactive)  --memo-->  ConnectedModelOption[]
  each option: { modelId: "provider/model", title, provider, category,
                 cost?, disabled? (already-in-list) }                       (FR1)

pools.set  '+ Add model'  --> picker over ConnectedModelOption[]
  select    -> append option.modelId to row.models[]   (payload UNCHANGED)  (FR2)
  Custom id… -> promptText raw prompt -> append trimmed string              (FR4)
  esc/cancel -> no mutation                                                 (FR6)

semantic.model.disable  'Model id' --> same picker
  select    -> { id: option.modelId }                  (payload UNCHANGED)  (FR3)
  Custom id… -> promptText raw prompt -> { id: trimmed string }             (FR4)

empty catalog -> picker renders with only the Custom id… action (no dead-end)(FR6)
provider connect/disconnect while open -> memo re-derives options           (FR6)

No option, no escape-hatch entry, and no reactive update fabricates a model id
or a connected provider absent from the live catalog (FR1, FR6). Payloads,
command ids, catalog version, and dispatch path are unchanged (FR5).
```

## Out of Scope

- Any server/port change — the operator command ports, payload contracts,
  `OperatorSlashPort` dispatch, command ids, and catalog version are untouched
  (FR5).
- The everyday `/models` switcher (`DialogModel`) — it already picks from the
  connected list well; this feature only reuses its pattern, it does not modify it.
- Adding new provider authentication/connection flows — the picker reflects
  whatever `sync.data.provider` already reports as connected; connecting a
  provider is a separate, existing surface.
- Reconciling the `semantic.model.disable` catalog source (connected provider
  catalog vs. the semantic-registered model set) beyond the documented escape
  hatch — recorded as an ADR-0020 boundary, not resolved here.
- Adding any operator command id, bumping the catalog version, introducing a new
  dispatch path, or adding a feature flag.

## Related Features and Decisions

- [ADR-0020 — Replace the free-text model id entry in the operator](../../adr/0020-replace-the-free-text-model-id-entry-in-the-operator.md)
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — the operator command/query authority, the `OperatorSlashPort` dispatch, and the registration invariant this feature preserves.
- [Feature 015 Redesign the operator TUI domain screens into true CRUD](../015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md) — the operator form/descriptor + multi-field-modal surface the two `Model id` seams live in.
- [Feature 019 Complete the semantic binding lifecycle and the remaining operator residuals](../019-complete-the-semantic-binding-lifecycle-and-the-remaining/spec.md) — the semantic registry/model surface behind `semantic.model.disable`.
- [Domain schema](../../schemas/replace-the-free-text-model-id-entry-in-the-operator.cue)

## Clarifications

### Session 2026-07-20

- **Both seams are the Operator admin palette (FR2, FR3).** The two free-text
  `Model id` entries are `pools.set` `+ Add model`
  (`multi-field-modal.tsx:474-478`) and `semantic.model.disable`
  (`descriptor.ts:213`); the `pools.set` bindings editor is the screen the user
  showed. Both are rewired to the shared picker.
- **Payloads are unchanged (FR2, FR3, FR5).** `pools.set` still composes
  `{ bindings: [{ role, models: string[] }] }` with each entry a `provider/model`
  id; `semantic.model.disable` still composes `{ id: "provider/model" }`. This is
  a TUI presentation change only — no operator port/dispatch/catalog change.
  Recorded in ADR-0020.
- **The list source is the live connected catalog (FR1).** The picker reads
  `sync.data.provider` (`sync.tsx:452-453`) through a reactive memo, mirroring the
  shipped `DialogModel` switcher, so it is "always updated" and reflects only
  connected/authenticated providers. Recorded in ADR-0020.
- **The escape hatch is mandatory (FR4).** A `Custom id…` action reopens the
  existing raw `promptText` prompt so a catalog-absent id is still enterable —
  non-regression is a hard requirement. Recorded in ADR-0020.
- **`semantic.model.disable` catalog-source trade-off (FR3).** The connected
  provider catalog is used for both seams for consistency; a
  registered-but-disconnected id is covered by the `Custom id…` escape hatch. The
  alternative (source `disable` from the semantic-registered model set) is
  recorded as an ADR-0020 consequence/boundary rather than adopted.
- **Reuse over authoring (NFR).** The picker is a thin composition over
  `DialogSelect` + `sync.data.provider` + `fuzzysort` + `promptText`, patterned on
  `DialogModel` — no new primitive is authored. Authored once, reused by both
  seams. Recorded in ADR-0020.
