---
status: proposed
date: 2026-07-19
deciders: [project maintainers]
consulted: []
informed: []
---

# 0011 — Grouped Operator TUI Navigation, Editable Forms, and Honest Availability

## Context and Problem Statement

Feature 007 delivered the unified native Operator Control Plane: a typed
command/query dispatcher, reserved catalog, auth, CAS, audit, and thin parity
adapters. Its TUI surface, however, still renders a **flat wall** of every reserved
catalog verb as top-level palette rows: `packages/tui/src/app.tsx` spreads every
entry from `listOperatorPaletteEntries`
(`packages/core/src/operator/palette.ts`). Each row titles as `"<domain>: <verb>"`
and, for read verbs, carries the secondary line `"Operator query: <id>"`. Three
forces are in tension:

- **Legibility.** A flat list of every verb with the dotted id surfaced as prose
  is unreadable; the operator cannot tell a safe query from a state change, and the
  `"Operator query: <id>"` copy describes nothing.
- **Configurability.** Mutating verbs fire with **no payload**, so most backends
  answer with a typed `unavailable`/`not_implemented` envelope and nothing
  persists. A working input-form pattern exists
  (`packages/tui/src/settings/langlock/index.tsx` `DialogLangLockPicker`) but is
  not wired into the palette flow.
- **Honesty.** Only `langlock`, `jobs`, `routing`, `process`, and `task` persist
  today; the remaining domains are honest-unavailable. Any redesign must not fake
  success for verbs whose backend has not landed.

A grouped menu -> submenu already partially exists
(`packages/tui/src/operator/dialog-settings.tsx`), but `OPERATOR_SETTINGS_DOMAINS`
reaches only 8 of 12 domains (omitting `process`, `task`, `jobs`, `output`) and
never collects input; five read-side panels are built, tested, and unwired. The
decision must restructure the presentation **without** creating a second dispatch
path — Feature 007 remains the command authority and the parity invariant (palette
== slash == CLI, same id/version/audit) is non-negotiable.

## Decision Drivers

- One command authority: Feature 007's `OperatorClient` loopback dispatch stays the
  only path; no parallel registry, divergent name, or new dispatch route.
- Legible navigation that separates read-only View verbs from mutating Configure
  verbs and replaces the `"Operator query: <id>"` copy with explicit action text.
- Editable configuration: mutating verbs that need input collect a typed payload
  and dispatch with it, generalising the existing `DialogLangLockPicker` pattern.
- Honest availability: unavailable backends are visibly marked and never imply a
  persisted change; the typed `unavailable` envelope is surfaced verbatim.
- Reuse the existing Dialog push/replace stack and the five built read-side panels;
  no new navigation framework and no new feature flag.
- Copy centralised where it is produced (`palette.ts`); no i18n layer.

## Considered Options

- **Grouped navigation (Home -> DomainPanel -> {ResultToast | ConfirmDialog |
  InputForm}) with editable forms and an honest-availability affordance, over the
  existing dispatch** — restructure presentation only, extend the partial grouped
  menu to all 12 domains, wire the read panels, and generalise the langlock form.
- **Keep the flat list, only relabel the subtitle** — cheap, but leaves the wall of
  verbs, still collects no input, and does not wire the read panels; fails the
  configurability and legibility drivers.
- **Build a new palette/registry tailored to the TUI** — would diverge command
  names and dispatch, breaking the Feature 007 parity invariant; rejected.
- **Fake-persist mutations optimistically in the UI** — would imply success for
  honest-unavailable backends; violates the honesty driver; rejected.

## Decision Outcome

Chosen option: **Grouped operator TUI navigation with editable forms and an
honest-availability affordance, layered over the unchanged Feature 007 dispatch.**

- **Single entry and group menu.** The top-level palette exposes one `Operator`
  entry opening the `home` group list of all 12 reserved domains, each with a human
  label and an availability badge. The flat per-verb rows are removed from the top
  level; a small curated `suggest` set of read-only queries may remain as quick
  access. `OPERATOR_SETTINGS_DOMAINS` is extended from 8 to 12 (adding `process`,
  `task`, `jobs`, `output`).
- **Domain panel split.** Selecting a domain pushes a `domain_panel` splitting the
  domain's verbs into a **View** section (`mutates=false`) and a **Configure**
  section (`mutates=true`), with confirm-required and secret-bearing verbs marked.
- **Relabel.** The `"Operator query: <id>"` line is replaced with explicit copy
  centralised in `palette.ts`: view verbs read `Read-only view · {commandId}`,
  configure verbs read `Editable setting · {commandId}` (with
  `· confirm required` and `· secret` markers as applicable), and unavailable verbs
  read `Unavailable · not implemented yet · {commandId}`. The dotted id stays
  discoverable but is never the primary label.
- **Editable forms.** A mutating verb requiring input opens a typed form
  (`value_picker` or `text_input`) generalising `DialogLangLockPicker`; it collects
  the payload and dispatches with it. Applies to the persisting domains: `langlock`,
  `jobs`, `routing`, `process`, `task`.
- **Read-side visualization.** The built `jobs`, `output`, `langlock`, `semantic`,
  and `mcp` panels are wired into their submenu, fed by the operator result signal,
  falling back to their honest empty state when no signal exists.
- **Honest availability.** Verbs whose backend returns `unavailable`/
  `not_implemented` are marked and surface the typed envelope on invocation without
  implying persistence. `telemetry`, `smart`, `budget`, `pools` mutations and
  `output`, `semantic`, `mcp` mutations stay honest-unavailable until their backends
  land (out of scope here).
- **Parity preserved.** Palette, submenu, and form dispatch the same command IDs
  through the same `OperatorClient` loopback as slash/CLI, producing the same
  result, version, and audit. No new dispatch path, registry, or flag; navigation
  uses the existing Dialog push/replace stack.

The navigation model is specified as ValueObjects in
`doc/arch/schemas/operator-menu/` and as a statechart in
`doc/arch/statecharts/operator-menu-navigation.md`.

### Consequences

#### Positive

- The palette becomes legible: one entry, grouped domains, and self-describing
  view/configure subtitles replace the flat wall and the `"Operator query: <id>"`
  copy.
- Mutating verbs that persist today (`langlock`, `jobs`, `routing`, `process`,
  `task`) become usable through typed forms that dispatch a real payload.
- The five built read panels finally render, fed by the operator result signal with
  honest empty fallback.
- The Feature 007 parity invariant is untouched: no new dispatch path, registry, or
  divergent command name.

#### Trade-offs

- Presentation and dispatch stay coupled to Feature 007 catalog metadata
  (`mutates`, `confirmRequired`, `secretRelated`, availability); catalog changes
  must keep the projection honest.
- Honest-unavailable domains still show verbs that cannot persist; the affordance
  makes this explicit rather than hiding them, which some operators may read as
  clutter until the backends land.
- Copy centralised in `palette.ts` without i18n means non-English operators see
  English action labels; an i18n layer is deferred.

#### Follow-ups

- Feature 011 `plan`/`tasks` wire `OPERATOR_SETTINGS_DOMAINS` to 12 domains, the
  View/Configure split, the relabelled copy, the generalised form, and the five
  panels, with tests asserting parity and honest-unavailable behaviour.
- Landing the honest-unavailable mutation backends (`telemetry`, `smart`, `budget`,
  `pools`, `output`, `semantic`, `mcp`) is separate domain work.

## Related

- Feature specification: [011 Restructure Operator TUI](../sdd/011-restructure-the-operator-control-plane-tui-from-a-flat/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Navigation schema: [operator-menu ValueObjects](../schemas/operator-menu/navigation.cue)
- Navigation statechart: [operator-menu-navigation](../statecharts/operator-menu-navigation.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
