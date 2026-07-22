---
id: 019f802b-0eb0-7a00-a740-ab0853aafa31
number: 025
slug: align-smart-and-budget-operator-config-write-authority-with
status: implemented
created_at: 2026-07-20T15:35:33.296366Z
---
# Feature Specification: Align Smart And Budget Operator Config Write Authority With The Request Scope

Feature: 025-align-smart-and-budget-operator-config-write-authority-with
Created: 2026-07-20
Scope: `smart.*` and `budget.*` are two of the config-backed operator commands that
share the per-scope `routing` document with `pools.set` and `routing.configure`. Both
mis-scoped their WRITE authority: they derived it from where the effective config
happens to resolve, NOT from the request scope the mutation preflight/CAS token comes
from. On a FRESH project (no project-scope routing doc) this DIVERGES — the exact
class Feature 024 just fixed for `routing.configure` (FR-F): SAVE#1 silently persists
to `global:routing` (preflight expected project `routing`, version null) and SAVE#2
hard-fails `invalid_argument` ("mutations require version (CAS token) when authority
already exists"), the RED operator error. This feature applies the identical
request-scope derivation to `smart` and `budget` so their preflight authority and
committed authority can never diverge, and hardens their commit-time merge to the same
`apply(current)` semantics `routing.configure` uses, so a Save never clobbers a
sibling writer's field. No new command id, no catalog bump, no parallel config store,
no weakening of the single-committed-CAS-write contract.

## Audit result (grounding — every anchor verified 2026-07-20)

- **The divergence is real and reproduced.** An adversarial repro over the REAL wired
  dispatcher (fresh project, no project routing doc) confirmed two consecutive
  project-scope `smart.on` then `smart.off` fail: BEFORE the fix SAVE#1 committed to
  `global:routing` and SAVE#2 returned `invalid_argument`. The same class applies to
  `budget.set`. This is the SAME defect Feature 024 FR-F fixed for `routing.configure`
  and flagged as a Feature 025 candidate (ADR-0024 consequences).
- **`smart` derived the write scope from the effective ORIGIN.**
  `smart/backend-live.ts` computed its write authority via
  `scopeForOrigin(effective.origin)` (`origin === "project" ? "project" : "global"`).
  On a fresh project the effective origin is `default`/`global`, so the first Save
  targeted `global:routing` while the preflight
  (`command-authority.ts` — `case "smart": SMART_AUTHORITY[norm(scope.scopeKind)]`,
  `norm` maps everything but "global" to "project") reported the project `routing`
  authority, version null.
- **`budget` passed an un-normalized scope straight through.**
  `budget-command-port.ts` set `scope = (payload.scope ?? ctx.request.scope.kind) as
  BudgetScope` with NO normalization, then `budget/backend-live.ts` wrote
  `AUTHORITY[toRoutingScope(scope)]`. A non-`global`/non-`project` scope kind
  (`session`, `root-tree`) resolved to an `undefined` authority, and a payload-supplied
  scope the preflight never sees diverged from the preflight's normalized authority.
- **The preflight is the SSOT and already correct.** The mutation preflight resolves
  the committed authority through `createOperatorAuthorityResolver`
  (`command-authority.ts`), which reads the domains' own exported `SMART_AUTHORITY` /
  `BUDGET_AUTHORITY` maps keyed by the NORMALIZED request scope (`norm(scopeKind)`).
  The backends must derive their write authority from the SAME request scope + map so
  the two never diverge — no re-typed table.
- **The write path is `mutateAuthority`, and `apply` sees the FRESH payload.** Both
  domains return an `OperatorMutationPlan` the dispatcher commits through the single
  `mutateAuthority` CAS write (`mutation.ts:277-296`); neither self-commits. `apply`
  receives the FRESH on-disk payload at commit time, so merging the domain-owned field
  into `current` (not a plan-time snapshot) preserves whatever siblings the committed
  document holds.
- **The `routing` document is shared by four writers.** `pools.set`
  (`PROJECT_AUTHORITY = "routing"`), `smart.*` (activation), `budget.*`
  (`enforcement.budget`), and `routing.configure` (mode + budget) ALL write the same
  per-scope routing document. Coexistence rests on each writer read-modify-writing and
  preserving sibling keys; the `apply(current)` merge makes this robust under a
  concurrent write.
- **Telemetry does NOT diverge.** `telemetry/backend-live.ts` exports a single
  global-only authority (`AUTHORITY = "global:telemetry"`) — no per-scope split, no
  `scopeForOrigin`, and its `apply` already merges into `current`. Its preflight
  (`command-authority.ts` — `case "telemetry": return TELEMETRY_AUTHORITY`) resolves
  the SAME constant. No request/origin divergence exists; telemetry is left unchanged.

## Problem

An operator config-backed command must commit to the SAME Config authority its
mutation preflight reports for the request scope, so the CAS token the client threads
matches the authority the write lands on. `smart.*` and `budget.*` did not: they
derived their write authority from the effective-config origin (`smart`) or an
un-normalized scope (`budget`), while the preflight resolves the request scope. On a
fresh project the two diverge — the first Save mis-writes `global:routing`, the second
fails `invalid_argument`. This feature moves the write authority of both domains to the
request scope (matching the preflight), mirroring the Feature 024 `routing.configure`
fix, and hardens their commit-time merge so a Save never clobbers a sibling.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — An operator can enable Smart Routing on a fresh project

- As an operator on a brand-new project (no routing document yet), I want the FIRST
  `smart.on` Save and every subsequent Save to persist to my project routing config, so
  that enabling Smart Routing works on the first try and the second Save never fails
  with a RED "mutations require version" error.

### P1 — An operator can set a budget on a fresh project

- As an operator, I want `budget.set` on a fresh project to persist to my project
  routing config and a second `budget.set` to succeed under CAS, so that tightening my
  budget works reliably without a mysterious second-save failure.

### P1 — smart/budget never clobber pools, each other, or routing.configure

- As an operator, I want saving a smart activation or a budget to preserve the
  role→model pools I bound (`pools.set`), the activation `smart.*` set, and the mode +
  budget `routing.configure` set, so that configuring one facet of routing never
  silently zeroes another that shares the same document.

### P1 — The write authority matches the mutation preflight

- As a maintainer, I want `smart.*` and `budget.*` to commit to the SAME Config
  authority the mutation preflight reports for the request scope (the shared
  `SMART_AUTHORITY`/`BUDGET_AUTHORITY` SSOT), so the preflight CAS token and the
  committed authority can never diverge and lost-update protection stays intact.

### P2 — Global-scope Saves still target the global document

- As an operator, I want a global-scope `smart.on`/`budget.set` to write
  `global:routing`, so a deliberately global configuration is honored and not silently
  redirected to the project document.

### P2 — telemetry is confirmed unaffected

- As a maintainer, I want confirmation that `telemetry.*` (global-only authority) does
  NOT carry the same divergence, so no unnecessary change is made to a domain that is
  already correct.

## Functional Requirements

### Group A — smart write authority follows the REQUEST scope (FR-A)

1. **FR-A — `smart.*` derives its write authority from the request scope, not the
   effective origin.** `smart/backend-live.ts` MUST replace
   `scopeForOrigin(effective.origin)` with a `scopeForRequest(scopeKind)` that maps
   `global` → `global:routing` and everything else → project `routing`, threaded from
   the inbound command port (`ctx.request.scope.kind` into
   `resolve`/`planOn`/`planOff`/`planAuto`). It MUST resolve the authority through the
   SAME exported `AUTHORITY` map the preflight consumes as `SMART_AUTHORITY`
   (`command-authority.ts`) — no re-typed table. The effective config is still read for
   the summary + merge base/defaults; only the WRITE TARGET moves to the request scope.

### Group B — budget write authority follows the REQUEST scope (FR-B)

2. **FR-B — `budget.*` derives its write authority from the request scope, normalized.**
   `budget-command-port.ts` MUST derive the `BudgetScope` from `ctx.request.scope.kind`
   normalized the SAME way the preflight normalizes (`global` → `global`, everything
   else → `project`), NOT from a payload-supplied scope the preflight never sees and NOT
   passed through un-normalized. `budget/backend-live.ts` continues to write
   `AUTHORITY[toRoutingScope(scope)]` — the SAME exported `AUTHORITY` map the preflight
   consumes as `BUDGET_AUTHORITY`. This keeps the preflight authority and the committed
   authority in lockstep for every scope kind.

### Group C — Shared-authority partial merge under CAS (FR-C)

3. **FR-C — `smart.*` and `budget.*` partial-merge into the shared `routing` document,
   preserving siblings.** Each plan's `apply` MUST read-modify-write: it merges ONLY the
   domain-owned field (`smart` → `activation.enabled`/`mode`; `budget` →
   `enforcement.budget`) into the FRESH persisted payload `mutateAuthority` threads in
   (`current`), PRESERVING `models.role_pools` (owned by `pools.set`), sibling
   `activation` (owned by `smart.*`/`routing.configure`), and `enforcement.budget`
   (owned by `budget.*`/`routing.configure`). It MUST NOT overwrite sibling keys with a
   plan-time snapshot; on create-if-absent it falls back to the plan-validated document.
   This mirrors the `routing.configure` `apply(current)` merge (Feature 024 FR-C).

### Group D — Single-committed-CAS-write + typed surfacing (FR-D)

4. **FR-D — The single-committed-CAS-write and operator mutation-plan contracts are
   intact, and a rejected Save is surfaced.** Neither backend MUST self-commit: the
   Feature 007 `mutateAuthority` pipeline owns the ONE committed CAS write + audit. A
   rejected Save (invalid budget above the hard ceiling, schema violation, stale
   expected-version) MUST surface a TYPED error envelope (`invalid_argument` /
   `CAS version conflict`) and MUST commit NOTHING — no phantom write, no version bump.
   A backend-less/read-only construction still degrades honestly (config outage →
   `unavailable`). The default budget ceiling is never silently relaxed (Feature 013
   FR4 preserved).

### Group E — telemetry non-divergence confirmed (FR-E)

5. **FR-E — telemetry is confirmed global-only and left unchanged.** `telemetry.*`
   exports a single global authority (`AUTHORITY = "global:telemetry"`) whose preflight
   resolves the SAME constant and whose `apply` already merges into `current`. This
   feature MUST verify there is no request/origin divergence and MUST NOT change
   telemetry.

### Group F — Regression proof over the REAL wired dispatcher (FR-F)

6. **FR-F — The reproduced scenarios persist / surface through the REAL wired stack.**
   Regression coverage MUST drive the SAME live dispatcher construction the TUI uses
   (smart + budget + pools + routing over ONE shared `store.config`, with the production
   authority resolver threaded) — NO masking seed — and prove:
   - (a) two consecutive project-scope `smart.on` then `smart.off` on a FRESH (unseeded)
     project BOTH succeed and land on the PROJECT `routing` authority (never
     `global:routing`), the CAS version bumps;
   - (b) two consecutive project-scope `budget.set` on a FRESH project BOTH succeed and
     land on the PROJECT `routing` authority, version bumps;
   - (c) a global-scope `smart.on` / `budget.set` writes `global:routing`;
   - (d) THE FULL COEXISTENCE PROOF — `pools.set` + `smart.on` + `budget.set` +
     `routing.configure` in sequence, and NONE clobbers the others in the final
     **on-disk** `config.json` (physical round-trip via `createFileConfigService` + a
     fresh-store re-read): the `routing` payload holds `role_pools` AND `activation`
     (enabled + mode) AND `enforcement.budget`;
   - (e) an invalid payload → typed error, NOTHING committed;
   - (f) a stale expected-version → conflict, NOTHING committed (CAS preserved).

## Non-Functional Requirements

- **Mirror the Feature 024 fix, no new store.** The change reuses each domain's existing
  `createConfigAdapter` reads + `OperatorMutationPlan`; no parallel product config
  store, no self-commit.
- **One routing-module authority SSOT.** The per-scope authority map
  (`routing`/`global:routing`) is exported once per domain (`SMART_AUTHORITY`,
  `BUDGET_AUTHORITY` — both re-export the same `config-adapter` shape) and consumed by
  BOTH the preflight and the backend — no re-typed table.
- **No contract, catalog, or dispatch change.** No operator payload shape, command id,
  catalog version, dispatch path, server/port surface, or feature flag is added or
  altered; `smart.on`/`budget.set` are already `mutates: true` in the catalog.
- **Zero provider/model cost.** Both backends are model-independent and offline-capable;
  they make no provider/model calls, consume no tokens, and incur no cost.
- **Honest failure.** Every rejected Save surfaces a typed, bounded, secret-free reason;
  no failure is swallowed or rendered as success (FR-D).

## Acceptance Scenarios

Given the operator control plane is enabled and a live wired stack is in use

- **smart.on on a fresh project persists to the project authority (FR-A, FR-F-a).**
  Given a FRESH project with no routing document,
  When the operator Saves `smart.on` (preflight authority `routing`, version null) and
  then Saves `smart.off` threading the bumped version,
  Then BOTH Saves commit with outcome `success` to the PROJECT `routing` authority,
  `global:routing` stays absent, and the CAS version bumps between them.

- **budget.set on a fresh project persists to the project authority (FR-B, FR-F-b).**
  Given a FRESH project,
  When the operator Saves `budget.set` twice threading the preflight version each time,
  Then BOTH commit to the PROJECT `routing` authority with `global:routing` absent.

- **Global-scope Save writes global (FR-A, FR-B, FR-F-c).**
  Given a global-scope request (no project bound),
  When the operator Saves `smart.on` / `budget.set`,
  Then the write lands on `global:routing` and the project `routing` document is absent.

- **Full coexistence — no clobber (FR-C, FR-F-d).**
  Given `pools.set` bound `role_pools`, `smart.on` enabled activation, `budget.set`
  tightened the budget on the shared `routing` document,
  When the operator then Saves `routing.configure { mode: "auto" }`,
  Then the final on-disk `config.json` under `routing` holds ALL: the role pool,
  `activation.enabled = true`, the tightened budget, and `mode = "auto"` — and a fresh
  store re-reads them from disk.

- **Invalid payload is rejected (FR-D, FR-F-e).**
  Given the operator Saves a `budget.set` above the hard ceiling,
  When the mutation dispatches,
  Then the backend returns a typed `invalid_argument` and the routing document is
  unchanged (nothing committed).

- **Stale version is a conflict (FR-D, FR-F-f).**
  Given a `smart.on` has committed at version `v`,
  When a second smart Save threads a stale token,
  Then it is rejected with `CAS version conflict`, and the committed document is
  preserved (nothing committed).

## Security Requirements

- **Data sensitivity/classification.** This feature reads and writes the
  `RoutingConfig.Info` document (activation flags, routing mode, role→pool bindings, and
  budget/enforcement limits) under the `routing` / `global:routing` Config authority —
  operator configuration metadata, not end-user content or secrets. No credential or
  token is read, written, or exposed; only the operator's own entered values persist.
- **Authentication/authorization.** No new authenticated surface, credential, or
  permission boundary. `smart.*`/`budget.*` ride the existing Feature 007 operator
  principal, scope, CAS, and confirmation gates unchanged; `mutateAuthority` enforces
  the same authorization every other mutation uses. Correcting the write authority to
  the request scope makes the committed authority MATCH the authorization scope the
  preflight already resolved — it tightens, never widens, the boundary.
- **Input validation.** The untrusted input is the operator payload (smart has none
  beyond the CAS token; budget carries a bounded limits view). `budget.set` limits are
  validated against the hard `DEFAULT_ROUTING_BUDGET` ceiling and the full patched
  `RoutingConfig.Info` is decoded against the effect-schema at plan time, so an
  above-ceiling or malformed budget is rejected as `invalid_argument` BEFORE any plan —
  never a crash, never a partial write. The request scope kind is normalized to a closed
  `{global, project}` set before it selects an authority.
- **Cryptography in transit/at rest.** Not applicable — this feature persists routing
  configuration through the existing Config.Service boundary; it introduces no new
  data-in-transit path and no new at-rest encryption requirement beyond what
  Config.Service already provides.
- **Logging/audit.** No new logging. The committed mutation projects through the existing
  Feature 007 EventV2 audit correlation via the single `mutateAuthority` `finalize` path
  (content-free `beforeVersion`/`afterVersion`), unchanged. The bounded, secret-free
  operator access-audit event each command port already emits is preserved; no
  payload/secret is carried into a log line.
- **Error-handling information exposure.** Rejected Saves surface the existing typed,
  bounded reason (`invalid_argument` with a `field` hint, or `CAS version conflict`) —
  never a stack trace, a raw config fragment, or a schema-decoder dump. Config reads are
  guarded (`Effect.tryPromise`) and degrade to a typed `unavailable`, never an unhandled
  throw.

## Observability

This is a domain write-scope + merge-semantics fix with no new backend surface, so it
emits no new metrics, log events, or trace spans. Committed `smart.*`/`budget.*`
mutations project through the existing Feature 007 EventV2 audit and the ADR-0001 OTLP
foundation with content-free, bounded labels (command id, domain, surface, outcome) —
unchanged, because the payload contract and dispatch path are unchanged. The behavioral
change is only WHICH authority the write lands on (now aligned with the preflight).
Conventions live in `doc/arch/observability/observability.md`.

## Domain Model

The smart/budget write-scope alignment + shared-authority merge reuses the existing
routing config domain (`packages/schema/src/routing/config.ts`,
`packages/protocol/src/{smart,budget}/commands.ts`); no new schema shape is introduced.
The corrected flow:

```
TUI smart.on / budget.set Save
        |
        v
smart/budget inbound command port
  smart: thread ctx.request.scope.kind into resolve/planOn/planOff/planAuto  (FR-A)
  budget: scope = norm(ctx.request.scope.kind)  (global | project)           (FR-B)
        |
        v
smart/budget backend-live (createConfigAdapter reads — no parallel store)
  write scope = scopeForRequest(requestScopeKind)  ==  SMART/BUDGET_AUTHORITY[norm(kind)]
  validate patched RoutingConfig.Info -> invalid_argument                    (FR-D)
  return { authority: AUTHORITY[scope], apply }                              (FR-A/B)
        |
        v
dispatcher -> mutateAuthority (mutation.ts:277-296)  [ONE committed CAS write]
  apply(current) merges the domain-owned field INTO the fresh persisted doc  (FR-C)
    smart -> activation; budget -> enforcement.budget
    preserves models.role_pools (pools.set) + sibling activation/budget
  stale expectedVersion -> CAS version conflict, commit nothing              (FR-D)
        |
        v
fresh project: SAVE#1 + SAVE#2 both land on PROJECT "routing" (never global) (FR-F-a/b)
coexistence: pools + smart + budget + routing.configure survive on disk      (FR-F-d)

preflight authority (command-authority.ts, SMART/BUDGET_AUTHORITY[norm(scopeKind)])
  == committed authority (backend scopeForRequest)  -> never diverge

telemetry: AUTHORITY = "global:telemetry" (global-only) -> no divergence, unchanged (FR-E)
```

## Out of Scope

- **Rewriting `RoutingConfigPort.set()` into a merging writer** — it stays a
  full-document CAS writer; the operator-dispatch merge lives in each plan's `apply`
  (FR-C), exactly as Feature 024 established.
- **Any operator payload, command id, catalog version, dispatch path, or feature flag
  change** — `smart.on`/`budget.set` are already `mutates: true`; only the handler /
  command-port body changes.
- **Changing telemetry** — it is global-only and already correct (FR-E); no change is
  made.
- **Changing the TUI smart/budget forms** — the forms already compose and dispatch the
  payload; this feature only makes the dispatch land on the right authority.

## Related Features and Decisions

- [ADR-0025 — Align smart and budget operator config write authority with the request scope](../../adr/0025-align-smart-and-budget-operator-config-write-authority-with.md)
- [Feature 024 — Implement routing configure persistence so operator routing](../024-implement-routing-configure-persistence-so-operator-routing/spec.md) — the `routing.configure` request-scope fix (FR-F) this feature mirrors for smart/budget, and the flagged Feature 025 candidate.
- [Feature 013 — Wire the four remaining config-backed operator domains](../013-wire-the-four-remaining-config-backed-operator-domains-so/spec.md) — the `smart`/`budget` backends and their `AUTHORITY` maps + budget hard ceiling.
- [Feature 021 — Operator config-backed saves must persist reliably and never silently zero](../021-operator-config-backed-saves-must-persist-reliably-and-never/spec.md) — the shared-`routing`-authority CAS-token / preflight invariants and `command-authority.ts` SSOT the fix reuses.
- [Feature 001 — Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — the routing config adapter (`config-adapter.ts`) and `RoutingConfig.Info` schema.

## Clarifications

### Session 2026-07-20

- **The write authority follows the REQUEST scope, not the effective origin/payload
  (FR-A, FR-B).** `smart` used `scopeForOrigin(effective.origin)`; `budget` passed an
  un-normalized scope. Both are corrected to derive the authority from
  `ctx.request.scope.kind` normalized the SAME way the preflight normalizes, via the
  shared `SMART_AUTHORITY`/`BUDGET_AUTHORITY` SSOT. Recorded in ADR-0025.
- **The merge lives in `apply(current)`, over the FRESH payload (FR-C).** Both backends
  now merge only the domain-owned field into the fresh on-disk payload (smart no longer
  snapshots the whole effective config; budget's `planWrite` re-runs its budget-only
  transform over `current`), so `role_pools`/`activation`/`budget` coexist even under a
  concurrent write. Recorded in ADR-0025.
- **telemetry is confirmed unaffected (FR-E).** `telemetry/backend-live.ts` exports a
  single `global:telemetry` authority with no scope split and an `apply` that already
  merges into `current`; its preflight resolves the same constant. No change. Recorded
  in ADR-0025.
- **Alternatives rejected (ADR-0025).** Keeping the origin/payload derivation and
  re-seeding the project doc in the client (a mask), a self-committing backend, and a
  plan-time-snapshot merge (that could clobber a concurrently-written sibling) were all
  rejected in favor of the request-scope derivation + `apply(current)` merge that
  mirrors Feature 024.
