---
status: accepted
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0015 — Operator TUI Domain Screens as True CRUD (single entry, on-screen status, toggles, modals, entity CRUD)

## Context and Problem Statement

Feature 011 restructured the operator TUI from a flat verb list into grouped
navigation; Feature 012 wired the structured result signal into read panels;
Features 013/014 made the config-backed domains persist and gave every verb an
honest per-verb `Partial` availability. The plumbing works, but the
operator-facing experience is still wrong on four counts:

- **The palette leaks a flat wall.** `packages/tui/src/app.tsx` renders the
  single `Operator` entry PLUS `...operatorSuggestedEntries().map(...)` (`:981`),
  spreading the read-only suggested subset back as top-level Commands rows. The
  human title `View: Status` repeats eight times (`telemetry.status`,
  `smart.status`, …), the dotted ids truncate, and the rows are indistinguishable
  — exactly the wall Feature 011 removed, re-introduced through the `suggest`
  spread. The `suggest` field (`packages/core/src/operator/palette.ts:44`),
  `listOperatorSuggestedEntries` (`:332`), and the `operatorSuggestedEntries`
  re-export (`packages/tui/src/operator/execute.ts`) feed **only** this spread.
- **Views are toasts, not screens.** `DialogOperatorDomainPanel`
  (`packages/tui/src/operator/dialog-settings.tsx:185`) dispatches a **toast** for
  a non-rich domain's View verb; status is never shown *on* the screen.
- **Configuration is inconsistent.** Enable/disable is two command rows, not one
  toggle with a state badge; edit forms
  (`packages/tui/src/operator/form/`) open a single text input that starts
  **empty** (no pre-fill from the current value); there is no structural view or
  edit modal, and errors surface as toasts.
- **Collection domains have no CRUD.** Jobs, semantic providers/models, and MCP
  servers persist real entities (Feature 014) but have no list → item →
  edit/toggle/delete/create flow in the TUI.

The operator's verbatim complaint: one Operator entry only; views render inside
the interface (the screen), not toasts; configuration all through the menu in one
consistent way; edit → edit modal; visualization → view modal; enable/disable → a
toggle row showing enabled/disabled; status → shown on the screen; *"faz o CRUD
da tela perfeito."*

The redesign must not create a second dispatch path — Feature 007 stays the
command authority and the parity invariant (palette == slash == CLI, same
id/version/audit) and the Feature 014 per-verb honest-availability contract are
non-negotiable.

## Decision Drivers

- One command authority: the Feature 007 `executeOperatorCommand`/`OperatorClient`
  loopback stays the only dispatch path; no parallel registry, divergent name, or
  new route; no new catalog id and no catalog version bump.
- One legible top-level entry: exactly one `Operator` palette row, with the flat
  suggested spread removed and in-menu keyboard search compensating discoverability.
- Status and views **on the screen**: an inline status section on open and a
  structural view modal for detail verbs — never a toast.
- One consistent way to configure: on/off as a single toggle row with a state
  badge; editable settings through an edit modal pre-filled from the current value.
- True entity CRUD for the collection domains (jobs, semantic, mcp): list → item →
  edit/toggle/delete/create.
- Honest availability: the Feature 014 per-verb `Partial` truth is respected — an
  unavailable verb is marked and inert, never faked.
- Reuse the existing Dialog push/back-stack and the Feature 012 result signal; no
  new navigation framework, no new dialog primitive, no new flag, no i18n layer.

## Considered Options

- **True per-domain CRUD screens over the unchanged dispatch** — collapse the
  palette to one entry and retire the `suggest` spread; compose each domain screen
  with an inline status section, toggle rows, edit/view modals, and entity CRUD
  lists; respect the Feature 014 per-verb availability; all over the Feature 007
  loopback.
- **Keep the palette spread, only de-duplicate the titles** — cheap, but leaves
  the flat wall at the top level, still toasts views, still collects blind edits,
  and adds no entity CRUD; fails the operator's core complaint.
- **Build a TUI-specific command registry / dispatch for the screens** — would
  diverge command names and dispatch, breaking the Feature 007 parity invariant;
  rejected.
- **Optimistically render mutations as success in the UI** — would imply success
  for typed capability gaps; violates the honesty driver; rejected.
- **Add a new multi-field dialog primitive** — larger than any FR requires; the
  current editable settings are single-field. Rejected in favour of a small
  operator-scoped modal composed over the existing push/back-stack.

## Decision Outcome

Chosen option: **True per-domain CRUD screens layered over the unchanged Feature
007 dispatch.**

- **Single entry, `suggest` retired (FR1, FR2).** `app.tsx` exposes exactly one
  `Operator` Commands entry opening `DialogOperatorSettingsHome`; the
  `...operatorSuggestedEntries().map(...)` spread is removed. Because no surface
  then consumes the suggested subset, the `suggest` field on `OperatorPaletteEntry`,
  `listOperatorSuggestedEntries`, and the `operatorSuggestedEntries` re-export are
  **retired** — leaving no dead code path. Discoverability of read-only verbs is
  served by keyboard search inside the grouped menu. The grouped
  `buildOperatorGroupList`/`buildOperatorDomainPanel` projection stays.
- **Unique titles (FR3).** The row-title copy contract is centralized in
  `palette.ts` so no two rows on a surface share a title; a verb title scopes to
  its domain screen (action-only where the domain is implicit, domain-qualified
  where not), and the dotted id stays a discoverable secondary line, never the
  primary label. The `View: Status` ×8 duplication is eliminated.
- **Status on the screen (FR4, FR6).** Opening a domain screen issues a **silent**
  status read through `executeOperatorCommand` and renders it as an inline status
  section — a generic key/value renderer for plain domains, the existing rich
  panel for jobs/output/langlock/semantic/mcp. Every on-screen mutation refetches
  the status section on return.
- **Views inside the interface (FR5, FR11).** The non-rich-domain View toast
  branch (`dialog-settings.tsx:185`) is removed; a detail verb opens a **view
  modal** rendering the effective payload as a structural key/value tree, closed
  on Esc.
- **Toggles and tri-state (FR7, FR8).** On/off verb pairs render one **toggle row**
  with a current-state badge whose action dispatches the opposite verb; a toggle on
  an unavailable backend is marked and inert. The tri-state smart-routing setting
  (`on`/`off`/`auto`) renders its mode as a badge and opens a **three-option
  picker pre-selected to the current mode** — not a binary toggle, which cannot
  honestly represent three states.
- **Edit modals (FR9, FR10).** Editable settings open an **edit modal** that
  pre-fills each field from a silent read of the current effective value, validates
  per field, dispatches Save through the existing path, closes on success, and
  surfaces errors **in-modal**. Text inputs no longer start empty (closing the
  Feature 014 residual).
- **Entity CRUD (FR12-FR14).** Jobs render as a list → item screen
  (edit/reschedule/enable-disable toggle/delete-with-confirm; create from the
  list); semantic providers/models as lists (add/edit/rotate-secret/disable/
  delete); mcp servers as a list (add/edit/connect-disconnect/delete). Milvus-
  gated index ops, `jobs.run-now`, and unreachable ops stay marked typed gaps.
- **Modal contract (FR16).** The edit and view modals are a small operator-scoped
  component under `packages/tui/src/operator/form/`, built over the existing
  `ui/dialog.tsx` push/back-stack — NOT a new dialog primitive — defining a title,
  fields (label + pre-filled value + input kind + validation), footer Save/Cancel,
  a busy state, and an in-modal error surface. Single-field edit modals cover the
  current editable settings; a general multi-field modal is a natural extension,
  not required here.
- **Honesty and parity (FR15, FR17, FR18).** Every control consults the Feature
  014 per-verb availability and renders an unavailable verb marked + inert,
  surfacing the typed envelope — never a fabricated success. Every action rides the
  same command id through the same loopback as slash/CLI; no new dispatch path, no
  new catalog id, no catalog version bump, no new flag. Toasts fire only for a
  user-invoked mutation's final outcome; status reads and view modals never toast.

The screen composition, controls, modal contract, and entity-list projection are
specified as ValueObjects in `doc/arch/schemas/operator-crud-screens/` and as a
statechart in `doc/arch/statecharts/operator-crud-screen.md`.

### Consequences

#### Positive

- The palette becomes legible: exactly one `Operator` entry, no duplicated
  `View: Status …` wall, unique titles, and the `suggest` dead-code path removed.
- Status and views render on the screen: an inline status section on open and a
  structural view modal replace the toast flash.
- Configuration is consistent: on/off is one toggle with a state badge, editable
  settings open a pre-filled edit modal that validates and reports errors in place.
- The collection domains (jobs, semantic, mcp) gain true CRUD from the screen.
- The Feature 007 parity invariant and the Feature 014 honest-availability contract
  are untouched: no new dispatch path, registry, catalog id, version bump, or flag.

#### Trade-offs

- Presentation stays coupled to the Feature 007 catalog metadata (`mutates`,
  `confirmRequired`, `secretRelated`) and the Feature 014 per-verb availability;
  catalog changes must keep the screen projection honest.
- Copy centralized in `palette.ts` without i18n means non-English operators see
  English titles and action labels; an i18n layer stays deferred.
- Marked-but-inert gaps (Milvus index, `jobs.run-now`, lifecycle cancel) still
  appear on the screen; the affordance makes the gap explicit rather than hiding
  it, which some operators may read as clutter until the backends land.
- The single-field edit modal covers today's editable settings; a domain that
  later needs a genuinely multi-field edit will extend the modal component.

#### Follow-ups

- Feature 015 `plan`/`tasks` wire the single entry + `suggest` retirement, the
  inline status sections, the toggle/tri-state rows, the edit/view modal
  component, and the jobs/semantic/mcp entity CRUD, with tests asserting parity,
  honest availability, and no new dispatch path.
- A general multi-field modal and an i18n layer remain separate, deferred work.

## Related

- Feature specification: [015 Redesign the Operator TUI Domain Screens into True CRUD](../sdd/015-redesign-the-operator-tui-domain-screens-into-true-crud/spec.md)
- Grouped navigation predecessor: [011 Restructure Operator TUI](../sdd/011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md)
- Result signal + projections: [012 Expose the structured operator command result through the TUI](../sdd/012-expose-the-structured-operator-command-result-through-the/spec.md)
- Per-verb availability + backends: [014 Complete the operator control plane persistence and service](../sdd/014-complete-the-operator-control-plane-persistence-and-service/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- CRUD screen schema: [operator-crud-screens ValueObjects](../schemas/operator-crud-screens/enums.cue)
- CRUD screen statechart: [operator-crud-screen](../statecharts/operator-crud-screen.md)
- Related ADR: [0011 — Grouped Operator TUI Navigation](0011-restructure-the-operator-control-plane-tui-from-a-flat.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)

## Links

- Related: ADR-0011, ADR-0016, ADR-0012, ADR-0040.
