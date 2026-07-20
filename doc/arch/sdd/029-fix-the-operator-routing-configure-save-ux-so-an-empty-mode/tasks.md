# Tasks: Fix The Operator Routing Configure Save Ux So An Empty Mode

## Task Breakdown

- [x] T001 In `packages/tui/src/operator/form/field-list.ts`, mark the
      routing.configure Mode field `required: false` so an unselected Mode never
      blocks the Save with a "Mode is required" in-modal error (FR2).
- [x] T002 Rewrite the routing.configure `compose` to include `enabled`/`mode` only
      when defined, so an unselected Mode is OMITTED from the payload (send
      `{ enabled }` only), never `mode: ""`, while a real `always|auto|never` pick is
      still composed (FR3, FR4).
- [x] T003 Confirm the multi-field modal already surfaces a non-success routing
      result in-modal via `failureReason` (modal stays open, `onSaved` not fired) and
      pin it for routing.configure so a rejected Save is never a silent no-op (FR1).
- [x] T004 Verify the backend `routing-command-port.ts` `parseConfigure` contract is
      untouched: enum-constrained mode, empty/unknown-mode rejection, and all-empty
      rejection all stand; the enabled-only payload is accepted and partial-merged
      (FR5, FR6). Reproduced via the deployed CLI.
- [x] T005 Add `packages/tui/test/operator/routing-save-ux.test.tsx`: enabled-only
      compose omits `mode`; a real pick composes `mode`; Mode is optional; and an
      end-to-end modal test proves a backend `invalid_argument` renders its reason
      in-modal, the modal stays open, and the dispatched payload omits `mode`.
- [x] T006 Author the speckit corpus (spec, plan, tasks) and ADR-0029; leave
      `validate` and `analyze` green.

## Dependencies

- Feature 024 (`024-implement-routing-configure-persistence-so-operator-routing`)
  must be in place: it introduced the routing.configure persistence and the
  enabled-only partial-merge this fix relies on.
- Feature 012 (`012-expose-the-structured-operator-command-result-through-the`) must
  be in place: it provides the structured command result whose typed outcome and
  message this fix surfaces in-modal.
- No external systems or services are required.
