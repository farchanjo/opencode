# Tasks: Align Smart And Budget Operator Config Write Authority With The Request Scope (Feature 025)

Synced with plan.md (Phase A smart request-scope authority, Phase B budget request-scope
authority, Phase C telemetry non-divergence check, Phase D regression proof + validate)
and the specScopeGlobs in doc/arch/speckit.toml. ADR-0025 proposed.

Behavior change ONLY. NO operator payload change, NO command id, NO catalog version bump,
NO new dispatch path, NO new flag, NO parallel config store — and NO self-commit and NO
weakening of the single-committed-CAS-write / optimistic-concurrency guard, NO relaxing
of the budget hard ceiling (FR-D). The fix moves the `smart`/`budget` write authority to
the REQUEST scope (matching the mutation preflight) (FR-A, FR-B), hardens the commit-time
merge to `apply(current)` so a Save never clobbers a sibling (FR-C), confirms telemetry is
global-only and unchanged (FR-E), and proves the reproduced scenarios over the REAL wired
dispatcher (FR-F). Mirrors the Feature 024 `routing.configure` fix verbatim.

## Task Breakdown

- [x] T001 — smart write authority follows the REQUEST scope (`scopeForRequest`) (FR-A)
- [x] T002 — smart `apply(current)` merges only activation into the fresh payload (FR-C)
- [x] T003 — budget write authority follows the REQUEST scope, normalized (FR-B)
- [x] T004 — budget `planWrite` merges the budget-only transform over `apply(current)` (FR-C)
- [x] T005 — Confirm telemetry is global-only and unchanged (FR-E)
- [x] T006 — FR-F regression proof over the REAL wired dispatcher (no masking seed)
- [x] T007 — `bun test` + `tsc` + `speckit validate --json` green + doc sync

---

## Phase A — smart write authority follows the request scope (FR-A, FR-C) — FIRST

- [x] **T001 — smart derives its write authority from the request scope**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/smart/backend-live.ts`,
  `packages/opencode/src/operator/smart/smart-port.ts`,
  `packages/opencode/src/operator/smart/smart-command-port.ts`
- **Deliverable:** replace `scopeForOrigin(effective.origin)` with
  `scopeForRequest(scopeKind) = scopeKind === "global" ? "global" : "project"`, threaded
  from the inbound command port (`ctx.request.scope.kind` into
  `resolve`/`planOn`/`planOff`/`planAuto`). The `SmartBackend` interface gains a
  `requestScopeKind: string` parameter on each method. The authority is resolved through
  the SAME exported `AUTHORITY` map `command-authority.ts` imports as `SMART_AUTHORITY`
  (no re-typed table). The effective config is still read for the summary + merge base.
- **Acceptance:** a project-scope `planOn` on a FRESH store targets `routing` (not
  `global:routing`); a global-scope `planOn` targets `global:routing`; the preflight and
  the committed authority match.
- **Verification:** `bun test test/operator/smart/`.
- **Evidence:** 2026-07-20 — `smart/backend-live.ts:54-72` `scopeForRequest` (was
  `scopeForOrigin`); `readState(requestScopeKind)` (`:69`), `resolve(requestScopeKind)`,
  `planMutate(_input, requestScopeKind, patch)`; `planOn/planOff/planAuto` take
  `requestScopeKind`. `smart-port.ts:57-62` `SmartBackend` methods gain
  `requestScopeKind`. `smart-command-port.ts:169-175` passes `ctx.request.scope.kind`.
  `test/operator/smart/backend-live.test.ts` updated: project-scope `planOn` → `routing`,
  global-scope → `global:routing`. `test/operator/smart/` green (23 tests).

## Phase A — smart apply(current) merge (FR-C)

- [x] **T002 — smart `apply(current)` merges only activation into the fresh payload**
- **Depends:** T001
- **Paths:** `packages/opencode/src/operator/smart/backend-live.ts`
- **Deliverable:** `planMutate`'s `apply(current)` decodes the FRESH persisted payload
  (`parseRouting`) and merges ONLY the activation transform into it (`{ ...base,
  activation: patch(base.activation) }`), falling back to the plan-validated document on
  create-if-absent — it no longer returns a plan-time whole-config snapshot, so
  `models.role_pools` (pools.set) and `enforcement.budget` (budget.*) are preserved. This
  mirrors the `routing.configure` `apply(current)` merge (Feature 024 FR-C).
- **Acceptance:** merging over a document that holds `role_pools` + `enforcement.budget`
  preserves both while flipping `activation`.
- **Verification:** `bun test test/operator/feature025-smart-budget-scope.test.ts`.
- **Evidence:** 2026-07-20 — `smart/backend-live.ts:36-39` `parseRouting`;
  `planMutate` `apply` merges `activation` into the parsed fresh payload. feature025 (d)
  full-coexistence proof green (role_pools + activation + budget + mode all survive).

## Phase B — budget write authority follows the request scope (FR-B, FR-C)

- [x] **T003 — budget derives its write authority from the request scope, normalized**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/budget/budget-command-port.ts`
- **Deliverable:** derive `scope: BudgetScope = ctx.request.scope.kind === "global" ?
  "global" : "project"` — the SAME normalization the preflight uses
  (`BUDGET_AUTHORITY[norm(scope.kind)]`) — instead of `(payload.scope ??
  ctx.request.scope.kind) as BudgetScope`. The authority-bearing scope now comes from the
  request scope the preflight sees, never a payload-supplied scope the preflight never
  sees. No backend signature change (scope already travels in `BudgetSetInput.scope`).
- **Acceptance:** a project-scope `budget.set` targets `routing`; a global-scope one
  targets `global:routing`; a non-normalized scope kind no longer resolves an `undefined`
  authority.
- **Verification:** `bun test test/operator/budget/`.
- **Evidence:** 2026-07-20 — `budget/budget-command-port.ts` `scope = ctx.request.scope.kind
  === "global" ? "global" : "project"` (was the un-normalized payload/request passthrough).
  `test/operator/budget/` green (14 tests, ctx scope kind "project" → `routing`).

- [x] **T004 — budget `planWrite` merges the budget-only transform over `apply(current)`**
- **Depends:** T003
- **Paths:** `packages/opencode/src/operator/budget/backend-live.ts`
- **Deliverable:** `planWrite(scope, transform, planBase)` validates `transform(planBase)`
  at plan time and its `apply(current)` re-runs the SAME budget-only transform
  (`applyLimits`/`resetBudget`) over the FRESH persisted payload (`parseRouting`), falling
  back to the plan-validated document on create-if-absent, so `models.role_pools` +
  sibling `activation` are never clobbered. `planSet`/`planReset` pass the transform
  closure instead of a pre-computed config.
- **Acceptance:** merging over a document that holds `role_pools` + `activation.enabled`
  preserves both while tightening the budget.
- **Verification:** `bun test test/operator/feature025-smart-budget-scope.test.ts`.
- **Evidence:** 2026-07-20 — `budget/backend-live.ts:72-75` `parseRouting`; `planWrite`
  takes `(scope, transform, planBase)` and `apply` re-runs the transform over `current`;
  `planSet` → `(current) => applyLimits(current, input.limits)`, `planReset` →
  `resetBudget`. feature025 (d) coexistence + (b) fresh-project two-save green.

## Phase C — telemetry non-divergence check (FR-E)

- [x] **T005 — Confirm telemetry is global-only and unchanged**
- **Depends:** none
- **Paths:** (read-only) `packages/opencode/src/operator/telemetry/backend-live.ts`,
  `packages/opencode/src/operator/application/command-authority.ts`
- **Deliverable:** verify `telemetry/backend-live.ts` exports
  `AUTHORITY = "global:telemetry"` (a single global-only constant, no per-scope split, no
  `scopeForOrigin`) and its write `apply` already merges into `current`
  (`backend-live.ts:148`), and that `command-authority.ts` `case "telemetry": return
  TELEMETRY_AUTHORITY` resolves the SAME constant. Confirm there is no request/origin
  divergence and make NO change.
- **Acceptance:** telemetry preflight authority == committed authority for every scope
  (always `global:telemetry`); no code change.
- **Verification:** read-through + `bun test test/operator/telemetry/`.
- **Evidence:** 2026-07-20 — `telemetry/backend-live.ts:47` `AUTHORITY = "global:telemetry"
  as const` (global-only); write path `:148` `{ authority: AUTHORITY, apply }` with `apply`
  merging into `current`. `command-authority.ts:89-90` `case "telemetry": return
  TELEMETRY_AUTHORITY`. No scope split → no divergence. UNCHANGED. `test/operator/telemetry/`
  green.

## Phase D — regression proof + validate (FR-F, FR-all)

- [x] **T006 — FR-F regression proof over the REAL wired dispatcher (no masking seed)**
- **Depends:** T002, T004, T005
- **Paths:** `packages/opencode/test/operator/feature025-smart-budget-scope.test.ts`
- **Deliverable:** a suite driving the SAME live dispatcher the TUI uses (smart + budget +
  pools + routing over ONE `store.config`, production `createOperatorAuthorityResolver`
  threaded, NO masking seed) proving: (a) `smart.on` then `smart.off` on a FRESH project →
  both `success`, PROJECT `routing` (never `global:routing`), version bumps; (b) `budget.set`
  twice on a FRESH project → both PROJECT `routing`; (c) global-scope smart/budget →
  `global:routing`; (d) THE FULL COEXISTENCE PROOF — pools.set + smart.on + budget.set +
  routing.configure in sequence, none clobbers the others in the final on-disk
  `config.json` (physical round-trip via `createFileConfigService` + fresh-store re-read);
  (e) invalid budget → typed error, nothing committed; (f) stale expected-version →
  conflict, nothing committed.
- **Acceptance:** all scenarios green; (a)/(b) assert both saves succeed on the PROJECT
  authority with `global:routing` null; (c) asserts `global:routing`; (d) asserts
  role_pools + enabled + budget + mode coexist on disk and re-read; (e)/(f) assert a
  non-success outcome and an unchanged document.
- **Verification:** `bun test test/operator/feature025-smart-budget-scope.test.ts`.
- **Evidence:** 2026-07-20 — `feature025-smart-budget-scope.test.ts` (7 tests, 59
  expect()): (a) FRESH-project `smart.on`+`smart.off` both PROJECT `routing`
  (`global:routing` null), version bumps; (b) `budget.set` twice PROJECT `routing`;
  (c) global-scope smart/budget → `global:routing` (project `routing` null); (d)
  coexistence on-disk (`operator.authorities.routing.payload` holds role_pools +
  activation.enabled + budget.limits.max_turns + activation.mode; `global:routing` absent)
  + fresh `createFileConfigService` re-read; (e) above-ceiling budget → non-success,
  version unchanged; (f) stale token → `conflict`, committed doc preserved. 7 pass.

- [x] **T007 — `bun test` + `tsc` + `speckit validate --json` green + doc sync**
- **Depends:** T006
- **Paths:** `doc/arch/**`, `AGENTS.md`, `README.md`
- **Deliverable:** confirm every write stayed inside scope
  (`packages/opencode/src/operator/{smart,budget}/**`,
  `packages/opencode/test/operator/**`); run the suites, typecheck, and
  `speckit validate --json`; author the 025 corpus (spec/plan/tasks/ADR) in the Feature
  024 style; keep `AGENTS.md`/`README`/`doc/arch` in sync (no code-doc surface change
  expected — the operator command surface is unchanged).
- **Acceptance:** guard clean; `bun test test/operator/ test/routing/` green; `tsc` 0 new
  errors; `speckit validate --json` `ok:true`.
- **Evidence:** 2026-07-20 — `bun test test/operator/ test/routing/` → 741 pass / 3 skip /
  0 fail (incl. the new feature025 suite, +8 over feature024's 733); `bunx tsc --noEmit` →
  0 new errors (pre-existing `dialog-move-session.tsx` only); `speckit validate --json` →
  `ok:true` (pre-existing waived hygiene findings only). Corpus authored: spec/plan/tasks +
  ADR-0025. No AGENTS.md/README surface change (operator command surface unchanged).

## Dependencies

- **Phase A/B are independent** (smart vs budget files disjoint) and both precede the
  regression proof; T002 depends on T001, T004 on T003; T005 (telemetry read-through) is
  independent; T006 depends on T002/T004/T005; T007 gates the commit.
- **No external dependency.** The `smart`/`budget` backends, `createConfigAdapter`, and
  the `command-authority.ts` SSOT are already present; no new SDK call, server change, or
  provider connection is required. Tests use the existing operator test stacks
  (`createDurableOperatorStore`, `createTuiOperatorSlashPort`, `createFileConfigService`).
- **Invariant:** no task self-commits, opens a parallel store, weakens the CAS guard,
  relaxes the budget ceiling, changes telemetry, or adds an operator payload change,
  command id, catalog version bump, dispatch path, or feature flag (FR-D, FR-E, NFR).
