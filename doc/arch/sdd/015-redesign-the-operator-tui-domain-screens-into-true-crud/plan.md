# Implementation Plan: Redesign the Operator TUI Domain Screens into True CRUD

Feature: 015-redesign-the-operator-tui-domain-screens-into-true-crud
Status target: planned (after this plan is complete)
ADR: [ADR-0015](../../adr/0015-redesign-the-operator-tui-domain-screens-into-true-crud.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR18; domain model; honest-availability + parity invariants)

## Overview

Features 011/012/013/014 built the operator TUI plumbing — grouped navigation, a
structured result signal, config-backed persistence, and per-verb honest
availability. The operator-facing experience is still wrong on four counts the
spec pins:

1. **The palette leaks a flat wall.** `app.tsx` renders the single `Operator`
   entry PLUS `...operatorSuggestedEntries().map(...)` (`packages/tui/src/app.tsx:981`),
   spreading the read-only suggested subset back as top-level Commands rows
   (`View: Status` ×8, truncated ids). The `suggest` field
   (`palette.ts:44`), `listOperatorSuggestedEntries` (`:332`), and
   `operatorSuggestedEntries` (`operator/execute.ts`) feed only this spread.
2. **Views are toasts, not screens.** `DialogOperatorDomainPanel`
   (`dialog-settings.tsx:185`) dispatches a **toast** for a non-rich domain's View
   verb; status never renders on the screen.
3. **Configuration is inconsistent.** Enable/disable is two command rows, not one
   toggle with a state badge; edit forms (`operator/form/`) open a text input that
   starts **empty**; errors surface as toasts.
4. **Collection domains have no CRUD.** Jobs, semantic providers/models, and MCP
   servers persist real entities (Feature 014) but have no list → item →
   edit/toggle/delete/create flow.

This plan is a **presentation-and-composition** change over the UNCHANGED Feature
007 dispatch: collapse the palette to one entry and retire the `suggest` spread,
compose each domain screen with an inline status section, toggle/tri-state
controls, edit/view modals, and entity CRUD for jobs/semantic/mcp — all over the
same `executeOperatorCommand`/`OperatorClient` loopback, respecting the Feature
014 per-verb availability.

**Explicitly out of this plan (invariants preserved):**

- **Feature 007 registration authority (FR17).** No catalog id is added and no
  catalog version is bumped; this feature is presentation only.
- **No new dispatch path (parity, FR17).** Every screen action rides the SAME
  `executeOperatorCommand`/`OperatorClient` loopback; no parallel registry,
  divergent name, or new route.
- **Reuse the runtime.** The Feature 007 dispatch, the Feature 012 result signal +
  projections + Dialog push back-stack, the Feature 011 grouped projection
  (`buildOperatorGroupList`/`buildOperatorDomainPanel`), and the Feature 014
  backends + per-verb availability are reused unchanged.
- **No flag change.** All work stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`.
- **No fabricated success (FR15).** An unavailable verb renders marked + inert and
  surfaces the typed envelope; nothing is synthesized.
- **No new dialog primitive.** Modals are a small operator-scoped component over
  the existing `ui/dialog.tsx` push/back-stack (FR16).

## Technical Approach

### Architecture layers affected

```
Palette host (packages/tui/src/app.tsx)
  remove ...operatorSuggestedEntries().map(...) spread ── one Operator entry ──▶ (FR1)
        │
        ▼
Copy + machinery (packages/core/src/operator/palette.ts, operator/execute.ts)
  retire suggest field + listOperatorSuggestedEntries + operatorSuggestedEntries;
  unique row-title copy contract centralised ── no dead code, no dup titles ──▶ (FR2, FR3)
        │
        ▼
Domain screen composition (packages/tui/src/operator/dialog-settings.tsx)
  on open: silent status read → inline StatusSection (key_value | rich_panel);
  remove the non-rich View toast branch (:185); refetch after every mutation ──▶ (FR4, FR5, FR6)
        │  (statechart: doc/arch/statecharts/operator-crud-screen.md)
        ▼
Controls (packages/tui/src/operator/*, palette.ts control classification)
  on/off pair → ONE ToggleRow (state badge, opposite-verb dispatch);
  smart on/off/auto → TriStateRow pre-selected picker ── never binary ──────▶ (FR7, FR8)
        │
        ▼
Modal component (packages/tui/src/operator/form/**)
  EditModal: silent read → pre-fill fields → validate → dispatch → close/in-modal error;
  ViewModal: structural key/value tree, Esc closes ── over the push/back-stack ─▶ (FR9, FR10, FR11, FR16)
        │
        ▼
Entity CRUD (packages/tui/src/operator/{jobs,semantic,mcp}/**)
  list → item → edit/toggle/delete(confirm)/create over the reused pickers ────▶ (FR12, FR13, FR14)
        ▼
Honest availability (Feature 014 palette per-verb Partial) on every control ───▶ (FR15)
Parity: same command id / same loopback / no new path ────────────────────────▶ (FR17)
Toasts only for a user-invoked mutation's final outcome ──────────────────────▶ (FR18)
```

The reused runtime — the Feature 007 `executeOperatorCommand`
(`packages/tui/src/operator/execute.ts`), the Feature 012 result signal +
per-domain projections (`operator/{jobs,output,langlock,semantic,mcp}/state.ts`)
and the Dialog push/back-stack (`packages/tui/src/ui/dialog.tsx`), the Feature 011
grouped projection (`packages/core/src/operator/palette.ts`), and the Feature 014
per-verb availability — is the single surface the screens compose onto; the CRUD
ValueObjects are specified in `doc/arch/schemas/operator-crud-screens/` and the
screen lifecycle in `doc/arch/statecharts/operator-crud-screen.md`.

### Phase 1 — Single Operator entry, unique titles (FR1, FR2, FR3)

- **Remove the palette spread (FR1).** Delete the
  `...operatorSuggestedEntries().map(...)` block in `app.tsx` (`:981`) so exactly
  one `Operator` Commands entry (opening `DialogOperatorSettingsHome`) remains.
- **Retire the `suggest` machinery (FR2).** Remove the `suggest` field from
  `OperatorPaletteEntry`, delete `listOperatorSuggestedEntries` (`palette.ts:332`)
  and the `operatorSuggestedEntries` re-export (`operator/execute.ts`), and drop
  the `suggest` computation in `listOperatorPaletteEntries` — leaving no dead code.
  Record the retirement in ADR-0015. Keep `buildOperatorGroupList`/
  `buildOperatorDomainPanel`.
- **Unique title copy contract (FR3).** Centralise the row-title copy in
  `palette.ts` so no two rows on a surface share a human title — scope a verb title
  to its domain screen (action-only where the domain is implicit, domain-qualified
  where not), keep the dotted id as the secondary line. Update the
  palette label unit tests.

### Phase 2 — Domain screen composition: inline status (FR4, FR5, FR6)

- **Silent status read on open (FR4).** In `DialogOperatorDomainPanel`, issue the
  domain's status read through `executeOperatorCommand` with the silent option on
  screen open and render an inline **StatusSection** — a generic key/value renderer
  projected from the effective payload for plain domains, the existing rich panel
  (`operator/{jobs,output,langlock,semantic,mcp}/index.tsx`) for the rich domains.
- **Remove the View toast branch (FR5).** Delete the branch that dispatches a
  toast for a non-rich domain's View verb (`dialog-settings.tsx:185`); route detail
  verbs to the view modal (Phase 4) instead.
- **Refetch after mutation (FR6).** After any on-screen mutation returns, re-issue
  the silent status read so the StatusSection reflects the commit; a
  `version_conflict`/typed gap keeps the prior state and surfaces the typed reason.

### Phase 3 — Toggle and tri-state controls (FR7, FR8)

- **Collapse on/off pairs into a ToggleRow (FR7).** Classify enable/disable verb
  pairs (`telemetry.on`/`off`, `smart.on`/`off`, per-entity `jobs.enable`/`disable`,
  `mcp.experimental`/`extension` `enable`/`disable`) in `palette.ts` and render ONE
  toggle row with a current-state badge whose action dispatches the opposite verb;
  an unavailable backend renders the row `unavailable` and inert (FR15).
- **Tri-state picker (FR8).** Render smart-routing `on`/`off`/`auto` as a
  TriStateRow whose action opens a three-option picker pre-selected to the current
  mode (a `DialogSelect` over the three verbs), dispatching the selected mode. NOT a
  binary toggle.

### Phase 4 — Modal component: edit + view (FR9, FR10, FR11, FR16)

- **Operator-scoped modal component (FR16).** Add a small modal component under
  `packages/tui/src/operator/form/` built over the existing `ui/dialog.tsx`
  push/back-stack — NOT a new dialog primitive — defining a title, fields (label +
  pre-filled value + input kind + validation), footer Save/Cancel, a busy state,
  and an in-modal error surface.
- **Edit modal pre-fill + validation (FR9, FR10).** On open, silently read the
  current effective value and pre-fill each field (no empty inputs; honest empty +
  placeholder when absent); validate per field; Save dispatches through
  `executeOperatorCommand`, closes on success, and surfaces a typed error in-modal.
  Fix the `descriptor.ts` empty-input residual so text inputs seed from the current
  value.
- **View modal (FR11).** Render a detail verb's effective payload as a structural
  key/value tree (read-only, Esc closes); honest empty tree when the payload is
  absent.

### Phase 5 — Entity CRUD: jobs, semantic, mcp (FR12, FR13, FR14)

- **Jobs (FR12).** Render the jobs list; a job pushes an item screen offering edit
  (edit modal), reschedule (edit modal), an enable/disable toggle, and delete behind
  the confirm gate; the list offers create. `run-now` stays a marked typed gap.
- **Semantic (FR13).** Render providers and models as lists; provider
  add/edit/rotate-secret/disable/delete and model register/disable/delete through
  the toggle/edit-modal/confirm contract; secrets `SecretRef`-only; Milvus index
  ops marked typed gaps.
- **MCP (FR14).** Render servers as a list; add/edit/connect-disconnect/delete,
  where connect/disconnect is a toggle over the live service state; unreachable ops
  marked typed gaps.

### Phase 6 — Honest availability + parity wiring (FR15, FR17, FR18)

- **Honest availability (FR15).** Every control (toggle, tri-state, edit, view,
  entity action) consults the Feature 014 per-verb availability
  (`palette.ts` `persistenceFor`/`domainBadge`) and renders an unavailable verb
  marked + inert, surfacing the typed envelope on invocation.
- **Parity (FR17).** Assert every screen action rides the same command id / same
  loopback with no new dispatch path, no new catalog id, and no catalog version
  bump (reuse the Feature 007 parity harness).
- **Toast discipline (FR18).** A toast fires only for a user-invoked mutation's
  final outcome; silent reads, status sections, and view modals never toast.

### Phase 7 — Tests + doc sync

- **Palette (Phase 1).** One Operator entry; no suggested rows spread; the
  `suggest` machinery removed; unique titles (no duplicate human titles on a
  surface).
- **Screen composition (Phase 2).** Status renders inline on open (no toast); the
  non-rich View toast branch is gone; the StatusSection refetches after a mutation
  and keeps prior state on a `version_conflict`.
- **Controls (Phase 3).** On/off renders one toggle row dispatching the opposite
  verb; an unavailable toggle is inert; the tri-state picker opens pre-selected and
  dispatches the selected mode.
- **Modals (Phase 4).** The edit modal pre-fills from the current value, validates
  in-modal, closes on success, and surfaces an error in-modal (not a toast); the
  view modal renders the key/value tree and closes on Esc.
- **Entity CRUD (Phase 5).** Jobs/semantic/mcp list → item → edit/toggle/delete/
  create over the reused pickers; typed gaps marked.
- **Honesty + parity (Phase 6).** Every control honours the per-verb availability;
  the parity harness asserts no new dispatch path / id / version bump.
- **Doc sync.** Keep the spec, ADR-0015, the `operator-crud-screens/*.cue` corpus,
  and the `operator-crud-screen` statechart in sync with the shipped shapes;
  refresh `AGENTS.md`/`README.md` only if a user-facing surface description drifts.

## Data model and migration strategy

No new store, table, or dispatch path: the CRUD screens are a **presentation**
projection over the EXISTING Feature 007 dispatch, the Feature 012 result signal,
and the Feature 014 backends. No data migration is required — nothing new is
persisted; the edit modals mutate the same authorities through the same CAS path
the current forms use. The screen composition, controls, modal contract, and
entity-list projection are typed by the ValueObjects in
`doc/arch/schemas/operator-crud-screens/` (`#DomainScreen`, `#StatusSection`,
`#ScreenSection`, `#ToggleRow`, `#TriStateRow`, `#EditModal`, `#EditField`,
`#ViewModal`, `#ViewNode`, `#EntityListScreen`, `#EntityRow`, `#EntityAction`, and
the bounded enums `#OperatorDomain`, `#ScreenNode`, `#SectionKind`,
`#StatusRenderer`, `#ControlKind`, `#ToggleState`, `#TriState`, `#FieldInput`,
`#ModalStatus`, `#EntityVerb`, `#EntityKind`).

## Screen lifecycle state machine

Per `doc/arch/statecharts/operator-crud-screen.md`:

```
screen_opened → loading → screen (inline StatusSection; no toast)
screen → { view_modal | edit_modal | toggling | tristate_picker | entity_list }
edit_modal → field_invalid (loop) | save_valid → dispatching
toggling → opposite_verb_dispatched → dispatching | unavailable_inert → screen
tristate_picker → mode_selected → dispatching
entity_list → entity_item → { edit_modal | toggling | confirm → dispatching }
dispatching → outcome_success → refetch → screen
            | outcome_error_in_modal → edit_modal
            | outcome_typed_gap → screen (prior state kept)
```

Every dispatch leaf rides the same `executeOperatorCommand`/`OperatorClient`
loopback as slash/CLI (FR17); an unavailable verb is marked + inert (FR15); a
toast fires only for a user-invoked mutation's final outcome (FR18).

## Security and threat boundaries

| Concern                       | Mitigation                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| No new authenticated surface  | Every screen action rides the Feature 007 `OperatorClient` loopback + operator principal/scope/CAS (FR17). |
| No new dispatch path          | Presentation only; no parallel registry, divergent name, catalog id, or version bump (FR17).        |
| Secret handling               | Secret-bearing edits stay `SecretRef` only (Feature 014 FR11); the modal edits the reference, never a plaintext secret. |
| Input validation              | Edit-modal fields validate in-modal, then the reused port schema-validates → typed `invalid_argument`. |
| Destructive actions           | Delete and other destructive entity actions ride the existing confirmation gate.                    |
| Honest capability gaps        | Milvus index, `jobs.run-now`, lifecycle cancel, and unreachable ops render marked + inert (FR15).   |
| No secret/payload leakage     | Status sections, view modals, entity lists, and in-modal errors carry only bounded, secret-free reasons. |
| Audit                         | Mutations emit the Feature 007 EventV2 audit correlation with bounded labels (command id, domain, surface, outcome). |

## Observability

No new telemetry of its own. Operator dispatches from the CRUD screens continue to
project through the Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with
content-free, bounded labels (command id, domain, surface, scope, outcome). The
screen composition, status sections, view modals, and entity lists emit nothing of
their own and record only what the reused dispatch already records; no config
payload, secret, credential, spool body, or role-pool model id is exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Presentation only; the entire surface is ALREADY in scope under the Feature 007 /
011 / 012 blocks. `packages/tui/src/app.tsx` (Feature 011), `packages/tui/src/**/
operator/**` and `packages/tui/src/**/settings/**` (Feature 007),
`packages/core/src/operator/**` (Feature 007), `packages/tui/src/ui/dialog.tsx`
and `packages/tui/src/context/**` (Feature 012), and `packages/tui/test/**`
(Feature 001) cover every touched path. **No genuinely-new implement path** — no
`speckit.toml` glob change is required for Feature 015.

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Single Operator entry + `suggest` retirement + unique titles.
2. Domain screen composition: inline status section, remove View toast branch,
   refetch after mutation.
3. Toggle + tri-state controls.
4. Modal component: edit modal (pre-fill + validation) + view modal.
5. Entity CRUD: jobs, semantic, mcp.
6. Honest availability + parity wiring.
7. Tests (palette, composition, controls, modals, entity CRUD, honesty, parity) +
   doc sync.

## Companion artifacts

None required beyond this plan. The CRUD ValueObjects
(`doc/arch/schemas/operator-crud-screens/`) and the statechart
(`doc/arch/statecharts/operator-crud-screen.md`) carry the data model; no
`research.md`, `data-model.md`, `contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR18 mapped to ordered phases
- [x] No new catalog id / no catalog version bump / no new dispatch path / no flag (FR17)
- [x] Palette: one Operator entry, `suggest` spread + machinery retired, unique titles (FR1-FR3)
- [x] Screen composition: inline status on open, View toast branch removed, refetch after mutation (FR4-FR6)
- [x] Controls: on/off toggle rows, tri-state pre-selected picker (FR7, FR8)
- [x] Modals: edit modal pre-filled + validated + in-modal error; structural view modal (FR9-FR11, FR16)
- [x] Entity CRUD for jobs/semantic/mcp (FR12-FR14)
- [x] Honest availability on every control; toasts only for mutation outcomes (FR15, FR18)
- [x] specScopeGlobs: no genuinely-new path; existing 007/011/012 blocks cover the surface
- [x] Security: SecretRef-only, in-modal validation, confirm gate, no fabricated capability, parity
- [x] `tasks.md` generated and filled
- [x] `speckit analyze` clean of new Critical/High/Medium blockers
- [x] `speckit validate --json` green (0 new findings on Feature 015 artifacts)

## Implementation notes (recorded during implement)

- 2026-07-19 — T001-T024 landed per plan: `app.tsx` now exposes exactly one
  `Operator` Commands entry; the `...operatorSuggestedEntries().map(...)`
  spread, the `suggest` field, `listOperatorSuggestedEntries`, and the
  `operatorSuggestedEntries` re-export are retired (FR1, FR2), closing the
  `View: Status` ×8 duplicate-title wall via a centralized row-title
  contract (FR3). Domain screens issue a silent status read on open and
  render an inline status section, refetching after every on-screen
  mutation (FR4, FR6); the non-rich-domain View toast branch is removed in
  favour of a structural view modal (FR5, FR11). On/off verb pairs render
  as a single toggle row with a state badge; the tri-state smart-routing
  setting renders a three-option picker pre-selected to the current mode,
  never a binary toggle (FR7, FR8). Editable settings open an edit modal
  that pre-fills from a silent read, validates per field, and surfaces
  errors in-modal (FR9, FR10) — closing the Feature 014 empty-input
  residual. Jobs, semantic providers/models, and mcp servers gained true
  list → item → edit/toggle/delete/create entity CRUD screens
  (`packages/tui/src/operator/entity.ts`, `entity-screens.tsx`) (FR12-FR14).
  Every control consults the Feature 014 per-verb availability and marks
  unavailable verbs inert, surfacing typed envelopes, never fabricated
  success (FR15); every action stays on the unchanged Feature 007
  `executeOperatorCommand` loopback — no new catalog id, no catalog version
  bump, no new dispatch path, no new flag (FR17); toasts fire only for a
  user-invoked mutation's outcome, never for status reads or view modals
  (FR18). TUI operator suite 130 pass / 0 fail; core operator suite 103
  pass / 0 fail; typecheck (tui + core) clean; oxlint clean.
- 2026-07-19 — **Fix round:** one confirmed defect closed — the domain
  screen's `verbOption` row title used the domain-qualified `entry.title`
  instead of the action-only `item.label`, so domain screens (where the
  domain is already implicit in the header) showed titles like "Telemetry
  status" instead of "Status", violating FR3. Fixed in
  `packages/tui/src/operator/dialog-settings.tsx`; pinned with two new
  cross-domain assertions in `screen-composition.test.ts`. Full detail in
  `tasks.md` "Fix (2026-07-19)" note under T003.
- 2026-07-19 — **Close-out (T025/T026):** confirmed the Feature 015 surface
  is fully covered by the existing Feature 007/011/012 `speckit.toml`
  guard globs (`packages/tui/src/operator/**`, `packages/tui/src/ui/**`,
  `packages/core/src/operator/**`, `packages/tui/src/context/**`,
  `packages/tui/test/**`) — no genuinely-new implement path, so no guard
  change was required. Removed a stray untracked
  `packages/opencode/config.json` (leaked a plaintext provider API key from
  an un-isolated live spot check, same pattern as the Feature 014
  close-out) — not a deliverable, never committed. `speckit analyze`:
  15 features consistent, 0 ADR overlaps, no new blockers. `speckit
  validate --json`: `ok:true`, only the 4 pre-existing waived
  `hygiene.empty-file` findings (desktop CSS, opencode fixture, two
  `.gitignore` files), 0 new findings.
