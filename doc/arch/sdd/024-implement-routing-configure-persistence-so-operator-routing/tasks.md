# Tasks: Implement Routing Configure Persistence So Operator Routing (Feature 024)

Synced with plan.md (Phase A export the authority SSOT, Phase B the write-capable
configure backend, Phase C the inbound mutation-plan path, Phase D compose into the live
stack, Phase E regression proof + validate) and the specScopeGlobs in
doc/arch/speckit.toml. ADR-0024 proposed.

Behavior + wiring change ONLY. NO operator payload change, NO command id, NO catalog
version bump, NO new dispatch path, NO new flag, NO parallel config store — and NO
self-commit and NO weakening of the single-committed-CAS-write / optimistic-concurrency
guard (FR-D). The fix wires a write-capable configure backend mirroring smart/pools
(FR-A, FR-B), partial-merges into the shared `routing` document under CAS to preserve
role_pools + activation (FR-C), and proves the reproduced scenarios over the REAL wired
dispatcher (FR-E).

## Task Breakdown

- [x] T001 — Export the routing-module authority SSOT from `config-adapter.ts`
- [x] T002 — Add the write-capable `RoutingConfigureBackend` (mirror smart/pools)
- [x] T003 — Partial-merge under CAS in the plan's `apply(current)` (preserve siblings)
- [x] T004 — Replace the `not_implemented` stub with the inbound mutation-plan path
- [x] T005 — Wire the configure backend into the live stack (`stack-live.ts`)
- [x] T006 — FR-E regression proof over the REAL wired dispatcher
- [x] T007 — `bun test` + `tsc` + `speckit validate --json` green + doc sync
- [x] T008 — Fix-round: write authority follows the REQUEST scope, not the origin (FR-F)

---

## Phase A — Export the routing-module authority SSOT (FR-A, NFR) — FIRST

- [x] **T001 — Export `AUTHORITY` from `config-adapter.ts`**
- **Depends:** none
- **Paths:** `packages/opencode/src/routing/adapters/outbound/config-adapter.ts`
- **Deliverable:** promote the private per-scope authority map
  (`{ global: "global:routing", project: "routing" }`) to an `export const AUTHORITY`
  so the configure backend consumes ONE routing-module source of truth (no re-typed
  table), matching how `pools`/`smart`/`command-authority` resolve the same `routing`
  document.
- **Acceptance:** `AUTHORITY.project === "routing"`, `AUTHORITY.global === "global:routing"`;
  no behavior change to existing readers of `config-adapter`.
- **Verification:** `bun test test/routing/`.
- **Evidence:** 2026-07-20 — `config-adapter.ts:31-34` exports `AUTHORITY` (was private);
  consumed by `configure-backend.ts`. `test/routing/` green (235 pass).

## Phase B — The write-capable configure backend (FR-A, FR-B, FR-C)

- [x] **T002 — Add `createRoutingConfigureBackend` (mirror smart/pools)**
- **Depends:** T001
- **Paths:** `packages/opencode/src/routing/adapters/outbound/configure-backend.ts`
- **Deliverable:** a `RoutingConfigureBackend` with
  `planConfigure(input): Effect<OperatorMutationPlan, RoutingError>` that reuses
  `createConfigAdapter` for reads (project>global>default — no parallel store), resolves
  the write scope via `scopeForOrigin`, VALIDATES the patched `RoutingConfig.Info` at
  plan time (invalid mode / malformed budget / schema violation → typed
  `invalid_argument`), and returns `{ authority: AUTHORITY[scope], apply }`. Mirrors
  `smart/backend-live.ts` `planMutate` and `pools/backend-live.ts` `planWrite`; the
  backend NEVER self-commits.
- **Acceptance:** a valid input yields a plan whose `authority` is the scoped routing
  authority; an invalid budget policy fails as `invalid_argument` before any plan.
- **Verification:** `bun test test/routing/feature024-configure-persist.test.ts`.
- **Evidence:** 2026-07-20 — `configure-backend.ts` `createRoutingConfigureBackend`;
  `planConfigure` reads effective, validates via `Schema.decodeUnknownExit(RoutingConfig.Info)`
  → `invalid_argument` on failure, else `{ authority, apply }`. Config reads
  guarded (`Effect.tryPromise` → `unavailable`). feature024 (c) invalid-policy test green.
  NOTE: the initial `scopeForOrigin(effective.origin)` write-scope derivation was SUPERSEDED
  by T008 (fix-round) — the write authority now comes from the request scope.

- [x] **T003 — Partial-merge under CAS in `apply(current)` (preserve siblings)**
- **Depends:** T002
- **Paths:** `packages/opencode/src/routing/adapters/outbound/configure-backend.ts`
- **Deliverable:** `applyConfigure(base, input)` merges ONLY the configure-owned fields
  (`activation.enabled`/`mode` + `enforcement.budget`) into `base`, preserving every
  sibling key. The plan's `apply(current)` decodes the FRESH persisted payload
  `mutateAuthority` threads in and merges into it (falling back to the plan-validated
  document on create-if-absent), so `models.role_pools` (owned by `pools.set`) and
  sibling `activation` (owned by `smart.*`) are NEVER clobbered. `RoutingConfigPort.set()`
  stays a full-document writer — the dispatch-path merge lives here (FR-C).
- **Acceptance:** merging over a document that holds `role_pools` + `activation.enabled`
  preserves both while setting the configure fields.
- **Verification:** `bun test test/routing/feature024-configure-persist.test.ts`.
- **Evidence:** 2026-07-20 — `configure-backend.ts:92-102` `applyConfigure` (spreads over
  base, only touches activation/enforcement.budget); `:137-141` `apply(current)` parses
  fresh payload and merges. feature024 (b) coexistence proof green (role_pools + enabled +
  mode/budget all survive on-disk + fresh re-read).

## Phase C — The inbound mutation-plan path (FR-B, FR-D)

- [x] **T004 — Replace the `not_implemented` stub with the mutation-plan path**
- **Depends:** T002
- **Paths:** `packages/opencode/src/routing/adapters/inbound/routing-command-port.ts`
- **Deliverable:** `createRoutingDomainPort(routing, configure?)` gains the optional
  backend. The `routing.configure` case parses `{ enabled, mode, ...advanced }`
  (`parseConfigure`), validates `mode` against `always|auto|never`, rejects an all-empty
  payload as `invalid_argument`, and returns the plan via a `runPlan` helper (mirroring
  smart/pools). With NO backend it keeps answering `not_implemented` (a read-only port
  genuinely cannot persist). RoutingErrors map to the existing operator failure envelope
  (`routingErrorToFailure`).
- **Acceptance:** with a backend, a valid Save returns `mutation_plan`; an invalid
  mode/empty payload returns `invalid_argument`; without a backend, `routing.configure`
  returns `not_implemented`.
- **Verification:** `bun test test/routing/`.
- **Evidence:** 2026-07-20 — `routing-command-port.ts:116-131` `runPlan`, `:133-157`
  `parseConfigure`, `:160` `createRoutingDomainPort(routing, configure?)`, `:190-201`
  the `routing.configure` case (backend-absent → not_implemented; parsed+valid →
  `runPlan(configure.planConfigure)`). Existing `command-contract`/`routing-command-port`
  tests (backend-less → not_implemented) still green.

## Phase D — Compose into the live stack (FR-A)

- [x] **T005 — Wire the configure backend into the live stack**
- **Depends:** T004
- **Paths:** `packages/opencode/src/operator/stack-live.ts`
- **Deliverable:** replace `routing: createRoutingDomainPort(routingService)` with
  `routing: createRoutingDomainPort(routingService, createRoutingConfigureBackend({ config: store.config }))`
  over the SAME committed `store.config` seam smart/budget/pools use — no parallel store,
  no new command id. Follows the smart/pools backend wiring
  (`stack-live.ts:791-799`).
- **Acceptance:** the live routing domain port is write-capable; the dispatcher commits
  `routing.configure` via `mutateAuthority`.
- **Verification:** `bun test test/operator/`.
- **Evidence:** 2026-07-20 — `stack-live.ts:35` imports `createRoutingConfigureBackend`;
  `stack-live.ts:818` wires it into `createRoutingDomainPort`. `test/operator/` green.

## Phase E — Regression proof + validate (FR-E, FR-all)

- [x] **T006 — FR-E regression proof over the REAL wired dispatcher**
- **Depends:** T005
- **Paths:** `packages/opencode/test/routing/feature024-configure-persist.test.ts`
- **Deliverable:** a suite driving the SAME live dispatcher the TUI uses (smart + pools +
  routing over ONE `store.config`, production `createOperatorAuthorityResolver` threaded)
  proving: (a) a `routing.configure` Save → `success`, persists activation/mode/policy,
  CAS version bumps, and a second configure threading the bumped version persists;
  (b) THE COEXISTENCE PROOF — pools.set + smart.on + routing.configure in sequence, none
  clobbers the others in the final on-disk `config.json` (physical round-trip via
  `createFileConfigService` + fresh-store re-read); (c) invalid policy JSON → typed
  validation error, nothing committed; (d) stale expected-version → conflict, nothing
  committed.
- **Acceptance:** all scenarios green; (a) asserts persisted fields + version bump;
  (b) asserts role_pools + enabled + mode/budget coexist on disk and re-read;
  (c)/(d) assert a non-success outcome and an unchanged document.
- **Verification:** `bun test test/routing/feature024-configure-persist.test.ts`.
- **Evidence:** 2026-07-20 — `feature024-configure-persist.test.ts` (7 tests, 55
  expect()): (a) FRESH-project persist+bump to the PROJECT `routing` authority
  (`global:routing` absent) + 2nd-configure persist; (b) coexistence on-disk
  (`operator.authorities.routing.payload` holds role_pools + activation.enabled +
  mode + budget.cost.cost_budget_usd=42) + fresh `createFileConfigService` re-read;
  (c) invalid budgetPolicy → non-success, version unchanged; (d) stale token →
  `conflict`, committed doc preserved; (e) global-resolved base + project-scope configure
  creates the project override, 2nd save succeeds. 7 pass. The `seedProjectRouting` mask
  was removed from (a)/(e) (see T008).

- [x] **T007 — `bun test` + `tsc` + `speckit validate --json` green + doc sync**
- **Depends:** T006
- **Paths:** `doc/arch/**`, `AGENTS.md`, `README.md`
- **Deliverable:** confirm every write stayed inside scope
  (`packages/opencode/src/routing/**`, `packages/opencode/src/operator/**`,
  `packages/opencode/test/routing/**`); run the suites, typecheck, and
  `speckit validate --json`; author the 024 corpus (spec/plan/tasks/ADR/schema) in the
  Feature 019-023 style; keep `AGENTS.md`/`README`/`doc/arch` in sync (no code-doc
  surface change expected — the operator command surface is unchanged).
- **Acceptance:** guard clean; `bun test test/routing/ test/operator/` green; `tsc` 0
  new errors; `speckit validate --json` `ok:true`.
- **Evidence:** 2026-07-20 — `bun test test/routing/ test/operator/` → 733 pass / 3 skip
  / 0 fail (incl. the new feature024 suite); `bunx tsc --noEmit` → 0 new errors (11
  pre-existing `dialog-move-session.tsx` only); `speckit validate --json` → `ok:true`
  (pre-existing waived hygiene findings only). Corpus authored: spec/plan/tasks + ADR-0024
  + schema cue. No AGENTS.md/README surface change (operator command surface unchanged).

- [x] **T008 — Fix-round: write authority follows the REQUEST scope, not the origin (FR-F)**
- **Depends:** T007
- **Paths:** `packages/opencode/src/routing/adapters/outbound/configure-backend.ts`,
  `packages/opencode/src/routing/adapters/inbound/routing-command-port.ts`,
  `packages/opencode/test/routing/feature024-configure-persist.test.ts`
- **Deliverable:** an adversarial review confirmed a HIGH defect: `planConfigure` derived
  its write authority from the effective-config ORIGIN (`scopeForOrigin(effective.origin)`)
  while the mutation preflight/CAS-token authority comes from the REQUEST scope
  (`command-authority.ts` `case "routing": SMART_AUTHORITY[norm(scopeKind)]`). On a fresh
  project with no project-scope routing doc these DIVERGE: SAVE#1 silently persisted to
  `global:routing`, SAVE#2 failed `invalid_argument` ("mutations require version"). The
  committed test masked this with a `seedProjectRouting` precondition (forcing
  origin=project). Fix: thread `ctx.request.scope.kind` into `planConfigure` and derive the
  write authority via `scopeForRequest` (global → `global:routing`, else → project
  `routing`) — the SAME map the preflight uses, as `pools.set` does — so preflight and
  commit authority always match. The effective config is still read for the merge
  base/defaults; only the write TARGET moved to the request scope.
- **Acceptance:** two consecutive project-scope Saves on a FRESH (unseeded) project both
  succeed and land on the PROJECT `routing` authority; `global:routing` untouched; the
  masking seed removed from the scenarios that must pass without it; smart/CAS/invalid
  negatives preserved.
- **Verification:** `bun test test/routing/ test/operator/`; `bunx tsc --noEmit`;
  `speckit validate --json`.
- **Evidence:** 2026-07-20 — `configure-backend.ts` `scopeForRequest` + `planConfigure(input,
  requestScopeKind)`; `routing-command-port.ts` passes `ctx.request.scope.kind`.
  Adversarial repro over the real wired dispatcher: BEFORE (origin-based) SAVE#1 →
  `global:routing`, SAVE#2 → `invalid_argument`; AFTER (request-scope) SAVE#1 → project
  `routing` (cas_v1), SAVE#2 → `success`. feature024 (a)/(e) un-masked → 7 pass / 55
  expect(); `test/routing/ test/operator/` → 733 pass / 3 skip / 0 fail; `tsc` 0 new errors;
  `speckit validate --json` `ok:true`. Follow-up recorded (ADR-0024 consequences): `smart.*`
  and `budget.*` carry the SAME latent origin-vs-request divergence (repro-confirmed) — NOT
  fixed here (out of scope), Feature 025 candidate.

## Dependencies

- **Phase A before B.** T001 exports the authority SSOT the configure backend (T002/T003)
  consumes; T004 depends on the backend (T002); T005 wires it (depends on T004); the
  regression proof (T006) depends on the wiring; T007 gates the commit.
- **No external dependency.** The `smart`/`pools` backends and `createConfigAdapter` are
  already present; no new SDK call, server change, or provider connection is required.
  Tests use the existing operator test stacks (`createDurableOperatorStore`,
  `createTuiOperatorSlashPort`, `createFileConfigService`).
- **Invariant:** no task self-commits, opens a parallel store, weakens the CAS guard, or
  adds an operator payload change, command id, catalog version bump, dispatch path, or
  feature flag (FR-D, NFR).
