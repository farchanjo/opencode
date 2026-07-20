# Implementation Plan: Fix The Operator Routing Configure Save Ux So An Empty Mode

## Overview

The operator routing configuration screen (a descriptor-driven multi-field form,
Feature 017) exposes an Enabled toggle and a Mode select that starts at an empty
"— select —" affordance. The Mode field was marked `required: true`, so flipping
Enabled and Saving while Mode was unselected was blocked in-modal by a "Mode is
required" error — the operator's reported "eu mando salvar e não salva". Yet the
backend `routing.configure` already ACCEPTS an enabled-only payload and
partial-merges it, preserving the stored mode; it only rejects a `mode: ""`
placeholder with `invalid_argument`. This feature makes Mode optional and omits the
unselected placeholder from the payload, so an enabled-only Save succeeds and leaves
the mode as-is, while a genuinely rejected Save always surfaces its reason in-modal.

Traced (backend confirmed via the deployed CLI): `{"enabled":true,"mode":""}` →
`invalid_argument` "routing.configure mode must be one of always, auto, or never";
`{"enabled":true}` → `success`, with the stored `mode` preserved (partial-merge).

## Technical Approach

- **Mode optional + placeholder omission (FR2, FR3, FR4).** In
  `packages/tui/src/operator/form/field-list.ts`, flip the routing.configure Mode
  field to `required: false` and rewrite its `compose` to include `enabled`/`mode`
  only when defined. `composePayload` already drops an optional-blank field, so an
  unselected Mode never reaches `compose`, and the payload omits `mode` entirely
  (never `mode: ""`). The Mode picker options remain the bounded `always|auto|never`
  set, so a real selection still composes `mode: "<value>"` unchanged.
- **Rejection surfacing (FR1).** No new plumbing is required: the multi-field modal's
  `dispatch` (`multi-field-modal.tsx`) already treats any non-success, non-cancelled
  outcome as a failure and renders `failureReason(result)` in-modal while keeping the
  modal open and not firing `onSaved`. The backend `invalid_argument` outcome and its
  typed `error.message` flow through the Feature 012 structured result to that
  surface. This feature pins that behavior for routing.configure with a test so it
  cannot regress into a silent no-op.
- **Backend + persistence untouched (FR5, FR6).** No change to
  `routing-command-port.ts` `parseConfigure` or the Feature 024/027/028 persistence
  path. The enum constraint, the empty/unknown-mode rejection, and the all-empty
  rejection stand as the authoritative server-side validation.
- **Choice of forgiving-enable strategy.** Between defaulting Mode to `auto` and
  keeping Mode required with inline validation, this feature does NEITHER: because
  the backend accepts an enabled-only payload and preserves the stored mode, forcing
  a mode on every Save would either make the operator re-pick the current mode just
  to toggle Enabled, or silently overwrite the stored mode with a default. Mode is
  therefore optional and omitted when unchanged (recorded in ADR-0029).
- **Tests.** In `packages/tui/test/operator/routing-save-ux.test.tsx`: pure
  `composePayload` assertions that an enabled-only entry omits `mode` and a real pick
  composes it; a Mode-optional regression pin; and an end-to-end keyboard-driven
  modal test proving a backend `invalid_argument` renders its reason in-modal, the
  modal stays open, `onSaved` never fires, and the dispatched payload omits `mode`.

## Companion Artifacts

No companion artifacts are required for this feature. It is a localized TUI
form-descriptor and error-surfacing fix in a single module; the decision record
lives in `doc/arch/adr/0029-fix-the-operator-routing-configure-save-ux-so-an-empty-mode.md`.
