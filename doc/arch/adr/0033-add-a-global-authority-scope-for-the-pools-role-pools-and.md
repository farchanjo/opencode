---
status: proposed
date: 2026-07-20
deciders: [project maintainers]
consulted: []
informed: []
---

# 0033 — Add A Global Authority Scope For The Pools (role_pools) Operator Config

## Context and Problem Statement

A coherent Smart Routing config — `models.role_pools` (role→model bindings), `activation`,
and `enforcement.budget` — lives on ONE routing document persisted under a per-scope Config
authority (`routing` for project scope, `global:routing` for global scope). Three of the
four writers of that document already honor the request scope: `routing.configure` (Feature
024), `smart.*`, and `budget.*` (Feature 025) each write `global:routing` under a
global-scope request and `routing` under a project-scope request, so an operator can
configure them globally.

`pools.*` (role_pools) did NOT. Its write authority was HARDWIRED to the project authority:

```
// pools/backend-live.ts (before)
export const PROJECT_AUTHORITY = "routing"
...
const readProject = () => deps.config.get(PROJECT_AUTHORITY)        // project only
return { authority: PROJECT_AUTHORITY, apply: () => payload }        // project only
```

and the mutation preflight was hardwired too — `command-authority.ts`
`staticAuthorityForCommandId` mapped `case "pools": return POOLS_AUTHORITY` (the project
`routing` constant) and the wired resolver short-circuited on that static value, so the
preflight reported the PROJECT authority for pools even under a global request.

The consequence: `role_pools`/`decision_model`/`fallback` could only ever be bound
per-project. Because a coherent config lives on one document, the project-only pools dragged
the whole Smart Routing config to a per-directory binding — an operator could not set role
pools once, globally, to govern every project. The catalog already granted `pools.*` the
Global+Project (`GP`) scope set and the CLI/slash/TUI already resolved pools to global scope
when no project was bound; only the pools backend and its preflight ignored that scope.

The question: how to widen the pools persistence scope to follow the request scope — so a
global-scope `pools.set` persists `role_pools` to `global:routing` while a project-scope
write keeps targeting `routing` — WITHOUT changing the routing engine or the `RoutingConfig`
schema, without a parallel config store, without breaking the preflight/CAS lockstep, and
without regressing the project-only default that every existing caller and test depends on.

## Decision Drivers

- **One global config governs every project.** A global-scope `pools.set` must persist
  `role_pools` to `global:routing` so a single configuration governs Smart Routing in every
  project, while a project can still override.
- **Mirror the Feature 024/025 request-scope model.** The fix must reuse the SAME
  request-scope derivation and shared routing `AUTHORITY` SSOT `smart`/`budget` use — no
  re-typed authority table, no new mechanism.
- **Preflight/CAS lockstep.** The committed authority must match the authority the mutation
  preflight reports for the request scope, so the CAS token the client threads matches where
  the write lands and a second global Save never fails "mutations require version".
- **No clobber on the shared document.** A pools Save must preserve `activation` (smart) and
  `enforcement.budget` (budget) on the shared routing document — the `apply(current)`
  read-modify-write, not a plan-time snapshot.
- **Project-over-global precedence, unchanged read.** The effective read must keep project
  document > global document > default (Feature 001/024 document-shadowing); a global config
  governs projects without their own document, a project document shadows the global one.
- **Zero default drift.** With no scope selector, `pools.set` must write the project
  `routing` authority exactly as before; the change is strictly additive.
- **No routing-engine / schema change.** Only the persistence scope of `pools.*` widens; the
  `role_pools`/`decision_model`/`fallback` shapes and the routing engine are untouched.

## Considered Options

- **Option A — Derive the pools write authority from the request scope via the shared
  routing SSOT, and resolve pools scope-dependently in the preflight (chosen).**
  `pools/backend-live.ts` gains a per-scope `AUTHORITY` map (mirroring
  `SmartBackendLive.AUTHORITY`) and a `scopeForRequest(kind)` (default `project`); the
  command port threads `ctx.request.scope.kind` into resolve/validate/planSet/planReset;
  `command-authority.ts`'s wired resolver resolves `pools.*` to `SMART_AUTHORITY[norm(kind)]`
  while `staticAuthorityForCommandId` keeps pools' PROJECT default for the degraded fallback.
  The plan's `apply` merges `models.role_pools` into the FRESH `current` payload. This is the
  exact shape Feature 025 established for smart/budget.
- **Option B — Add a separate global-pools store/authority distinct from the routing
  document.** Rejected: a coherent Smart Routing config lives on ONE document; splitting
  role_pools onto a parallel authority would fracture the config, duplicate the CAS/merge
  machinery, and break the shared-document coexistence Feature 024/025 rely on.
- **Option C — Keep the hardwired project authority and re-seed a global doc from the
  client.** Rejected as a mask: it re-introduces the origin/scope divergence Feature 025
  removed, and a client-side seed is precisely the anti-pattern that ADR-0025 rejected.
- **Option D — Make `resolveEffective` deep-merge role_pools per role across scopes.**
  Rejected and out of scope: the effective read is document-shadowing by design (Feature
  001/024); a deep per-role merge would change routing merge semantics and the engine's view
  of the config. Document-shadowing already gives project-over-global precedence; only the
  WRITE scope needed widening.
- **Option E — Self-commit the pools write in the backend.** Rejected: it violates the
  single-committed-CAS-write contract; `mutateAuthority` owns the one write + audit, and the
  backend returns an `OperatorMutationPlan`.

## Decision Outcome

Chosen option: **Option A**, because deriving the pools write authority from the request
scope through the shared routing `AUTHORITY` SSOT — and resolving pools scope-dependently in
the preflight while keeping its PROJECT-default static entry for the degraded fallback —
widens the persistence scope with the minimal, proven Feature 025 mechanism: it keeps the
preflight and the committed authority in lockstep, preserves the project-only default, leaves
the routing engine / schema / effective-read precedence untouched, and — because the plan's
`apply(current)` merges only `models.role_pools` into the fresh persisted document — never
clobbers a sibling writer on the shared routing document.

Key decisions recorded:

1. **Pools write authority follows the REQUEST scope (FR-A).** `pools/backend-live.ts`
   replaces the constant `PROJECT_AUTHORITY` write target with
   `AUTHORITY[scopeForRequest(requestScopeKind)]` (`global` → `global:routing`, else project
   `routing`). `scopeForRequest` defaults to `project` and `requestScopeKind` is optional on
   the `PoolsBackend` methods, so an omitting caller keeps the pre-feature behavior.
   `readProject` becomes `readScoped(scope)`, reading the CAS base from the scope the write
   targets. `PROJECT_AUTHORITY` remains exported as the project entry for the degraded
   fallback.
2. **The preflight resolves pools scope-dependently, with a project-default static entry
   (FR-B).** `command-authority.ts`'s wired `createOperatorAuthorityResolver` no longer
   short-circuits on the static value for pools; it resolves `case "pools":
   SMART_AUTHORITY[norm(scope.scopeKind)]` (the SAME routing map smart/routing use).
   `staticAuthorityForCommandId` keeps `case "pools": POOLS_AUTHORITY` so the degraded
   `config-status.ts:authorityKeyForCommandId` fallback still resolves `pools.set →
   "routing"` (Feature 021), never the bare prefix `"pools"`. The preflight and the committed
   authority thus track the same request scope.
3. **Command port threads the request scope (FR-A).** `pools-command-port.ts` passes
   `ctx.request.scope.kind` into `resolve`/`validate`/`planSet`/`planReset`, exactly as
   `smart-command-port.ts` does.
4. **Shared-document partial merge under CAS (FR-C).** The plan's `apply(current)`
   read-modify-writes only `models.role_pools` into the FRESH persisted payload
   `mutateAuthority` threads in, preserving `activation` (smart/routing.configure) and
   `enforcement.budget` (budget/routing.configure); on create-if-absent it falls back to the
   plan-validated document. This replaces the pre-fix plan-time snapshot (`apply: () =>
   payload`).
5. **Read/merge precedence unchanged (FR-D).** `config-adapter.resolveEffective` keeps
   document-shadowing (project doc > global doc > default). A global role pool governs a
   project with no project document; a project role pool for the same role shadows the global
   one. No routing engine, `RoutingConfig` schema, or merge-semantics change.
6. **CLI/TUI scope selection was already generic (FR-F).** No CLI flag, TUI form field,
   descriptor, or catalog scope entry changed. `pools.*` already carried the `GP` scope set,
   and `resolveCliScope`/`resolveScopeForCommandId` already resolved pools scope from the
   ambient `projectId`/`--project`, the SAME path `routing.configure` rides. The fix makes the
   pools backend honor the resolved scope.
7. **Regression test over the REAL wired stack (load-bearing).**
   `packages/opencode/test/operator/feature033-pools-global-scope.test.ts` drives the SAME
   live dispatcher construction the TUI uses (pools + smart + budget + routing over one
   shared `store.config`, production authority resolver threaded) and proves: a global-scope
   `pools.set` persists to `global:routing` (project `routing` absent); a project-scope
   `pools.set` still writes `routing` (global absent); a global role pool governs a project
   with no project document; a project role pool shadows the global one for the same role
   (both persisted); and two consecutive global-scope `pools.set` both succeed under CAS
   (preflight authority `global:routing`, version bumps).

### Consequences

- Good: an operator can bind `role_pools` once, globally, and one configuration governs Smart
  Routing in every project — the feature's reason to exist.
- Good: a project can still override the global role pools; project-over-global precedence is
  preserved by the unchanged document-shadowing read.
- Good: the preflight and committed authority stay in lockstep across scopes, so a second
  global-scope Save never fails the RED "mutations require version" error — the SAME class
  Feature 024/025 fixed, now closed for pools.
- Good: the `apply(current)` merge makes a pools Save coexist with smart/budget/routing.configure
  on the shared routing document — no writer clobbers another.
- Good: strictly additive — with no scope selector, `pools.set` writes the project `routing`
  authority byte-for-byte as before; every existing pools test stays green (one unit-test
  assertion that had hardcoded a global-scope request while expecting the old project authority
  was corrected to expect `global:routing`).
- Neutral: the pools backend now carries a per-scope `AUTHORITY` map and a `scopeForRequest`
  helper, converging its shape with `smart`/`budget` (less special-casing, one consistent
  pattern across the routing-document writers).
- Residual (accepted): the effective read remains document-shadowing, not a deep per-role
  merge — a project routing document shadows the global one WHOLESALE, so a project that
  writes ANY project routing document no longer inherits the global `role_pools` for roles it
  did not itself define. This is the established Feature 001/024 behavior and out of scope
  here; introducing per-role inheritance would change routing merge semantics and is
  deliberately not undertaken.

## Related

- Feature specification: [033 Add a global authority scope for the pools (role_pools) operator config](../sdd/033-add-a-global-authority-scope-for-the-pools-role-pools-and/spec.md)
- The request-scope write-authority pattern this mirrors: [025 Align smart and budget operator config write authority with the request scope](../sdd/025-align-smart-and-budget-operator-config-write-authority-with/spec.md)
- The original shared-`routing`-document persistence + `apply(current)` merge: [024 Implement routing configure persistence so operator routing](../sdd/024-implement-routing-configure-persistence-so-operator-routing/spec.md)
- The `command-authority.ts` SSOT + degraded `pools.set → "routing"` fallback preserved: [021 Operator config-backed saves must persist reliably and never silently zero](../sdd/021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md)
- The profile-global config store the global write persists into: [030 Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../sdd/030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md)
- The project-profile wholesale vs global deep-merge write the pools write inherits: [032 Operator config writes must persist only the project owned](../sdd/032-operator-config-writes-must-persist-only-the-project-owned/spec.md)
