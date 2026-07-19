# Implementation Plan: Polish The Operator Domain Screen Layout So The Screen Reads

Feature: 016-polish-the-operator-domain-screen-layout-so-the-screen-reads
Status target: planned (after this plan is complete)
ADR: [ADR-0016](../../adr/0016-polish-the-operator-domain-screen-layout-so-the-screen-reads.md) **proposed**
Spec: [spec.md](spec.md) (FR1-FR7; domain model; presentation-only + parity invariants)

## Overview

Feature 015 turned the operator TUI into true CRUD screens. The dispatch is
correct, but the **screen does not read**. On the MCP (and every plain) domain
screen after Feature 015, four layout defects the spec pins:

1. **The status renders above the header.** `DialogOperatorDomainPanel`
   (`packages/tui/src/operator/dialog-settings.tsx`) returns a `<box>` that renders
   `<OperatorStatusSection>` above `<DialogSelect>`, but `DialogSelect` renders its
   own header/title and search internally (`packages/tui/src/ui/dialog.tsx`), so the
   status lands above the header — the screen reads status → header → search → list.
2. **The status floods the screen.** `OperatorStatusSection` renders every projected
   group in full, including the empty ones, so a fresh MCP shows a wall of
   `no <thing>` lines that bury the actions.
3. **The rows are noisy.** Every row reads `<Action>  Read-only view · <truncated-id>
   view`: the `Read-only view ·` boilerplate (`verbSubtitleFor`, `palette.ts`) repeats
   on all rows, the dotted id truncates mid-token, and the per-row `view` kind badge
   (`verbFooter`, `dialog-settings.tsx`) repeats per row.
4. **The primary affordance is buried.** With `no MCP servers configured` the
   operator asked *"como vou configurar isso?"* — `Add server` is invisible: the
   Configure/entity rows render after the whole View list, and the entity list is a
   single generic `Manage Servers` row.

This plan is a **presentation-and-copy** change over the UNCHANGED Feature 015
dispatch: move the status inside the `DialogSelect` layout so the header leads,
compact the status so empty groups collapse to one summary line, rewrite the row
copy contract, and order Configure-before-View with the entity domain's create/list
affordance as the first Configure rows — all over the same
`executeOperatorCommand`/`OperatorClient` loopback with unchanged command ids,
respecting the Feature 014 per-verb availability. Behavior stays governed by the
Feature 015 statechart (`doc/arch/statecharts/operator-crud-screen.md`); no new
statechart is added.

**Explicitly out of this plan (invariants preserved):**

- **Feature 007 registration authority (FR6).** No catalog id is added and no
  catalog version is bumped; presentation only.
- **No new dispatch path (parity, FR6).** Every screen action rides the SAME
  `executeOperatorCommand`/`OperatorClient` loopback; no parallel registry,
  divergent name, or new route.
- **Reuse the runtime.** The Feature 015 CRUD composition (entity screens, modals,
  `status.ts` projection), the Feature 007 dispatch, the Feature 012 result signal +
  projections + Dialog push back-stack, and the Feature 014 per-verb availability are
  reused unchanged.
- **No new primitive / flag / statechart.** The layout reuses the existing
  `DialogSelect` push/back-stack; no new dialog primitive, no new flag, no new
  statechart. `packages/opencode` stays read-only.
- **No fabricated success (FR6).** An unavailable verb stays marked + inert.

## Technical Approach

### Architecture layers affected

```
Screen composition (packages/tui/src/operator/dialog-settings.tsx)
  move OperatorStatusSection INSIDE the DialogSelect layout below the header;
  panel reads header → status → search → actions ────────────────────────────▶ (FR1)
        │  (behavior unchanged: Feature 015 statechart still governs)
        ▼
Compact status (packages/tui/src/operator/status.ts, OperatorStatusSection)
  project groups + state; render populated in full, collapse empty to one
  summary line; keep Loading/unavailable explicit ───────────────────────────▶ (FR2)
        │
        ▼
Row copy contract (packages/core/src/operator/palette.ts, verbFooter/verbOption)
  drop the "Read-only view ·"/"Editable setting ·" boilerplate; section header
  carries the kind; row title = action; id secondary only when it fits; drop the
  per-row kind badge; availability marker only when not fully available ───────▶ (FR3)
        │
        ▼
Section ordering + entity affordances (palette.ts + dialog-settings.tsx)
  order Configure before View for editable domains; entity domain leads Configure
  with [create affordance, list] as the first rows (Add server/Create job/
  Add provider + Servers/Jobs/lists) over the Feature 015 entity screens ──────▶ (FR4, FR5)
        ▼
Layout invariants: same ids / same loopback / same primitives / honest
availability / no new path / id / version / flag / statechart ─────────────────▶ (FR6)
Tests updated for order, compaction, copy, ordering, and unchanged dispatch ───▶ (FR7)
```

The reused runtime — the Feature 015 CRUD composition
(`dialog-settings.tsx`, `entity.ts`, `entity-screens.tsx`, `status.ts`,
`controls.ts`, `form/`), the Feature 007 `executeOperatorCommand`
(`packages/tui/src/operator/execute.ts`), the Feature 012 result signal +
projections and the Dialog push/back-stack (`packages/tui/src/ui/dialog.tsx`), the
Feature 011 grouped projection (`packages/core/src/operator/palette.ts`), and the
Feature 014 per-verb availability — is the single surface the layout re-composes
onto; the layout ValueObjects are specified in
`doc/arch/schemas/operator-screen-layout/`, and behavior is unchanged and still
governed by `doc/arch/statecharts/operator-crud-screen.md` (no new statechart).

### Phase 1 — Header-first reading order (FR1)

- **Move the status inside the `DialogSelect` layout (FR1).** In
  `DialogOperatorDomainPanel`, stop rendering `<OperatorStatusSection>` above
  `<DialogSelect>`. Because `DialogSelect` renders its own header/title and search
  internally (`ui/dialog.tsx`), render the status below the header inside the dialog
  — pass it through the existing `titleView`/header slot (the same slot
  `DialogOperatorSettingsHome` uses for its subtitle) or the closest available
  below-header slot — so the panel reads **header → status → search → action list**.
  Choose the seam that reuses the primitive; add no new dialog primitive. If
  `DialogSelect` has no below-header content slot wide enough for the status, extend
  its existing `titleView`/header content prop (presentation only, no new primitive)
  rather than reordering the outer `<box>`.

### Phase 2 — Compact status with collapsed empty groups (FR2)

- **Project group state (FR2).** Extend the `status.ts` projection so the plain
  key/value renderer and each rich panel expose, per status group, whether it is
  `populated`, `empty`, `loading`, or `unavailable` (mirroring
  `operator-screen-layout` `#StatusGroupState`).
- **Render compact (FR2).** In `OperatorStatusSection`/`StatusKeyValue`, render the
  **populated** groups in full and collapse the **empty** groups into a single
  summary line naming them (`servers · resources · experimental · calls: empty`);
  keep `Loading…` and `unavailable` explicit and never collapse them. When all
  groups are populated, render no summary line; when none is, render only the line.

### Phase 3 — Row copy contract (FR3)

- **Drop the boilerplate + kind badge (FR3).** Rewrite `verbSubtitleFor`
  (`palette.ts`) so the row secondary line is the dotted command id **only when it
  fits without truncation**, dropping the `Read-only view ·`/`Editable setting ·`
  prefix; omit the id (no secondary line) when it would truncate mid-token. Drop the
  per-row kind footer from `verbFooter`/`verbOption` (`dialog-settings.tsx`) so the
  **section header** (View/Configure category) alone carries the kind.
- **Marker only when not fully available (FR3).** Keep the availability marker
  (`unavailable`/`confirm`/`secret`) on a row **only when the verb is not fully
  available**; a fully-available verb renders no marker. Preserve the Feature 014
  per-verb availability source.

### Phase 4 — Section ordering + entity-first affordances (FR4, FR5)

- **Configure-before-View (FR4).** Order the Configure section before the read-only
  View section for a domain with editable state; a pure read-only domain keeps View
  leading. Centralise the ordering in `palette.ts` (the panel projection), not
  open-coded per screen; update `dialog-settings.tsx` `options()` to consume the
  ordered projection.
- **Entity-first affordances (FR5).** Replace the single generic `Manage <collection>`
  entity row with the entity domain's **create + list** affordance as the **first**
  Configure rows: `mcp` → `Add server` + `Servers`; `jobs` → `Create job` + `Jobs`;
  `semantic` → `Add provider` + providers/models. `Add server`/`Create job`/
  `Add provider` open the existing Feature 015 create flow; `Servers`/`Jobs`/lists
  open the existing list→item CRUD screen — through the same command ids
  (`entity.ts` `createId`/`listRead`) and loopback.

### Phase 5 — Tests + doc sync (FR7)

- **Order (Phase 1).** Assert the domain screen renders header → status → search →
  action list (the status is not above the header).
- **Compaction (Phase 2).** Assert populated groups render in full, empty groups
  collapse to one summary line, and Loading/unavailable stay explicit.
- **Copy (Phase 3).** Assert the `Read-only view ·` boilerplate and per-row kind
  badge are gone, the id is secondary only when untruncated, and the availability
  marker appears only when the verb is not fully available.
- **Ordering + affordances (Phase 4).** Assert Configure orders before View for
  editable domains and the entity domains lead with `Add server`+`Servers` /
  `Create job`+`Jobs` / `Add provider`+lists over the existing command ids.
- **Invariants (FR6).** Re-assert the unchanged command ids, the same loopback / no
  new dispatch path, no new catalog id / version bump, and honest availability.
- **Doc sync.** Keep the spec, ADR-0016, and the `operator-screen-layout/*.cue`
  corpus in sync with the shipped shapes; refresh `AGENTS.md`/`README.md` only if a
  user-facing surface description drifts.

## Data model and migration strategy

No new store, table, or dispatch path: the polish is a **presentation** re-layout
over the EXISTING Feature 015 composition, the Feature 007 dispatch, the Feature 012
result signal, and the Feature 014 backends. No data migration — nothing new is
persisted or read. The reading order, compact status, row copy contract, and
Configure-first ordering with entity-first affordances are typed by the
ValueObjects in `doc/arch/schemas/operator-screen-layout/` (`#ScreenLayout`,
`#ScreenRegionList`, `#StatusSummary`, `#StatusGroup`, `#StatusGroupList`,
`#ActionSection`, `#ActionRow`, `#ActionRowList`, `#ConfigureAffordance`, and the
bounded enums `#ScreenRegion`, `#StatusGroupState`, `#SectionKind`,
`#AvailabilityMarker`, `#AffordanceKind`).

## Screen lifecycle state machine

**Unchanged.** This feature adds no statechart; the screen lifecycle is still
governed by the Feature 015 statechart
`doc/arch/statecharts/operator-crud-screen.md` (screen_opened → loading → screen;
view_modal / edit_modal / toggling / tristate_picker / entity_list; dispatching →
outcome → refetch). The polish re-orders and re-copies the **rendering** of the
`screen` node only; it introduces no new node, transition, or dispatch leaf. Every
dispatch leaf still rides the same `executeOperatorCommand`/`OperatorClient`
loopback (FR6); an unavailable verb stays marked + inert.

## Security and threat boundaries

| Concern                       | Mitigation                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| No new authenticated surface  | Every screen action rides the Feature 007 `OperatorClient` loopback + operator principal/scope/CAS (FR6). |
| No new dispatch path          | Presentation-and-copy only; no parallel registry, divergent name, catalog id, or version bump (FR6). |
| No new input                  | The edit/create flows surfaced are the unchanged Feature 015 modals; they validate in-modal, then the reused port schema-validates. |
| Secret handling               | Unchanged: secret-bearing values stay `SecretRef` only (Feature 014 FR11); the polish edits no secret. |
| Honest capability gaps        | An unavailable verb keeps its marker and renders marked + inert (FR3, FR6).                          |
| No secret/payload leakage     | The compact status names only group labels; rows carry only the action + id; no config payload, secret, or spool body is surfaced. |
| Audit                         | Mutations emit the Feature 007 EventV2 audit correlation with bounded labels (command id, domain, surface, outcome); the copy change adds no log. |

## Observability

No new telemetry of its own. Operator dispatches from the re-laid-out screens
continue to project through the Feature 007 EventV2 audit and the ADR-0001 OTLP
foundation with content-free, bounded labels (command id, domain, surface, scope,
outcome). The region ordering, compact status, rewritten rows, and Configure-first
affordances emit nothing of their own and record only what the reused dispatch
already records; no config payload, secret, credential, spool body, or role-pool
model id is exported.

## specScopeGlobs (applied in doc/arch/speckit.toml)

Presentation-and-copy only; the entire touched surface is ALREADY in scope under the
Feature 007 / 011 / 012 blocks. `packages/tui/src/**/operator/**` (Feature 007) covers
`dialog-settings.tsx`, `status.ts`, `controls.ts`, `entity.ts`, `entity-screens.tsx`,
and `form/**`; `packages/core/src/operator/**` (Feature 007) covers `palette.ts`;
`packages/tui/src/ui/dialog.tsx` (Feature 012) covers the `DialogSelect` primitive;
`packages/tui/test/**` and `packages/core/test/operator/**` (Feature 001 / 007) cover
the tests. **No genuinely-new implement path** — no `speckit.toml` glob change is
required for Feature 016.

Source of truth: `doc/arch/speckit.toml` `[guard].specScopeGlobs`.

## Implementation order (task groups preview)

1. Header-first reading order: move the status inside the `DialogSelect` layout.
2. Compact status: project group state, render populated in full, collapse empty to
   one summary line, keep Loading/unavailable explicit.
3. Row copy contract: drop boilerplate + per-row kind badge, id secondary only when
   untruncated, availability marker only when not fully available.
4. Section ordering + entity-first affordances: Configure-before-View,
   create + list as the first Configure rows.
5. Tests (order, compaction, copy, ordering, invariants) + doc sync.

## Companion artifacts

None required beyond this plan. The screen-layout ValueObjects
(`doc/arch/schemas/operator-screen-layout/`) carry the data model; behavior is
governed by the existing Feature 015 statechart. No `research.md`, `data-model.md`,
`contracts/`, or `quickstart.md` is added.

## Validation checklist (plan complete when)

- [x] FR1-FR7 mapped to ordered phases
- [x] No new catalog id / no catalog version bump / no new dispatch path / no flag / no statechart (FR6)
- [x] Reading order: header → status → search → action list, status inside the DialogSelect layout (FR1)
- [x] Compact status: populated full, empty collapsed to one summary line, Loading/unavailable kept (FR2)
- [x] Row copy: no boilerplate, no per-row kind badge, id secondary only when untruncated, marker only when not fully available (FR3)
- [x] Section ordering: Configure-before-View for editable domains, centralised in palette.ts (FR4)
- [x] Entity-first affordances: create + list as the first Configure rows over the existing entity screens (FR5)
- [x] Layout invariants: same ids / loopback / primitives / honest availability, presentation only (FR6)
- [x] specScopeGlobs: no genuinely-new path; existing 007/011/012 blocks cover the surface
- [x] Security: no new input/surface/secret handling; parity + honest availability preserved
- [ ] `tasks.md` generated and filled
- [ ] `speckit analyze` clean of new Critical/High/Medium blockers
- [ ] `speckit validate --json` green (0 new findings on Feature 016 artifacts)
