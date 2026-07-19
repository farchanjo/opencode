# Implementation Plan: Restructure the Operator Control Plane TUI From a Flat List

Feature: 011-restructure-the-operator-control-plane-tui-from-a-flat
Status target: planned (after this plan is complete)
ADR: [ADR-0011](../../adr/0011-restructure-the-operator-control-plane-tui-from-a-flat.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR8; navigation model; normative label copy)

## Overview

Feature 007 delivered the unified native Operator Control Plane (typed
command/query dispatch, reserved catalog, auth, CAS, audit, and thin parity
adapters). Its TUI surface still renders a **flat wall** of every reserved catalog
verb as top-level palette rows with the unusable `"Operator query: <id>"` subtitle,
fires mutations with **no payload**, and leaves five built read panels unwired.

This plan restructures **presentation and navigation only** over the unchanged
Feature 007 dispatch: one `Operator` palette entry opens a grouped `home` menu of
all 12 reserved domains; each domain panel splits verbs into a **View** section
(read-only) and a **Configure** section (mutations); a generalised typed form
collects a payload for the domains that persist today; the five read panels are
wired to the operator result signal; and honest-unavailable verbs are marked and
surface the typed `unavailable` envelope without ever faking success.

**Explicitly out of this plan (invariants preserved):**

- **No new dispatch path (Feature 007 parity, FR8).** Palette, submenu, and form
  dispatch the same canonical command IDs through the same `OperatorClient`
  loopback as slash/CLI — no parallel registry, divergent name, or new route.
- **No backend changes.** Only `langlock`, `jobs`, `routing`, `process`, and `task`
  persist today; the honest-unavailable domains stay unavailable (their backends
  are separate domain work, out of scope).
- **No control-plane flag change.** The surface stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`; this
  feature adds no new flag.
- **No i18n layer.** Copy stays centralised in `palette.ts` where it is produced.
- **No new navigation framework.** Navigation reuses the existing Dialog
  push/replace stack (`ctx.push` / `ctx.replace`).

## Technical Approach

### Architecture layers affected

```
Top-level palette (packages/tui/src/app.tsx)
  ONE "Operator" entry  ── opens ──▶  home group list
        │  (flat per-verb spread REMOVED; curated `suggest` set MAY remain)
        ▼
Grouped navigation (packages/tui/src/operator/dialog-settings.tsx)
  DialogOperatorSettingsHome (home)      12 domain rows + availability badge
        │  domain_selected
        ▼
  DialogOperatorDomainPanel (domain_panel)
        │  View section (mutates=false)          Configure section (mutates=true)
        ├─ view_verb ─────▶ ResultToast / wired read panel
        ├─ confirm_verb ──▶ ConfirmDialog ──▶ dispatch
        ├─ input_verb ────▶ InputForm ──▶ [ConfirmDialog] ──▶ dispatch(payload)
        └─ unavailable_verb ─▶ ResultToast (typed unavailable envelope)
        ▼
Dispatch (packages/tui/src/operator/execute.ts, UNCHANGED path)
  executeOperatorCommand ──▶ same OperatorClient loopback as slash/CLI
```

Catalog metadata (`packages/core/src/operator/catalog.ts`: `mutates`, 12 domains)
and the projection helpers (`packages/core/src/operator/palette.ts`) are the single
source the projection reads; the navigation ValueObjects are specified in
`doc/arch/schemas/operator-menu/` and the statechart in
`doc/arch/statecharts/operator-menu-navigation.md`.

### Phase 1 — Core palette metadata and label copy (`palette.ts`)

Centralise all copy where it is produced; add availability + input metadata derived
from the Feature 007 catalog. No i18n layer.

- **Availability derivation (`#VerbAvailability`).** Per verb: `unavailable` when its
  `#PersistenceClass` is `honest_unavailable`; `confirm_required` when
  `requiresConfirmation` (and it persists); otherwise `available`. Persistence is a
  **static map** of the domains that persist today —
  `{langlock, jobs, routing, process, task}` = `persists_today`; the rest
  (`telemetry, smart, budget, pools, output, semantic, mcp` mutations) =
  `honest_unavailable`. View (read-only) verbs are `available` regardless (they read
  redacted state), except where a read backend is itself unavailable, which reuses
  the same static map.
- **Input mode derivation (`#InputMode`).** A static per-verb descriptor map marks
  which Configure verbs need a payload and whether it is a `value_picker` or
  `text_input`; verbs with no payload stay `none`. Covers the persisting domains:
  `langlock` (`set`, `reset`), `jobs` (`create`, `update`, `enable`, `disable`,
  `delete`, `reschedule`, `run-now`), `routing` (`configure`), `process` (`cancel`,
  `steer`, `handoff`), `task` (`cancel`).
- **Normative label copy (FR4).** Replace `titleFor` / the `description` ternary with
  explicit action copy — verbatim from the spec and `operator-menu/text-values.cue`:
  - Top entry: title `Operator`, subtitle `Grouped operator settings and views`.
  - Domain-group row subtitle: `{Available|Partial|Unavailable} · {view_count} views · {configure_count} settings`.
  - View verb: title `View: {verbLabel}`, subtitle `Read-only view · {commandId}`.
  - Configure verb (available): title `Configure: {verbLabel}`, subtitle `Editable setting · {commandId}`.
  - Configure verb (confirm required): subtitle `Editable setting · confirm required · {commandId}`.
  - Unavailable verb: subtitle `Unavailable · not implemented yet · {commandId}`.
  - Secret-bearing verb (`isOperatorSecretMutationId`): the subtitle appends ` · secret`.

  The canonical dotted `{commandId}` stays discoverable in the subtitle but is never
  the primary label; `{verbLabel}` is a humanised verb, not the dotted id.
- **Extend `OPERATOR_SETTINGS_DOMAINS` from 8 to 12 (FR2).** Add `process`, `task`,
  `jobs`, `output` so every reserved domain projects into the group menu.
- **Keep `suggest()` curated subset (FR1).** `listOperatorSuggestedEntries()` (the
  read-only `status`/`show` queries already flagged `suggest`) MAY still surface as
  top-level quick access; the full flat wall is removed.
- **Projection builders.** Add helpers that assemble the `#GroupList` (12
  `#DomainGroup` rows with badge + `view_count`/`configure_count`) and the per-domain
  `#DomainPanel` (`view` / `configure` `#VerbList`) so `palette.ts` owns the shape
  the dialog renders.

### Phase 2 — TUI navigation (`app.tsx` + `dialog-settings.tsx`)

- **Collapse the flat spread (FR1).** In `packages/tui/src/app.tsx`, remove the
  unconditional `listOperatorPaletteEntries()` spread of top-level per-verb commands;
  keep exactly ONE `Operator` palette entry that opens
  `DialogOperatorSettingsHome`. The curated `suggest` set MAY remain as quick access.
- **Home group list (FR2).** `DialogOperatorSettingsHome` lists all 12 domains from
  the `#GroupList` projection, each with its human label and availability-badge
  subtitle. Selecting a domain pushes the domain panel via `ctx.push`.
- **Domain panel split (FR3).** `DialogOperatorDomainPanel` renders the `view` and
  `configure` `#VerbList`s as two labelled sections, with confirm-required and
  secret markers already baked into each row subtitle from Phase 1. Row selection
  routes per `#InputMode` / `#VerbAvailability`: view → result/panel;
  confirm_required → `DialogConfirm`; input → form; unavailable → result toast with
  the typed envelope.

### Phase 3 — Editable configuration forms (FR5)

- **Generalise `DialogLangLockPicker`.** Extract the value-picker + text-input pattern
  from `packages/tui/src/settings/langlock/index.tsx` into a small reusable form
  component under `packages/tui/src/operator/form/` driven by the per-verb
  `#InputMode` descriptors from Phase 1. The form collects the typed payload and hands
  it to `executeOperatorCommand({ ..., payload })` — the SAME dispatch path (FR8).
- **Wire the persisting domains.** `langlock.set`/`reset`, the `jobs` mutations,
  `routing.configure`, `process.cancel`/`steer`/`handoff`, `task.cancel`.
- **No-payload verbs keep direct dispatch.** Verbs whose `#InputMode` is `none`
  dispatch directly (through `DialogConfirm` first when confirm-required).
- **Honest-unavailable verbs dispatch honestly.** They invoke the command and surface
  the returned typed `unavailable`/`not_implemented` envelope; the form MUST NOT
  synthesize success. Input validation is delegated to the Feature 007 typed command
  schema — the form never constructs a command id or scope from free-form text, and
  never renders/echoes/persists secret material in a field, label, subtitle, or toast
  (secrets flow via the Feature 007 secure secret-reference path).

### Phase 4 — Read-side panel wiring (FR6)

- **Wire the five built panels** (`packages/tui/src/operator/{jobs,output,langlock,semantic,mcp}/index.tsx`)
  into their domain panel's View section, fed by the operator result signal. Each
  panel falls back to its existing honest-empty baseline (`EMPTY_*_SIGNAL`) when no
  signal is present; no mutation is dispatched on a view selection.

### Phase 5 — Tests + doc sync

- **Unit — palette metadata/labels (`packages/core/test/operator/**`).** Assert the
  normative copy for view/configure/confirm/unavailable/secret rows; the 12-domain
  `OPERATOR_SETTINGS_DOMAINS`; the `#GroupList` badge + counts; and the static
  availability/input-mode maps. Update any test asserting the old
  `"Operator query: <id>"` copy or the flat entry set.
- **Unit/integration — dialog navigation + form dispatch + honest-unavailable
  (`packages/tui/test/operator/**`).** Assert: one top-level `Operator` entry, no flat
  per-verb rows; home lists 12 domains; the View/Configure split with markers; the
  form collects and dispatches the payload through the same path; and an unavailable
  verb surfaces the typed envelope with no synthesized success.
- **Parity check (FR8).** A test asserting the palette/form dispatch the same command
  id as slash/CLI (reuse the Feature 007 parity harness; assert command id + no new
  path), keeping the invariant honest.
- **Doc sync.** Keep the spec, ADR-0011, the navigation schema, and the statechart in
  sync with the shipped copy and node names; refresh `AGENTS.md`/`README.md` only if a
  path or user-facing surface description drifts.

## Data model and migration strategy

None. This feature persists nothing itself and introduces no table or store; Feature
007 owns Config.Service persistence, CAS, idempotency, and the EventV2 audit. The
navigation is a pure projection over the reserved catalog, typed by the ValueObjects
in `doc/arch/schemas/operator-menu/` (`#OperatorMenuModel`, `#GroupList`,
`#DomainPanel`, `#VerbItem`) and the bounded enums (`#NavNode`, `#VerbSection`,
`#VerbAvailability`, `#InputMode`, `#PersistenceClass`).

## Navigation state machine

Per `doc/arch/statecharts/operator-menu-navigation.md`:

```
[*] → home            (operator_selected — the one Operator entry)
home → domain_panel   (domain_selected)          home → closed (dismissed)
domain_panel → result_toast   (view_verb_selected | unavailable_verb_invoked)
domain_panel → confirm_dialog (confirm_verb_selected)
domain_panel → input_form     (input_verb_selected)
input_form → confirm_dialog   (payload_collected_confirm_required)
input_form → result_toast     (dispatched)        input_form → domain_panel (cancelled)
confirm_dialog → result_toast (confirmed_dispatched)  confirm_dialog → domain_panel (cancelled)
result_toast → domain_panel   (back)              result_toast → closed (dismissed)
back transitions unwind the Dialog push/replace stack and never mutate state.
```

Both dispatch leaves (`dispatched`, `confirmed_dispatched`) invoke the same command
id through the same `OperatorClient` loopback as slash/CLI (FR8).

## Security and threat boundaries

| Concern                     | Mitigation                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| No new authenticated surface | Every dispatch flows through the Feature 007 `OperatorClient` loopback + operator principal (FR8). |
| Input validation            | Payload handed to the typed command schema; form never builds a command id/scope from free text.   |
| Secret handling             | Secret verbs marked via `isOperatorSecretMutationId`; forms use the secure secret-ref path only.   |
| No secret leakage           | No secret material rendered/echoed/persisted in a field, label, subtitle, or result toast.         |
| Honest availability (FR7)   | Unavailable verbs surface the typed envelope verbatim; UI never synthesizes success.               |
| No new audit/log channel    | Audit stays the Feature 007 EventV2 record; TUI adds no transcript entry or session injection.     |

## Observability

No new telemetry. Dispatches continue to project through the Feature 007 EventV2
audit and the ADR-0001 OTLP foundation with content-free, bounded labels
(command/query id, source, scope, outcome). Navigation carries no request-scoped
identifiers beyond what the underlying dispatch already records; no verb label,
payload, or secret is exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Narrow paths only; most of the implementation surface is already in scope under the
Feature 007 block. The only genuinely-new path is the top-level palette host
(`packages/tui/src/app.tsx`). Reused seams are listed for traceability:

```toml
# Genuinely new to Feature 011:
"packages/tui/src/app.tsx",                # collapse flat spread → one Operator entry (FR1)
# Already in scope (Feature 007 / 001) — NOT re-added, listed for traceability:
#   packages/core/src/operator/**          → palette.ts + catalog.ts projection metadata (FR1-FR4)
#   packages/tui/src/**/operator/**        → dialog-settings.tsx, execute.ts, form/**, five panels (FR2-FR7)
#   packages/tui/src/**/settings/**        → DialogLangLockPicker source pattern (FR5)
#   packages/core/test/operator/**         → palette metadata/label unit tests (Phase 5)
#   packages/tui/test/**                   → dialog/form/honest-unavailable tests (Phase 5)
```

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Core palette metadata + normative copy + 12-domain settings (`palette.ts`).
2. TUI navigation: one Operator entry (`app.tsx`); home + domain-panel split
   (`dialog-settings.tsx`).
3. Generalised editable form + wire persisting-domain Configure verbs.
4. Wire the five read panels; honest-empty fallback.
5. Tests (palette copy, navigation, form dispatch, honest-unavailable, parity) +
   doc sync.

## Companion artifacts

None required beyond this plan. The navigation ValueObjects
(`doc/arch/schemas/operator-menu/`) and the statechart
(`doc/arch/statecharts/operator-menu-navigation.md`) already carry the data model;
no `research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR8 mapped to ordered phases
- [x] No new dispatch path / no backend change / no new flag stated explicitly
- [x] Normative label copy reproduced verbatim from the spec + text-values.cue
- [x] Availability + input-mode derivation from a static persisting-domains map
- [x] `OPERATOR_SETTINGS_DOMAINS` extension 8 → 12 called out
- [x] Navigation reuses the Dialog push/replace stack; nodes match the statechart
- [x] Security: parity, input validation, secret handling, honest availability
- [x] specScopeGlobs narrow; only `packages/tui/src/app.tsx` genuinely new
- [x] `tasks.md` generated and filled
- [x] `speckit analyze` clean of new Critical/High/Medium blockers
- [x] `speckit validate --json` green (0 new findings on Feature 011 artifacts)
