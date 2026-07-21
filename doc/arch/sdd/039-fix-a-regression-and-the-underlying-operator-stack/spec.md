---
id: 019f8242-ef9e-7f63-85cd-d6eb67ed1660
number: 039
slug: fix-a-regression-and-the-underlying-operator-stack
status: implemented
created_at: 2026-07-21T01:20:52.63893Z
---
# Feature Specification: Fix A Regression And The Underlying Operator Stack

Feature: 039-fix-a-regression-and-the-underlying-operator-stack
Created: 2026-07-21
Scope: the operator-stack composition root
(`packages/opencode/src/operator/stack-live.ts`) — the catalog candidate and agent
resolver seams — and the Feature 038 `pools.set` write-time validation degrade path
(`packages/opencode/src/operator/pools/backend-live.ts` +
`packages/opencode/src/routing/adapters/outbound/catalog-adapter.ts`). Feature 001
built the routing engine and the operator stack; Feature 007 owns the operator
control plane; Feature 037 wired Smart Routing into the live session and explicitly
DEFERRED the operator-stack `InstanceRef` candidate-resolver defect
(`stack-live.ts:314/341`) as a Phase 2 residual; Feature 038 wired catalog validation
into `pools.set`. This feature fixes a CONFIRMED regression — `op pools set` now fails
on every CLI invocation — by resolving that deferred `InstanceRef` defect AND making
the Feature 038 validation best-effort so a catalog it cannot consult never blocks a
write.

## The confirmed bug

On the compiled binary, EVERY `op pools set` invocation fails:

```
unavailable: catalog validation unavailable: Error: InstanceRef not provided
```

Two coupled defects produce it:

1. **Operator-stack `InstanceRef` defect (pre-existing, Feature 037 Phase 2
   residual).** In `stack-live.ts`, the catalog candidate resolver
   `catalogCandidates.listModels` (~:314) and the agent resolver
   `agentResolver.resolveAgents` (~:341) call `AppRuntime.runPromise(Effect.gen(...))`
   WITHOUT `.pipe(Effect.provideService(InstanceRef, instance))`. Every other seam in
   the same function binds it — the config seam at ~:176 and the domain seams at
   ~:624/640/653/667/680/696/714/727. `Provider.list()` and agent resolution are
   `InstanceState`-backed and every `InstanceState` read funnels through
   `InstanceState.context`, which `Effect.die("InstanceRef not provided")` when no
   `InstanceRef` is bound. So those two seams die on any CLI `op` invocation that
   reaches them. This has always broken `op routing test` and
   `op routing capability inspect`.

2. **Feature 038 regression.** Feature 038 wired catalog validation into `pools.set`
   (`backend-live.ts#validateAgainstCatalog` → the `catalog` validator → the stack's
   `catalogCandidates` seam). Because that seam is unbound (defect 1), validation
   always throws `InstanceRef not provided`; `validateAgainstCatalog` maps that thrown
   error to the `unavailable` PoolsError, and `planSet` treats `unavailable` as a
   FAILURE — so the mutation is rejected and `pools.set` can no longer persist via the
   CLI. Pre-038 (no validation) it succeeded.

The regression is total for the CLI write path: a fully valid `op pools set` cannot
persist at all, because a preflight validation that can never reach its catalog fails
the whole mutation.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — `op pools set` persists again

- As an operator, I want `op pools set` to persist my role-pool bindings from the CLI
  again, so the Feature 038 catalog preflight — which cannot consult the catalog on a
  freshly-invoked CLI process — never blocks a write it was only meant to sanity-check.

### P1 — Candidate and agent resolution succeed on the operator stack

- As an operator, I want `op routing test` and `op routing capability inspect` to
  resolve routing candidates and agents instead of crashing `InstanceRef not provided`,
  so the operator stack's catalog and agent seams work like every other seam in the
  same stack.

### P1 — A genuinely-unknown id is still rejected

- As an operator, I want `pools.set` to STILL reject a mistyped, genuinely-unknown
  model id when the catalog IS reachable and populated, naming the offender, so the
  Feature 038 safety net is preserved for the case it can actually observe.

### P2 — Best-effort validation degrades gracefully

- As an operator, I want a catalog outage OR a transiently-empty catalog (cold start /
  provider-reload race) to SKIP the preflight and let the write proceed, rather than
  failing the mutation, so validation is a best-effort guard that can only reject a
  positively-observed bad id, never block on its own unavailability.

## Functional Requirements

### Group A — bind InstanceRef on the two operator-stack seams (FR-A)

1. **FR-A1 — bind InstanceRef on the catalog candidate seam.**
   `catalogCandidates.listModels` MUST run its `AppRuntime.runPromise` effect with
   `.pipe(Effect.provideService(InstanceRef, instance))`, using the SAME `instance`
   captured for the config seam, so `Provider.list()` resolves instead of dying
   `InstanceRef not provided`.

2. **FR-A2 — bind InstanceRef on the agent resolver seam.** `agentResolver.resolveAgents`
   MUST likewise bind `InstanceRef` on its `AppRuntime.runPromise` effect, so
   `Agent.listSpecialists()` resolves.

3. **FR-A3 — mirror the existing bound seams exactly.** Both additions MUST be the
   minimal one-line pipe used verbatim by the config seam (~:176) and the domain seams
   in the same function — same `InstanceRef` identifier, same in-scope `instance`. No
   other behavior of either seam changes.

### Group B — best-effort `pools.set` validation (FR-B)

4. **FR-B1 — a catalog that cannot be consulted is NON-FATAL.** `pools.set` validation
   MUST SKIP and let the write PERSIST when the catalog cannot be consulted — a thrown
   resolver error (an `InstanceRef`/outage failure) OR a transiently-empty provider
   catalog (a successful but empty `Provider.list()` at cold start / a reload race).
   The mutation MUST NOT fail `unavailable` in either case.

5. **FR-B2 — a reachable, populated catalog still rejects an absent id.** When the
   catalog IS reachable and populated and it positively reports a role-pool model id as
   `not_found_in_catalog`, `pools.set` MUST STILL reject with `invalid_argument`,
   naming the offender (unchanged Feature 038 behavior for the observable case).

6. **FR-B3 — one clear distinction: unreachable/empty (skip) vs reachable-absent
   (reject).** The write path MUST only reject on a positively-returned non-empty
   unknown-id list; ANY thrown validator error (including the empty-catalog signal)
   MUST recover to skip-and-proceed. The empty-catalog signal (Feature 038 threw from
   `createCatalogModelValidator.unknownModelIds` to mean "cannot validate") MUST now
   lead to skip-and-proceed, not a failed write.

7. **FR-B4 — preserve every other pools.set semantic.** Best-effort validation MUST NOT
   change the structural binding checks, the CAS/scope/idempotency behavior (Features
   033/034/035), the principal authorization gate, or `planReset` (which still bypasses
   validation). A catalog-less backend construction still skips validation (pre-038
   behavior). Feature 037's session resolver and Feature 038's resolution precedence
   (bare-first, provider-strip) are untouched.

## Non-Functional Requirements

- **Minimal, mirrored seam fix.** The two `InstanceRef` binds are one line each, copied
  verbatim from the already-bound seams in the same function; nothing else in
  `stack-live.ts` changes.
- **Best-effort, not weaker.** The reject path for a positively-observed unknown id
  under a reachable populated catalog is unchanged; only the "cannot consult the
  catalog" case flips from FAIL to SKIP. Validation can still reject — it just can no
  longer block a write on its own unavailability.
- **Zero regression for the reachable case.** With a reachable, populated catalog, both
  the accept path (a resolvable id) and the reject path (a genuinely-unknown id) are
  byte-for-byte identical to Feature 038.
- **No new I/O or hot-path cost.** Binding `InstanceRef` adds no work; the validation
  degrade is pure control flow over the same single catalog read `pools.set` already
  performs.

## Security Requirements

- **Data sensitivity/classification.** This feature reads operator configuration
  metadata (role-pool model ids) and the live provider catalog (model ids + provider
  ids + status), and resolves the agent specialist registry (agent names). No
  credential, secret, or payload is read, written, logged, or surfaced. Binding
  `InstanceRef` provides the already-loaded, non-sensitive project instance context to
  the two seams; it exposes nothing new across any boundary.
- **Authentication/authorization.** No new authenticated surface or permission
  boundary. `pools.set` keeps its existing principal check (only `operator`/`system`
  may mutate); the best-effort change runs AFTER that gate and only relaxes when a
  write may proceed absent a reachable catalog — it never widens who may write or what
  authority is targeted.
- **Input validation.** The untrusted input is the operator-supplied role-pool model
  id. When the catalog is reachable and populated it is still bounded exactly as in
  Feature 038 (accepted only if it resolves; otherwise rejected by name). When the
  catalog cannot be consulted, the id is written unvalidated — a best-effort, non-fatal
  degrade consistent with a preflight sanity check, not a security control (the routing
  engine independently ignores an unresolvable id at routing time).
- **Cryptography in transit/at rest.** Not applicable — this feature moves and persists
  no secret and adds no network I/O beyond the catalog/agent reads the operator stack
  already performs.
- **Logging/audit.** No new logging. The existing bounded, secret-free `pools` operator
  audit event (which never carries a model id or payload) is unchanged. A skipped
  validation persists the write and audits as a normal successful mutation; a rejected
  write audits `invalid` exactly as in Feature 038.
- **Error-handling information exposure.** The reject message contains only the
  operator's own offending model id and a fixed explanation — no catalog dump, no
  provider list, no credential, no internal path. The removed failure path previously
  surfaced a raw `InstanceRef not provided` cause string to the CLI; skipping validation
  eliminates that leak on the CLI write path.

## Acceptance Scenarios

Given the operator stack composes the catalog candidate seam and the agent resolver
seam over `AppRuntime`, with the project `instance` already loaded

- **Catalog/agent resolution binds InstanceRef (FR-A1, FR-A2, FR-A3).**
  Given the seam effect that reads an `InstanceState`-backed value the way
  `Provider.list()` / `Agent.listSpecialists()` do,
  When it runs WITHOUT `Effect.provideService(InstanceRef, instance)`,
  Then it dies `InstanceRef not provided`; and when it runs WITH the bind,
  Then it resolves — the exact one-line fix the two seams now apply.

- **`pools.set` persists when validation throws (FR-B1, FR-B3).**
  Given a catalog validator that throws (an `InstanceRef`/outage failure),
  When `pools.set` is planned,
  Then validation is skipped and the write proceeds — NOT `unavailable`, NOT
  `invalid_argument` — and the binding is installed.

- **`pools.set` persists when the catalog is transiently empty (FR-B1, FR-B3).**
  Given a validator over a successful-but-empty catalog,
  When `pools.set` is planned with a valid id,
  Then validation is skipped and the write persists (no `unavailable` failure).

- **`pools.set` still rejects a genuinely-unknown id (FR-B2).**
  Given a reachable, populated catalog and `pools.set` with a mistyped id that resolves
  `not_found_in_catalog`,
  When the write is planned,
  Then it fails with `invalid_argument` naming the offender and persists nothing.

## Observability

This feature adds no new metrics, log events, or trace spans. The behavioral change is
confined to (1) the two operator-stack seams now binding `InstanceRef` so
candidate/agent resolution succeeds, and (2) `pools.set` treating an
unreachable/empty catalog as skip-and-persist rather than an `unavailable` failure. The
existing routing decision record (Feature 001, redacted) and the bounded `pools`
operator audit event are unchanged. Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

```
createLiveOperatorStack (stack-live.ts)
  instance = InstanceRuntime.load({ directory })
  config seam         AppRuntime.runPromise(... .pipe(provideService(InstanceRef, instance)))  (existing)
  catalogCandidates.listModels                                                    (FR-A1)
        AppRuntime.runPromise(Provider.list() ...
          .pipe(provideService(InstanceRef, instance)))   <- ADDED
  agentResolver.resolveAgents                                                     (FR-A2)
        AppRuntime.runPromise(Agent.listSpecialists() ...
          .pipe(provideService(InstanceRef, instance)))   <- ADDED
        |
        v
pools.set (backend-live.ts#planSet)                                              (FR-B)
  firstBindingDefect(bindings)                    structural check (unchanged)
  validateAgainstCatalog(bindings):
     catalog === undefined -> skip                 (pre-038, unchanged)          (FR-B4)
     unknownModelIds(ids) THROWS (unreachable/empty) -> orElseSucceed([]) -> skip (FR-B1,B3)
     unknownModelIds(ids) returns non-empty (reachable+absent) -> invalid_argument (FR-B2)
  planWrite(...)                                   unchanged CAS/scope/idempotency (FR-B4)
```

## Out of Scope

- **The Feature 037 session seam** (`session/routing-resolve.ts`, `session/prompt.ts`)
  — it already resolves on a request-`InstanceRef`-bound context and is untouched.
- **Feature 038 candidate resolution** (bare-first, single known-provider prefix strip)
  — unchanged; this feature only binds the seam it runs on and relaxes the write-time
  degrade.
- **The scope/authority/CAS machinery** (Features 033/034/035) — unchanged.
- **A UI/TUI affordance** for role-pool ids — out of scope.

## Related Features and Decisions

- [ADR-0039 — Fix a regression and the underlying operator-stack InstanceRef defect](../../adr/0039-fix-a-regression-and-the-underlying-operator-stack.md)
- [Feature 001 — Define one cohesive Smart Agent Routing and OpenTelemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the routing engine and the catalog candidate-resolution seam this feature binds.
- [Feature 007 — Add a unified native operator control plane for all opencode](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — the operator control plane and command registry whose live stack composes these seams.
- [Feature 037 — Wire the operator Smart Routing engine into the live session](../037-wire-the-operator-smart-routing-engine-into-the-live-session/spec.md) — deferred the operator-stack `InstanceRef` candidate-resolver defect (`stack-live.ts:314/341`) as a Phase 2 residual; this feature resolves it.
- [Feature 038 — Make operator role pools accept the standard provider-qualified id](../038-make-operator-role-pools-accept-the-standard-provider/spec.md) — the `pools.set` catalog validation this feature makes best-effort so it never blocks a write it cannot validate.

## Clarifications

### Session 2026-07-21

- **The two seams bind InstanceRef exactly like every other seam (FR-A).** The catalog
  and agent seams were the only two in `createLiveOperatorStack` that omitted the
  `.pipe(Effect.provideService(InstanceRef, instance))` the config and domain seams
  all carry; the fix is that one line on each, verbatim.
- **Validation is best-effort: it may reject, never block (FR-B).** A catalog that
  cannot be consulted (a thrown resolver error OR a transiently-empty read) skips
  validation and lets the write persist. Only a reachable, populated catalog that
  positively reports an id absent rejects `invalid_argument`.
- **The empty-catalog signal now means skip, not fail (FR-B3).** Feature 038 threw from
  `unknownModelIds` for the empty case to mean "cannot validate"; that throw now
  recovers to skip-and-proceed, the SAME outcome as a thrown outage — reconciling the
  two "cannot consult" signals into one non-fatal path.
- **Reachable-catalog behavior is unchanged (FR-B2, FR-B4).** With a populated catalog,
  accept and reject are byte-for-byte identical to Feature 038; CAS/scope/idempotency,
  `planReset`, and the Feature 037/038 resolution are untouched.
