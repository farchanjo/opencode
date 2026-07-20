---
id: 019f80a6-9b4c-7ec1-8afb-a48eb5b9c018
number: 029
slug: fix-the-operator-routing-configure-save-ux-so-an-empty-mode
status: analyzed
created_at: 2026-07-20T17:50:30.220604Z
---
# Feature Specification: Fix The Operator Routing Configure Save Ux So An Empty Mode

Feature: 029-fix-the-operator-routing-configure-save-ux-so-an-empty-mode
Created: 2026-07-20

## User Stories

- As an operator on the routing configuration screen, I want to flip Enabled and
  Save WITHOUT being forced to pick a Mode, so a routing toggle actually persists
  instead of appearing to do nothing ("eu mando salvar e não salva").
- As an operator, I want the Mode select left at its empty "— select —" affordance to
  be OMITTED from the Save, so an enabled-only change succeeds and leaves the stored
  mode unchanged, never overwriting it or sending a value the backend rejects.
- As an operator, when a routing Save IS rejected by the backend (an
  `invalid_argument`), I want a clear, human-readable reason shown in the form,
  so a rejected Save is never a silent no-op.
- As a maintainer, I want the backend routing.configure contract preserved (mode ∈
  `always|auto|never`; an all-empty payload still rejected) and the Feature 024/027/028
  persistence path untouched, so this is a TUI UX + validation-surfacing fix only.

## Functional Requirements

1. **No silent no-op on rejection.** Any routing.configure result whose outcome is
   not a success MUST surface a clear, human-readable reason in the operator TUI
   (in-modal for the form path; a non-success toast for the slash/CLI path). The
   modal MUST stay open on a rejected Save and MUST NOT fire `onSaved` or close.
   The backend's typed `error.message` (e.g. "routing.configure mode must be one of
   always, auto, or never") MUST be the surfaced reason, not a swallowed outcome.
2. **Mode is optional in the form.** The routing.configure Mode select MUST NOT be
   marked required. A Save with Mode left at the "— select —" placeholder MUST NOT
   block with a "Mode is required" in-modal error.
3. **Omit the placeholder from the payload.** When Mode is still the placeholder,
   the composed payload MUST OMIT the `mode` key entirely (send `{ enabled }` only),
   never `mode: ""` and never the placeholder string. The Mode picker can only ever
   yield a real `always|auto|never` value; the placeholder is a display-only "leave
   unchanged" affordance.
4. **A real Mode pick is still composed.** When the operator selects `always`,
   `auto`, or `never`, the composed payload MUST carry `mode` with that exact value,
   unchanged from the prior behavior.
5. **Backend contract preserved (invariant).** The backend `parseConfigure` contract
   is UNCHANGED: `mode` (when present) MUST be one of `always|auto|never`, an empty or
   unknown mode is rejected `invalid_argument`, and an all-empty payload (no enabled,
   no mode, no policy override) is still rejected. The enabled-only payload the form
   now sends is already accepted and partial-merged, preserving the stored mode.
6. **Persistence path untouched (invariant).** The Feature 024 routing.configure
   persistence (CAS over the shared `routing` / `global:routing` authority,
   partial-merge preserving `role_pools` + sibling activation) and the Feature
   027/028 config-root resolution are UNCHANGED. No routing-engine behavior changes.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes the routing
  activation config (`enabled` boolean, `mode` enum, and an optional advanced budget
  policy) — operational configuration, not credentials or user content. No new
  sensitive data is read, written, or exposed; the change only alters which fields
  the form composes onto an already-existing command payload.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary is introduced. The routing.configure command already flows
  through the Feature 007 dispatcher's mutation preflight and CAS write authority;
  this feature does not touch that path, only the client-side field composition and
  error surfacing.
- **Input validation.** The untrusted input is the operator's form entry. The Mode
  value is a bounded enum picked from `always|auto|never` (never free text), so an
  invalid mode cannot originate from the picker; the placeholder is omitted rather
  than sent. The advanced-policy field is still parsed as a bounded JSON object
  in-modal. The backend `parseConfigure` remains the authoritative validator and
  still rejects any out-of-contract payload.
- **Cryptography in transit/at rest.** Not applicable — this feature performs no
  transport and adds no at-rest encryption; it changes only local TUI form
  composition and error rendering over an existing command path.
- **Logging/audit.** This feature adds no logging. The existing operator audit trail
  for routing.configure (audit id per dispatch) is unchanged. No sensitive material
  is recorded; the payload carries only an `enabled` flag and an enum.
- **Error-handling information exposure.** The surfaced reason is the backend's
  typed, bounded error message (an enum-constraint sentence with a field name) — it
  carries no secrets, no stack traces, and no raw payload bodies. The in-modal error
  path reuses the Feature 012/021 `failureReason` projection, which prefers the typed
  display message and falls back to the typed outcome, so no unbounded or sensitive
  detail is echoed to the operator.

## Acceptance Scenarios

Given the routing configuration screen with Mode at the "— select —" placeholder
When  the operator flips Enabled on and Saves
Then  the dispatched payload is `{ enabled: true }` with no `mode` key
And    the backend accepts it and the stored mode is left unchanged

Given the routing configuration form
When  the operator leaves Mode at the placeholder
Then  the Save is NOT blocked by a "Mode is required" in-modal error

Given the routing configuration form and a Mode selection of `auto`
When  the operator Saves
Then  the dispatched payload carries `mode: "auto"`

Given a routing.configure Save that the backend rejects with `invalid_argument`
When  the operator Saves from the form
Then  the backend's reason is shown in the modal
And    the modal stays open and no committed-save callback fires

Given the backend routing.configure contract
When  a payload carries `mode: ""` or an unknown mode
Then  it is still rejected `invalid_argument`
And    an all-empty payload is still rejected

## Observability

This feature introduces no new metrics, log events, or trace spans. It reuses the
existing operator command dispatch path (audit id per routing.configure) and the
in-modal error surface. No telemetry label sets change. Conventions live in
`doc/arch/observability/observability.md`.

## Clarifications
