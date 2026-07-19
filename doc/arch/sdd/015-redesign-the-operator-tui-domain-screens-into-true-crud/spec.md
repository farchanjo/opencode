---
id: 019f7bac-56af-7c93-9a51-492620836889
number: 015
slug: redesign-the-operator-tui-domain-screens-into-true-crud
status: analyzed
created_at: 2026-07-19T18:38:39.791718Z
---
# Feature Specification: Redesign the Operator TUI Domain Screens into True CRUD

Feature: 015-redesign-the-operator-tui-domain-screens-into-true-crud
Created: 2026-07-19
Scope: Turn the operator control-plane TUI from a leaky palette + toast surface
into **true per-domain CRUD screens**, without adding a catalog id, bumping the
catalog version, introducing a new dispatch path, or adding a flag. Four bodies
of work: (1) collapse the top-level Commands palette to **exactly one** Operator
entry — remove the flat wall of duplicated read-only suggested rows and retire
the `suggest` spread machinery — and give every row a **unique human title**;
(2) compose each domain **screen** so status renders **inline on the screen**
(never a toast), toggles render as **on/off rows with a state badge**, and views
render **inside the interface** through a structural **view modal**; (3) add an
**edit modal** contract that pre-fills the current effective value, validates
per field, dispatches through the existing path, and surfaces errors in-modal;
(4) make **entity CRUD** real for the collection domains — jobs, semantic
providers/models, and MCP servers — list → item → edit/toggle/delete/create.
Feature 007 remains the sole command-registration authority; the parity
invariant and the Feature 014 per-verb honest-availability contract are
preserved throughout.

## Problem

Feature 011 restructured the operator TUI from a flat list into grouped
navigation, Feature 012 wired the structured result signal into read panels, and
Features 013/014 made the config-backed domains persist. The management surface
is functionally wired, but the **operator-facing experience is still wrong** —
the top-level palette leaks, and the domain menus behave like a command launcher
rather than a management screen:

- **The palette still shows a flat wall of duplicated rows.** `app.tsx` renders
  the single `Operator` entry PLUS
  `...operatorSuggestedEntries().map(...)` (`packages/tui/src/app.tsx:981`),
  spreading the read-only suggested subset back as top-level Commands rows —
  `View: Status … · telemetry.status`, `View: Status … · smart.status`, and so
  on. The human title `View: Status` repeats eight times, the command ids are
  truncated, and the operator cannot tell the rows apart. This is exactly the
  flat wall Feature 011 set out to remove, re-introduced through the `suggest`
  spread. The `suggest` field on `OperatorPaletteEntry`
  (`packages/core/src/operator/palette.ts:44`), `listOperatorSuggestedEntries`
  (`:332`), and `operatorSuggestedEntries` (`packages/tui/src/operator/execute.ts`)
  exist **only** to feed this spread; no other surface consumes them.

- **Views render as toasts, not on the screen.** In
  `DialogOperatorDomainPanel` (`packages/tui/src/operator/dialog-settings.tsx:147`),
  a View verb for jobs/output/langlock/semantic/mcp pushes the rich read panel,
  but every other domain's view **dispatches a toast** (`:185`) — the result
  flashes and is gone. Status is not shown *on* the screen; the operator sees a
  transient toast where a persistent status section belongs.

- **Configuration is inconsistent and unedited.** Enable/disable is a pair of
  separate command rows rather than one toggle showing the current state; edit
  verbs open a single-field form (`packages/tui/src/operator/form/`) whose text
  input starts **empty** — no pre-fill from the current effective value — so the
  operator overwrites blind; there is no multi-field or structural modal, and
  errors surface as toasts rather than next to the field that produced them.

- **Collection domains have no CRUD.** Jobs, semantic providers/models, and MCP
  servers persist real entities (Feature 014), but the TUI has no list → item →
  edit/toggle/delete/create flow for them; the operator cannot manage the
  collection from the screen.

The verbatim operator complaint: one Operator entry only; views render inside
the normal interface (the screen), not toasts; configuration all through the
menu in one consistent way; edit → edit modal; visualization → view modal;
enable/disable → a toggle button row showing enabled/disabled state; status →
shown on the screen — *"faz o CRUD da tela perfeito."*

The corpus already mandates the invariants this redesign must not break:
Feature 007 is the sole registration authority (FR11) and the palette/slash/CLI/
TUI parity invariant (Feature 011 FR8, Feature 014 FR13) forbids a new dispatch
path; Feature 014 established per-verb honest availability (`Partial`) that the
CRUD screens must respect — an unavailable verb is marked, never faked. This is
a **presentation-and-composition** change over the unchanged Feature 007
dispatch: no new catalog id, no catalog version bump, no new dispatch path, no
new flag.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — One Operator entry, unique titles

- As an operator, I want the top-level Commands palette to show **exactly one**
  Operator entry — not the flat wall of duplicated `View: Status …` rows — so
  that the palette is legible and I reach every domain through the one grouped
  menu, with keyboard search inside the menu for discoverability.
- As an operator, I want every row I do see to carry a **unique, human title**
  (never `View: Status` repeated eight times, never a truncated dotted id as the
  primary label) so that I can tell rows apart at a glance.

### P1 — Status and views render on the screen, not as toasts

- As an operator, I want a domain screen to **fetch its status on open and
  render it inline** as a status section — a generic key/value view for plain
  domains and the rich panel for jobs/output/langlock/semantic/mcp — so that the
  screen shows me the current state instead of flashing a toast.
- As an operator, I want a detail/visualization verb (show/explain/capabilities/
  history) to open a **view modal** rendering the effective payload as a
  structural key/value tree that I dismiss with Esc, so that viewing happens
  **inside** the interface, never as a transient toast.
- As an operator, I want the status section to **refresh after every mutation**
  I perform on that screen so that what I see always reflects the state I just
  changed.

### P1 — One consistent way to configure: toggles and edit modals

- As an operator, I want an enable/disable capability to render as **one toggle
  row** with a current-state badge (Enabled / Disabled) and an action that
  dispatches the opposite verb, so that I manage on/off state with a single
  control instead of two separate command rows.
- As an operator, I want an editable setting to open an **edit modal pre-filled
  with the current effective value**, validated per field, that saves through the
  existing dispatch, closes on success, and surfaces any error **in the modal**
  (not a toast), so that I edit deliberately and see failures where they happen.
- As an operator, I want a tri-state setting (smart routing on/off/auto) to show
  its current mode as a badge and open a **three-option picker** pre-selected to
  the current mode, rather than a binary toggle that cannot honestly represent
  three states.

### P1 — True entity CRUD for the collection domains

- As an operator, I want **jobs** to render as a list I can drill into: an item
  screen with edit, reschedule, an enable/disable toggle, and delete-with-confirm,
  plus create from the list.
- As an operator, I want **semantic** providers and models to render as lists
  with add, edit, rotate-secret, disable, and delete.
- As an operator, I want **MCP servers** to render as a list with add, edit,
  connect/disconnect, and delete.

### P1 — Honest availability everywhere

- As an operator, I want a toggle, edit, view, or entity action whose backend is
  unavailable (the Feature 014 per-verb `Partial` truth) to be **visibly marked
  and inert** — surfacing the typed capability gap, never a fabricated success —
  so that the screen never claims a capability it cannot reach.

### P2 — Parity across surfaces

- As an operator, I want every screen action to ride the **same command id and
  the same `OperatorClient` loopback** as slash/CLI, with no new dispatch path,
  no new catalog id, and no catalog version bump, so that the CRUD screens are a
  pure presentation layer over the Feature 007 authority.

## Functional Requirements

### Group 1 — Single Operator entry and unique titles

1. **Exactly one Operator palette entry (FR1).** `app.tsx`
   (`packages/tui/src/app.tsx`) MUST expose a single top-level `Operator`
   Commands entry that opens `DialogOperatorSettingsHome`. The
   `...operatorSuggestedEntries().map(...)` spread (`:981`) that re-introduces the
   flat wall of read-only suggested rows MUST be removed. Discoverability of the
   read-only verbs is compensated by keyboard search inside the grouped menu, not
   by top-level spread.
2. **Retire the `suggest` spread machinery (FR2).** Because no surface consumes
   the suggested spread after FR1, the `suggest` field on `OperatorPaletteEntry`
   (`palette.ts:44`), `listOperatorSuggestedEntries` (`palette.ts:332`), and the
   `operatorSuggestedEntries` re-export (`operator/execute.ts`) MUST be retired to
   leave no dead code path. The removal MUST be recorded in ADR-0015. The grouped
   `buildOperatorGroupList`/`buildOperatorDomainPanel` projection machinery stays.
3. **Unique human row titles (FR3).** The row title copy contract MUST be
   centralized in `palette.ts` so that no two rows presented on the same surface
   carry an identical human title. Titles MUST scope to their domain screen —
   where the domain is implicit, a verb title reads as its action ("Status",
   "Endpoint", "Retention") and where it is not, it carries the domain
   ("Telemetry status") — and the dotted command id MUST remain discoverable as a
   secondary line, never the primary label. The `View: Status` ×8 duplication
   MUST be eliminated.

### Group 2 — Domain screen composition (status and views on the screen)

4. **Inline status section on open (FR4).** Opening a domain screen MUST issue a
   **silent** status read through the existing `executeOperatorCommand` path and
   render the result as an **inline status section** on the screen — a generic
   key/value renderer projected from the effective payload for the plain domains,
   and the existing rich panel for `jobs`/`output`/`langlock`/`semantic`/`mcp`.
   The status section MUST NOT be a toast, and a silent read MUST NOT flash a
   toast on open.
5. **Views render inside the interface, never a toast (FR5).** A View/detail
   verb MUST render **inside** the interface: rich-panel domains render their
   panel, and every other domain's detail verb opens a **view modal** (FR11). The
   `DialogOperatorDomainPanel` branch that dispatches a **toast** for a non-rich
   domain's view (`dialog-settings.tsx:185`) MUST be removed.
6. **Refresh status after every on-screen mutation (FR6).** After any mutation
   dispatched from a domain screen returns, the screen's status section MUST
   **refetch** its status (silent read) so the rendered state reflects the
   committed change; a `version_conflict` or other typed failure MUST leave the
   prior state and surface the typed reason, never a stale "success" view.

### Group 3 — Toggle rows and tri-state

7. **On/off toggle rows (FR7).** An enable/disable verb pair MUST render as
   **one toggle row** carrying a current-state badge (`Enabled`/`Disabled`) and an
   action that dispatches the **opposite** verb of the current state, refreshing
   status on return (FR6). This applies to `telemetry.on`/`off`, `smart.on`/`off`,
   per-entity `jobs.enable`/`disable`, and `mcp.experimental`/`extension`
   `enable`/`disable`. A toggle whose backend is unavailable (FR15) MUST render
   **disabled and marked**, never dispatching a fabricated success.
8. **Tri-state as a pre-selected picker, not a binary toggle (FR8).** A
   tri-state setting — smart routing `on`/`off`/`auto` — MUST render its current
   mode as a badge and open a **three-option picker pre-selected to the current
   mode**, dispatching the selected mode's verb. It MUST NOT be forced into a
   binary toggle button, because a binary control cannot honestly represent three
   states.

### Group 4 — Edit modals

9. **Edit modal pre-filled from the current value (FR9).** An editable setting
   MUST open an **edit modal** that, before opening, issues a silent read and
   **pre-fills each field with the current effective value**, applies field-level
   validation, dispatches Save through the existing `executeOperatorCommand`
   path, **closes on success**, and surfaces any typed error **in the modal**
   (not a toast). This applies to budget limits, pools bindings, telemetry
   endpoint/transport, langlock tag, output retention/quota, mcp logging level,
   semantic selects, and routing configure.
10. **No empty text inputs (FR10).** The edit-modal text inputs MUST NOT start
    empty; they MUST pre-fill from the current effective value read (closing the
    Feature 014 residual where `descriptor.ts` text inputs opened blank). An
    honest absence (no current value) renders an empty field with a placeholder,
    not a fabricated default.

### Group 5 — View modals

11. **Structural view modal (FR11).** A detail/visualization verb
    (`show`/`explain`/`capabilities`/`history`/status-of-a-plain-domain) MUST open
    a **view modal** that renders the effective payload as a **structural
    key/value tree**, is read-only, and closes on Esc. It MUST NOT be a toast, and
    it MUST render the honest empty state when the effective payload is absent,
    never a synthesized value.

### Group 6 — Entity CRUD

12. **Jobs entity CRUD (FR12).** The `jobs` screen MUST render the scheduled
    jobs as a **list**; selecting a job MUST push an **item screen** offering
    `edit` (edit modal, FR9), `reschedule` (edit modal), an `enable`/`disable`
    **toggle** (FR7), and `delete` behind a confirm gate; the list MUST offer
    `create` (create modal). `run-now` stays a marked typed gap (Feature 014
    FR9/FR10).
13. **Semantic entity CRUD (FR13).** The `semantic` screen MUST render
    **providers** and **models** as lists; a provider MUST offer `add`/`edit`/
    `rotate-secret`/`disable`/`delete` and a model `register`/`disable`/`delete`,
    each through the toggle/edit-modal/confirm contract, with secrets handled as
    `SecretRef` only (Feature 014 FR11). The Milvus-gated index ops stay marked
    typed gaps.
14. **MCP entity CRUD (FR14).** The `mcp` screen MUST render **servers** as a
    list offering `add`/`edit`/`connect`/`disconnect`/`delete`, where
    `connect`/`disconnect` render as a toggle over the live service state and the
    config-backed ops persist (Feature 014 FR7); unreachable ops stay marked typed
    gaps.

### Group 7 — Honesty, the modal contract, and parity

15. **Honest availability everywhere (FR15).** Every control — toggle, edit
    modal, view modal, entity action — MUST consult the Feature 014 per-verb
    availability (`palette.ts` `persistenceFor`/`domainBadge`, per-verb `Partial`)
    and render an unavailable verb as **marked and inert**, surfacing the typed
    envelope (`unavailable`/`milvus_unavailable`/`mcp_unavailable`) on invocation.
    No control MUST fabricate success or synthesize effective state.
16. **Modal contract (FR16).** The edit and view modals MUST be a small
    operator-scoped component (under `packages/tui/src/operator/form/`) built over
    the existing Dialog push/back-stack primitives (`ui/dialog.tsx`) — NOT a new
    dialog primitive — defining: a title, a set of fields (each with a label,
    a pre-filled current value, an input kind, and validation), footer actions
    (Save/Cancel), a busy state, and an in-modal error surface. Single-field edit
    modals cover the current editable settings; a general multi-field modal is
    a natural extension but is not required for any FR here.
17. **Parity and no new dispatch path (FR17).** Every screen action MUST ride
    the SAME `executeOperatorCommand`/`OperatorClient` loopback with the SAME
    command ids, CAS, confirm, and audit as slash/CLI. This feature adds NO
    catalog id, bumps NO catalog version, introduces NO new dispatch path, and
    adds NO new flag; Feature 007 stays the sole command-registration authority.
18. **Toasts only for a mutation's final outcome (FR18).** A toast MUST be
    used only for the final outcome of a **user-invoked mutation** (an optional
    success/failure confirmation); silent status reads, view modals, and status
    sections MUST NOT toast. No view or status path emits a toast.

## Non-Functional Requirements

- **Presentation only, unchanged dispatch.** The redesign reuses the Feature 007
  `executeOperatorCommand` loopback, the Feature 012 result signal + projections,
  the Feature 011 grouped projection (`buildOperatorGroupList`/
  `buildOperatorDomainPanel`), and the Feature 014 per-verb availability; no
  backend, port, dispatcher, or catalog changes.
- **Reuse the existing Dialog stack.** Screens, modals, and lists build on the
  existing `ui/dialog.tsx` push/back-stack and `DialogSelect`/`DialogPrompt`/
  `DialogConfirm` primitives plus a small operator-scoped modal component; no new
  navigation framework and no new dialog primitive.
- **No new flag.** All work stays behind the existing operator control-plane flag
  (`OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`).
- **Bounded, content-free surfaces.** Status sections, view modals, and entity
  lists project bounded, redacted summaries; no raw config payload, spool page
  content, resolved secret, endpoint credential, or role-pool model id is
  surfaced.
- **Honest over pretty.** Where a verb is a typed capability gap, the control is
  marked and inert; the screen never hides an unavailable verb behind a
  fabricated success or a synthesized value.

## Acceptance Scenarios

Given the operator control plane flag is enabled

- **One Operator entry in the palette.**
  Given the top-level Commands palette is open,
  When the operator lists Operator-category entries,
  Then exactly one `Operator` entry is present and no `View: Status …` suggested
  rows are spread as top-level commands.

- **Unique row titles.**
  Given a domain screen is open,
  When its rows are rendered,
  Then no two rows on that surface share an identical human title, and each row's
  dotted command id appears only as a secondary line.

- **Status renders inline on open.**
  Given a domain screen is opened,
  When its status read returns,
  Then the status renders as an inline section on the screen (generic key/value
  or the rich panel), and no toast is shown for the silent read.

- **A view opens a modal, not a toast.**
  Given a plain domain's detail verb is selected,
  When it is invoked,
  Then a view modal renders the effective payload as a key/value tree and closes
  on Esc, and no toast is emitted.

- **Status refreshes after a mutation.**
  Given a mutation is dispatched from a domain screen and returns success,
  When the dispatch completes,
  Then the screen's status section refetches and reflects the committed change;
  on a `version_conflict` the prior state remains and the typed reason surfaces.

- **Enable/disable is one toggle row.**
  Given a domain exposes an on/off verb pair,
  When the screen renders it,
  Then a single toggle row shows the current state badge and its action dispatches
  the opposite verb; if the backend is unavailable the row is marked and inert.

- **Tri-state opens a pre-selected picker.**
  Given smart routing is in `auto` mode,
  When the operator opens its control,
  Then a three-option picker (`on`/`off`/`auto`) opens pre-selected to `auto`, and
  selecting a mode dispatches that mode's verb.

- **Edit modal pre-fills and validates.**
  Given an editable setting has a current effective value,
  When the operator opens its edit modal,
  Then each field is pre-filled with the current value, invalid input is rejected
  in-modal, Save dispatches through the existing path, the modal closes on
  success, and an error surfaces in the modal rather than a toast.

- **Jobs CRUD from the screen.**
  Given the jobs screen lists scheduled jobs,
  When the operator drills into a job,
  Then the item screen offers edit, reschedule, an enable/disable toggle, and
  delete-with-confirm, and the list offers create; `run-now` is a marked typed gap.

- **Semantic and MCP CRUD from the screen.**
  Given the semantic and mcp screens list providers/models and servers,
  When the operator manages an entity,
  Then add/edit/disable/delete (semantic) and add/edit/connect-disconnect/delete
  (mcp) are available through the toggle/edit-modal/confirm contract, with
  Milvus-gated and unreachable ops marked as typed gaps.

- **Honest availability on every control.**
  Given a verb is a typed capability gap,
  When its toggle/edit/view/entity control renders,
  Then the control is marked and inert and surfaces the typed envelope on
  invocation, never a fabricated success.

- **Parity preserved.**
  Given the same command id is dispatched from palette, slash, CLI, and the CRUD
  screen,
  When any screen action is invoked,
  Then it rides the same `OperatorClient` loopback with no new dispatch path, and
  no catalog id is added and no catalog version is bumped.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and presents operator
  configuration and effective state already surfaced by the Feature 007 control
  plane — telemetry export settings (with a `SecretRef` export header), smart-
  routing mode, budget policy, role-pool map, langlock policy, output retention/
  quota, scheduled-job definitions, semantic provider credentials (as
  `SecretRef`), and MCP server config. It is a **presentation** layer: status
  sections, view modals, and entity lists render only the bounded, redacted
  summaries the ports already return; no raw config payload, spool page body,
  resolved secret value, or endpoint credential is displayed or newly persisted.
- **Authentication/authorization.** No new authenticated surface and no new
  dispatch path. Every screen action rides the Feature 007 `OperatorClient`
  loopback and the operator principal, scope, version/CAS, and confirmation gates
  (Feature 007 FR11/FR28); the CRUD screens register no command ids and cannot
  relax those gates. Delete and other destructive entity actions ride the
  existing confirmation gate.
- **Input validation.** The untrusted inputs are the edit-modal field values the
  operator types. Each field is validated in-modal (type/shape) before dispatch
  and rejected with an in-modal error; the payload is then schema-validated by the
  reused port and rejected with a typed `invalid_argument` envelope on mismatch. A
  `SecretRef` field is validated against its canonical `backend:name[@vN]` pattern
  and never dereferenced into plaintext at this layer.
- **Cryptography in transit/at rest.** This feature persists nothing new. Secret-
  bearing values (telemetry export header, semantic provider credential) remain
  `SecretRef` only and are resolved by the Feature 007 `SecretPort` at use time,
  never by the TUI; the edit modal edits the reference, not a plaintext secret,
  and never echoes a resolved value.
- **Logging/audit.** Mutations dispatched from the screens emit the Feature 007
  audit correlation through the same EventV2 authority with content-free, bounded
  labels (command id, domain, surface, outcome). The status sections, view modals,
  and entity lists log nothing of their own and never record a config payload,
  secret, credential, or spool body.
- **Error-handling information exposure.** Every failure path renders a typed,
  bounded, secret-free reason — in the modal for an edit, on the screen for a
  status refresh, in the row badge for an unavailable toggle. No error path leaks a
  stack trace, credential, secret value, endpoint, or raw config/spool payload in a
  modal, status section, toast, or log.

## Domain Model

The CRUD screen composition, the toggle/tri-state controls, the modal contract,
and the entity-list projection are specified as ValueObjects in
`doc/arch/schemas/operator-crud-screens/` and the screen lifecycle as a
statechart in `doc/arch/statecharts/operator-crud-screen.md`:

```
DomainScreen (open)
  → silent status read → StatusSection { key_value | rich_panel }   (FR4)
  → sections: [ toggles | settings | entities | detail ]
        ToggleRow      { state: enabled|disabled|unavailable }       (FR7)
        TriStateRow    { on|off|auto, pre-selected picker }          (FR8)
        EditModal      { fields pre-filled, in-modal validation }    (FR9, FR10)
        ViewModal      { structural key/value tree, Esc closes }     (FR11)
        EntityListScreen { job | provider | model | mcp_server }     (FR12-FR14)
  → any mutation returns → refetch StatusSection                     (FR6)

Every control dispatches the SAME command id through the SAME
executeOperatorCommand / OperatorClient loopback (FR17); an unavailable verb
(Feature 014 per-verb Partial) renders marked + inert and surfaces the typed
envelope, never a fabricated success (FR15). Toasts fire only for a user-invoked
mutation's final outcome (FR18).
```

## Observability

Operator dispatches from the CRUD screens continue to project through the
Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free,
bounded labels (command id, domain, surface, scope, outcome). The screen
composition, status sections, view modals, and entity lists emit no telemetry of
their own and record only what the reused dispatch already records; no config
payload, secret, credential, spool body, or role-pool model id is exported.
Conventions live in `doc/arch/observability/observability.md`.

## Out of Scope

- Re-authoring the operator dispatch, ports, backends, or catalog — the Feature
  007 `executeOperatorCommand` loopback, the Feature 012 result signal and
  projections, the Feature 011 grouped projection, and the Feature 014 backends
  are reused unchanged.
- Adding any catalog id, bumping the catalog version, or introducing a new
  dispatch path, parallel registry, or divergent command name.
- Landing any new persistence backend or lifting a Feature 014 typed capability
  gap (Milvus index ops, `jobs.run-now`, lifecycle `cancel`) — these stay marked
  typed gaps.
- A general multi-field modal beyond the single-field edit modals the current
  editable settings require, an i18n/translation layer, or a new feature flag.
- App/Desktop parity (Feature 007 Phase 2), multi-user directory, vault backends,
  or a non-loopback operator API.

## Related Features and Decisions

- [ADR-0015 — Redesign the operator TUI domain screens into true CRUD](../../adr/0015-redesign-the-operator-tui-domain-screens-into-true-crud.md)
- [Feature 011 Restructure the Operator Control Plane TUI](../011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md) — the grouped menu, the single Operator entry, and the copy contract this feature completes.
- [Feature 012 Expose the structured operator command result through the TUI](../012-expose-the-structured-operator-command-result-through-the/spec.md) — the result signal + projections + Dialog push back-stack the screens reuse.
- [Feature 014 Complete the operator control plane persistence and service](../014-complete-the-operator-control-plane-persistence-and-service/spec.md) — the per-verb `Partial` availability and the real jobs/semantic/mcp/output backends the CRUD screens present.
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, registration invariant (FR11), the `OperatorClient` loopback, CAS, and the SecretPort seam.
- [ADR-0011 — Grouped Operator TUI Navigation](../../adr/0011-restructure-the-operator-control-plane-tui-from-a-flat.md)
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Domain schema](../../schemas/operator-crud-screens/enums.cue)
- [Operator CRUD screen statechart](../../statecharts/operator-crud-screen.md)

## Clarifications
</invoke>
