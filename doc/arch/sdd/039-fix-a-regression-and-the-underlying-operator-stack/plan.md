# Implementation Plan: Fix A Regression And The Underlying Operator Stack

## Overview

Fix a CONFIRMED regression: `op pools set` now fails on every CLI invocation with
`unavailable: catalog validation unavailable: Error: InstanceRef not provided`. Two
coupled defects cause it — (1) the operator-stack catalog and agent seams
(`stack-live.ts`) run their `AppRuntime.runPromise` effects WITHOUT binding
`InstanceRef` (a Feature 037 Phase 2 residual), so `Provider.list()` / agent
resolution die `InstanceRef not provided`; and (2) Feature 038 wired catalog
validation into `pools.set`, which maps that thrown error to an `unavailable` FAILURE
— so a fully valid write can no longer persist. This plan binds `InstanceRef` on the
two seams (making candidate/agent resolution, `routing.test`, and `capability inspect`
work) and makes the Feature 038 validation best-effort: a catalog it cannot consult
skips validation and lets the write proceed; only a reachable, populated catalog that
positively reports an absent id still rejects.

## Technical Approach

Two seams change; one degrade decision flips.

- **Part 1 — bind InstanceRef on the two seams
  (`packages/opencode/src/operator/stack-live.ts`).**
  - `catalogCandidates.listModels` (~:314) and `agentResolver.resolveAgents` (~:341)
    each add `.pipe(Effect.provideService(InstanceRef, instance))` to their
    `AppRuntime.runPromise(Effect.gen(...))`, mirroring EXACTLY the config seam at
    ~:176 and the domain seams at ~:624/640/653/667/680/696/714/727 — same
    `InstanceRef` identifier, same in-scope `instance` (loaded once at the top of
    `createLiveOperatorStack`). `Provider.Service` and `Agent.Service` are
    `InstanceState`-backed; every `InstanceState` read funnels through
    `InstanceState.context`, which `Effect.die("InstanceRef not provided")` when
    `InstanceRef` is absent. Binding it makes both resolutions succeed. (FR-A1..A3)

- **Part 2 — best-effort validation
  (`packages/opencode/src/operator/pools/backend-live.ts`).**
  - `validateAgainstCatalog` becomes best-effort: `Effect.tryPromise(() =>
    catalog.unknownModelIds(ids))` is recovered with
    `Effect.orElseSucceed<ReadonlyArray<string>>(() => [])`. Any thrown validator error
    — an `InstanceRef`/outage failure OR the empty-catalog signal — recovers to an empty
    unknown-id list, i.e. skip-and-proceed. Only a positively-returned non-empty list
    (a reachable, populated catalog reporting an absent id) still fails
    `invalid_argument`, naming the offender. The prior mapping of a thrown error to the
    `unavailable` PoolsError (which `planSet` treated as a mutation failure) is removed.
    (FR-B1, FR-B2, FR-B3)
  - `planReset`, the structural `firstBindingDefect` check, the principal gate, the
    catalog-less pre-038 skip, and the CAS/scope/idempotency plan are untouched. (FR-B4)

- **Part 2 (reconcile the empty-catalog signal)
  (`packages/opencode/src/routing/adapters/outbound/catalog-adapter.ts`).**
  - `createCatalogModelValidator.unknownModelIds` (~:412) already THROWS when the
    catalog resolves to zero models (a successful-but-empty `Provider.list()`), to mean
    "cannot validate". With Part 2's `orElseSucceed`, that throw now leads to
    skip-and-persist rather than an `unavailable` failure — the SAME outcome a thrown
    outage produces. The behavior is unchanged; only its comment is updated to say
    "skip-and-persist (best-effort)" instead of "degrades to `unavailable`".

Best-effort, not weaker (FR-B2, FR-B4): with a reachable, populated catalog the accept
and reject paths are byte-for-byte identical to Feature 038; only the "cannot consult
the catalog" case flips from FAIL to SKIP.

Feature 037 / 038 (Out of Scope): the session resolver already runs on a
request-`InstanceRef`-bound context; Feature 038 candidate resolution (bare-first,
provider-strip) is untouched. This feature only binds the operator-stack seam those
resolutions run on and relaxes the write-time degrade.

Testing (FR-A, FR-B):
- `packages/opencode/test/operator/feature039-stack-seam.test.ts` (new) — the shared
  `InstanceState.context` check the two seams funnel through DIES `InstanceRef not
  provided` without the bind and RESOLVES with
  `.pipe(Effect.provideService(InstanceRef, instance))`. A harness-light, focused proof
  of the exact seam-binding contract (a full `createLiveOperatorStack` integration test
  is impractical in the unit harness — see Residuals).
- `packages/opencode/test/operator/pools/backend.test.ts` — `pools.set` PERSISTS when a
  throwing validator (InstanceRef/outage) is injected (skip, not `unavailable`); the
  adapted Feature 038 empty-catalog test now asserts PERSIST (skip) rather than an
  `unavailable` fail; the genuinely-unknown id under a reachable populated catalog still
  rejects `invalid_argument` naming it (regression guard, unchanged).
- No existing routing/pools/session/config assertion is weakened.

## Companion Artifacts

No companion files are required: this feature binds an existing seam and relaxes an
existing degrade decision — it adds no new entity, external contract, or integration.
The optional `research.md` / `data-model.md` / `contracts/` / `quickstart.md` are
intentionally omitted (the Domain Model section in `spec.md` carries the flow); the
`.feature` / `.cue` scaffolds follow the 024–038 convention.
