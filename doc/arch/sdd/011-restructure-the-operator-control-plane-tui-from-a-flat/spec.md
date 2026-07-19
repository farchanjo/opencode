---
id: 019f7993-5d09-75a1-892d-9c2690c85dcf
number: 011
slug: restructure-the-operator-control-plane-tui-from-a-flat
status: implemented
created_at: 2026-07-19T08:52:08.586391Z
---
# Feature Specification: Restructure the Operator Control Plane TUI From a Flat List

Feature: 011-restructure-the-operator-control-plane-tui-from-a-flat
Created: 2026-07-19
Scope: TUI presentation and navigation for the Feature 007 Operator Control Plane.
This feature restructures how the operator palette and settings surfaces render
and collect input; it owns no dispatch, auth, audit, or domain business logic and
adds no new command path. Feature 007 remains the command/query authority and the
parity invariant is preserved.

## Problem

Today the operator command palette renders a **flat wall** of every reserved
catalog verb as top-level rows: `packages/tui/src/app.tsx` spreads every entry
from `listOperatorPaletteEntries` (`packages/core/src/operator/palette.ts`). Each
row shows the title `"<domain>: <verb>"` (`titleFor`) and a poor secondary line —
for read verbs the subtitle is literally `"Operator query: <id>"` (the
`description` ternary in `palette.ts`). Three concrete failures follow:

1. **Unusable label.** `"Operator query: <id>"` tells the operator nothing about
   what the verb does or whether it is safe; the dotted id is surfaced as prose.
2. **No configuration.** Mutating verbs fire with **no payload**, so most backends
   answer with a typed `unavailable`/`not_implemented` envelope and nothing
   persists. A reusable input-form pattern exists
   (`packages/tui/src/settings/langlock/index.tsx` `DialogLangLockPicker`, which
   dispatches with a payload) but it is not wired into the palette flow.
3. **Partial grouping.** A grouped menu -> submenu already partially exists
   (`packages/tui/src/operator/dialog-settings.tsx`:
   `DialogOperatorSettingsHome` -> `DialogOperatorDomainPanel`) but
   `OPERATOR_SETTINGS_DOMAINS` in `palette.ts` reaches only **8 of 12** reserved
   domains (it omits `process`, `task`, `jobs`, `output`) and never collects
   input. Five read-side panels
   (`packages/tui/src/operator/{jobs,output,langlock,semantic,mcp}/index.tsx`) are
   built, tested, honest-empty, and unwired.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Grouped, legible navigation

- As an operator, I want a single **Operator** entry that opens a domain-group
  menu, so that the palette is not a flat wall of every verb.
- As an operator, I want each domain to list its verbs split into a **View**
  section (read-only) and a **Configure** section (mutations), so that I can tell
  a safe query from a state change at a glance.
- As an operator, I want a clear subtitle that reads as a view or configure
  action instead of `"Operator query: <id>"`, so that rows are self-describing
  while the command id stays discoverable.

### P1 — Editable configuration

- As an operator, I want a mutating verb that needs input to open a typed form
  (value picker or text input) that collects a payload and dispatches **with** it,
  so that the change actually persists instead of firing empty.

### P1 — Honest availability

- As an operator, I want verbs whose backend is not implemented to be visibly
  marked unavailable and, when invoked, to surface the typed `unavailable`
  envelope without ever implying a change persisted, so that the UI never fakes
  success.

### P2 — Read-side visualization

- As an operator, I want the existing jobs/output/langlock/semantic/mcp read
  panels wired into their domain submenu and fed by the operator result signal,
  falling back to their honest empty state when no signal exists.

## Functional Requirements

1. **Single Operator palette entry (FR1).** The top-level palette MUST expose one
   `Operator` entry that opens the domain-group menu (the `home` navigation node).
   The flat per-verb rows MUST be removed from the top-level palette; they move
   under the grouped navigation. A small curated `suggest` set (read-only
   `status`/`show` queries, already flagged by `suggest` in `palette.ts`) MAY
   still surface as quick access, but the full flat wall MUST NOT.
2. **Full domain-group menu (FR2).** The group menu MUST list all **12** reserved
   domains — `telemetry`, `smart`, `routing`, `budget`, `pools`, `process`,
   `task`, `jobs`, `langlock`, `output`, `semantic`, `mcp` — each with a human
   label and an availability badge. `OPERATOR_SETTINGS_DOMAINS` MUST be extended
   from its current 8 to cover `process`, `task`, `jobs`, and `output`.
3. **Domain submenu split into View and Configure (FR3).** Selecting a domain
   MUST push a submenu (`domain_panel`) listing that domain's verbs split into a
   **View** section (read-only queries, `mutates=false`) and a **Configure**
   section (mutations, `mutates=true`). Confirm-required verbs (from
   `requiresConfirmation`) and secret-bearing verbs (from
   `isOperatorSecretMutationId`) MUST be marked in the row.
4. **Relabel (FR4).** The `"Operator query: <id>"` subtitle MUST be replaced with
   explicit action copy centralised in `palette.ts` where it is produced (no i18n
   layer): a query reads as a **view** action, a mutation as a **configure**
   action, and an unavailable verb is marked as such. The canonical dotted command
   id MUST remain discoverable in the row but MUST NOT be the primary label. The
   normative copy is:
   - Top-level entry: title `Operator`, subtitle `Grouped operator settings and views`.
   - Domain-group row subtitle: `{Available|Partial|Unavailable} · {view_count} views · {configure_count} settings`.
   - View verb: title `View: {verbLabel}`, subtitle `Read-only view · {commandId}`.
   - Configure verb (available): title `Configure: {verbLabel}`, subtitle `Editable setting · {commandId}`.
   - Configure verb (confirm required): subtitle `Editable setting · confirm required · {commandId}`.
   - Unavailable verb: subtitle `Unavailable · not implemented yet · {commandId}`.
   - Secret-bearing verb: the subtitle appends ` · secret`.
5. **Editable configuration form (FR5).** A mutating verb that requires input MUST
   open a typed form (`value_picker` or `text_input`) that collects the payload
   and dispatches **with** it, generalising the `DialogLangLockPicker` pattern.
   This applies to the domains that persist today: `langlock` (`set`, `reset`),
   `jobs` (`create`, `update`, `enable`, `disable`, `delete`, `reschedule`,
   `run-now`), `routing` (`configure`), `process` (`cancel`, `steer`, `handoff`),
   and `task` (`cancel`).
6. **Read-side visualization (FR6).** The existing read-side panels — `jobs`,
   `output`, `langlock`, `semantic`, `mcp` — MUST be wired into their domain
   submenu, fed by the operator result signal, and MUST fall back to their honest
   empty state when no signal is present.
7. **Honest availability (FR7, CRITICAL).** A verb whose backend returns
   `unavailable`/`not_implemented` MUST be visibly marked and, when invoked, the
   UI MUST NOT imply that a change persisted; it MUST surface the typed
   `unavailable` envelope. Only `langlock`, `jobs`, `routing`, `process`, and
   `task` persist today. `telemetry`, `smart`, `budget`, and `pools` mutations,
   and `output`, `semantic`, and `mcp` mutations, MUST remain honest-unavailable
   until their backends land (out of scope here).
8. **Parity invariant (FR8, from Feature 007).** The palette, submenu, and form
   MUST dispatch the **same** command IDs through the **same** `OperatorClient`
   loopback as slash and CLI, producing the same result, version, and audit
   record. This feature MUST NOT introduce a new dispatch path, a parallel
   registry, or a divergent command name; it is presentation and navigation only.

## Non-Functional Requirements

- **No i18n layer.** Copy stays centralised in `palette.ts` where it is produced;
  this feature does not introduce a translation pipeline.
- **Flag-gated, off by default.** The operator control plane stays behind
  `OPENCODE_OPERATOR_CONTROL_PLANE` / `experimental.operator_control_plane`,
  unchanged. This feature adds no new flag.
- **Existing navigation stack.** Navigation MUST use the existing Dialog
  push/replace stack (`ctx.push` / `ctx.replace`); no new navigation framework.
- **Parity.** Palette/submenu/form share command id, validation, effective state,
  version, and audit semantics with slash/CLI/API per Feature 007.

## Acceptance Scenarios

Given the operator control plane flag is enabled

- **Open the Operator menu.**
  Given the palette is open,
  When the operator selects the single `Operator` entry,
  Then the `home` group list shows all 12 reserved domains, each with a human
  label and an availability badge, and no flat per-verb rows appear at top level.

- **Drill into a domain.**
  Given the group menu is open,
  When the operator selects `langlock`,
  Then a `domain_panel` is pushed with a View section (read-only queries) and a
  Configure section (mutations), with confirm-required and secret verbs marked.

- **Run a query.**
  Given the `langlock` panel is open,
  When the operator selects a View verb (for example `langlock.show`),
  Then the read-side panel renders the effective state from the operator result
  signal, or its honest empty state when no signal is present, with no mutation.

- **Configure langlock via a form (persists).**
  Given the `langlock` Configure section,
  When the operator selects `langlock.set`, the value picker collects a language,
  and the operator confirms,
  Then `langlock.set` is dispatched with the payload through the same
  `OperatorClient` loopback as slash/CLI and the change persists with a version
  and audit record.

- **Invoke an unavailable verb (honest unavailable, no false success).**
  Given a domain whose backend is not implemented (for example a `telemetry`
  mutation),
  When the operator invokes the verb,
  Then the row is marked unavailable, the typed `unavailable` envelope is
  surfaced, and the UI does not imply that any change persisted.

## Security Requirements

- **Data sensitivity/classification.** This feature is TUI presentation over the
  Feature 007 control plane; it reads redacted effective state and reserved
  catalog metadata only. Secret-bearing verbs are marked via
  `isOperatorSecretMutationId`; the forms MUST use the Feature 007 secure secret
  reference path and MUST NOT render, echo, or persist secret material in a form
  field, label, subtitle, or result toast.
- **Authentication/authorization.** No new authenticated surface is introduced.
  Every dispatch flows through the same `OperatorClient` loopback and operator
  principal, scope, version/CAS, and confirmation gates as slash/CLI (Feature 007
  FR4, FR19); the TUI is a thin adapter and cannot relax those gates.
- **Input validation.** Untrusted input is limited to the value the operator types
  or picks in a Configure form. The form MUST hand the payload to the existing
  typed command schema for validation and MUST NOT construct a command id or scope
  from free-form text; invalid input is rejected by the command schema before
  dispatch.
- **Cryptography in transit/at rest.** Not applicable — dispatch is loopback-only
  and this feature persists nothing itself; Feature 007 owns Config.Service
  persistence and secret backends.
- **Logging/audit.** This feature writes no new log or audit channel. Audit is the
  existing EventV2 record produced by the Feature 007 dispatch; the TUI adds no
  transcript entry and injects no content into the session.
- **Error-handling information exposure.** Unavailable, conflict, unauthorized, and
  invalid-argument outcomes are surfaced from the typed Feature 007 envelope as
  bounded structured states; the UI MUST NOT synthesize a success message or leak
  secret or path detail in a toast or subtitle.

## Navigation Model

The navigation is a projection over the reserved catalog on the existing Dialog
push/replace stack, specified as ValueObjects in
`doc/arch/schemas/operator-menu/` and as a statechart in
`doc/arch/statecharts/operator-menu-navigation.md`:

```
Home(group list, 12 domains)
  -> DomainPanel(View section + Configure section)
       -> ResultToast                 (query result / typed unavailable envelope)
       -> ConfirmDialog -> dispatch    (confirm-required mutation)
       -> InputForm     -> dispatch    (mutation requiring a payload)
```

Per-verb availability is one of `available`, `confirm_required`, or `unavailable`
(`#VerbAvailability`). Each verb also carries an `#InputMode` (`none`,
`value_picker`, `text_input`) and a `#PersistenceClass` (`persists_today`,
`honest_unavailable`).

## Observability

This feature emits no new telemetry of its own. Operator dispatches continue to
project through the Feature 007 EventV2 audit and the ADR-0001 OTLP foundation
with content-free, bounded labels (command/query id, source, scope, outcome). The
TUI navigation carries no request-scoped identifiers beyond what the underlying
dispatch already records; metric label sets stay bounded and no verb label,
payload, or secret is exported. Conventions live in
`doc/arch/observability/observability.md`.

## Out of Scope

- Landing the `telemetry`, `smart`, `budget`, `pools`, `output`, `semantic`, or
  `mcp` mutation backends — they stay honest-unavailable here.
- Any new dispatch path, parallel registry, or divergent command name.
- App/Desktop parity (Feature 007 Phase 2).
- A new feature flag; the existing operator control plane flag is unchanged.
- An i18n/translation layer for operator copy.

## Related Features and Decisions

- [ADR-0011 — Grouped operator TUI navigation, editable forms, honest availability](../../adr/0011-restructure-the-operator-control-plane-tui-from-a-flat.md)
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — command/query authority, parity invariant, reserved catalog.
- [ADR-0003 — Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md)
- [Navigation schema](../../schemas/operator-menu/navigation.cue)
- [Navigation statechart](../../statecharts/operator-menu-navigation.md)

## Clarifications
