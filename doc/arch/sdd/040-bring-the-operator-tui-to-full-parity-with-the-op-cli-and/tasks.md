# Tasks: Bring The Operator TUI To Full Parity With The op CLI

## Task Breakdown

- [ ] T001 Confirm the compound root cause by reading the code: the "Routing configure" modal
  DOES read on open (`multi-field-modal.tsx:202-221`, `readId:"routing.status"` at
  `field-list.ts:324`) and DOES carry prefill functions, yet shows `off`/`— select —` because
  (1) the prefill read omits `requestedScope` → the config-status handler
  (`config-status.ts:92-113`, `routingStatusAuthority` `:61-63`) resolves the project `routing`
  authority via a single `config.get` (never `resolveEffective`, so `global:routing` is not
  shadowed), and (2) the extractors `prefillScalar("enabled")`/`prefillString("mode")`
  (`field-list.ts:326-327`, `:135-163`) read TOP-LEVEL `effective.enabled`/`effective.mode`
  while Feature 036 nests them under `effective.activation` (`config-status.ts:99-110`).
- [ ] T002 Decide the read seam (ADR-0040 OPEN decision): Option A — enrich
  `createRoutingStatusHandler` to project the EFFECTIVE (shadowed) activation for project/bare
  scope while reading `global:routing` directly under global scope (recommended); or Option B —
  re-point the `routing.configure` descriptor `readId` at `smart.status`. Record the choice.
- [ ] T003 Part 1 — thread the Request scope into the prefill read: pass
  `requestedScope: store.raw[REQUEST_SCOPE_KEY]` into `prefillFromRead`'s
  `executeOperatorCommand` (`multi-field-modal.tsx:205-213`), so the read resolves the selected
  scope's authority/effective config, not an unconditional project default. (FR-B1)
- [ ] T004 Part 1 — re-read on scope switch: add a deferred `createEffect` keyed on the
  Request-scope value that re-issues the scope-resolved read and re-seeds the non-secret fields,
  reusing the hoisted-store re-seed path, without closing the modal. (FR-B2)
- [ ] T005 Part 2 — implement the chosen effective read (Option A): make the config-status
  `routing.status` handler resolve the shadowed effective activation
  (`resolveEffective`: project > global > default) under project/bare scope and read
  `global:routing` directly under global scope, superseding the Feature 036 accepted residual
  (project/bare `configured:false` under a global-only config). Update the Feature 036 comment
  accordingly. (FR-A1)
- [ ] T006 Part 3 — fix the field-mapping shape: add prefill extractors that read
  `effective.activation.enabled` (→ toggle `"true"`/`"false"`) and `effective.activation.mode`
  (→ picker option), with a back-compat fallback to the top-level domain-port shape; wire them
  onto the `routing.configure` descriptor `enabled`/`mode` fields (`field-list.ts:326-327`).
  (FR-C1)
- [ ] T007 Part 3 — verify honest placeholder vs seeded value: an absent activation seeds
  nothing → `[ ] off` / `— select —`; a present activation seeds the real value → `[x] on` /
  the mode option. (FR-C2)
- [ ] T008 Part 4 — audit parity across the config-backed Configure modals: confirm `smart`
  activation, `pools.set` (`prefillBindings` over `effective.bindings`), and `budget.set`
  (`prefillNestedScalar("limits", …)`) each seed correctly from their scope-resolved effective
  read; ensure the request-scope threading applies to every scope-flexible Configure modal so
  the forthcoming operator config-domain modals (hierarchy, capability) inherit the contract.
  (FR-E1)
- [ ] T009 Part 4 — realtime refresh: confirm the modal + backing operator status card reflect
  a committed Save without a manual reopen, reusing the read-on-open + refetch-after-mutation
  pattern (`dialog-settings.tsx:262-284`, `entity-screens.tsx:86-110`); no new dispatch path or
  store. (FR-D1)
- [ ] T010 Add the tests: a TUI prefill-parity test (seeded field set == persisted activation;
  honest placeholder on absence; read issued WITH `requestedScope` and re-issued on scope
  switch) and, for Option A, a backend effective-read parity test over the wired dispatcher
  (`global:routing`-only → project/bare `routing.status` reports the shadowed activation and
  AGREES with `smart.status`; explicit global/project unchanged; no Feature 036 assertion
  weakened without the superseded-residual note). (FR-A, FR-C, FR-D)
- [ ] T011 Author/finalize the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0040-bring-the-operator-tui-to-full-parity-with-the-op-cli-and.md`; leave the gates green
  (`bun test`, `bunx tsgo --noEmit`, `speckit validate`, `speckit analyze`).

## Dependencies

- Feature 007 (operator control plane + command registry) — the dispatch loopback the modal
  uses; already shipped.
- Feature 017 (multi-field prefill: read-on-open → seed) — the prefill machinery this feature
  reconciles; already shipped.
- Feature 024 (routing.configure persistence) — the Save/write path the modal targets;
  untouched, already shipped.
- Feature 034 (explicit Request-scope selector) — the scope value the prefill read must now
  honor; already shipped.
- Feature 036 (scope-aware routing.status) — introduced the nested-activation shape and the
  scope-honoring read this feature's prefill must read (and shadow); already shipped.
- Feature 030 / 037 (layered global config read; live effective read) — the `resolveEffective`
  document-shadowing the effective-read parity depends on; already shipped.

## Residuals

- The forthcoming operator config-domain modals (hierarchy, capability) are OUT of scope here;
  this feature only establishes the dynamic-prefill parity contract they inherit.
- If Option A is chosen, the Feature 036 note that the project/bare `routing.status` reports
  `configured:false` under a global-only config is SUPERSEDED (the read now shadows); this must
  be recorded in the Feature 036 residual and the config-status comment, not left divergent.
- End-to-end TUI parity (open the real modal against a live `global:routing` config and observe
  the prefilled `[x] on` / `Auto`) is validated on the binary; the unit tests prove the prefill
  mapping and the effective-read seam.
</content>
