---
status: proposed
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0016 — Polish the Operator Domain Screen Layout So the Screen Reads (header-first order, compact status, clean rows, Configure-first)

## Context and Problem Statement

Feature 015 turned the operator TUI into true CRUD screens — one Operator entry,
inline status, toggles, edit/view modals, and entity CRUD for jobs/semantic/mcp.
The dispatch is correct, but the **screen does not read**. On the MCP domain
screen after Feature 015 the operator sees, top to bottom, the status section
(`servers / no MCP servers configured / resources / no resources / experimental /
no experimental flags / calls / no direct-child calls`) **before** the dialog
header `Operator · Mcp`, then the search, then the action list — status-first,
header-second. Four concrete defects:

- **The status renders above the header.** `DialogOperatorDomainPanel`
  (`packages/tui/src/operator/dialog-settings.tsx`) returns a `<box>` that renders
  `<OperatorStatusSection>` above `<DialogSelect>`, but `DialogSelect` renders its
  own title/header and search internally (`packages/tui/src/ui/dialog.tsx`), so the
  status lands above the header.
- **The status floods the screen.** `OperatorStatusSection` renders every projected
  group in full, including the empty ones, so a fresh MCP shows a wall of
  `no <thing>` lines that bury the actions.
- **The rows are noisy.** Every row reads
  `<Action>  Read-only view · <truncated-id>   view`: the `Read-only view ·`
  boilerplate (`verbSubtitleFor`, `palette.ts`) repeats on all rows, the dotted id
  truncates mid-token (`mcp.resour`, `mcp.server.statu`), and a right-aligned
  `view` kind badge (`verbFooter`, `dialog-settings.tsx`) repeats per row.
- **The primary affordance is buried.** With `no MCP servers configured` the
  operator asked *"como vou configurar isso?"* — because `Add server` is invisible:
  Configure/entity rows render **after** the whole View list, and the entity list is
  a single generic `Manage Servers` row.

The Feature 015 entity CRUD screens already exist
(`packages/tui/src/operator/entity.ts`, `entity-screens.tsx`); this polish must
**surface** them, not add machinery. The Feature 007 parity invariant (palette ==
slash == CLI, same id/version/audit) and the Feature 014 per-verb honest-availability
contract are non-negotiable — no second dispatch path, no catalog id, no version
bump, no new flag, and behavior stays governed by the Feature 015 statechart.

## Decision Drivers

- The screen must read **header → status → search → action list**, one coherent
  panel, top to bottom.
- The status must inform without flooding: populated groups in full, empty groups
  collapsed to one summary line, honest `Loading`/`unavailable` kept explicit.
- The rows must read as distinct actions: the section header carries the kind, the
  row title carries the action, the id is a secondary line only when it fits, and
  the per-row kind badge is dropped.
- Configure must lead for editable domains, with the entity domain's create/list
  affordance as the first Configure rows.
- Presentation-and-copy only: the Feature 007 loopback stays the sole dispatch
  path; no catalog id, no version bump, no new flag, no new dialog primitive, and no
  new statechart; the Feature 014 per-verb availability is respected.

## Considered Options

- **Re-layout, compact, and re-copy the existing screens over the unchanged
  dispatch** — move the status inside the `DialogSelect` layout so the header leads,
  collapse empty status groups to a summary line, rewrite the row copy contract, and
  order Configure-before-View with entity-first affordances; all over the Feature
  015 composition and the Feature 007 loopback.
- **Only fix the status/header order, leave the rows and ordering** — cheap, but
  leaves the noisy `Read-only view · <truncated>   view` rows and the buried
  `Add server`, so the operator still cannot read the screen or find the affordance.
- **Introduce a new multi-region dialog primitive that owns header + status +
  search + list** — larger than any FR requires; the existing `DialogSelect`
  push/back-stack already renders header + search + list, so the status just needs
  to land inside it. Rejected in favour of reusing the primitive.
- **Hide empty status groups entirely** — would erase the honest "these groups
  exist but are empty" signal; the compact summary line keeps the signal without the
  flood. Rejected the full-hide.

## Decision Outcome

Chosen option: **Re-layout, compact, and re-copy the existing Feature 015 screens
over the unchanged Feature 007 dispatch.**

- **Header-first reading order (FR1).** The domain screen renders so the panel reads
  header → status → search → action list. Because `DialogSelect` renders its own
  header and search internally, the status section moves **inside** the
  `DialogSelect` layout below the header (or the wrapper renders the header before
  the status and reuses/suppresses the internal one) — the implementer picks the
  seam; the normative requirement is the order.
- **Compact status (FR2).** The inline status renders only the **populated** groups
  in full and collapses the **empty** groups to a single summary line (e.g.
  `servers · resources · experimental · calls: empty`); honest `Loading…` and
  `unavailable` states stay explicit and are never collapsed.
- **Clean row copy (FR3).** The section header (`View`/`Configure`) alone carries
  the kind; the row title carries the action; the `Read-only view ·` /
  `Editable setting ·` boilerplate is dropped; the dotted command id is a single
  secondary line **only when it fits without truncation**, omitted otherwise; the
  per-row kind footer badge is dropped; an availability marker
  (`unavailable`/`confirm`/`secret`) renders once per row **only when the verb is
  not fully available**.
- **Configure-first with entity affordances (FR4, FR5).** For an editable domain the
  Configure section orders before View (centralised in `palette.ts`); an entity
  domain leads Configure with its create + list affordance as the first rows
  (`mcp`: `Add server` + `Servers`; `jobs`: `Create job` + `Jobs`; `semantic`:
  `Add provider` + providers/models), opening the existing Feature 015 create/CRUD
  screens through the same command ids, replacing the generic `Manage <collection>`
  row.
- **Layout invariants (FR6).** Presentation-and-copy only: the existing
  `DialogSelect` push/back-stack, the Feature 007 `executeOperatorCommand`/
  `OperatorClient` loopback, the Feature 012 result signal + projections, and the
  Feature 015 entity screens and status projection are reused unchanged. No catalog
  id is added, no catalog version bumped, no new dispatch path, no new flag, no new
  dialog primitive, and no new statechart; every command id is unchanged and every
  control still honours the Feature 014 per-verb availability, marked + inert when
  unavailable, never a fabricated success. `packages/opencode` stays read-only.

The reading order, compact status, row copy contract, and Configure-first ordering
with entity-first affordances are specified as ValueObjects in
`doc/arch/schemas/operator-screen-layout/`. This feature adds **no statechart** —
behavior is unchanged and still governed by the Feature 015 statechart
`doc/arch/statecharts/operator-crud-screen.md`.

### Consequences

#### Positive

- The screen reads top to bottom: header first, then a compact status, then clean
  action rows — the operator sees what screen they are on before its state.
- The status informs without flooding: populated groups render, empty groups
  collapse to one honest summary line, and `Loading`/`unavailable` stay explicit.
- The rows read as distinct actions: no repeated boilerplate, no truncated id as the
  primary label, no per-row kind badge, and a marker only where availability differs.
- The primary affordance is obvious: Configure leads and `Add server`/`Create job`/
  `Add provider` are the first rows, so an empty domain shows how to configure it.
- The Feature 007 parity invariant and the Feature 014 honest-availability contract
  are untouched: no new dispatch path, catalog id, version bump, flag, or statechart.

#### Trade-offs

- The compact summary line names the empty groups but not their (absent) values; an
  operator wanting the per-group empty text no longer sees it inline — the summary
  is the deliberate trade for a readable panel.
- Copy stays centralised in `palette.ts` without i18n, so non-English operators see
  English titles and section headers; an i18n layer stays deferred.
- Omitting a command id when it would truncate means very narrow terminals show some
  rows without the id secondary line; the id stays reachable through the unchanged
  detail/view surfaces.
- Marked-but-inert typed gaps still appear on the screen; the polish keeps the honest
  marker rather than hiding the gap.

#### Follow-ups

- Feature 016 `plan`/`tasks` wire the header-first order, the compact status, the row
  copy contract, and the Configure-first entity affordances, with tests asserting the
  order, the compaction, the copy contract, the ordering, and the unchanged ids /
  loopback / honest availability.
- An i18n layer for the operator copy remains separate, deferred work.

## Related

- Feature specification: [016 Polish the operator domain screen layout so the screen reads](../sdd/016-polish-the-operator-domain-screen-layout-so-the-screen-reads/spec.md)
- CRUD predecessor: [015 Redesign the Operator TUI Domain Screens into True CRUD](../sdd/015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md)
- Result signal + projections: [012 Expose the structured operator command result through the TUI](../sdd/012-expose-the-structured-operator-command-result-through-the/spec.md)
- Per-verb availability: [014 Complete the operator control plane persistence and service](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)
- Grouped navigation: [011 Restructure Operator TUI](../sdd/011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Screen-layout schema: [operator-screen-layout ValueObjects](../schemas/operator-screen-layout/enums.cue)
- CRUD screen statechart (unchanged, governs behavior): [operator-crud-screen](../statecharts/operator-crud-screen.md)
- Related ADR: [0015 — Redesign the operator TUI domain screens into true CRUD](0015-redesign-the-operator-tui-domain-screens-into-true-crud.md)
- Related ADR: [0011 — Grouped Operator TUI Navigation](0011-restructure-the-operator-control-plane-tui-from-a-flat.md)
