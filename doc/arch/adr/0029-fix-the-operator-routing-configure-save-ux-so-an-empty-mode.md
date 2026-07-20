---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0029 — Fix The Operator Routing Configure Save Ux So An Empty Mode

## Context and Problem Statement

The operator control-plane routing configuration screen is a descriptor-driven
multi-field form (Feature 017, `packages/tui/src/operator/form/field-list.ts` +
`multi-field-modal.tsx`). Its routing.configure descriptor exposes an Enabled toggle
and a Mode select that starts at an empty "— select —" affordance, with the Mode
field marked `required: true`. An operator who flipped Enabled, left Mode unselected,
and Saved got nothing persisted — the reported "eu mando salvar e não salva". With
`required: true`, `composePayload` blocked the Save with a "Mode is required" in-modal
error, so an enabled-only change could never go through unless the operator also
picked a Mode.

Yet the backend already accepts that change. Reproduced against the deployed CLI:
`op routing configure --payload '{"enabled":true}'` returns `success` and
partial-merges the toggle, PRESERVING the stored `mode` (Feature 024); while
`--payload '{"enabled":true,"mode":""}'` returns `invalid_argument` "routing.configure
mode must be one of always, auto, or never". So the form was both over-strict (forcing
a Mode the backend does not require) and one careless edit away from sending the
placeholder as `mode: ""` (which the backend rejects).

The question: how to let an enabled-only Save succeed and leave Mode as-is, without
ever sending the placeholder as a real value, and while guaranteeing a genuinely
rejected Save always surfaces its reason — never a silent no-op — and without touching
the backend contract or the Feature 024/027/028 persistence path.

## Decision Drivers

- **No silent no-op.** A rejected routing.configure Save must show the operator a
  clear, human-readable reason in-modal; a "won't save" that looks like nothing
  happened is the exact bug being fixed.
- **Enabling must not require a Mode.** The backend accepts an enabled-only payload
  and preserves the stored mode, so the form must not force a Mode pick to toggle
  Enabled.
- **Never send the placeholder as a value.** An unselected Mode must be OMITTED from
  the payload, never sent as `mode: ""` or the placeholder string the backend rejects.
- **Preserve a real Mode pick.** Selecting `always|auto|never` must still compose
  `mode` with that exact value.
- **Backend + persistence untouched.** The enum constraint, the empty/unknown-mode
  rejection, the all-empty rejection, and the Feature 024 CAS partial-merge persistence
  must be unchanged — this is a TUI UX + validation-surfacing fix, not a routing-engine
  change.

## Considered Options

- **Option A — Make Mode optional and OMIT the placeholder from the payload
  (chosen).** Mark the Mode field `required: false` and compose `enabled`/`mode` only
  when defined, so `composePayload` drops an unselected Mode and the payload carries
  `{ enabled }` only. A real pick still composes `mode`. The existing in-modal failure
  surface (`failureReason`) already renders any non-success outcome, so a backend
  `invalid_argument` is shown without new plumbing.
- **Option B — Default the Mode select to `auto` on a fresh enable.** Rejected: it
  would silently OVERWRITE the operator's stored mode with `auto` whenever they only
  meant to toggle Enabled — a data-losing surprise. It also contradicts the driver
  that an enabled-only Save must leave Mode as-is.
- **Option C — Keep Mode required with inline validation that blocks submit before
  the backend.** Rejected: it preserves the exact over-strictness being fixed —
  forcing the operator to re-select the current mode just to flip Enabled — for no
  backend reason, since an enabled-only payload is already accepted.
- **Option D — Loosen the backend to accept `mode: ""` as "leave unchanged".**
  Rejected and out of scope: it weakens the server-side enum contract and the
  authoritative validation, pushing "leave unchanged" semantics onto a sentinel empty
  string instead of simple omission. Omitting the key is the honest partial-update.

## Decision Outcome

Chosen option: **Option A**, because it lets an enabled-only Save succeed and leave
Mode as-is, never sends the placeholder as a real value, keeps a real Mode pick
intact, surfaces every rejected Save in-modal, and leaves the backend contract and the
persistence path completely untouched.

Key decisions recorded:

1. **Mode is optional (FR2).** The routing.configure Mode field is `required: false`,
   so an unselected Mode no longer blocks the Save with a "Mode is required" in-modal
   error. The placeholder is a display-only "leave unchanged" affordance.
2. **Omit the placeholder from the payload (FR3).** The descriptor's `compose` now
   spreads `enabled`/`mode` only when defined. Because `composePayload` already drops
   an optional-blank field, an unselected Mode never reaches `compose`, so the payload
   OMITS `mode` entirely (`{ enabled }` only) — never `mode: ""`. The Mode picker's
   option set is the bounded `always|auto|never`, so the placeholder can never be
   selected as a value.
3. **A real Mode pick is unchanged (FR4).** Selecting `always`, `auto`, or `never`
   composes `mode` with that exact value, byte-for-byte as before.
4. **Rejection is surfaced, not swallowed (FR1).** No new plumbing: the multi-field
   modal's `dispatch` already treats any non-success, non-cancelled outcome as a
   failure and renders `failureReason(result)` in-modal while keeping the modal open
   and not firing `onSaved`. The backend `invalid_argument` outcome and its typed
   `error.message` flow through the Feature 012 structured result to that surface. A
   test pins this for routing.configure so it cannot regress into a silent no-op.
5. **Backend + persistence untouched (FR5, FR6, invariant).** No change to
   `routing-command-port.ts` `parseConfigure`: the enum constraint, the empty/unknown
   -mode rejection, and the all-empty-payload rejection stand as the authoritative
   server-side validation. The Feature 024 CAS partial-merge persistence and the
   Feature 027/028 config-root resolution are unchanged; the enabled-only payload the
   form now sends is the same one the backend already accepts and merges.

### Consequences

- Good: an enabled-only routing Save now persists and leaves the stored mode as-is —
  the reported "eu mando salvar e não salva" is fixed.
- Good: the placeholder can never ride the wire as `mode: ""`, so the form never
  triggers the backend's `invalid_argument` for an empty mode.
- Good: a genuinely rejected Save (any non-success outcome) shows its typed,
  secret-free reason in-modal, and the modal stays open — never a silent no-op.
- Good: a real `always|auto|never` selection is composed unchanged, and the backend
  contract, the enum validation, and the Feature 024/027/028 persistence path are
  untouched.
- Neutral: because the Enabled toggle always contributes a boolean, this form never
  produces an all-empty payload, so the backend's all-empty rejection is unreachable
  from the routing screen — it remains a defensive guard for the slash/CLI path.
- Trade-off: an operator who opens the form intending to change Mode but forgets to
  pick one will simply leave Mode unchanged (a no-op on that field) rather than see a
  block; this is acceptable because Mode is now an explicit, bounded pick and the
  screen re-reads the current mode on open.

## Related

- Feature specification: [029 Fix the operator routing configure save UX so an empty mode](../sdd/029-fix-the-operator-routing-configure-save-ux-so-an-empty-mode/spec.md)
- The routing.configure persistence and the enabled-only partial-merge this fix relies on: [024 Implement routing configure persistence so operator routing](../sdd/024-implement-routing-configure-persistence-so-operator-routing/spec.md)
- The structured operator command result whose typed outcome + message this fix surfaces in-modal: [012 Expose the structured operator command result through the TUI](../sdd/012-expose-the-structured-operator-command-result-through-the/spec.md)
