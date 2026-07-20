# Implementation Plan: Align Smart And Budget Operator Config Write Authority With The Request Scope

Feature: 025-align-smart-and-budget-operator-config-write-authority-with
Status target: implemented (this plan tracks the completed implement pass)
ADR: [ADR-0025](../../adr/0025-align-smart-and-budget-operator-config-write-authority-with.md) **proposed**
Spec: [spec.md](spec.md) (FR-A..FR-F; audit result; domain model; mirror-Feature-024 + request-scope-authority + apply(current)-merge + single-committed-write invariants)

## Overview

`smart.*` and `budget.*` mis-scoped their WRITE authority: `smart/backend-live.ts`
derived it from the effective-config ORIGIN (`scopeForOrigin(effective.origin)`) and
`budget-command-port.ts` passed an un-normalized scope through, while the mutation
preflight/CAS token comes from the REQUEST scope
(`command-authority.ts` — `SMART_AUTHORITY`/`BUDGET_AUTHORITY[norm(scope.scopeKind)]`).
On a FRESH project (no project routing doc) these DIVERGE: SAVE#1 silently persists to
`global:routing`, SAVE#2 hard-fails `invalid_argument` ("mutations require version") —
the SAME class Feature 024 fixed for `routing.configure` (FR-F) and flagged as a Feature
025 candidate. This plan applies the identical request-scope derivation
(`scopeForRequest`) to both domains, threaded from their inbound command ports, and
hardens their commit-time merge to the same `apply(current)` semantics
`routing.configure` uses so a Save never clobbers a sibling. It also verifies (and does
NOT change) `telemetry.*`, which is global-only and already correct.

**Audit conclusion driving this plan (every anchor verified 2026-07-20):**

- **The preflight is the SSOT, already correct.** `createOperatorAuthorityResolver`
  (`command-authority.ts`) resolves the committed authority from the domains' exported
  `SMART_AUTHORITY`/`BUDGET_AUTHORITY` maps keyed by `norm(scopeKind)`. The backends must
  derive their write authority from the SAME request scope + map — no re-typed table.
- **The write path is `mutateAuthority`; `apply(current)` sees the FRESH payload.** Both
  domains return an `OperatorMutationPlan`; the single `mutateAuthority` CAS write
  (`mutation.ts:277-296`) commits it and threads the fresh on-disk payload to `apply`, so
  merging into `current` preserves siblings.
- **Four writers share `routing`.** `pools.set` (`PROJECT_AUTHORITY="routing"`),
  `smart.*`, `budget.*`, and `routing.configure` all target the same per-scope document;
  the merge must preserve the other three's fields.
- **telemetry does not diverge.** `AUTHORITY = "global:telemetry"` (global-only, `apply`
  already merges into `current`); its preflight resolves the same constant.

**Explicitly out of this plan (invariants preserved):**

- **No self-commit, no parallel store.** Both backends read via `createConfigAdapter` and
  return a plan; neither calls `.set()` in the dispatch path or opens a second store.
- **No contract change.** No operator payload, command id, catalog version, dispatch
  path, server/port surface, or feature flag is added or altered — `smart.on`/`budget.set`
  are already `mutates: true`.
- **No telemetry change.** It is global-only and correct (FR-E); only verified.
- **Budget hard ceiling unchanged.** `budget.set` still validates against
  `DEFAULT_ROUTING_BUDGET` and never silently relaxes it (Feature 013 FR4).

## Technical Approach

### Architecture layers affected

```
Phase A — smart write authority follows the request scope  (FR-A, FR-C)
  smart/backend-live.ts: scopeForOrigin -> scopeForRequest(requestScopeKind)
    thread requestScopeKind through readState/resolve/planOn/planOff/planAuto
    apply(current) merges ONLY activation into the fresh payload (no snapshot)
  smart/smart-port.ts: SmartBackend methods gain requestScopeKind param
  smart/smart-command-port.ts: pass ctx.request.scope.kind
        |
        v
Phase B — budget write authority follows the request scope  (FR-B, FR-C)
  budget/budget-command-port.ts: scope = norm(ctx.request.scope.kind)  (global|project)
  budget/backend-live.ts: planWrite re-runs the budget-only transform over apply(current)
        |
        v
Phase C — telemetry non-divergence check  (FR-E)
  telemetry/backend-live.ts: confirm AUTHORITY="global:telemetry" (global-only) — NO change
        |
        v
Phase D — regression proof + validate  (FR-F, FR-all)
  feature025-smart-budget-scope.test.ts over the REAL wired dispatcher (NO seed):
    (a) smart.on then smart.off on a FRESH project -> both PROJECT "routing", version bump
    (b) budget.set twice on a FRESH project -> both PROJECT "routing"
    (c) global-scope smart/budget -> global:routing
    (d) coexistence: pools + smart + budget + routing.configure on-disk + fresh re-read
    (e) invalid budget -> typed error, nothing committed
    (f) stale expectedVersion -> conflict, nothing committed
  bun test test/operator/ test/routing/ green; tsc 0 new; speckit validate --json ok
```

### Guard-scope note

Every write lands inside the active-feature implement scope
(`doc/arch/speckit.toml` `[guard] specScopeGlobs`): the operator domain files
`packages/opencode/src/operator/{smart,budget}/**` are under `packages/opencode/src/operator/**`;
the regression test lands under `packages/opencode/test/operator/**`; the smart backend
unit test update is under the same tree. No file outside scope is written — `pools`,
`routing.configure`, `telemetry`, and `command-authority.ts` are READ (their pattern /
SSOT is mirrored), not modified.

### Phase A — smart write authority follows the request scope (FR-A, FR-C)

- `smart/backend-live.ts`: replace `scopeForOrigin(effective.origin)` with
  `scopeForRequest(scopeKind) = scopeKind === "global" ? "global" : "project"`. Thread
  `requestScopeKind` through `readState`, `resolve`, and `planMutate`. The effective
  config is still read for the summary + merge base/defaults; only the write scope moves.
- `planMutate`'s `apply(current)` decodes the FRESH persisted payload and merges ONLY the
  activation transform into it (falling back to the plan-validated document on
  create-if-absent) — it no longer returns a plan-time whole-config snapshot, so
  `role_pools`/`budget` are preserved.
- `smart/smart-port.ts`: the `SmartBackend` methods gain a `requestScopeKind: string`
  parameter. `smart/smart-command-port.ts`: pass `ctx.request.scope.kind`.

### Phase B — budget write authority follows the request scope (FR-B, FR-C)

- `budget/budget-command-port.ts`: derive
  `scope: BudgetScope = ctx.request.scope.kind === "global" ? "global" : "project"` — the
  SAME normalization the preflight uses — instead of `(payload.scope ??
  ctx.request.scope.kind) as BudgetScope`. No backend signature change (scope already
  travels in `BudgetSetInput.scope`).
- `budget/backend-live.ts`: `planWrite(scope, transform, planBase)` validates
  `transform(planBase)` at plan time and its `apply(current)` re-runs the SAME
  budget-only transform (`applyLimits`/`resetBudget`) over the fresh payload, preserving
  siblings.

### Phase C — telemetry non-divergence check (FR-E)

- Confirm `telemetry/backend-live.ts` exports `AUTHORITY = "global:telemetry"`
  (global-only, no scope split, `apply` already merges into `current`) and its preflight
  resolves the same constant. Record the verdict; make NO change.

### Phase D — regression proof + validate (FR-F)

- `feature025-smart-budget-scope.test.ts` drives the REAL wired dispatcher (smart +
  budget + pools + routing over one `store.config`, production authority resolver
  threaded, NO masking seed) and proves (a)-(f) above, including a physical on-disk
  `config.json` full-coexistence round-trip and a fresh-store re-read. Update the smart
  `backend-live.test.ts` unit grid for the new signature/authority semantics. `bun test
  test/operator/ test/routing/` green; `bunx tsc --noEmit` 0 new errors (beyond the
  pre-existing `dialog-move-session.tsx`); `speckit validate --json` `ok:true`.

## Companion Artifacts

The following optional companion files may be created alongside this plan:

- `research.md` — the Feature 024 mirror analysis and the origin-vs-request divergence
  repro (captured inline in the spec and ADR; deferred as a separate file).
- `data-model.md` — no new domain shape; the fix reuses the existing routing config +
  smart/budget protocol schemas (`packages/schema/src/routing/config.ts`,
  `packages/protocol/src/{smart,budget}/commands.ts`).
- `contracts/` — no new interface contract; the operator payload, command id, and
  dispatch path are unchanged (the `SmartBackend` interface is an internal seam, not a
  wire contract).
- `quickstart.md` — reproducing the fresh-project two-save + full-coexistence flow over
  the operator sandbox (covered by `feature025-smart-budget-scope.test.ts`).
