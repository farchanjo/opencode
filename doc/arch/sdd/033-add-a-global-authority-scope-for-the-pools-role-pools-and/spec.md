---
id: 019f814b-e01a-7683-9f5e-6abfcdd364b7
number: 033
slug: add-a-global-authority-scope-for-the-pools-role-pools-and
status: analyzed
created_at: 2026-07-20T20:51:01.27446Z
---
# Feature Specification: Add A Global Authority Scope For The Pools (role_pools) Operator Config

Feature: 033-add-a-global-authority-scope-for-the-pools-role-pools-and
Created: 2026-07-20
Scope: `pools.*` (role_pools) is one of four writers that share the per-scope `routing`
document with `smart.*`, `budget.*`, and `routing.configure`. Unlike the other three,
`pools.set`/`pools.reset` were HARDWIRED to the PROJECT authority: `pools/backend-live.ts`
returned the constant `PROJECT_AUTHORITY = "routing"` for every write, and
`command-authority.ts` mapped `pools.*` statically to the project authority regardless of
the request scope. So `role_pools`/`decision_model`/`fallback` could only ever be
per-project, even though the catalog already granted `pools.*` the Global+Project (`GP`)
scope set and `smart`/`budget`/`routing.configure` already honored global scope
(Feature 024/025). Because a coherent Smart Routing config (role_pools + activation +
budget) lives on ONE routing document, the project-only pools dragged the whole config to
a per-directory binding. This feature widens the pools write authority to follow the
REQUEST scope — `global` → `global:routing`, `project` → `routing` — mirroring the exact
request-scope derivation `smart`/`budget` use, so ONE global config can govern every
project while a project can still override. No new command id, no catalog bump, no
parallel config store, no change to the routing engine or the `RoutingConfig` schema.

## Audit result (grounding — every anchor verified 2026-07-20)

- **Only `pools` was hardwired.** `smart/backend-live.ts` and `budget/backend-live.ts`
  already derive their write authority from the request scope via a per-scope `AUTHORITY`
  map (Feature 025). `pools/backend-live.ts` alone returned the constant
  `PROJECT_AUTHORITY = "routing"` from `planWrite`, and read its CAS base solely from the
  project authority (`readProject`). So a global-scope `pools.set` could never persist to
  `global:routing`.
- **The preflight was hardwired to project too.** `command-authority.ts`
  `staticAuthorityForCommandId` mapped `case "pools": return POOLS_AUTHORITY` (the project
  `routing` constant), and the wired `createOperatorAuthorityResolver` short-circuited on
  that static value — so the mutation preflight reported the PROJECT authority for pools
  even under a global request. Had only the backend been fixed, the SAME class Feature 025
  fixed would appear: preflight expects project `routing` (version null), the write lands
  on `global:routing`, and the second Save fails `invalid_argument` ("mutations require
  version").
- **The scope-selection plumbing already supports global for pools.** The catalog grants
  `pools.status|show|set|reset|validate` the `GP` scope set (same as
  `routing.configure`/`smart.*`/`budget.*`). `resolveCliScope` (CLI) and
  `resolveScopeForCommandId` (slash/HTTP/TUI) already resolve `pools.*` to `global` when no
  project is bound (`projectId` null) and `project` otherwise — the SAME generic path the
  other three commands ride. No CLI flag, TUI form, or descriptor needed a change; the
  scope affordance was already present and merely ignored by the pools backend.
- **The write path is `mutateAuthority`, and `apply` sees the FRESH payload.** `pools`
  returns an `OperatorMutationPlan` the dispatcher commits through the single
  `mutateAuthority` CAS write; it never self-commits. The pre-fix `apply` returned a
  plan-time snapshot (`apply: () => payload`) rather than merging into `current`; hardening
  it to `apply(current)` (as `smart`/`budget` do) makes a pools Save robust against
  clobbering a concurrently written sibling on the shared document.
- **The effective read is document-shadowing, and already correct.**
  `config-adapter.resolveEffective` returns the PROJECT routing document whole when it
  exists, else the GLOBAL document whole, else the built-in default. So a global config
  already governs any project WITHOUT its own routing document, and a project document
  shadows the global one — the layered precedence the feature needs already holds at the
  document level. Widening the pools WRITE scope is sufficient; the READ/merge is untouched.
- **The degraded preflight fallback must keep pools → project.**
  `config-status.ts:authorityKeyForCommandId` (used only when the full resolver is NOT
  threaded) consults `staticAuthorityForCommandId`. Keeping pools' PROJECT-default static
  entry preserves the Feature 021 degraded-path guarantee (`pools.set → "routing"`, not the
  bare prefix `"pools"`) while the wired resolver overrides it scope-dependently.

## Problem

An operator who wants ONE Smart Routing config to govern every project cannot set
`role_pools` globally: `pools.set`/`pools.reset` are hardwired to the per-project `routing`
authority, so role pools can only be bound per-directory. The other three writers of the
same routing document (`smart.*`, `budget.*`, `routing.configure`) already honor the
request scope and can write `global:routing`, but pools cannot — so a coherent global
config is impossible while pools stays project-only. This feature moves the pools write
authority to the request scope (matching the preflight), mirroring the Feature 024/025 fix,
so a global-scope `pools.set` persists `role_pools` to `global:routing` and a project-scope
`pools.set` still writes the project `routing` document.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — An operator can bind role pools once, globally, for every project

- As an operator, I want a global-scope `pools.set` to persist my `role_pools` to the
  global routing config, so that one configuration governs Smart Routing in every project
  instead of my having to re-bind role pools in each working directory.

### P1 — A project can still override the global role pools

- As an operator on a specific project, I want a project-scope `pools.set` to persist to my
  project routing config and shadow the global role pools for the same role, so that a
  project can deviate from the global default without changing it.

### P1 — The write authority matches the mutation preflight

- As a maintainer, I want `pools.*` to commit to the SAME Config authority the mutation
  preflight reports for the request scope (the shared `SMART_AUTHORITY` routing SSOT), so
  the preflight CAS token and the committed authority can never diverge and a second
  global-scope Save never fails with a RED "mutations require version" error.

### P1 — pools never clobbers smart, budget, or routing.configure

- As an operator, I want saving role pools to preserve the activation (`smart.*`), the
  budget (`budget.*`), and the mode (`routing.configure`) on the shared routing document,
  so that configuring role pools never silently zeroes another facet of routing.

### P2 — The default (no scope) stays project (back-compat)

- As a maintainer, I want a `pools.set` with no scope selector to keep writing the project
  `routing` authority exactly as before, so that every existing caller and test behaves
  identically and the change is strictly additive.

### P2 — CLI and TUI select pools scope exactly like routing.configure

- As an operator, I want the op CLI and the operator TUI to let me pick global vs project
  scope for `pools.set`/`pools.reset` the same way they already do for
  `routing.configure`/`smart.*`/`budget.*`, so the scope affordance is uniform across the
  four writers of the routing document.

## Functional Requirements

### Group A — pools write authority follows the REQUEST scope (FR-A)

1. **FR-A — `pools.*` derives its write authority from the request scope, not a hardwired
   constant.** `pools/backend-live.ts` MUST replace the constant `PROJECT_AUTHORITY` write
   target with a `scopeForRequest(scopeKind)` that maps `global` → `global:routing` and
   everything else → project `routing`, threaded from the inbound command port
   (`ctx.request.scope.kind` into `resolve`/`validate`/`planSet`/`planReset`). It MUST
   resolve the authority through a per-scope `AUTHORITY` map mirroring
   `SmartBackendLive.AUTHORITY` — the SAME shape the preflight consumes — no re-typed table.
   The `requestScopeKind` parameter MUST be optional and default to `project`, so a caller
   that omits it keeps the pre-feature project-only behavior.

### Group B — the preflight resolves pools scope-dependently (FR-B)

2. **FR-B — `command-authority.ts` resolves `pools.*` by request scope in the wired
   resolver.** The wired `createOperatorAuthorityResolver` MUST resolve `pools.*` to
   `global:routing` under global scope and `routing` under project scope (via the shared
   `SMART_AUTHORITY` routing map), instead of short-circuiting on the static project value.
   `staticAuthorityForCommandId` MUST keep pools' PROJECT-default entry so the DEGRADED
   preflight fallback (`config-status.ts:authorityKeyForCommandId`, used only when the full
   resolver is not threaded) still resolves `pools.set → "routing"` (Feature 021), never the
   bare prefix `"pools"`.

### Group C — pools partial-merges into the shared routing document under CAS (FR-C)

3. **FR-C — `pools.*` partial-merges into the scoped `routing` document, preserving
   siblings.** Each plan's `apply` MUST read-modify-write: it merges ONLY the domain-owned
   field (`models.role_pools`) into the FRESH persisted payload `mutateAuthority` threads in
   (`current`), PRESERVING `activation` (owned by `smart.*`/`routing.configure`) and
   `enforcement.budget` (owned by `budget.*`/`routing.configure`). It MUST NOT overwrite
   sibling keys with a plan-time snapshot; on create-if-absent it falls back to the
   plan-validated document. This mirrors the `smart`/`budget` `apply(current)` merge
   (Feature 025 FR-C).

### Group D — layered precedence: project shadows global (FR-D)

4. **FR-D — the operator read keeps project-over-global precedence, unchanged.** The
   effective routing config MUST resolve the PROJECT routing document when it exists, else
   the GLOBAL routing document, else the built-in default (document shadowing, Feature
   001/024). A global `role_pool` MUST govern a project that has NO project routing document;
   a project `role_pool` for the same role MUST shadow the global one. This feature MUST NOT
   change the routing engine, the `RoutingConfig` schema, or `resolveEffective`'s merge
   semantics — only the WRITE scope is widened.

### Group E — single-committed-CAS-write + typed surfacing (FR-E)

5. **FR-E — the single-committed-CAS-write and operator mutation-plan contracts are intact,
   and a rejected Save is surfaced.** The backend MUST NOT self-commit: the Feature 007
   `mutateAuthority` pipeline owns the ONE committed CAS write + audit. A rejected Save
   (malformed binding, empty pool, schema violation, non-mutating principal, stale
   expected-version) MUST surface a TYPED error envelope (`invalid_argument` /
   `unauthorized` / `CAS version conflict`) and MUST commit NOTHING — no phantom write, no
   version bump. A config outage MUST degrade to a typed `unavailable`, never an unhandled
   throw.

### Group F — CLI + TUI scope selection parity (FR-F)

6. **FR-F — the CLI and TUI select pools scope exactly as they do for routing.configure.**
   The op CLI (`resolveCliScope`) and the slash/HTTP/TUI path (`resolveScopeForCommandId`)
   MUST accept the SAME scope selector for `pools.set`/`pools.reset` they already accept for
   `routing.configure` — driven by the catalog `GP` scope set and the ambient
   `projectId`/`--project` selector. No new CLI flag, TUI form field, descriptor, or catalog
   scope entry is added; the affordance already exists generically and this feature makes the
   pools backend HONOR it.

### Group G — regression proof over the REAL wired dispatcher (FR-G)

7. **FR-G — the widened scope persists / surfaces through the REAL wired stack.**
   Regression coverage MUST drive the SAME live dispatcher construction the TUI uses
   (pools + smart + budget + routing over ONE shared `store.config`, with the production
   authority resolver threaded) and prove:
   - (a) a GLOBAL-scope `pools.set` persists `role_pools` to `global:routing`, the project
     `routing` document stays absent, and the effective read reflects it;
   - (b) a PROJECT-scope `pools.set` still writes the project `routing` authority with
     `global:routing` absent (back-compat default);
   - (c) a GLOBAL role_pool governs a project that has NO project routing document (the
     effective read resolves `role_pools` from `global:routing`);
   - (d) PRECEDENCE — when both scopes hold a document, the PROJECT role_pool shadows the
     GLOBAL one for the same role, and both documents remain independently persisted;
   - (e) the pools preflight authority tracks the request scope, so two consecutive
     global-scope `pools.set` BOTH succeed and bump the `global:routing` CAS token (no
     "mutations require version" failure).

## Non-Functional Requirements

- **Mirror the Feature 025 fix, no new store.** The change reuses the pools domain's
  existing `createConfigAdapter` reads + `OperatorMutationPlan`; no parallel product config
  store, no self-commit.
- **One routing-module authority SSOT.** The per-scope authority map
  (`routing`/`global:routing`) is the SAME `config-adapter` shape the preflight consumes as
  `SMART_AUTHORITY` — no re-typed table.
- **No contract, catalog, or dispatch change.** No operator payload shape, command id,
  catalog version, dispatch path, server/port surface, or feature flag is added or altered;
  `pools.set`/`pools.reset` are already `mutates: true` with the `GP` scope set.
- **Zero provider/model cost.** The pools backend is model-independent and offline-capable;
  it makes no provider/model calls, consumes no tokens, and incurs no cost.
- **Honest failure.** Every rejected Save surfaces a typed, bounded, secret-free reason; no
  failure is swallowed or rendered as success (FR-E).

## Acceptance Scenarios

Given the operator control plane is enabled and a live wired stack is in use

- **Global pools.set persists to the global authority (FR-A, FR-G-a).**
  Given a global-scope request (no project bound),
  When the operator Saves `pools.set` binding a role pool,
  Then the write lands on `global:routing`, the project `routing` document stays absent,
  and the effective read reflects the role pool.

- **Project pools.set still persists to the project authority (FR-A, FR-G-b).**
  Given a project-scope request,
  When the operator Saves `pools.set`,
  Then the write lands on the PROJECT `routing` authority with `global:routing` absent.

- **A global config governs a project with no project document (FR-D, FR-G-c).**
  Given only a global routing document with a role pool and a project that has never
  written a project routing document,
  When the effective config is read for that project,
  Then its `role_pools` resolve from `global:routing`.

- **A project role pool shadows the global one (FR-D, FR-G-d).**
  Given a global role pool for a role and a project role pool for the SAME role,
  When the effective config is read,
  Then the PROJECT role pool wins and both documents remain independently persisted.

- **The preflight tracks the request scope (FR-B, FR-E, FR-G-e).**
  Given a fresh store, when the operator Saves `pools.set` globally and then a second
  global `pools.set` threading the bumped version,
  Then BOTH commit with outcome `success` to `global:routing`, the CAS version bumps, and
  the project `routing` document stays absent.

- **A malformed binding is rejected (FR-E).**
  Given a `pools.set` with an empty candidate pool for a role,
  When the mutation dispatches,
  Then the backend returns a typed `invalid_argument` and nothing is committed.

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes the
  `RoutingConfig.Info` document — specifically the `models.role_pools` role→model bindings —
  under the `routing` / `global:routing` Config authority. This is operator configuration
  metadata (role names and catalog-resolved model ids), not end-user content or secrets. No
  credential or token is read, written, or exposed; only the operator's own entered bindings
  persist.
- **Authentication/authorization.** No new authenticated surface, credential, or permission
  boundary. `pools.*` rides the existing Feature 007 operator principal, scope, CAS, and
  confirmation gates unchanged; `mutateAuthority` enforces the same authorization every
  other mutation uses. Widening the write authority to the GLOBAL scope does not widen
  authorization: the global scope is only selected when the request itself resolves to
  global (no project bound), and the committed authority now MATCHES the scope the preflight
  already authorized — it aligns, it does not bypass, the boundary. The non-mutating
  principal check (`operator`/`system` only) is preserved.
- **Input validation.** The untrusted input is the operator payload (a `bindings` array of
  `{ role, models }` plus a CAS token). Each binding is validated before any plan: a
  non-empty role, no duplicate role, a non-empty candidate pool, and no empty model id, and
  the full patched `RoutingConfig.Info` is decoded against the effect-schema, so a malformed
  binding is rejected as `invalid_argument` BEFORE any write — never a crash, never a partial
  write. The request scope kind is normalized to a closed `{global, project}` set before it
  selects an authority.
- **Cryptography in transit/at rest.** Not applicable — this feature persists routing
  configuration through the existing Config.Service boundary; it introduces no new
  data-in-transit path and no new at-rest encryption requirement beyond what Config.Service
  already provides. Widening the scope to `global:routing` writes to the same profile-global
  config store Features 027/030/032 already govern.
- **Logging/audit.** No new logging. The committed mutation projects through the existing
  Feature 007 EventV2 audit correlation via the single `mutateAuthority` `finalize` path
  (content-free `beforeVersion`/`afterVersion`), unchanged. The bounded, secret-free operator
  access-audit event the pools command port already emits (command id, principal id, target
  scope, outcome) is preserved; no role_pool model id or payload is carried into a log line.
- **Error-handling information exposure.** Rejected Saves surface the existing typed, bounded
  reason (`invalid_argument` with a `field` hint, `unauthorized`, or `CAS version conflict`)
  — never a stack trace, a raw config fragment, or a schema-decoder dump. Config reads are
  guarded (`Effect.tryPromise`) and degrade to a typed `unavailable`, never an unhandled
  throw.

## Observability

This is a domain write-scope + merge-semantics fix with no new backend surface, so it emits
no new metrics, log events, or trace spans. Committed `pools.*` mutations project through the
existing Feature 007 EventV2 audit and the ADR-0001 OTLP foundation with content-free,
bounded labels (command id, domain, surface, outcome) — unchanged, because the payload
contract and dispatch path are unchanged. The behavioral change is only WHICH authority the
write lands on (now aligned with the preflight/request scope). Conventions live in
`doc/arch/observability/observability.md`.

## Domain Model

The pools write-scope widening reuses the existing routing config domain
(`packages/schema/src/routing/config.ts`, `packages/protocol/src/pools/commands.ts`); no new
schema shape is introduced. The corrected flow:

```
TUI / CLI pools.set (scope: global | project — GP catalog set, resolved by projectId)
        |
        v
pools inbound command port
  thread ctx.request.scope.kind into resolve/validate/planSet/planReset   (FR-A)
        |
        v
pools backend-live (createConfigAdapter reads — no parallel store)
  write scope = scopeForRequest(requestScopeKind)  ==  SMART_AUTHORITY[norm(kind)]
  validate bindings + patched RoutingConfig.Info -> invalid_argument      (FR-E)
  return { authority: AUTHORITY[scope], apply }                           (FR-A/C)
        |
        v
dispatcher -> mutateAuthority  [ONE committed CAS write]
  apply(current) merges models.role_pools INTO the fresh persisted doc    (FR-C)
    preserves activation (smart) + enforcement.budget (budget)
  stale expectedVersion -> CAS version conflict, commit nothing           (FR-E)
        |
        v
global scope: role_pools land on global:routing (governs every project)  (FR-G-a/c)
project scope: role_pools land on project routing (shadows global)        (FR-G-b/d)

preflight authority (command-authority.ts, SMART_AUTHORITY[norm(scopeKind)] for pools)
  == committed authority (backend scopeForRequest)  -> never diverge      (FR-B)

read/merge (resolveEffective): project doc > global doc > default — UNCHANGED (FR-D)
```

## Out of Scope

- **Changing the routing engine or the `RoutingConfig` schema** — only the persistence
  scope of `pools.*` is widened; `role_pools`/`decision_model`/`fallback` shapes are
  untouched.
- **Rewriting `resolveEffective` into a deep per-role merge** — it stays document-shadowing
  (project doc > global doc > default), the established Feature 001/024 model; a project
  document shadows the global one wholesale, which is the layered precedence the feature
  needs.
- **Any operator payload, command id, catalog version, dispatch path, or feature flag
  change** — `pools.set`/`pools.reset` are already `mutates: true` with the `GP` scope set;
  only the backend/command-port/authority-resolver bodies change.
- **Adding a new CLI flag or TUI scope picker** — the CLI/slash/TUI scope selection is
  already generic (catalog `GP` + `resolveScopeForCommandId`/`resolveCliScope`) and shared
  with `routing.configure`; pools rides it once the backend honors the resolved scope.
- **Widening `smart`/`budget`** — both already follow the request scope (Feature 025); no
  change is made to them.

## Related Features and Decisions

- [ADR-0033 — Add a global authority scope for the pools (role_pools) operator config](../../adr/0033-add-a-global-authority-scope-for-the-pools-role-pools-and.md)
- [Feature 025 — Align smart and budget operator config write authority with the request scope](../025-align-smart-and-budget-operator-config-write-authority-with/spec.md) — the request-scope derivation + `apply(current)` merge this feature mirrors for pools.
- [Feature 024 — Implement routing configure persistence so operator routing](../024-implement-routing-configure-persistence-so-operator-routing/spec.md) — the original `routing.configure` request-scope fix and the shared-`routing`-document coexistence contract.
- [Feature 021 — Operator config-backed saves must persist reliably and never silently zero](../021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md) — the shared-`routing`-authority CAS-token / preflight invariants and the `command-authority.ts` SSOT (incl. the degraded `pools.set → "routing"` fallback) the fix preserves.
- [Feature 030 — Correct feature 028 so an OPENCODE_CONFIG_DIR profile layers](../030-correct-feature-028-so-an-opencode-config-dir-profile-layers/spec.md) — the profile-global config store the global (`global:routing`) write persists into.
- [Feature 032 — Operator config writes must persist only the project owned](../032-operator-config-writes-must-persist-only-the-project-owned/spec.md) — the project-profile wholesale write vs global deep-merge the pools write inherits unchanged.

## Clarifications

### Session 2026-07-20

- **The write authority follows the REQUEST scope, defaulting to project (FR-A).** `pools`
  used the hardwired constant `PROJECT_AUTHORITY`; it is corrected to derive the authority
  from `ctx.request.scope.kind` normalized the SAME way the preflight normalizes, via the
  shared routing `AUTHORITY` map, with an optional `requestScopeKind` that defaults to
  `project` for back-compat. Recorded in ADR-0033.
- **The preflight resolves pools scope-dependently but keeps a project-default static entry
  (FR-B).** The wired `createOperatorAuthorityResolver` resolves `pools.*` by request scope;
  `staticAuthorityForCommandId` keeps pools' PROJECT default for the degraded
  `authorityKeyForCommandId` fallback (Feature 021). Recorded in ADR-0033.
- **The merge lives in `apply(current)`, over the FRESH payload (FR-C).** The pools backend
  now merges only `models.role_pools` into the fresh on-disk payload (no plan-time snapshot),
  so `role_pools`/`activation`/`budget` coexist even under a concurrent write. Recorded in
  ADR-0033.
- **Read/merge precedence is unchanged (FR-D).** `resolveEffective` keeps document-shadowing
  (project doc > global doc > default); no deep per-role merge is introduced. A global config
  governs projects without their own document; a project document shadows the global one.
  Recorded in ADR-0033.
- **CLI/TUI scope selection was already generic (FR-F).** No CLI flag, TUI form, descriptor,
  or catalog scope entry changed; `pools.*` already carried the `GP` scope set and rode the
  same `resolveScopeForCommandId`/`resolveCliScope` path as `routing.configure`. The backend
  simply had to honor the resolved scope. Recorded in ADR-0033.
- **Alternatives rejected (ADR-0033).** Keeping the hardwired project authority and adding a
  separate global-pools store (a parallel store), a self-committing backend, a plan-time
  snapshot merge, and a deep per-role `resolveEffective` merge were all rejected in favor of
  the request-scope derivation + `apply(current)` merge that mirrors Feature 025.
