# Tasks: Make Operator Role Pools Accept The Standard Provider

## Task Breakdown

- [x] T001 Confirm the bug by reading the code: `catalog-adapter.ts`
  `createCatalogAdapter.resolveCandidates` keys the catalog lookup on the bare
  `CatalogModelSnapshot.modelId`, so a `provider/model` role-pool id matches nothing
  and `routing.evaluate` returns `no_authorized_candidate`; `backend-live.ts`
  `planSet` validates only structural shape (`firstBindingDefect`), never
  resolvability, so an unresolvable id is accepted silently and the Feature 037
  resolver degrades to the static default.
- [x] T002 Add the pure `resolveCatalogModel` helper (bare-first, then a single
  known-provider first-segment strip) in `catalog-adapter.ts`, and switch
  `resolveCandidates` to build `byId` / `byProviderModel` / `providers` and normalise a
  resolved candidate's `modelId` to the catalog's within-provider bare id. (FR-A1..A5)
- [x] T003 Normalise the decision-model pool in `createCandidateSource.resolve`
  through the SAME `resolveCandidates`, so a provider-qualified decision-pool id maps
  to the bare candidate id `pickHealthyDecisionModel` matches. (FR-A6)
- [x] T004 Add `createCatalogModelValidator` (+ `CatalogModelValidator` interface):
  `unknownModelIds(ids)` returns only the `not_found_in_catalog` subset (disabled /
  deprecated are KNOWN ids and pass). (FR-B1, FR-B3)
- [x] T005 Add the optional `catalog?: CatalogModelValidator` dep to
  `createLivePoolsBackend` and make `planSet` reject any unknown id with an
  `invalid_argument` error naming the offender(s), after the structural check and
  before `planWrite`; catalog outage → typed `unavailable`; no validator → pre-038
  behavior. `planReset` untouched. (FR-B1, FR-B2, FR-B4)
- [x] T006 Wire the composition root (`stack-live.ts`): share one `catalogAdapter`
  for `createCandidateSource` and `createCatalogModelValidator`, and pass the validator
  into `createLivePoolsBackend`. (FR-B4)
- [x] T007 Extend the regressions: `test/routing/catalog-adapter.test.ts`
  (provider-qualified == bare candidate; nested case; bare-first precedence; bare
  unchanged; unknown-provider unresolved; candidate-source parity + normalised
  decision pool; validator flags only not-found) and
  `test/operator/pools/backend.test.ts` (`pools.set` rejects unresolvable bare +
  provider-qualified ids naming them, nothing persisted; accepts valid
  provider-qualified flat + nested; skips validation with no catalog). No existing
  assertion weakened. (FR-A, FR-B)
- [x] T008 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0038-make-operator-role-pools-accept-the-standard-provider.md`; leave the gates
  green (`bun test test/routing/ test/operator/ test/session/ test/config/`,
  `bunx tsgo --noEmit`, `speckit validate`, `speckit analyze`).

## Dependencies

- Feature 001 (the routing engine, the catalog candidate-resolution seam) — corrected
  here; already shipped.
- Feature 033 / 034 (the per-scope `pools.set` write path + explicit scope selector) —
  the CAS/scope/idempotency behavior this validation preserves; already shipped.
- Feature 037 (the live-session routing resolver) — the consumer this fix unblocks;
  already shipped, needs no parallel change (executor_model stays bare).

## Residuals

- A UI/TUI affordance for entering/validating provider-qualified role-pool ids is out
  of scope (resolution + write-time validation only).
- The operator-stack `InstanceRef` candidate-resolver defect (`stack-live.ts`) remains
  a Feature 037 Phase 2 residual, untouched here.
