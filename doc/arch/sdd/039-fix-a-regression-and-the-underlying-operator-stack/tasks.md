# Tasks: Fix A Regression And The Underlying Operator Stack

## Task Breakdown

- [x] T001 Confirm the regression + root cause by reading the code and the binary
  error (`unavailable: catalog validation unavailable: Error: InstanceRef not
  provided`): `stack-live.ts` `catalogCandidates.listModels` (~:314) and
  `agentResolver.resolveAgents` (~:341) call `AppRuntime.runPromise` WITHOUT
  `.pipe(Effect.provideService(InstanceRef, instance))`, unlike the config seam (~:176)
  and the domain seams (~:624/640/653/667/680/696/714/727); `Provider.list()` /
  `Agent.listSpecialists()` are `InstanceState`-backed and die `InstanceRef not
  provided`. Feature 038 wired that seam into `pools.set` validation, which maps the
  throw to `unavailable` and fails the mutation.
- [x] T002 Part 1 — bind `InstanceRef` on the catalog candidate seam: add
  `.pipe(Effect.provideService(InstanceRef, instance))` to
  `catalogCandidates.listModels`'s `AppRuntime.runPromise` effect, verbatim from the
  config seam, using the same in-scope `instance`. (FR-A1, FR-A3)
- [x] T003 Part 1 — bind `InstanceRef` on the agent resolver seam: add the same
  one-line pipe to `agentResolver.resolveAgents`'s `AppRuntime.runPromise` effect.
  (FR-A2, FR-A3)
- [x] T004 Part 2 — make `validateAgainstCatalog` (`backend-live.ts` ~:238) best-effort:
  recover the `Effect.tryPromise` over `unknownModelIds` with
  `Effect.orElseSucceed(() => [])` so ANY thrown validator error (InstanceRef/outage OR
  the empty-catalog signal) skips-and-proceeds; only a positively-returned non-empty
  unknown-id list still fails `invalid_argument` naming the offender. Remove the mapping
  of a thrown error to the `unavailable` PoolsError. (FR-B1, FR-B2, FR-B3)
- [x] T005 Part 2 — reconcile the empty-catalog signal: confirm
  `createCatalogModelValidator.unknownModelIds` (`catalog-adapter.ts` ~:412) still
  THROWS for a zero-model catalog (now leading to skip-and-persist via T004) and update
  its comment from "degrades to `unavailable`" to "skip-and-persist (best-effort)". No
  behavior change in the adapter. (FR-B3)
- [x] T006 Confirm the untouched invariants: `planReset` bypasses validation; the
  structural `firstBindingDefect` check, the principal gate, the catalog-less pre-038
  skip, and the CAS/scope/idempotency plan (Features 033/034/035) are unchanged; Feature
  037's session resolver and Feature 038's resolution precedence are untouched. (FR-B4)
- [x] T007 Add/adapt the tests: new `test/operator/feature039-stack-seam.test.ts`
  (the shared `InstanceState.context` seam DIES without the bind, RESOLVES with it);
  `test/operator/pools/backend.test.ts` — a THROWING validator (InstanceRef/outage) →
  `pools.set` PERSISTS (skip); the adapted empty-catalog test now asserts PERSIST (skip)
  not an `unavailable` fail; the genuinely-unknown id under a reachable populated
  catalog still rejects `invalid_argument` naming it. No existing assertion weakened.
  (FR-A, FR-B)
- [x] T008 Author the speckit corpus (`spec.md`, `plan.md`, `tasks.md`) and
  `adr/0039-fix-a-regression-and-the-underlying-operator-stack.md`; leave the gates
  green (`bun test test/routing/ test/operator/ test/session/ test/config/`,
  `bunx tsgo --noEmit`, `speckit validate`, `speckit analyze`).

## Dependencies

- Feature 001 (the routing engine + catalog candidate-resolution seam) — the seam bound
  here; already shipped.
- Feature 007 (the operator control plane + live stack composition) — the stack whose
  two seams are bound; already shipped.
- Feature 037 (the live-session routing resolver) — deferred this `InstanceRef` fix as a
  Phase 2 residual; resolved here.
- Feature 038 (the `pools.set` catalog validation) — the validation made best-effort so
  it never blocks a write it cannot consult; already shipped.

## Residuals

- A full `createLiveOperatorStack` integration test (real `InstanceRuntime.load` +
  live `Provider.Service` / `Agent.Service`) is impractical in the unit harness; the
  focused `InstanceState.context` seam test proves the exact binding contract both
  seams now apply, and the `pools.set` best-effort tests prove the write path. The
  end-to-end CLI (`op pools set`, `op routing test`, `op routing capability inspect`)
  is validated on the binary.
- A UI/TUI affordance for role-pool ids remains out of scope (unchanged from 038).
