---
status: accepted
date: 2026-07-21
deciders: [project maintainers]
consulted: []
informed: []
---

# 0039 — Fix A Regression And The Underlying Operator-Stack InstanceRef Defect

## Context and Problem Statement

On the compiled binary, EVERY `op pools set` invocation fails:

```
unavailable: catalog validation unavailable: Error: InstanceRef not provided
```

A fully valid role-pool write can no longer persist via the CLI. Two coupled defects
produce it.

1. **Operator-stack `InstanceRef` defect (pre-existing, deferred by Feature 037).** In
   `operator/stack-live.ts`, the catalog candidate resolver
   `catalogCandidates.listModels` (~:314) and the agent resolver
   `agentResolver.resolveAgents` (~:341) run their `AppRuntime.runPromise(Effect.gen(...))`
   WITHOUT `.pipe(Effect.provideService(InstanceRef, instance))`. Every OTHER seam in
   the same `createLiveOperatorStack` function binds it — the config seam at ~:176 and
   the domain seams at ~:624/640/653/667/680/696/714/727. `Provider.Service.list()` and
   `Agent.Service.listSpecialists()` are `InstanceState`-backed, and every
   `InstanceState` read funnels through `InstanceState.context`, which
   `Effect.die("InstanceRef not provided")` when no `InstanceRef` is bound on the fiber.
   So those two seams die on any CLI `op` invocation that reaches them — which has
   always broken `op routing test` and `op routing capability inspect`. Feature 037
   explicitly named this fix (`stack-live.ts:314/341`) a Phase 2 residual and
   side-stepped it for the session path.

2. **Feature 038 regression.** Feature 038 wired catalog validation into `pools.set`
   (`pools/backend-live.ts#validateAgainstCatalog` → the `catalog` validator → the
   stack's `catalogCandidates` seam). Because that seam is unbound (defect 1),
   validation always throws `InstanceRef not provided`;
   `validateAgainstCatalog` maps that thrown error to the `unavailable` PoolsError, and
   `planSet` treats `unavailable` as a mutation FAILURE. So a preflight that can never
   reach its catalog fails the whole write. Pre-038 (no validation) `pools.set`
   succeeded.

The question: how to restore `op pools set` (and unblock candidate/agent resolution for
`routing.test` / `capability inspect`) without weakening the Feature 038 safety net for
the case it can actually observe, and without touching the Feature 037 session seam or
the Features 033/034/035 scope/authority machinery.

## Decision Drivers

- **Fix the root cause, not the symptom.** The two operator-stack seams must bind
  `InstanceRef` like every other seam in the same function, so candidate/agent
  resolution actually works on the operator stack.
- **A preflight must never block a write it cannot perform.** `pools.set` must persist
  when the catalog cannot be consulted — a thrown resolver error OR a transiently-empty
  catalog — rather than failing the mutation `unavailable`.
- **Preserve the observable safety net.** A genuinely-unknown id under a reachable,
  populated catalog must still be rejected `invalid_argument`, naming it.
- **One clear distinction.** Unreachable/empty (skip-and-persist) vs reachable-absent
  (reject) — the write path rejects only on a positively-observed absent id.
- **No collateral damage.** Do not change the Feature 037 session seam, the Feature 038
  resolution precedence, or the Features 033/034/035 CAS/scope/idempotency behavior;
  `planReset` still bypasses validation.
- **Minimal, mirrored seam fix.** The `InstanceRef` binds are one line each, copied
  verbatim from the already-bound seams.

## Considered Options

- **Option A — bind `InstanceRef` on both seams AND make `pools.set` validation
  best-effort (chosen).** Add the one-line `.pipe(Effect.provideService(InstanceRef,
  instance))` to the catalog and agent seams (so resolution works), and change
  `validateAgainstCatalog` so ANY thrown validator error (InstanceRef/outage OR the
  empty-catalog signal) recovers to skip-and-proceed, while a positively-returned
  non-empty unknown-id list still rejects. This fixes the root cause AND makes the
  preflight incapable of blocking a write on its own unavailability, while keeping the
  reject path for the observable case.
- **Option B — bind `InstanceRef` only, leave `pools.set` failing `unavailable` when
  the catalog is unreachable.** Rejected: a freshly-invoked CLI `op` process may still
  present a cold/empty catalog (providers not yet loaded/authed, a reload race), and the
  binary error already showed that a preflight which cannot consult the catalog must not
  fail the write. Binding alone narrows the window but does not make the preflight
  best-effort.
- **Option C — make `pools.set` validation best-effort only, leave the seams unbound.**
  Rejected: it would paper over `op pools set` but leave `routing.test` and
  `capability inspect` still dying `InstanceRef not provided`, and leave the catalog
  seam permanently unable to resolve any candidate — treating the symptom, not the
  defect Feature 037 deferred.
- **Option D — remove the Feature 038 `pools.set` catalog validation entirely.**
  Rejected: it would discard the real value of the safety net (rejecting a mistyped id
  at configure time when the catalog IS reachable and populated). Best-effort keeps the
  reject for the case it can observe and only skips when it genuinely cannot validate.

## Decision Outcome

Chosen option: **Option A**. Binding `InstanceRef` on the catalog and agent seams
resolves the Feature 037 Phase 2 residual so `Provider.list()` / agent resolution
succeed on the operator stack (unblocking `routing.test`, `capability inspect`, and the
`pools.set` preflight); making the `pools.set` validation best-effort ensures a catalog
it cannot consult skips the preflight and lets the write persist, while a reachable,
populated catalog still rejects a genuinely-absent id.

Key decisions recorded:

1. **The two seams bind `InstanceRef` verbatim.** `catalogCandidates.listModels` and
   `agentResolver.resolveAgents` each add
   `.pipe(Effect.provideService(InstanceRef, instance))` to their `AppRuntime.runPromise`
   effect — the exact one-line bind the config seam (~:176) and the domain seams all
   carry, using the same in-scope `instance` loaded once at the top of
   `createLiveOperatorStack`. Nothing else in either seam changes.
2. **`pools.set` validation is best-effort.** `validateAgainstCatalog` recovers the
   `unknownModelIds` call with `Effect.orElseSucceed(() => [])`: a thrown resolver error
   (InstanceRef/outage) OR the empty-catalog signal recovers to an empty unknown-id list
   — skip-and-proceed. The write persists; it is not failed `unavailable`.
3. **A reachable, populated catalog still rejects an absent id.** A positively-returned
   non-empty unknown-id list still fails `invalid_argument`, naming the offender —
   Feature 038 behavior for the observable case is unchanged.
4. **The empty-catalog signal is reconciled to skip, not fail.** Feature 038 threw from
   `createCatalogModelValidator.unknownModelIds` for a zero-model catalog to mean
   "cannot validate"; that throw now leads to skip-and-persist (the SAME outcome as a
   thrown outage), and its comment is updated accordingly. No behavior change in the
   adapter itself.
5. **Everything else is untouched.** `planReset` still bypasses validation; the
   structural binding check, the principal gate, the catalog-less pre-038 skip, and the
   CAS/scope/idempotency behavior (Features 033/034/035) are unchanged; the Feature 037
   session resolver and Feature 038 resolution precedence (bare-first, provider-strip)
   are untouched.

### Consequences

- Good: `op pools set` persists again from the CLI — a valid write is no longer blocked
  by a preflight that cannot reach its catalog on a freshly-invoked process.
- Good: `op routing test` and `op routing capability inspect` resolve candidates/agents
  instead of crashing `InstanceRef not provided`; the operator stack's catalog and agent
  seams now work like every other seam in it.
- Good: the Feature 038 safety net is preserved for the case it can observe — a
  genuinely-unknown id under a reachable, populated catalog is still rejected by name.
- Neutral: when the catalog cannot be consulted, `pools.set` writes the id unvalidated;
  this is a best-effort preflight, not a security control, and the routing engine
  independently ignores an unresolvable id at routing time. It also removes the raw
  `InstanceRef not provided` cause string that previously leaked to the CLI on the write
  path.
- Residual: a full `createLiveOperatorStack` integration test (real
  `InstanceRuntime.load` + live services) is impractical in the unit harness; a focused
  `InstanceState.context` seam test proves the binding contract, and the `pools.set`
  best-effort tests prove the write path. A UI/TUI affordance for role-pool ids remains
  out of scope.

## Related

- Feature specification: [039 Fix a regression and the underlying operator stack](../sdd/039-fix-a-regression-and-the-underlying-operator-stack/spec.md)
- The routing engine and catalog candidate-resolution seam bound here: [001 Define one cohesive Smart Agent Routing and OpenTelemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- The operator control plane and live stack composition: [007 Add a unified native operator control plane for all opencode](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Deferred this `InstanceRef` candidate-resolver fix (`stack-live.ts:314/341`) as a Phase 2 residual: [037 Wire the operator Smart Routing engine into the live session](../sdd/037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md)
- The `pools.set` catalog validation this feature makes best-effort: [038 Make operator role pools accept the standard provider-qualified id](../sdd/038-make-operator-role-pools-accept-the-standard-provider/spec.md)

## Links

- Related: ADR-0020, ADR-0038.
