---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0024 — Implement Routing Configure Persistence So Operator Routing

## Context and Problem Statement

`routing.configure` is the ONE config-backed operator command that never persists. Its
inbound adapter hardcoded
`fail("not_implemented", "routing.configure persists via Config.Service …")`
(`packages/opencode/src/routing/adapters/inbound/routing-command-port.ts:133-136`,
pre-024) — so the TUI "Routing configure" **Save** surfaced a RED warning and the
operator **could not activate routing**. A trace (2026-07-20, every `file:line`
verified) isolated the cause and the fix:

- Every sibling routing verb already persists through the Feature 007 `mutateAuthority`
  CAS pipeline over the shared `routing` Config authority: `smart.*` flips `activation`
  (`smart/backend-live.ts`), `pools.set` writes `role_pools`
  (`pools/backend-live.ts:44`, `PROJECT_AUTHORITY = "routing"`).
- The persisting **writer** for routing config already existed but was **orphaned**:
  `RoutingConfigPort.set()`
  (`packages/opencode/src/routing/adapters/outbound/config-adapter.ts:130-145`) CAS-writes
  the routing document to `AUTHORITY[scope]` (`routing` project / `global:routing`
  global). Yet `createRoutingDomainPort` was given only a READ source
  (`toRoutingConfigSource`, `config-adapter.ts:155`) at the composition root
  (`stack-live.ts:813`, pre-024) — no write-capable backend.
- The operator dispatch commits EXCLUSIVELY through the single `mutateAuthority` CAS
  write (`mutation.ts:277-296`); `smart`/`pools` reach it by returning an
  `OperatorMutationPlan`, never by self-committing via `.set()`.
- The `routing` document is **shared** by three writers (`pools.set`, `smart.*`,
  `routing.configure`). `mutateAuthority.apply(current, …)` receives the FRESH persisted
  payload at commit time (`mutation.ts:224,277`), so a merge into `current` preserves
  siblings even under a concurrent write.

The question: how to make `routing.configure` persist — mirroring the `smart`/`pools`
mutation-plan pattern — **without** self-committing, opening a parallel store, weakening
the single-committed-CAS-write guard, or clobbering the `role_pools`/`activation` that
share the same document.

## Decision Drivers

- **Mirror the proven pattern.** `routing.configure` must persist exactly as
  `smart`/`pools` do — read effective via `createConfigAdapter`, return an
  `OperatorMutationPlan`, commit through the single `mutateAuthority` CAS write — not a
  bespoke path.
- **Never clobber a shared document.** `routing.configure`, `pools.set`, and `smart.*`
  all write the same `routing` document; the configure write must partial-merge and
  preserve the others' fields.
- **Preserve the single-committed-CAS-write / optimistic-concurrency guard.** No
  self-commit, no auto-resolved token; a stale expected-version stays a `CAS version
  conflict`.
- **Typed validation, not `not_implemented`.** An invalid advanced policy JSON / schema
  violation must be a typed `invalid_argument` that commits nothing.
- **Zero contract surface.** No operator payload, command id, catalog version, dispatch
  path, or feature flag change; `routing.configure` was already `mutates: true`
  (`packages/core/src/operator/catalog.ts:83`).

## Considered Options

- **Option A — Wire a write-capable configure backend that mirrors smart/pools, return
  an `OperatorMutationPlan`, and partial-merge the configure fields into the fresh
  persisted document under CAS (chosen).** `createRoutingConfigureBackend` reads
  effective via `createConfigAdapter` and validates the patched `RoutingConfig.Info` at
  plan time; the plan's `apply(current)` merges only `activation.enabled`/`mode` +
  `enforcement.budget` into the fresh on-disk payload, preserving `role_pools` +
  sibling activation. The dispatcher commits via the single `mutateAuthority` CAS write.
- **Option B — Call `RoutingConfigPort.set()` directly from the inbound adapter.**
  Rejected: it self-commits outside the `mutateAuthority` pipeline, bypassing the
  idempotency claim, the single-committed-CAS-write contract, and the Feature 007 audit —
  a second, parallel write path the whole operator plane was designed to forbid.
- **Option C — Merge from a plan-time snapshot (the effective config read at plan time)
  rather than from `apply(current)`.** Rejected as weaker: a sibling committed between
  plan-read and CAS would be clobbered by the stale snapshot. `apply(current)` merges
  into the FRESH payload, so a concurrent `pools.set`/`smart.*` is preserved (CAS still
  rejects a genuine version conflict).
- **Option D — Open a parallel routing config store for `routing.configure`.** Rejected:
  it duplicates the Config.Service authority the routing family already shares and would
  drift from `smart`/`pools`/`budget`; the spec mandates one store.
- **Option E — Leave `routing.configure` as `not_implemented` and document a CLI-only
  path.** Rejected: it does not fix the reproduced "cannot activate routing" — the
  operator surface must persist the Save.

## Decision Outcome

Chosen option: **Option A**, because it makes `routing.configure` persist through the
exact `smart`/`pools` mutation-plan contract — one committed CAS write, no self-commit,
no parallel store — while partial-merging into the shared `routing` document so it never
clobbers `role_pools`/`activation`, and rejecting an invalid policy as a typed
validation error.

Key decisions recorded:

1. **A write-capable configure backend (FR-A).** `createRoutingConfigureBackend({ config })`
   (`routing/adapters/outbound/configure-backend.ts`) reuses `createConfigAdapter` for
   reads and is wired into `createRoutingDomainPort(routingService, …)` at
   `stack-live.ts:818` over the SAME committed `store.config` seam smart/budget/pools use
   — no parallel store. The per-scope authority map is exported once from
   `config-adapter.ts` (`AUTHORITY`) as the routing-module SSOT.
2. **A real mutation-plan path, never `not_implemented` (FR-B).** The inbound adapter
   (`routing-command-port.ts:190`) parses `{ enabled, mode, ...advanced }`, validates
   `mode ∈ {always,auto,never}`, rejects an all-empty payload, and returns
   `{ kind: "mutation_plan", authority, apply }` via `runPlan`. `planConfigure` decodes
   the patched `RoutingConfig.Info` at plan time — a malformed advanced policy / schema
   violation is a typed `invalid_argument`, not `not_implemented`. A backend-less
   (read-only) port still answers `not_implemented`, the honest outcome.
3. **Partial-merge under CAS preserves siblings (FR-C).** `apply(current)` decodes the
   FRESH persisted payload and merges ONLY `activation.enabled`/`mode` +
   `enforcement.budget` into it, preserving `models.role_pools` (owned by `pools.set`)
   and sibling `activation` (owned by `smart.*`); on create-if-absent it falls back to
   the plan-validated document. `RoutingConfigPort.set()` stays a full-document CAS
   writer — the operator-dispatch merge lives in the plan's `apply`, matching how
   `pools`/`smart` coexist today.
4. **The single-committed-CAS-write contract is PRESERVED (FR-D).** The backend never
   self-commits; the Feature 007 `mutateAuthority` pipeline owns the ONE committed CAS
   write + audit (`mutation.ts:277-296`). A stale expected-version still returns `CAS
   version conflict`, and a rejected Save (invalid policy / conflict) surfaces a typed
   envelope to the TUI and commits nothing.
5. **The write authority follows the REQUEST scope, not the effective origin
   (FR-F, fix-round 2026-07-20).** `planConfigure` derives its write authority from the
   dispatcher-resolved request scope (`ctx.request.scope.kind` → `scopeForRequest`:
   `global` → `global:routing`, otherwise → project `routing`), threaded from the inbound
   adapter (`routing-command-port.ts`). This is the SAME resolution the mutation preflight
   uses (`command-authority.ts` — `case "routing": return SMART_AUTHORITY[norm(scopeKind)]`),
   so the preflight CAS-token authority and the committed authority can never diverge. The
   effective config is still read for the merge base/defaults, but the WRITE TARGET is the
   request scope — exactly as `pools.set` writes its fixed project `PROJECT_AUTHORITY`.
6. **Regression proof over the REAL wired dispatcher (FR-E).**
   `feature024-configure-persist.test.ts` drives the same live construction the TUI uses
   (smart + pools + routing over one `store.config`, production authority resolver
   threaded) and proves: (a) a Save on a FRESH (unseeded) project persists
   activation/mode/policy to the PROJECT `routing` authority (never `global:routing`) +
   bumps the version, and a second configure persists (no false `mutations require
   version`); (b) pools + smart + routing coexist with none clobbering the others in the
   on-disk `config.json` + a fresh re-read; (c) invalid policy → typed error, nothing
   committed; (d) stale version → conflict, nothing committed; (e) a global-resolved base
   with a project-scope configure still creates the PROJECT override and the second save
   succeeds. The prior masking precondition (`seedProjectRouting`, which forced
   origin=project so the two authorities coincided) was removed from the scenarios that
   must pass without it.
7. **No contract change (invariant).** No operator payload, command id, catalog version,
   dispatch path, server/port surface, or feature flag is added or altered; only the
   `routing.configure` handler body and its composition-root wiring change.

### Consequences

- Good: the operator can finally **activate and configure routing** from the TUI — the
  Save persists the Enabled toggle, the mode, and the advanced budget policy instead of
  returning a RED `not_implemented`.
- Good: `routing.configure` joins `smart`/`pools`/`budget` as one coherent
  mutation-plan pattern over the shared `routing` authority — one store, one committed
  CAS write, one audit; no drift.
- Good: the shared-authority partial-merge (over `apply(current)`) preserves `role_pools`
  and `activation` even under a concurrent write, proven by the on-disk coexistence
  round-trip — configuring one facet of routing never zeroes another.
- Good: zero contract surface and an unchanged CAS guard — no server, SDK, or catalog
  work, and lost-update protection is fully preserved.
- Good (fix-round 2026-07-20): the scope-alignment fix eliminated the original residual.
  The write authority is now derived from the REQUEST scope (`scopeForRequest`), so a
  first `routing.configure` on a wholly-unconfigured project targets the PROJECT `routing`
  authority (matching the preflight) instead of silently writing `global:routing` and
  failing the second Save with `invalid_argument` ("mutations require version"). Verified
  by an adversarial repro over the real wired dispatcher (fresh project, two consecutive
  project-scope Saves) and covered by scenarios (a)/(e) of the regression suite.
- Bad (documented boundary): only the `budgetPolicy` advanced-override key is mapped;
  other enforcement/model overrides in the advanced JSON are not yet routed and remain
  out of scope. A future feature can extend the mapping following the same plan `apply`.
- Bad (follow-up, out of scope here — Feature 025 candidate): `smart.*`
  (`smart/backend-live.ts`) and `budget.*` (`budget/backend-live.ts`) STILL derive their
  write authority from the effective-config origin (`scopeForOrigin(effective.origin)`),
  while their preflight authority is the request scope (`command-authority.ts`
  `case "smart"/"budget": SMART_AUTHORITY[norm(scopeKind)]`). This is the SAME latent
  divergence `routing.configure` just fixed: an adversarial repro (fresh project,
  `smart.on` then `smart.off`) confirmed SAVE#1 mis-writes `global:routing` and SAVE#2
  returns `invalid_argument`. It is deliberately NOT fixed in Feature 024 (scope
  boundary); the same request-scope derivation should be applied to `smart`/`budget` in a
  dedicated follow-up so their preflight and commit authorities align.

## Related

- Feature specification: [024 Implement routing configure persistence so operator routing](../sdd/024-implement-routing-configure-persistence-so-operator-routing/spec.md)
- The smart/pools backends this feature mirrors + `PROJECT_AUTHORITY = "routing"`: [Feature 013 Wire the four remaining config-backed operator domains](../sdd/013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md)
- The shared-`routing`-authority CAS-token / preflight invariants the coexistence proof reuses: [ADR-0021 Operator config-backed saves must persist reliably and never silently zero](0021-operator-config-backed-saves-must-persist-reliably-and-never.md)
- The routing config adapter + `RoutingConfig.Info` schema: [Feature 001 Smart Agent Routing and Telemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- The operator mutation-plan handler contract + `mutateAuthority` pipeline: [ADR-0017 Close the implementable operator capability gaps](0017-close-the-implementable-operator-capability-gaps-so-the.md)
- Mutation authority / CAS guard: [ADR-0003 Operator control plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Domain schema: [implement-routing-configure-persistence ValueObject](../schemas/implement-routing-configure-persistence-so-operator-routing.cue)
