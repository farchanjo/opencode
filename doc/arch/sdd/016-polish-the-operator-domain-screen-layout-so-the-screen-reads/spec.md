---
id: 019f7c93-e569-7042-9544-fdf71b6a2f73
number: 016
slug: polish-the-operator-domain-screen-layout-so-the-screen-reads
status: implemented
created_at: 2026-07-19T22:51:35.145645Z
---
# Feature Specification: Polish The Operator Domain Screen Layout So The Screen Reads

Feature: 016-polish-the-operator-domain-screen-layout-so-the-screen-reads
Created: 2026-07-19
Scope: A focused **layout polish** on top of Feature 015. The Feature 015 CRUD
screens dispatch correctly, but the MCP (and every plain) domain screen **does
not read as one coherent panel**: the inline status section renders **above** the
`DialogSelect` header, the status floods the screen with empty-group lines, every
action row repeats `Read-only view ·` boilerplate with a truncated id and a
per-row `view` badge, and the primary creation affordance (`Add server`) is buried
below the whole read-only View list. This feature makes the screen read
**header → status → search → action list**, one panel, top to bottom: it moves the
status **into** the `DialogSelect` layout so the header leads, compacts the status
so empty groups collapse to a single summary line, rewrites the row copy contract
so the section header alone carries the kind and rows carry the action, and orders
**Configure before View** with the entity domain's primary create/list affordance
as the first Configure rows. This is **presentation-only**: no new dispatch path,
no catalog id, no catalog version bump, no new flag; every action rides the SAME
Feature 007 `executeOperatorCommand`/`OperatorClient` loopback with UNCHANGED
command ids, and the Feature 014 per-verb honest-availability contract is
preserved. Behavior is still governed by the Feature 015 statechart
(`doc/arch/statecharts/operator-crud-screen.md`); this feature adds no statechart.

## Problem

Feature 015 turned the operator TUI into true CRUD screens — one Operator entry,
inline status, toggles, edit/view modals, and entity CRUD for jobs/semantic/mcp.
The dispatch is correct, but the **screen does not read**. On the MCP domain
screen after Feature 015, the operator sees the status section
(`Status / servers / no MCP servers configured / resources / no resources /
experimental / no experimental flags / calls / no direct-child calls`) **before**
the dialog header `Operator · Mcp   esc`, then the search, then the action list —
the screen reads status-first, header-second. Four concrete defects:

- **The status renders above the header (order bug).** `DialogOperatorDomainPanel`
  (`packages/tui/src/operator/dialog-settings.tsx`) returns a `<box>` that renders
  `<OperatorStatusSection>` **above** `<DialogSelect>`, but `DialogSelect` renders
  its own title/header and search internally (`packages/tui/src/ui/dialog.tsx`) —
  so the status lands above the header and the screen reads status → header →
  search → list. The header must lead: the screen must read **header → status →
  search → action list**, one coherent panel.

- **The status floods the screen (noisy status).** `OperatorStatusSection` renders
  every projected group in full, including the empty ones, so a domain with no
  populated state (a fresh MCP with no servers) shows a wall of
  `no MCP servers configured / no resources / no experimental flags /
  no direct-child calls` lines that dominate the panel and bury the actions. Only
  **populated** groups deserve full rendering; empty groups must collapse to one
  summary line, while honest `Loading`/`unavailable` states stay explicit.

- **The rows are noisy (row copy).** Every action row reads
  `<Action>  Read-only view · <truncated-id>   view`: the `Read-only view ·`
  boilerplate (`verbSubtitleFor`, `palette.ts`) repeats on all rows, the dotted id
  truncates mid-token (`mcp.resour`, `mcp.server.statu`), and a right-aligned
  `view` kind badge (`verbFooter`, `dialog-settings.tsx`) repeats per row. The copy
  is redundant and unreadable. The **section header** (View/Configure) alone should
  carry the kind; the **row title** carries the action; the command id belongs on a
  single secondary line **only when it fits without truncation**; the per-row kind
  badge is noise.

- **The primary affordance is buried (configure discoverability).** On the MCP
  screen with `no MCP servers configured`, the operator asked *"como vou configurar
  isso?"* — because the primary affordance (`Add server`) is invisible: the
  Configure/entity rows render **after** the whole read-only View list, and the
  entity list is a single generic `Manage Servers` row rather than a leading
  `Add server` + `Servers` pair. For a domain with editable state, **Configure must
  lead**, and an entity domain must lead with its primary creation/list affordance
  as the **first** Configure rows.

The Feature 015 entity CRUD screens already exist
(`packages/tui/src/operator/entity.ts`, `entity-screens.tsx`); this polish
**surfaces them prominently** rather than adding new machinery. The invariants
Feature 015 established hold: Feature 007 is the sole registration authority and
the palette/slash/CLI/TUI parity invariant forbids a new dispatch path; command
ids are unchanged; the Feature 014 per-verb `Partial` availability is respected —
an unavailable verb is marked, never faked. This is a **presentation-and-copy**
change over the unchanged Feature 015 dispatch: no new catalog id, no catalog
version bump, no new dispatch path, no new flag, no new statechart.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — The screen reads top to bottom

- As an operator, I want a domain screen to read **header → status → search →
  action list**, one coherent panel, so that I see what screen I am on first, then
  its state, then the actions — never the status floating above the header.

### P1 — The status is compact

- As an operator, I want only the **populated** status groups rendered in full and
  the empty groups collapsed to a **single summary line** (e.g.
  `servers · resources · experimental · calls: empty`), with honest
  `Loading`/`unavailable` states kept, so that the status informs me without
  flooding the panel and burying the actions.

### P1 — The rows are clean

- As an operator, I want each action row to carry the **action** as its title, the
  **section header** (View/Configure) alone to carry the kind, the command id to
  appear as a secondary line **only when it fits without truncating**, and the
  per-row kind badge dropped — so that the rows read as distinct actions, not a
  wall of `Read-only view · <truncated>   view`. An availability marker
  (`unavailable`/`confirm`/`secret`) appears **only when the verb is not fully
  available**.

### P1 — Configure leads and the primary affordance is obvious

- As an operator on a domain with editable state, I want the **Configure** section
  to render **before** the read-only **View** section, and an entity domain to lead
  with its primary creation/list affordance as the **first** Configure rows
  (`mcp`: `Add server` + `Servers`; `jobs`: `Create job` + `Jobs`; `semantic`:
  `Add provider` + providers/models), so that when the state is empty I can see how
  to configure it at a glance.

### P2 — Nothing behavioral changes

- As an operator, I want every screen action to still ride the **same command id**
  and the **same `OperatorClient` loopback** as slash/CLI, with no new dispatch
  path, no new catalog id, no catalog version bump, and the same honest
  availability, so that this is a pure layout polish over the Feature 015 dispatch.

## Functional Requirements

1. **Screen reading order — header → status → search → action list (FR1).** A
   domain screen (`DialogOperatorDomainPanel`, `dialog-settings.tsx`) MUST render
   so the panel reads, top to bottom, **header → status → search → action list**.
   The inline status section MUST NOT render above the `DialogSelect` header;
   because `DialogSelect` renders its own header/title and search internally
   (`ui/dialog.tsx`), the fix MUST place the status **inside** the `DialogSelect`
   layout below the header (or render the header in the wrapper before the status
   and reuse/suppress the internal one) — the implementer chooses the seam. The
   observable requirement is the ORDER: header first, status second, search third,
   action list fourth, as one coherent panel.

2. **Compact status with collapsed empty groups (FR2).** The inline status section
   MUST render only the **populated** status groups in full; **empty** groups MUST
   collapse to a **single summary line** naming them (e.g.
   `servers · resources · experimental · calls: empty`) rather than one
   `no <thing>` line each. Honest non-populated states — `Loading…` and
   `unavailable` — MUST stay explicit and MUST NOT be collapsed into the empty
   summary. When every group is populated, no empty summary line renders; when none
   is, only the summary line renders.

3. **Row copy contract (FR3).** The action-row copy MUST be rewritten so that: the
   **section header** (`View` / `Configure`) alone carries the kind; the **row
   title** carries the action (`Status`, `Servers`, `Add server`); the boilerplate
   `Read-only view ·` / `Editable setting ·` prefix (`verbSubtitleFor`,
   `palette.ts`) MUST be dropped; the dotted command id MUST appear as a **single
   secondary line only when it fits without truncation** and MUST be **omitted**
   otherwise (never truncated mid-token); and the per-row kind footer badge
   (`verbFooter` `view`/`configure`, `dialog-settings.tsx`) MUST be dropped. An
   availability marker (`unavailable` / `confirm` / `secret`) MUST render **once
   per row and only when the verb is not fully available**; a fully-available verb
   carries no marker.

4. **Configure-before-View ordering for editable domains (FR4).** For a domain with
   editable (Configure) state, the domain screen MUST order the **Configure**
   section **before** the read-only **View** section. A domain with no editable
   state (pure read-only) keeps View leading. The section order MUST be centralized
   in the palette projection (`palette.ts`), not open-coded per screen.

5. **Entity-first Configure affordances (FR5).** An entity domain MUST lead its
   Configure section with its **primary creation and list affordance as the first
   Configure rows**, surfacing the Feature 015 entity screens
   (`entity.ts`/`entity-screens.tsx`) prominently: `mcp` → `Add server` + `Servers`;
   `jobs` → `Create job` + `Jobs`; `semantic` → `Add provider` + providers/models
   lists. `Add server`/`Create job`/`Add provider` MUST open the existing create
   flow and `Servers`/`Jobs`/lists MUST open the existing list→item CRUD screen —
   through the SAME command ids and loopback (FR6), replacing the single generic
   `Manage <collection>` row.

6. **Layout invariants — dispatch, ids, primitives, honesty unchanged (FR6).** This
   feature is presentation-and-copy only: it reuses the existing `DialogSelect`
   push/back-stack primitives (`ui/dialog.tsx`), the Feature 007
   `executeOperatorCommand`/`OperatorClient` loopback, the Feature 012 result
   signal and per-domain projections, and the Feature 015 entity screens and status
   projection (`status.ts`). It MUST NOT add a catalog id, bump the catalog
   version, introduce a new dispatch path, add a new flag, or add a new dialog
   primitive or statechart. Every command id is unchanged, and every control still
   consults the Feature 014 per-verb availability and renders an unavailable verb
   marked + inert, never a fabricated success. `packages/opencode` stays read-only.

7. **Tests updated (FR7).** The palette copy tests, the screen-composition tests,
   and the status-projection tests MUST be updated to assert the new layout: the
   header→status→search→list order, the compacted status (populated full, empty
   collapsed to one summary line, honest Loading/unavailable kept), the row copy
   contract (no boilerplate, no per-row kind badge, id secondary only when
   untruncated, availability marker only when not fully available), and the
   Configure-before-View ordering with entity-first affordances — while re-asserting
   the unchanged command ids, loopback, and honest availability (FR6).

## Non-Functional Requirements

- **Presentation only, unchanged dispatch.** The polish reuses the Feature 015 CRUD
  composition, the Feature 007 `executeOperatorCommand` loopback, the Feature 012
  result signal + projections, and the Feature 014 per-verb availability; no
  backend, port, dispatcher, catalog, or statechart changes.
- **Reuse the existing primitives.** The screen builds on the existing
  `ui/dialog.tsx` `DialogSelect` push/back-stack and the Feature 015 status
  projection (`status.ts`) and entity screens; no new navigation framework, dialog
  primitive, or flag.
- **Bounded, content-free surfaces.** The compacted status and the rewritten rows
  project bounded, redacted summaries; no raw config payload, spool page content,
  resolved secret, endpoint credential, or role-pool model id is surfaced. The
  empty-group summary names only the group labels, never their would-be values.
- **Honest over pretty.** A verb that is a typed capability gap stays marked and
  inert; the polish never hides an unavailable verb, and never omits a marker that
  the Feature 014 availability requires.

## Acceptance Scenarios

Given the operator control plane flag is enabled

- **The screen reads header → status → search → list.**
  Given the MCP domain screen is opened,
  When it renders,
  Then the panel reads, top to bottom, the header (`Operator · Mcp`), then the
  status section, then the search, then the action list — the status never renders
  above the header.

- **The status is compact.**
  Given a domain screen whose status has empty groups,
  When the status section renders,
  Then only the populated groups render in full and the empty groups collapse to a
  single summary line (e.g. `servers · resources · experimental · calls: empty`),
  and an honest `Loading…`/`unavailable` state renders explicitly, not collapsed.

- **The rows are clean.**
  Given a domain screen's action rows,
  When they render,
  Then each row's title is the action, the `Read-only view ·` boilerplate and the
  per-row `view` kind badge are gone, the section header carries the kind, the
  command id appears as a secondary line only when it fits without truncation, and
  an availability marker appears only when the verb is not fully available.

- **Configure leads with the primary affordance.**
  Given the MCP screen with no servers configured,
  When it renders,
  Then the Configure section renders before the View section and its first rows are
  `Add server` and `Servers`, so the primary affordance is visible at a glance;
  `Add server` opens the create flow and `Servers` opens the list→item CRUD screen.

- **Entity-first affordances per domain.**
  Given the jobs and semantic screens,
  When they render,
  Then jobs leads Configure with `Create job` + `Jobs` and semantic leads with
  `Add provider` + the providers/models lists, each through the existing command
  ids and CRUD screens.

- **Nothing behavioral changed.**
  Given the same command id is dispatched from palette, slash, CLI, and the domain
  screen,
  When any screen action is invoked,
  Then it rides the same `OperatorClient` loopback with no new dispatch path, no
  catalog id is added, no catalog version is bumped, and an unavailable verb stays
  marked and inert.

## Security Requirements

- **Data sensitivity/classification.** This feature only re-lays-out and re-copies
  the operator configuration and effective state already surfaced by the Feature
  015 CRUD screens — the same bounded, redacted status summaries and entity lists.
  It reads nothing new and persists nothing. The compacted status and rewritten
  rows render only the labels and bounded values the ports already returned; no raw
  config payload, spool body, resolved secret, or endpoint credential is displayed
  or newly persisted, and the empty-group summary names only group labels.
- **Authentication/authorization.** No new authenticated surface and no new
  dispatch path. Every screen action rides the Feature 007 `OperatorClient`
  loopback, operator principal, scope, version/CAS, and confirmation gates
  unchanged; this feature registers no command ids and cannot relax those gates.
- **Input validation.** This feature introduces no new input. The edit/create flows
  it surfaces are the unchanged Feature 015 modals, which validate in-modal before
  dispatch and are then schema-validated by the reused port; a `SecretRef` field
  stays reference-only and is never dereferenced at this layer.
- **Cryptography in transit/at rest.** This feature persists nothing new and moves
  no secret. Secret-bearing values remain `SecretRef` only and are resolved by the
  Feature 007 `SecretPort` at use time, never by the TUI; the polish changes only
  layout and copy, never a secret's handling.
- **Logging/audit.** Mutations invoked from the re-laid-out rows emit the same
  Feature 007 EventV2 audit correlation with content-free, bounded labels (command
  id, domain, surface, outcome). The status section and rows log nothing of their
  own and never record a config payload, secret, credential, or spool body; the
  copy change adds no new log line.
- **Error-handling information exposure.** Every failure path still renders a typed,
  bounded, secret-free reason — the compacted status keeps the honest
  `unavailable` state, an unavailable row keeps its marker, and a failed
  edit/create surfaces its typed reason in the unchanged Feature 015 modal. No error
  path leaks a stack trace, credential, secret, endpoint, or raw payload.

## Domain Model

The screen reading order, the compact status projection, the row copy contract,
and the Configure-before-View ordering with entity-first affordances are specified
as ValueObjects in `doc/arch/schemas/operator-screen-layout/`. This feature adds
**no statechart** — the screen lifecycle is unchanged and still governed by the
Feature 015 statechart `doc/arch/statecharts/operator-crud-screen.md`:

```
DomainScreen (open)                                                     (FR1)
  region order:  header → status → search → actions        one panel
      StatusSummary                                                     (FR2)
        populated groups → rendered in full
        empty groups     → one summary line "a · b · c: empty"
        Loading / unavailable → kept explicit (never collapsed)
      ActionSection[]  ordered Configure → View (editable domains)      (FR4)
        Configure (entity domain) leads: [ create affordance, list ]    (FR5)
        ActionRow { title=action; commandId? secondary-if-untruncated;  (FR3)
                    marker? only when not fully available }
        section header carries the kind — rows carry no kind badge

Every row dispatches the SAME command id through the SAME
executeOperatorCommand / OperatorClient loopback (FR6); an unavailable verb
(Feature 014 per-verb Partial) stays marked + inert. No new dispatch path, no
catalog id, no version bump, no new flag, no new statechart (FR6).
```

## Observability

Operator dispatches from the re-laid-out screens continue to project through the
Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free,
bounded labels (command id, domain, surface, scope, outcome). The layout polish —
the region ordering, the compacted status, the rewritten rows, and the
Configure-first affordances — emits no telemetry of its own and records only what
the reused dispatch already records; no config payload, secret, credential, spool
body, or role-pool model id is exported. Conventions live in
`doc/arch/observability/observability.md`.

## Out of Scope

- Re-authoring the operator dispatch, ports, backends, catalog, or the Feature 015
  CRUD/modal/entity machinery — the Feature 015 composition and the Feature 007
  loopback are reused unchanged; this feature only re-orders, compacts, and
  re-copies the presentation.
- Adding any catalog id, bumping the catalog version, introducing a new dispatch
  path, a new flag, a new dialog primitive, or a new statechart.
- Landing any new persistence backend or lifting a Feature 014 typed capability gap
  (Milvus index ops, `jobs.run-now`, lifecycle `cancel`) — these stay marked typed
  gaps.
- An i18n/translation layer for the rewritten copy, or a redesign of the status
  projection beyond compacting empty groups.
- App/Desktop parity, multi-user directory, vault backends, or a non-loopback
  operator API.

## Related Features and Decisions

- [ADR-0016 — Polish the operator domain screen layout so the screen reads](../../adr/0016-polish-the-operator-domain-screen-layout-so-the-screen-reads.md)
- [Feature 015 Redesign the Operator TUI Domain Screens into True CRUD](../015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md) — the CRUD composition, inline status, modals, and entity screens this feature re-lays-out.
- [Feature 012 Expose the structured operator command result through the TUI](../012-expose-the-structured-operator-command-result-through-the/spec.md) — the result signal + projections + Dialog push back-stack the screen reuses.
- [Feature 014 Complete the operator control plane persistence and service](../014-complete-the-operator-control-plane-persistence-and-service/spec.md) — the per-verb `Partial` availability the rewritten rows preserve.
- [Feature 011 Restructure the Operator Control Plane TUI](../011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md) — the grouped menu and copy contract this polish completes.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, registration invariant (FR11), and the `OperatorClient` loopback.
- [ADR-0015 — Redesign the operator TUI domain screens into true CRUD](../../adr/0015-redesign-the-operator-tui-domain-screens-into-true-crud.md)
- [ADR-0011 — Grouped Operator TUI Navigation](../../adr/0011-restructure-the-operator-control-plane-tui-from-a-flat.md)
- [Domain schema](../../schemas/operator-screen-layout/enums.cue)
- [Operator CRUD screen statechart (unchanged, governs behavior)](../../statecharts/operator-crud-screen.md)

## Clarifications
