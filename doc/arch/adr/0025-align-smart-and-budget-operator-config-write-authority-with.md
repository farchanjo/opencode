---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0025 — Align Smart And Budget Operator Config Write Authority With The Request Scope

## Context and Problem Statement

`smart.*` and `budget.*` are config-backed operator commands that share the per-scope
`routing` document with `pools.set` and `routing.configure`. Both mis-scoped their WRITE
authority: they derived it from where the effective config happens to resolve, NOT from
the request scope the mutation preflight/CAS token comes from. An adversarial repro
(2026-07-20, every `file:line` verified) over the REAL wired dispatcher isolated the
cause and the fix — this is the SAME class Feature 024 fixed for `routing.configure`
(ADR-0024 FR-F) and explicitly flagged as a Feature 025 candidate:

- **`smart` derived the write scope from the effective ORIGIN.**
  `smart/backend-live.ts` used `scopeForOrigin(effective.origin)`
  (`origin === "project" ? "project" : "global"`). On a FRESH project (no project
  routing doc) the effective origin is `default`/`global`, so SAVE#1 committed to
  `global:routing` while the preflight
  (`command-authority.ts` — `case "smart": SMART_AUTHORITY[norm(scope.scopeKind)]`,
  `norm` maps everything but "global" to "project") reported the project `routing`
  authority, version null. SAVE#2 then failed `invalid_argument` ("mutations require
  version (CAS token) when authority already exists") — the RED operator error.
- **`budget` passed an un-normalized scope straight through.**
  `budget-command-port.ts` set `scope = (payload.scope ?? ctx.request.scope.kind) as
  BudgetScope` with NO normalization, then wrote `AUTHORITY[toRoutingScope(scope)]`. A
  non-`global`/non-`project` scope kind resolved to an `undefined` authority, and a
  payload-supplied scope the preflight never sees diverged from the preflight's
  normalized authority.
- **The preflight is the SSOT and already correct.** `createOperatorAuthorityResolver`
  (`command-authority.ts`) resolves the committed authority from the domains' own
  exported `SMART_AUTHORITY`/`BUDGET_AUTHORITY` maps keyed by the NORMALIZED request
  scope. The backends must derive their write authority from the SAME request scope +
  map.
- **The write path is `mutateAuthority`; `apply` sees the FRESH payload.** Both domains
  return an `OperatorMutationPlan` the dispatcher commits via the single
  `mutateAuthority` CAS write (`mutation.ts:277-296`); neither self-commits. `apply`
  receives the fresh on-disk payload, so a merge into `current` preserves siblings even
  under a concurrent write.
- **telemetry does NOT diverge.** `telemetry/backend-live.ts` exports a single
  `AUTHORITY = "global:telemetry"` (global-only, no scope split, `apply` already merges
  into `current`); its preflight resolves the same constant. No change is warranted.

The question: how to make `smart.*`/`budget.*` commit to the authority their preflight
reports — mirroring the Feature 024 `routing.configure` fix — **without** self-committing,
opening a parallel store, weakening the single-committed-CAS-write guard, or clobbering
the `role_pools`/`activation`/`budget` that share the same document.

## Decision Drivers

- **Mirror the proven Feature 024 fix.** The request-scope derivation
  (`scopeForRequest`) + `apply(current)` merge already fixed the identical defect for
  `routing.configure`; apply it verbatim to smart/budget rather than inventing a new
  path.
- **Preflight and commit authority must never diverge.** The backend must resolve its
  write authority from the SAME request scope + shared `SMART_AUTHORITY`/`BUDGET_AUTHORITY`
  map the preflight uses — no re-typed table.
- **Never clobber a shared document.** smart, budget, pools, and routing.configure all
  write the same `routing` document; each write must partial-merge over the fresh payload
  and preserve the others' fields.
- **Preserve the single-committed-CAS-write / optimistic-concurrency guard.** No
  self-commit, no auto-resolved token; a stale expected-version stays a `CAS version
  conflict`. The budget hard ceiling is never silently relaxed.
- **Zero contract surface.** No operator payload, command id, catalog version, dispatch
  path, or feature flag change; `smart.on`/`budget.set` are already `mutates: true`.
- **Change only what diverges.** telemetry is global-only and correct; leave it
  untouched.

## Considered Options

- **Option A — Derive the smart/budget write authority from the request scope
  (`scopeForRequest`), threaded from the command ports, and harden the commit-time merge
  to `apply(current)` (chosen).** `smart/backend-live.ts` replaces
  `scopeForOrigin(effective.origin)` with `scopeForRequest(requestScopeKind)` and its
  `apply` merges only `activation` into the fresh payload; `budget-command-port.ts`
  normalizes `ctx.request.scope.kind` to the closed `{global, project}` set and
  `budget/backend-live.ts`'s `planWrite` re-runs its budget-only transform over
  `current`. Both resolve the authority through the SAME exported map the preflight
  consumes.
- **Option B — Keep the origin/payload derivation and re-seed the project routing doc in
  the client before the first Save (a mask).** Rejected: it hides the divergence behind a
  precondition instead of fixing it, and any path that does not pre-seed still fails. The
  committed test for Feature 024 removed exactly this mask (`seedProjectRouting`).
- **Option C — Call `RoutingConfigPort.set()` directly / self-commit from the backend.**
  Rejected: it self-commits outside `mutateAuthority`, bypassing the idempotency claim,
  the single-committed-CAS-write contract, and the Feature 007 audit.
- **Option D — Merge from a plan-time snapshot rather than `apply(current)`.** Rejected as
  weaker: a sibling committed between plan-read and CAS would be clobbered by the stale
  snapshot. `apply(current)` merges into the FRESH payload; CAS still rejects a genuine
  version conflict.
- **Option E — Also "fix" telemetry for symmetry.** Rejected: telemetry is global-only
  with no scope split and no divergence; changing it would add risk with no benefit.

## Decision Outcome

Chosen option: **Option A**, because it makes `smart.*`/`budget.*` commit to the exact
authority their mutation preflight reports for the request scope — one committed CAS
write, no self-commit, no parallel store — while partial-merging into the shared
`routing` document so a Save never clobbers `role_pools`/`activation`/`budget`, and it
mirrors the Feature 024 `routing.configure` fix verbatim.

Key decisions recorded:

1. **smart write authority follows the REQUEST scope (FR-A).** `smart/backend-live.ts`
   replaces `scopeForOrigin(effective.origin)` with
   `scopeForRequest(scopeKind) = scopeKind === "global" ? "global" : "project"`, threaded
   from `smart-command-port.ts` (`ctx.request.scope.kind` into
   `resolve`/`planOn`/`planOff`/`planAuto`, and through the `SmartBackend` interface). It
   resolves `AUTHORITY[scope]` — the SAME map `command-authority.ts` imports as
   `SMART_AUTHORITY`. The effective config is still read for the summary + merge
   base/defaults; only the WRITE TARGET moved.
2. **budget write authority follows the REQUEST scope, normalized (FR-B).**
   `budget-command-port.ts` derives `scope: BudgetScope =
   ctx.request.scope.kind === "global" ? "global" : "project"` — the SAME normalization
   the preflight uses — instead of passing a payload-or-request scope through
   un-normalized. `budget/backend-live.ts` continues to write
   `AUTHORITY[toRoutingScope(scope)]` (the `BUDGET_AUTHORITY` map). No backend signature
   change was needed for budget (scope already travels in `BudgetSetInput.scope`).
3. **Partial-merge under CAS preserves siblings (FR-C).** `smart` `planMutate`'s `apply`
   now decodes the FRESH persisted payload and merges ONLY the activation transform into
   it (it no longer returns a plan-time whole-config snapshot); `budget` `planWrite` takes
   the budget-only transform and re-runs it over the fresh payload, both falling back to
   the plan-validated document on create-if-absent. `models.role_pools` (pools.set) and
   sibling `activation`/`enforcement.budget` are never clobbered — matching how
   `routing.configure` merges (Feature 024 FR-C).
4. **The single-committed-CAS-write contract is PRESERVED (FR-D).** Neither backend
   self-commits; `mutateAuthority` owns the ONE committed CAS write + audit. A stale
   expected-version still returns `CAS version conflict`; an above-ceiling / malformed
   budget is a typed `invalid_argument` that commits nothing; a config outage degrades to
   `unavailable`. The budget hard ceiling is never silently relaxed.
5. **telemetry is confirmed global-only and unchanged (FR-E).**
   `telemetry/backend-live.ts` exports `AUTHORITY = "global:telemetry"` (no per-scope
   split, `apply` already merges into `current`); `command-authority.ts`
   `case "telemetry": return TELEMETRY_AUTHORITY` resolves the same constant. There is no
   request/origin divergence; telemetry is left untouched.
6. **Regression proof over the REAL wired dispatcher (FR-F).**
   `feature025-smart-budget-scope.test.ts` drives the same live construction the TUI uses
   (smart + budget + pools + routing over one `store.config`, production authority
   resolver threaded, NO masking seed) and proves: (a) `smart.on` then `smart.off` on a
   FRESH project both persist to the PROJECT `routing` authority + bump the version;
   (b) `budget.set` twice on a FRESH project both persist to the PROJECT authority;
   (c) a global-scope smart/budget Save writes `global:routing`; (d) pools + smart +
   budget + routing.configure coexist with none clobbering the others in the on-disk
   `config.json` + a fresh re-read; (e) invalid budget → typed error, nothing committed;
   (f) stale version → conflict, nothing committed.
7. **No contract change (invariant).** No operator payload, command id, catalog version,
   dispatch path, server/port surface, or feature flag is added or altered; only the
   `smart`/`budget` backend + command-port bodies and the `SmartBackend` interface change.

### Consequences

- Good: an operator can finally enable Smart Routing and set a budget on a FRESH project
  — the first Save and every subsequent Save persist to the project routing config
  instead of mis-writing `global:routing` and failing the second Save with
  `invalid_argument`.
- Good: `smart.*`/`budget.*` join `pools.set`/`routing.configure` as one coherent
  request-scope-aligned mutation-plan pattern over the shared `routing` authority — the
  preflight CAS token and the committed authority always match.
- Good: the shared-authority partial-merge (over `apply(current)`) preserves
  `role_pools`, `activation`, and `budget` even under a concurrent write, proven by the
  on-disk full-coexistence round-trip.
- Good: zero contract surface and an unchanged CAS guard — no server, SDK, or catalog
  work, and lost-update protection is fully preserved.
- Good: the Feature 024 residual (ADR-0024 consequences, "Feature 025 candidate") is now
  closed; the origin-vs-request divergence no longer exists in any config-backed routing
  writer.
- Neutral (documented): `telemetry.*` is intentionally NOT changed — it is global-only
  and already correct (FR-E); the audit confirmed no divergence.

## Related

- Feature specification: [025 Align smart and budget operator config write authority with the request scope](../sdd/025-align-smart-and-budget-operator-config-write-authority-with/spec.md)
- The `routing.configure` request-scope fix this feature mirrors + the flagged Feature 025 candidate: [ADR-0024 Implement routing configure persistence so operator routing](0024-implement-routing-configure-persistence-so-operator-routing.md)
- The smart/budget backends + their `AUTHORITY` maps + budget hard ceiling: [Feature 013 Wire the four remaining config-backed operator domains](../sdd/013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md)
- The shared-`routing`-authority CAS-token / preflight invariants + `command-authority.ts` SSOT: [ADR-0021 Operator config-backed saves must persist reliably and never silently zero](0021-operator-config-backed-saves-must-persist-reliably-and-never.md)
- The operator mutation-plan handler contract + `mutateAuthority` pipeline: [ADR-0017 Close the implementable operator capability gaps](0017-close-the-implementable-operator-capability-gaps-so-the.md)
- Mutation authority / CAS guard: [ADR-0003 Operator control plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
