# Tasks: Complete the Operator Control Plane Persistence and Service (Feature 014)

Synced with plan.md (Phase 1 config round-trip, Phase 2 langlock/jobs
mutation_plan conversion, Phase 3 OutputSpool backend, Phase 4 MCP admin backend,
Phase 5 semantic registry backend, Phase 6 jobs persistence + typed gaps, Phase 7
TUI Partial refinement, Phase 8 tests + doc sync) and the specScopeGlobs in
doc/arch/speckit.toml. ADR-0014 proposed.

Persistence-and-wiring ONLY. NO new catalog id, NO catalog version bump, NO new
dispatch path, NO new flag — the Feature 007 registration + `OperatorClient`
loopback parity invariant (FR13) is preserved. Config mutations persist through the
SAME Config.Service seam via the `mutation_plan` path under CAS and honest-degrade
to typed envelopes (FR5, FR14). Where a live dependency (Milvus, the Feature 002
executor, the lifecycle cancel edge) is unreachable, the verb stays a typed
capability gap. No code is executed in this documentary pass; tasks are the
implement backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below).

- [x] T001 — Accept the `operator` namespace in `ConfigV1.Info` (config schema)
- [x] T002 — Align the `Config.update` write path with the loader read path
- [x] T003 — Invalidate the authority-scoped config cache on commit
- [x] T004 — Round-trip acceptance per config-backed domain (restart-proven)
- [x] T005 — Convert `langlock` command port to the `mutation_plan` contract
- [x] T006 — Convert `jobs` command port to the `mutation_plan` contract
- [x] T007 — Wire the real OutputSpool backend (resolve the AppLayer `Database`)
- [x] T008 — Wire the real MCP admin backend (resolve `MCP.Service` + `McpAuth`)
- [x] T009 — Wire the config-backed semantic registry backend + typed Milvus gap
- [x] T010 — Persist `jobs` mutations over the `JobPersistence` seam
- [x] T011 — Keep `jobs.run-now` + lifecycle `cancel` typed capability gaps
- [x] T012 — Refine the palette persistence classification to per-verb `Partial`
- [x] T013 — Round-trip tests + false-success negative (FR1 without FR2)
- [x] T014 — Commit-contract tests: `langlock`/`jobs` `mutation_plan` end-to-end
- [x] T015 — OutputSpool backend tests (real control store)
- [x] T016 — MCP admin backend tests (live host double)
- [x] T017 — Semantic registry tests + `milvus_unavailable` gate
- [x] T018 — Jobs persistence tests + typed `run-now`/`cancel` gaps
- [x] T019 — TUI `Partial` availability tests
- [x] T020 — Parity test: same command id, no new path / id / version bump (FR13)
- [x] T021 — Guard scope (`speckit.toml` 014 block) + doc sync
- [x] T022 — `speckit analyze` + `speckit validate --json` green

---

## Group A — Config persistence round-trip (FR1, FR2, FR3, FR4)

- [x] **T001 — Accept the `operator` namespace in `ConfigV1.Info`**
- **Depends:** none
- **Paths:** `packages/core/src/v1/config/config.ts`
- **Deliverable:** add a typed `operator` key to `ConfigV1.Info` whose sub-schema
  holds each config-backed domain's persisted document — typed, not free-form
  `unknown`, carrying only `SecretRef` references for secret values (FR11) — so
  `ConfigParse.schema` (`packages/opencode/src/config/parse.ts:40`) accepts a
  persisted operator document instead of raising `ConfigInvalidError` (FR1).
- **Acceptance:** a persisted operator document parses without
  `ConfigInvalidError`; no plaintext-secret field exists in the sub-schema.
- **Verification:** `bun test packages/opencode/test/config/**`; `bun run typecheck`.
- **Evidence (2026-07-19):** `packages/core/src/v1/config/config.ts` — added the
  `Operator` sub-schema (envelope typed at `authorities`/`idempotency`/`rollback`/
  `auditOutbox`; leaf payloads `Schema.Unknown` so arbitrary domain documents
  round-trip losslessly and no plaintext-secret field is declared) and the
  `operator: Schema.optional(Operator)` key on `Info`. `tsgo --noEmit` green for
  `@opencode-ai/core` and `@opencode-ai/opencode`. CLI `op telemetry show` /
  `pools show` (operator flag on) parse the persisted operator document with NO
  `ConfigInvalidError` (previously the durable-store write was rejected as an
  unrecognized top-level key). `bun test test/config/` → 183 pass / 3 skip / 0
  fail. Verified in the persisted global file: `operator.authorities` holds
  `global:telemetry` + `global:routing` records with intact payloads.

- [x] **T002 — Align the `Config.update` write path with the loader read path**
- **Depends:** T001
- **Paths:** `packages/opencode/src/config/**`
- **Deliverable:** choose and implement the smaller honest change so the
  `Config.update` write target and the instance loader read target land on the SAME
  file/authority — teach the loader to read the file `Config.update` writes, or
  redirect the write to a loader-consumed file — and record the decision in
  ADR-0014. Accepting the schema key (T001) without this alignment yields a false
  `cas_vN` success and MUST NOT be shipped (FR2).
- **Acceptance:** a committed mutation persists to a path the loader reads back; the
  false-success (`configured:false` re-read) path is closed.
- **Verification:** `bun test packages/opencode/test/config/**`.
- **Decision (2026-07-19):** teach the loader to read the written file, scoped to
  the `operator` key ONLY (recorded in ADR-0014 "Decision Outcome" + plan.md
  Phase 1). `packages/opencode/src/config/config.ts` — new `loadOperatorNamespace`
  helper JSONC-parses `<dir>/config.json`, plucks and validates just the
  `operator` namespace against `ConfigV1.Info`, and `loadInstanceState` deep-merges
  it after the project files. Never adopts the whole file (a project `config.json`
  is a common unrelated filename whose unknown keys would be rejected); malformed/
  absent → `undefined`, no crash. Recovers the previously-orphaned project-scoped
  authorities (`routing`); global-scoped authorities already round-trip via
  `updateGlobal`/`getGlobal`. Redirecting `Config.update`'s shared target was
  rejected as larger/riskier (HTTP handler + flag-bootstrap + user `opencode.json`).
- **Evidence (2026-07-19):** end-to-end CLI proof (T004) — `pools set` (project
  `routing` authority) re-read across a NEW process shows
  `configured:true, bindings:[{role:"build",models:["anthropic/claude-opus"]}],
  version:"cas_v1"` (baseline was `configured:false, [], cas_v0`); the persisted
  `<dir>/config.json` carries `operator.authorities.routing` at `cas_v1` with an
  intact payload. `budget set` project round-trip likewise reflects
  `limits.maxTurns:7 … cas_v1`. The pre-fix `configured:false` false-success path
  is closed. `bun test test/config/ test/operator/` → 523 pass / 5 skip / 0 fail.

- [x] **T003 — Invalidate the authority-scoped config cache on commit**
- **Depends:** T002
- **Paths:** `packages/opencode/src/config/**`
- **Deliverable:** on a committed CAS mutation, invalidate the loader's cached
  document for the mutated authority so an immediate re-read reflects the new state;
  keep the invalidation authority-scoped (do not drop unrelated cached config) (FR3).
- **Acceptance:** a mutate → immediate re-read reflects the new state; unrelated
  cached authorities are untouched.
- **Verification:** `bun test packages/opencode/test/config/**`.
- **Evidence (2026-07-19):** `packages/opencode/src/config/config.ts` —
  `Config.update` now calls `InstanceState.invalidate(state)` after writing
  `<dir>/config.json`, dropping ONLY this directory's cached instance config so an
  in-process re-read reloads and reflects the new project-scoped operator
  namespace; the global cache and other directories' caches are untouched
  (directory-scoped `ScopedCache.invalidate`). The global path already invalidates
  its own cache via `Config.updateGlobal` → `invalidate()` (`invalidateGlobal`),
  so global-scoped authorities re-read fresh via `getGlobal()`. `bun test
  test/config/` (523 across config+operator) green; existing update/get and
  updateGlobal tests unaffected. Cross-process re-read (the CLI, a fresh process
  each call) reloads from disk independent of the cache — see T004.

- [x] **T004 — Round-trip acceptance per config-backed domain (restart-proven)**
- **Depends:** T003, T005, T006, T010
- **Paths:** `packages/opencode/test/operator/**`, `packages/opencode/test/config/**`
- **Deliverable:** prove, per config-backed domain (`langlock`, `telemetry`,
  `smart`, `budget`, `pools`, `jobs`), the CLI mutation → `success` + version bump →
  immediate re-read → process-restart re-read chain, with no `cas_vN` the loader
  fails to read back (FR4).
- **Acceptance:** every domain round-trips and survives a simulated restart; no
  false success.
- **Verification:** `bun test packages/opencode/test/operator/** packages/opencode/test/config/**`.
- **Evidence (2026-07-19).** Proven via the live CLI (`OPENCODE_OPERATOR_CONTROL_PLANE=1
  bun run --conditions=browser src/index.ts op <domain> <verb> --json --directory=<tmp>`),
  isolated `XDG_*` dirs; **each `op` invocation is a fresh OS process**, so every
  re-read below is a NEW-PROCESS read from disk. `langlock` (override fail-closed
  gate) + `jobs` are deferred to T005/T006 (still self-committing `kind:"query"`);
  the keystone is proven on `telemetry`/`smart`/`budget`/`pools`.
  - **pools** (project `routing` authority — the FR2 path this feature fixes):
    - baseline (proc 1): `{"ok":true,"id":"pools.show","outcome":"success","effective":{"configured":false,"bindings":[],"version":"cas_v0"}}`
    - mutate `pools set` (proc 2): `{"ok":true,"id":"pools.set","outcome":"success","version":"cas_v1", ...role_pools.build=["anthropic/claude-opus"]}`
    - re-read (proc 3, NEW process): `{"ok":true,"id":"pools.show","outcome":"success","effective":{"configured":true,"bindings":[{"role":"build","models":["anthropic/claude-opus"]}],"version":"cas_v1"}}`
    - re-read again (proc 4, NEW process): identical `configured:true … cas_v1`. Persisted `<dir>/config.json` → `operator.authorities.routing` = `cas_v1` with intact payload.
  - **budget** (project `routing`, fresh dir): baseline `configured:false, cas_v0` → `budget set {limits.max_turns:7,…}` → `success, cas_v1` → NEW-PROCESS `budget show` = `{"configured":true,"limits":{"maxTurns":7,"maxContextTokens":123456,"maxOutputTokens":4096,"maxWorkers":3,"tokenBudget":999999},"version":"cas_v1"}`. Full state round-trips.
  - **telemetry** (global `global:telemetry` authority): baseline `configured:false, cas_v0` → `telemetry on` → `success, cas_v1` → NEW-PROCESS `telemetry show` = `{"configured":true, … "version":"cas_v1"}`, stable across two more processes. Namespace persists (version bump + `configured:true`) via the global config file (needs only FR1).
  - **smart** (global `global:routing`, fresh dir): baseline `configured:false, cas_v0` → `smart on` → `success, cas_v1` → NEW-PROCESS `smart status` version bumps to `cas_v1`. `routing`/`global:routing` are shared by pools/smart/budget — a `pools set` at `cas_v1` correctly rejects a later `smart on --expected-version=-` create-sentinel with `currentVersion:cas_v1`, further proving cross-process persistence.
  - **No false success:** the persisted operator payloads are byte-identical on read (verified: raw file JSON round-trips losslessly; `Schema.Unknown` leaves each authority payload intact).
  - **Honest caveat (RESOLVED in the 2026-07-19 fix round — see "## Fix round"):**
    the `smart`/`telemetry` `*.status` false success was NOT a backend decode
    asymmetry as first recorded here — the root cause was the GLOBAL-authority write
    path. `smart`/`telemetry` persist to `global:routing`/`global:telemetry`, which
    `Config.updateGlobal` writes to the global `opencode.jsonc` via `patchJsonc`.
    That writer recursed per key and emitted nothing for an EMPTY object, silently
    dropping `models.role_pools:{}` / `export.headers:{}` — both required — so the
    read-back schema decode failed and the effective read fell to the default (a
    false `cas_vN` success, FR14). `pools`/`budget` round-tripped because they write
    the PROJECT `routing` authority via `Config.update` (`mergeDeep`+`JSON.stringify`,
    which preserves `{}`). Fixed in `patchJsonc` (`packages/opencode/src/config/config.ts`);
    `smart status` / `telemetry status` now re-read `configured:true` across a fresh
    process. Guarded by a new config-write regression test.

---

## Group B — Mutation-plan commit contract (FR5)

- [x] **T005 — Convert `langlock` command port to the `mutation_plan` contract**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/langlock/**`
- **Deliverable:** convert `langlock-command-port.ts` (self-commit + `kind:"query"`
  at `:164`) to return a validated `OperatorMutationPlan` (`application/handler.ts`),
  the `telemetry-command-port.ts` `runPlan` template, so `mutateAuthority` owns the
  single committed CAS write + FR7 audit correlation and the backend never
  self-commits; retire any local `auditId` layer. Reads unchanged (FR5).
- **Acceptance:** a `langlock` mutation commits via `mutateAuthority`; no
  self-committed `query` result is rejected after a write.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence (2026-07-19):** the backend seam now returns plans, not committed
  summaries — `LangLockBackend` (`langlock-port.ts:64`) drops `set`/`reset` (which
  self-committed via `LangLockPersistence.saveConfig`, then the command port's
  `mutation` helper returned `kind:"query"` at the old `:164` → the dispatcher
  rejected the shape for a `mutates:true` descriptor AFTER the write had already
  landed = a phantom write / false failure) for `planSet`/`planReset` returning
  `Effect<OperatorMutationPlan, LangLockPolicyError>` (`backend-live.ts:110-150`).
  Validation (tag allowlist + the fail-closed `langlock.override` gate) runs at PLAN
  time BEFORE any plan is produced, so a rejected mutation persists nothing; the pure
  `apply` bumps the content-free document's domain `policy_version` off the committed
  `current` and re-encodes via `Schema.encodeSync` (byte-identical to the old
  `saveConfig` write). `LangLockPersistence.authorityFor` (`persistence.ts`) is
  exposed so the plan names the same `langlock/global` | `langlock/project/<id>`
  authority the reads use. `langlock-command-port.ts` consumes the backend directly
  (dropped the `createLangLockPort` auditId wrapper) with the `runPlan` template
  (audits only rejections; a successful plan is audited by `mutateAuthority`); reads
  emit `query(summary)` unchanged. `stack-wiring.ts` composes over the backend
  (`port: deps.backend`); `stack-live.ts` unaffected. Proof (new
  `test/operator/feature014-wire.test.ts`, full dispatcher + slash wire): a global
  `langlock.set {tag:"pt-BR"}` → `success` and a re-read `langlock.show` reflects
  `tag:"pt-BR"`; a committed `langlock.reset` reverts to `en-US` under CAS; a
  grant-present project override commits (`origin:"project"`); a stale-CAS
  `--expected-version=cas_v9` on the absent `langlock/global` → `conflict` with
  `config.get("langlock/global") === null` (NO phantom write); a fail-closed project
  override → `unauthorized` with `config.get("langlock/project/proj_14") === null`.
  `test/langlock/e2e.test.ts` (T040) retargeted to `planSet`/`planReset` +
  a `commitPlan` helper (added a direct no-self-commit assertion: a produced-but-
  uncommitted plan leaves `resolve` at the default). `tsgo --noEmit` green
  (`@opencode-ai/core` + `@opencode-ai/opencode`). `bun test test/operator/ test/jobs/
  test/langlock/ test/config/` → 629 pass / 5 skip / 0 fail.

- [x] **T006 — Convert `jobs` command port to the `mutation_plan` contract**
- **Depends:** none
- **[P]** with T005 (distinct domain dir)
- **Paths:** `packages/opencode/src/operator/jobs/**`
- **Deliverable:** convert the `jobs` command port from self-commit + `kind:"query"`
  to the `OperatorMutationPlan` contract exactly as T005, so `mutateAuthority` owns
  the commit; reads unchanged (FR5).
- **Acceptance:** a `jobs` mutation commits via `mutateAuthority`; no self-committed
  `query` result is rejected after a write.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence (2026-07-19):** `JobsBackend` (`jobs-port.ts:89`) keeps the reads
  (`list`/`status`/`show`/`history`/`watch`) unchanged and replaces the mutating
  methods with `planCreate`/`planUpdate`/`planEnable`/`planDisable`/`planDelete`/
  `planReschedule`/`planRunNow` returning `Effect<OperatorMutationPlan, JobsError>`.
  `jobs-command-port.ts` consumes the backend directly (dropped the `createJobsPort`
  auditId wrapper), routing every mutating verb through the same `runPlan` template
  as langlock/telemetry; reads still use `run(...query)`. Because the durable-
  persistence transform is Feature 014 T010 and the executor/scheduler edges are
  T011, `backend-live.ts` honestly degrades each `planX` to the SAME typed capability
  gap the old self-committing methods returned — `planCreate`/`planUpdate`/
  `planDelete`/`planReschedule` → `not_implemented`; `planEnable`/`planDisable`/
  `planRunNow` → `unavailable` — BEFORE any plan is produced, so there is never a
  phantom write. `stack-wiring.ts` composes over the backend; `stack-live.ts`
  unaffected. Proof (`feature014-wire.test.ts`): `jobs.create` dispatched through the
  full pipeline degrades to a typed `not_implemented` failure (NOT the old
  `mutation command cannot return query result` invalid_argument — the contract now
  routes through the plan path); `jobs.enable` → typed `unavailable` and a `jobs.list`
  re-read shows `definitions: []` (no fabricated definition). `test/jobs/
  operator-jobs-port.test.ts` (T033) retargeted to assert each mutating verb yields
  `kind:"mutation_plan"` with the authority and NO command-port audit for a
  successful plan; `test/jobs/backend-live.test.ts` retargeted to the `planX` gap
  methods. `tsgo --noEmit` green; `bun test test/operator/ test/jobs/ test/langlock/
  test/config/` → 629 pass / 5 skip / 0 fail. Real jobs persistence remains T010; the
  typed `run-now`/`cancel` capability gaps remain T011.

---

## Group C — Service backends (FR6, FR7, FR8, FR9, FR10, FR11)

- [x] **T007 — Wire the real OutputSpool backend**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/stack-live.ts`,
  `packages/opencode/src/operator/outputspool/**`
- **Deliverable:** resolve the AppLayer `Database`
  (`packages/opencode/src/effect/app-runtime.ts`) and inject it into
  `createLiveOutputSpoolBackend` (`stack-live.ts:405`), backing `stat`/`read`/
  `follow`/`release`/`delete`/`purge`/`retention.set`/`quota.set` over
  `createControlStore(db)` (`outputspool/control-store.ts:119`), `page-reader.ts`
  `readPage`, and `retention-sweeper.ts`. Preserve the deny-by-default export/share
  policy; guard store I/O → typed `unavailable` (FR6, FR14).
- **Acceptance:** `output.stat`/`read` reflect the real control store; `retention.set`/
  `quota.set` mutate real policy; store outage → typed `unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence (2026-07-19):** the `OutputSpoolBackend` seam
  (`operator/outputspool/outputspool-port.ts`) is converted to the Feature 014
  `OperatorMutationPlan` commit contract — `setRetention`/`setQuota` become
  `planSetRetention`/`planSetQuota` returning `Effect<OperatorMutationPlan, AdminError>`
  (the langlock template) so the mutating verbs no longer self-commit a `query` the
  dispatcher rejects. `backend-live.ts` gains the real composition: injecting a
  `ControlStore` enables `stat` (projects the channel-generation record) and `read`
  (reads one bounded window through `page-reader.ts` `readPage`), each guarded so a
  store outage/absent record degrades to typed `unavailable`/`not_found` — never a
  fabricated page; injecting the retention/quota authority resolvers enables the
  config-backed policy plans (pure `apply`, committed once by `mutateAuthority`
  through the round-trip seam). `outputspool-command-port.ts` routes `retention.set`/
  `quota.set` through a `runPlan` helper (`mutation_plan`, audited only on rejection).
  `stack-live.ts` (`~:407`) opens the outputspool subsystem's own `bun:sqlite`
  control store under `<Global.data>/outputspool/operator-control.db` and injects
  it + the spool root + the `output.retention`/`output.quota` authority resolvers.
  **Honest boundaries (FR14):** the AppLayer `Database` is an EffectDrizzle client,
  incompatible with the `bun:sqlite` `createControlStore` surface, so the operator
  binds the control store's own db (documented in the stack-live comment); `follow`
  (cursor-codec seam) and `release`/`delete`/`purge` (control-store mutations that
  the config-CAS `mutateAuthority` pipeline cannot atomically own without fabricating
  success or a new dispatch path — the FR10 lifecycle-cancel precedent) stay typed
  capability gaps, never forced. New `test/operator/outputspool/feature014-outputspool-wire.test.ts`
  (10 tests, full dispatcher wire over the shared `store.config`): `output.stat`/`read`
  reflect a seeded control-store record; `retention.set`/`quota.set` commit through
  `mutateAuthority` and a re-read of the named authority reflects the descriptor; a
  stale-CAS `retention.set` conflicts with `config.get(...)===null` (no phantom write);
  a store outage → `unavailable`; `delete`/`follow` → typed gap; cross-project
  `share` denied. `bun test test/outputspool/ test/operator/outputspool/` → 100 pass
  / 0 fail. `bun run typecheck` clean for the outputspool + stack-live paths (the
  remaining tsgo errors are the concurrent T010 `operator/jobs/persistence.ts` work,
  not this task). oxlint: warnings only (sibling-style `as` casts + two pre-existing
  `consistent-return` on the exhaustive error-mapper switches), zero errors. Not
  committed (orchestrator commits).

- [x] **T008 — Wire the real MCP admin backend**
- **Depends:** none
- **[P]** with T007, T009 (distinct adapter seam)
- **Paths:** `packages/opencode/src/operator/stack-live.ts`,
  `packages/opencode/src/operator/mcp/**`
- **Deliverable:** resolve `MCP.Service` (`mcp/index.ts:200`) + `McpAuth` via
  `AppRuntime` (the routing/provider precedent, `stack-live.ts:270-311`) into
  `createLiveMcpBackend` (`stack-live.ts:427`), backing the server/auth/resource/
  logging/experimental/extension sub-ports; degrade to typed `mcp_unavailable` only
  when the service is genuinely unbound (FR7, FR14).
- **Acceptance:** `mcp.*` admin verbs reflect the live host; an unbound service →
  typed `mcp_unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence (2026-07-19):** `packages/opencode/src/operator/mcp/backend-live.ts` —
  added `McpHostReader` (a narrow, content-free live-host READ seam) +
  `createMcpServiceOverride`, which overlays the honest gap with real
  `auth.status` + `resource.admin.list`/`templates` ports. `stack-live.ts` (mcp
  block, ~:427) resolves `MCP.Service` via `AppRuntime` (routing/provider
  precedent, `InstanceRef`-bound) into that reader — `getAuthStatus` for auth
  status, `clients()`+`resources()`/`resourceTemplates()` for the resource reads
  (`subscribable` derived from the live `getServerCapabilities().resources.subscribe`).
  **Scope boundary (documented in the backend + this note):** the server-profile
  reads (`server.list`/`status`/`capabilities`) stay typed gaps — `McpServerProfile`
  needs SSOT metadata (CAS version, auditId, timestamps, trust profile) the live host
  config (`cfg.mcp`) does not carry, so projecting them would fabricate state (FR14).
  Every MUTATING verb also stays a typed gap: the Feature 008 `mcp.*` command port
  returns `kind:"query"`, which the Feature 007 dispatcher rejects for a `mutates`
  descriptor AFTER any side effect (`dispatcher.ts:244`) — a live mutation would be
  the exact FR5 phantom-write trap; converting `mcp.*` to `mutation_plan` is out of
  T008 (FR5 = langlock/jobs) and MCP server config is not an operator CAS authority.
  Guarded reads degrade to a typed `unavailable` with a fixed, content-free reason
  (no path/secret/token leak, FR11/FR14). Backward-compatible: `createLiveMcpBackend({})`
  (no override) still returns the full gap, so the Feature 008 tests are unchanged.
  Tests — new `packages/opencode/test/operator/mcp-service-backend.test.ts` (6 pass):
  faithful live reads via the DomainInvoke, unreachable read → typed `unavailable`
  (asserts the raw error path+token is never surfaced), mutating verbs never return a
  successful query, and the FULL dispatcher pipeline (read → `success`; `server.disconnect`
  mutation → `unavailable`, no phantom). `bun test test/operator/ test/mcp/` → 509 pass /
  2 skip / 0 fail; `bun run typecheck` green (`@opencode-ai/opencode`); oxlint 0 errors on
  changed files. End-to-end CLI (isolated `XDG_*`, `OPENCODE_OPERATOR_CONTROL_PLANE=1`):
  `op mcp auth status` → `success {authStatus:"not_authenticated"}`, `op mcp resource
  admin list`/`templates` → `success` live-empty, `op mcp server disconnect` → typed
  `unavailable` (no phantom write, no crash), `op mcp server list` → typed `unavailable`
  gap. Not committed (orchestrator commits).

- [x] **T009 — Wire the config-backed semantic registry backend + typed Milvus gap**
- **Depends:** T002
- **[P]** with T007, T008
- **Paths:** `packages/opencode/src/operator/stack-live.ts`,
  `packages/opencode/src/operator/semantic/**`
- **Deliverable:** wire the config-backed registry ops — `provider.list`/`add`/
  `update`/`disable`/`delete`/`rotate-secret`, `model.list`/`register`/`disable`,
  `binding.status`/`history`, `embedding`/`reranker` `show`/`select` — into
  `createLiveSemanticBackend` (`stack-live.ts:416`) over
  `semantic/credential-resolver.ts` + config, persisting under CAS through the
  round-trip; `rotate-secret` + every secret value go through the SecretPort as a
  `SecretRef` (FR11). Keep the Milvus-gated `index`/`reindex`/`cutover`/`validate`
  (`semantic/milvus-adapter.ts`) typed `milvus_unavailable` (FR8, FR14).
- **Acceptance:** `provider.add` persists + re-reads under CAS; `index` → typed
  `milvus_unavailable`; no plaintext secret persisted.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence (2026-07-19):** the semantic domain now splits cleanly. New
  `packages/opencode/src/operator/semantic/registry-backend.ts` —
  `createConfigBackedRegistry({config})` holds a permissive-but-typed
  `RegistryDocument` (providers/models/embedding/reranker) under the project
  `Config.Service` authority `semantic` (mirrors the pools `routing` seam). Reads
  project the persisted document; the nine config-backed mutations
  (`provider.add`/`update`/`disable`/`delete`/`rotate-secret`, `model.register`/
  `disable`, `embedding.select`, `reranker.select`) VALIDATE at PLAN time and return
  an `OperatorMutationPlan` (`authority:"semantic"`, pure `apply`) so
  `mutateAuthority` owns the single committed CAS write — the backend never
  self-commits (FR5). Secrets are `SecretRef`-only (FR11): a plaintext-looking
  credential is rejected before any write, and the final payload is scanned by the
  Feature 007 `findPlaintextSecretFields` detector; endpoints pass an offline
  SSRF-safe static check (scheme + TLS + literal blocked-address) with full
  DNS-rebinding revalidation reserved for the gated live probe (C17).
  `SemanticBackend` gains an optional `registry` seam (`semantic-port.ts`);
  `backend-live.ts` builds it from an injected `config` (unset keeps the pre-014
  honest gap); `semantic-command-port.ts` routes the config-backed reads via
  `io.run`+`query` and the mutations via a new `io.plan` (`mutation_plan`), while
  `provider.test`, `model.discover`/`validate`, `embedding`/`reranker`
  `validate`/`reindex`/`cutover`/`rollback` and every `index.*` op STAY the exact
  current typed gap (`unavailable`/`milvus_unavailable`) on the four ports.
  `stack-live.ts:421` now wires `createLiveSemanticBackend({ config: store.config })`.
  Proof — new `test/operator/semantic/feature014-registry-wire.test.ts` (9 tests,
  full dispatcher + slash wire over ONE shared `store.config`): `provider.add`
  commits `outcome:"success"` and `provider.list` re-reads the persisted profile
  (v1); `provider.update` bumps the domain version to 2 under CAS and re-reads; a
  stale provider version is rejected with the committed profile unchanged (no
  phantom write); a plaintext-looking `secretRef` and an `http://` endpoint are each
  rejected with `config.get("semantic") === null`; a committed provider persists only
  the `keychain:k@v2` coordinate (never a plaintext value); `model.register` →
  `embedding.select` stages a `draft` binding re-read via `binding.history`;
  `semantic.index.show-collections` returns the typed `milvus_unavailable` gap.
  (`semantic.embedding.show`/`binding.status`/`index.status` are the Feature 007
  config-status honesty ids — they read the same `semantic` authority and report
  `configured/hasPayload`, so the registry serves the non-shadowed reads
  `provider.list`/`model.list`/`reranker.show`/`binding.history` + every mutation.)
  `bun run typecheck` CLEAN; `bun test test/operator/ test/jobs/ test/langlock/
  test/config/ test/semantic/` → 786 pass / 6 skip / 0 fail; oxlint 0 errors
  (warnings are pre-existing sibling-file `as` casts). The pre-existing
  `test/operator/semantic/semantic-command-port.test.ts` (no registry injected)
  stays green — the seam is additive.

- [x] **T010 — Persist `jobs` mutations over the `JobPersistence` seam**
- **Depends:** T002, T006
- **Paths:** `packages/opencode/src/operator/jobs/**`, `packages/opencode/src/jobs/**`
- **Deliverable:** persist the `jobs` mutations (`create`/`update`/`enable`/
  `disable`/`delete`/`reschedule`/`show`/`history`) over the `JobPersistence` seam
  (`jobs/persistence.ts`, over config; depends on the Group A round-trip) under CAS,
  honest-degrading to typed envelopes (FR9, FR14).
- **Acceptance:** a `jobs.create`/`update` persists + re-reads under CAS and survives
  a restart; config outage → typed `unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence (2026-07-19):** new operator-side seam
  `packages/opencode/src/operator/jobs/persistence.ts` (`createOperatorJobPersistence`)
  persists a **bounded operator job record** — only the fields the flat operator input
  carries (name/schedule/action/overlap/misfire/scope/payloadRef + a generated id,
  monotonic domain `version`, timestamps) — in ONE config authority (`jobs`) as a keyed
  map. Assembling a full durable `Definition.JobDefinition` here would have to INVENT
  the `target`/`capability_surface`/budget fields the flat input lacks, which the
  honesty invariant forbids (FR14); the durable-definition assembler + external
  scheduler registration stay the T011 residual. Single-authority CAS discipline: every
  mutating verb is a pure `apply(current)` transform of the `jobs` payload, so
  `mutateAuthority` owns the one committed CAS write and the backend never self-commits
  (FR5, matching the CUE `#CasExpectation` single-authority contract). Validation
  (closed-enum schema decode + `findPlaintextSecretFields`, FR11) runs at PLAN time
  BEFORE any plan, so a rejected mutation persists nothing. `list`/`status`/`show` read
  persisted records (`show` returns the definition + an honestly-empty occurrence list —
  the EventV2 occurrence projection is the T011 residual); `history`/`watch`/`planRunNow`
  stay typed capability gaps. Every read + plan-time load wraps `config.get` in a guarded
  `Effect.tryPromise` → typed `unavailable` (FR14). `backend-live.ts` rewired onto the
  seam; `stack-live.ts:380` constructs it over `store.config`; `jobs-command-port.ts`
  relaxed so a string `cas_vN` envelope token satisfies a mutating verb's CAS requirement
  (the committed config CAS is driven by `request.version`, not the numeric domain
  `expectedVersion`).
  **Live CLI round-trip (each `op` call a fresh OS process = restart-proven; isolated
  `XDG_*` + `--directory`):** `jobs create --expected-version=- --payload …` →
  `success, cas_v1`; a NEW-process `jobs list` returns the persisted definition
  (`enabled:true, version:1`); `jobs status` re-reads it; `jobs disable --yes
  --expected-version=cas_v1` → `success, cas_v2` and a NEW-process `jobs list` shows
  `enabled:false`; a repeat `disable --expected-version=cas_v1` → `conflict` (no phantom
  write); `jobs run-now --expected-version=cas_v2` → typed `unavailable` (Feature 002
  executor gap, T011); `jobs delete --expected-version=cas_v2` → `success` and `jobs
  list` → empty. Tests: `test/jobs/backend-live.test.ts` retargeted to the operator seam
  (9 pass — read projection, enable/update/reschedule/delete round-trip,
  not_found-before-write, config-outage → `unavailable`, RESIDUAL gaps);
  `test/operator/feature014-wire.test.ts` jobs block converted from the T006 gap
  assertions to the T010 full-pipeline round-trip (create→list re-read,
  disable-under-CAS, absent→not_found, stale-CAS→conflict no phantom write,
  run-now→unavailable). `bun run typecheck` green; `bun test test/jobs/
  test/operator/feature014-wire.test.ts test/config/` → 254 pass / 0 fail;
  `persistence.ts` zero new lint warnings. (The 2 failures in the untracked
  `test/operator/semantic/feature014-registry-wire.test.ts` are the still-open T009
  semantic backend, not jobs.)

- [x] **T011 — Keep `jobs.run-now` + lifecycle `cancel` typed capability gaps**
- **Depends:** T010
- **Paths:** `packages/opencode/src/operator/jobs/**`,
  `packages/opencode/src/operator/lifecycle/**`
- **Deliverable:** keep `jobs.run-now` a typed `unavailable` gap when the Feature 002
  executor seam is unreachable from the operator `AppRuntime`, and keep the
  process/task `cancel` op (`SessionRunCoordinator.interrupt`,
  `lifecycle/stack-wiring.ts`) a typed `unavailable` gap — UNLESS a clean dependency
  edge is found during implement (never forced); document the boundary in ADR-0014
  (FR9, FR10, FR14).
- **Acceptance:** `run-now` and `cancel` return typed capability gaps, never a
  fabricated success; the boundary is documented.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Investigation (2026-07-19):** no clean executor edge exists — `jobs.run-now`
  requires the Feature 002 executor Task-Process seam, which the operator `AppRuntime`
  does not resolve; forcing it was rejected (the brief's "do not force"). Likewise the
  process/task `cancel` FORCED-abort edge drives `SessionRunCoordinator.interrupt`,
  which lives in the core `SessionExecution` layer the operator stack's `AppRuntime`
  does not expose (`lifecycle/stack-wiring.ts:272-291` `rootInterruptor`), so no clean
  edge — kept as the documented honest gap.
- **Evidence (2026-07-19):** both edges were already honest typed gaps and stay so.
  `jobs/backend-live.ts:181` `planRunNow` degrades to `{type:"unavailable"}` citing
  "run-now requires the Feature 002 executor seam, not reachable from the operator
  runtime" BEFORE any plan (no phantom write); `lifecycle/stack-wiring.ts` wires a
  no-op `rootInterruptor` that records the unavailability and issues nothing, so a
  second-press cancel surfaces the honest `unconfirmed` outcome (its documented
  "no remote kill/reversal is promised" contract). Wire proof — added to
  `test/operator/semantic/feature014-registry-wire.test.ts`: `jobs.run-now` dispatched
  through the FULL pipeline rides the `mutation_plan` path and returns a typed
  `unavailable` gap (never fabricated). Backend-unit coverage stands:
  `test/jobs/backend-live.test.ts` asserts `planRunNow` → unavailable, and
  `test/lifecycle/cancel.test.ts` asserts the second-press forced-abort surfaces
  `unconfirmed` with no remote kill. The ADR-0014 boundary note already records both
  edges (documented for T009/T011). `bun test test/operator/ test/jobs/
  test/lifecycle/` green.

---

## Group D — TUI availability (FR12)

- [x] **T012 — Refine the palette persistence classification to per-verb `Partial`**
- **Depends:** T009
- **Paths:** `packages/core/src/operator/palette.ts`,
  `packages/core/test/operator/**`
- **Deliverable:** refine `OPERATOR_PERSISTING_DOMAINS`/`persistenceFor`/`domainBadge`
  to per-verb granularity so a mixed domain (semantic: registry persists, index
  Milvus-gated; optionally jobs) renders the `Partial` badge honestly — no verb
  advertises persistence it lacks, no persisting verb reads as `unavailable`; update
  the palette metadata/label unit tests (FR12).
- **Acceptance:** semantic resolves `Partial`; registry verbs editable; index verbs
  surface the gap; existing domains unchanged.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence (2026-07-19):** `packages/core/src/operator/palette.ts` — added the
  per-verb `OPERATOR_PERSISTING_VERBS` set (the nine config-backed semantic registry
  mutations from T009 + the two output policy setters from T007) and refined
  `persistenceFor(id, domain, mutates)` to consult it BEFORE the domain default, so a
  mutating verb persists when its whole domain persists OR it is a per-verb
  config-backed exception. `domainBadge`'s pre-existing `Partial` branch now goes
  live: semantic classifies 9 registry mutations `persists_today` (available/
  confirm_required) and 7 Milvus-gated mutations (`embedding.reindex`/`cutover`/
  `rollback`, `reranker.cutover`/`rollback`, `index.reindex`/`reconcile`)
  `honest_unavailable`, so the domain renders `Partial`; output likewise (`retention.set`/
  `quota.set` persist, the 5 control-store lifecycle mutations stay gated) → `Partial`;
  `mcp` stays fully `Unavailable` (T008 kept every mcp mutation a typed gap — the brief's
  "mcp logging.level" parenthetical was NOT honored because `mcp.logging.level.set`
  does not persist; advertising it editable would violate FR12 "no verb may advertise
  persistence it lacks"). `OPERATOR_INPUT_MODES` grew 14 → 25 with the newly-editable
  Configure verbs (9 semantic registry + 2 output), so the registry entries open a
  typed form and the Milvus-gated mutations stay `none` (dispatch directly to the
  typed gap). `OPERATOR_PERSISTING_VERBS` exported from `operator/index.ts`.
  `packages/tui/src/operator/form/descriptor.ts` — added `FORM_FIELDS` specs for the
  11 newly-editable verbs (provider/model/embedding/reranker registry `text_input`s +
  the two output policy setters), each a single typed field the domain command schema
  validates on dispatch (the form never builds a command id/scope — FR8). Tests:
  updated `palette-menu.test.ts` (semantic → `Partial`, registry editable, index gated,
  input-mode count 25) and `dispatch.test.ts`/`navigation.test.ts` in TUI (switched the
  honest-unavailable example from `semantic.provider.add`, now persisting, to the
  Milvus-gated `semantic.index.reindex`). `bun test packages/core/test/operator/` →
  95 pass / 0 fail; `bun test packages/tui/test/operator/` → 60 pass / 0 fail;
  `bun run typecheck` clean (30/30 packages). Not committed (orchestrator commits).

---

## Group E — Tests + doc sync

- [x] **T013 — Round-trip tests + false-success negative**
- **Depends:** T004
- **[P]** with T014, T015, T016, T017, T018
- **Paths:** `packages/opencode/test/config/**`, `packages/opencode/test/operator/**`
- **Deliverable:** assert the per-domain round-trip (mutation → success + version →
  re-read → restart) AND a negative test proving FR1 without FR2 is a false success
  (re-read `configured:false`) so the write/read alignment is load-bearing (FR2, FR4).
- **Acceptance:** round-trip green per domain; the false-success negative fails
  without the alignment.
- **Verification:** `bun test packages/opencode/test/config/** packages/opencode/test/operator/**`.
- **Evidence (2026-07-19):** new `it.instance` case in
  `packages/opencode/test/config/config.test.ts` ("Feature 014 T013 — operator
  namespace round-trips; the write/read alignment is load-bearing"): (1) a baseline
  `Config.use.get()` with no persisted operator namespace reports the authority
  ABSENT — the false-success SHAPE FR1 alone would leave (a write that lands while
  the loader never reads it back); (2) `Config.Service.update(...)` writes the
  operator namespace to `<dir>/config.json` — the SAME file `loadOperatorNamespace`
  scope-merges (FR2) — and the invalidated cache makes an immediate in-process
  re-read reflect `authorities.routing.version === "cas_v1"` (FR3); (3) the raw
  `<dir>/config.json` carries the namespace, proving the write target IS the loader
  read target (FR4 restart-equivalent). The FR3 re-read regresses to `undefined` if
  `loadOperatorNamespace` is removed — the load-bearing negative. The per-domain
  restart round-trip is additionally proven by the T004 live-CLI evidence
  (pools/budget/telemetry/smart, each `op` a fresh process) and the store-level
  commit+re-read in the T014/T017/T018 wire suites. `bun test test/config/config.test.ts`
  → green (the new case + the 96 existing). Not committed (orchestrator commits).

- [x] **T014 — Commit-contract tests: `langlock`/`jobs` `mutation_plan` end-to-end**
- **Depends:** T005, T006
- **[P]** with T013, T015, T016, T017, T018
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** dispatch `langlock`/`jobs` mutations through the FULL pipeline
  (`dispatchRequest` → confirm → contract → plan → `mutateAuthority`) asserting
  `outcome:"success"` + a re-read reflecting the commit, plus a stale-CAS
  no-phantom-write case (the 013 conversion test pattern) (FR5).
- **Acceptance:** both domains commit via `mutateAuthority`; stale CAS → `conflict`
  with no phantom write.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence (2026-07-19):** covered by `packages/opencode/test/operator/feature014-wire.test.ts`
  (authored in T005/T006/T010, verified green this wave). It builds the same
  composition `stack-live.ts` assembles — the langlock + jobs `create*DomainWiring`
  overrides spread into `wireDomainPorts` over ONE shared `store.config` — behind the
  real dispatcher + slash interceptor, and asserts: a global `langlock.set {tag:"pt-BR"}`
  dispatched through the FULL pipeline returns `outcome:"success"` and a `langlock.show`
  re-read reflects the committed tag; a committed `langlock.reset` reverts under CAS; a
  stale-CAS `langlock.set` (`cas_v9`, absent authority) → `conflict` with
  `config.get("langlock/global") === null` (no phantom write); a fail-closed project
  override → `unauthorized` with `config.get("langlock/project/proj_14") === null`; and
  the jobs block commits `jobs.create`/`disable` via `mutateAuthority` (re-read reflects
  the commit) with a stale-CAS `jobs.create` → `conflict` writing nothing. `bun test
  test/operator/feature014-wire.test.ts` → green. Not committed (orchestrator commits).

- [x] **T015 — OutputSpool backend tests**
- **Depends:** T007
- **[P]** with T013, T014, T016, T017, T018
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `output.stat`/`read`/`follow` against a real control store
  over an in-memory `Database`, `retention.set`/`quota.set` mutate real policy under
  the deny-by-default guard, and a store outage → typed `unavailable` (FR6, FR14).
- **Acceptance:** suite green across read/mutation/deny/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence (2026-07-19):** covered by
  `packages/opencode/test/operator/outputspool/feature014-outputspool-wire.test.ts`
  (authored in T007, verified green this wave — 10 tests, full dispatcher wire over the
  shared `store.config` + a real `bun:sqlite` control store): `output.stat`/`read`
  reflect a seeded control-store channel-generation record; `retention.set`/`quota.set`
  commit through `mutateAuthority` and a re-read of the named `output.retention`/
  `output.quota` authority reflects the descriptor; a stale-CAS `retention.set` →
  `conflict` with `config.get(...) === null` (no phantom write); a store outage → typed
  `unavailable`; `delete`/`follow` → typed capability gap; a cross-project `share` is
  denied under deny-by-default. `bun test test/outputspool/ test/operator/outputspool/`
  → 100 pass / 0 fail. Not committed (orchestrator commits).

- [x] **T016 — MCP admin backend tests**
- **Depends:** T008
- **[P]** with T013, T014, T015, T017, T018
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `mcp.*` admin verbs reflect a live host double across the
  server/auth/resource/logging/experimental/extension sub-ports, and an unbound
  service → typed `mcp_unavailable` (FR7, FR14).
- **Acceptance:** suite green; unbound → typed `mcp_unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence (2026-07-19):** covered by
  `packages/opencode/test/operator/mcp-service-backend.test.ts` (authored in T008,
  verified green this wave — 6 tests): faithful live reads via the `McpHostReader`
  double (`auth.status` → `not_authenticated`, `resource.admin.list`/`templates`
  live-empty) through the full DomainInvoke; an unreachable read degrades to a typed
  `unavailable` and asserts the raw error path/token is NEVER surfaced (FR11); the
  mutating verbs never return a successful query; and the FULL dispatcher pipeline
  (`resource.admin.list` read → `success`; `server.disconnect` mutation → typed
  `unavailable`, no phantom write). Honest boundary re-affirmed: the server-profile
  reads + every mutating verb stay typed gaps (T008 — `McpServerProfile` SSOT metadata
  the live host config lacks; mcp is not an operator CAS authority), so an unbound
  service degrades to a typed gap, never fabricated state. `bun test test/operator/
  test/mcp/` → 509 pass / 2 skip / 0 fail. Not committed (orchestrator commits).

- [x] **T017 — Semantic registry tests + `milvus_unavailable` gate**
- **Depends:** T009
- **[P]** with T013, T014, T015, T016, T018
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert the config-backed registry ops persist + re-read under CAS
  (provider/model/binding/embedding/reranker), `rotate-secret` stores a `SecretRef`
  only, and the Milvus-gated `index`/`reindex`/`cutover`/`validate` → typed
  `milvus_unavailable` (FR8, FR11, FR14).
- **Acceptance:** registry persists; index verbs → typed gap; no plaintext secret.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence (2026-07-19):** covered by
  `packages/opencode/test/operator/semantic/feature014-registry-wire.test.ts` (authored
  in T009, verified green this wave — 9 tests, full dispatcher + slash wire over ONE
  shared `store.config`): `provider.add` commits `success` and `provider.list` re-reads
  the persisted profile (v1); `provider.update` bumps the domain version under CAS; a
  stale provider version → rejected with the committed profile unchanged (no phantom
  write); a plaintext-looking `secretRef` and an `http://` endpoint are each rejected
  with `config.get("semantic") === null` (FR11); a committed provider persists only the
  `keychain:k@v2` coordinate (never a plaintext value); `model.register` →
  `embedding.select` stages a `draft` binding re-read via `binding.history`;
  `semantic.index.show-collections` → typed `milvus_unavailable` gap. `bun test
  test/operator/ test/jobs/ test/langlock/ test/config/ test/semantic/` → 786+ pass /
  0 fail. Not committed (orchestrator commits).

- [x] **T018 — Jobs persistence tests + typed `run-now`/`cancel` gaps**
- **Depends:** T010, T011
- **[P]** with T013, T014, T015, T016, T017
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `jobs` mutations persist + re-read + survive a restart over
  the persistence seam, and `jobs.run-now` + process/task `cancel` → typed
  `unavailable` capability gaps, never fabricated (FR9, FR10, FR14).
- **Acceptance:** persistence round-trips; the two edges return typed gaps.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence (2026-07-19):** covered by the jobs block of
  `packages/opencode/test/operator/feature014-wire.test.ts` +
  `packages/opencode/test/jobs/backend-live.test.ts` +
  `packages/opencode/test/lifecycle/cancel.test.ts` (authored in T010/T011, verified
  green this wave). Wire: `jobs.create` commits through `mutateAuthority` and a
  `jobs.list` re-read reflects the persisted definition (`enabled:true`); a committed
  `jobs.disable` round-trips under CAS (re-read `enabled:false`); `jobs.enable` on an
  absent definition → typed `not_found` with no phantom write; a stale-CAS `jobs.create`
  → `conflict` writing nothing; `jobs.run-now` → typed `unavailable` capability gap
  (T011 executor edge). Backend-unit: `backend-live.test.ts` asserts the read projection
  + enable/update/reschedule/delete round-trip, not_found-before-write, config-outage →
  `unavailable`, and `planRunNow` → `unavailable`; `cancel.test.ts` asserts the
  second-press forced-abort surfaces `unconfirmed` with no remote kill (T011 lifecycle
  edge). The restart dimension is proven by the T010 live-CLI evidence (each `op` a
  fresh OS process). `bun test test/jobs/ test/operator/feature014-wire.test.ts
  test/lifecycle/` → green. Not committed (orchestrator commits).

- [x] **T019 — TUI `Partial` availability tests**
- **Depends:** T012
- **Paths:** `packages/core/test/operator/**`
- **Deliverable:** assert the grouped menu derives `Partial` for the mixed semantic
  domain, its registry Configure entries are editable, its index entries surface the
  typed gap, and the pre-existing domains are unchanged (FR12).
- **Acceptance:** suite green; `Partial` shown honestly; others intact.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence (2026-07-19):** new
  `packages/core/test/operator/feature014-availability.test.ts` (10 tests): the grouped
  menu derives `Partial` (+`confirm_required` availability + `Partial · N views · M
  settings` subtitle) for BOTH mixed domains (semantic, output); a fully-gated domain
  (mcp) stays `Unavailable` and a fully-persisting one (langlock) stays `Available`;
  every one of semantic's 9 registry Configure entries is editable (`persists_today`,
  availability `available`/`confirm_required`, never `unavailable`) with a `text_input`
  form, while all 7 Milvus-gated entries surface the typed gap (`honest_unavailable`,
  `unavailable`, "not implemented yet" subtitle, inputMode `none`); output's two policy
  setters persist while the 5 lifecycle mutations stay gated; and the pre-existing 9
  persisting domains all still badge `Available` (no regression). The existing
  `palette-menu.test.ts` was updated in T012 for the same behavior. `bun test
  packages/core/test/operator/` → 95 pass / 0 fail. Not committed (orchestrator commits).

- [x] **T020 — Parity test: same command id, no new path / id / version bump**
- **Depends:** T005, T006, T007, T008, T009
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert each wired verb
  rides the SAME canonical command id through the SAME `OperatorClient` loopback as
  slash/CLI, with no new dispatch path, no new catalog id, and no catalog version
  bump (FR13).
- **Acceptance:** command-id parity holds; the catalog version is unchanged.
- **Verification:** parity assertion green.
- **Evidence (2026-07-19):** new
  `packages/opencode/test/operator/feature014-parity.test.ts` (4 tests, modeled on the
  Feature 013 parity harness). Structural: `catalogVersion()` + `RESERVED_CATALOG_VERSION`
  stay `1.3.0` (no bump); every Feature 014 wired verb (langlock/jobs/output/semantic-
  registry/mcp-reads — 35 ids across the five domains) is a PRE-EXISTING reserved id
  (`isReservedCommandId` true, none newly introduced); and the canonical id is identical
  across the slash alias (`/op.<id>`), palette command name (`operator.<id>`), and CLI
  segments (no per-surface divergence). Behavioural: a read per wired domain
  (`langlock.show`, `jobs.list`) rides the SAME id through the SAME dispatcher across
  slash, CLI, HTTP handler, and the SDK `createOperatorClient` loopback with an identical
  outcome — the Feature 007 surface-parity contract, no new dispatch path. `bun test
  test/operator/feature014-parity.test.ts` → 4 pass / 0 fail. Not committed (orchestrator
  commits).

- [x] **T021 — Guard scope (`speckit.toml` 014 block) + doc sync**
- **Depends:** T013, T014, T015, T016, T017, T018, T019, T020
- **Paths:** `doc/arch/speckit.toml`, docs under allowed globs (spec, ADR-0014,
  `operator-persistence/*.cue`, `config-roundtrip.md`; `AGENTS.md`/`README.md` only
  if a surface description drifts)
- **Deliverable:** confirm the Feature 014 specScopeGlobs block covers the genuinely
  new `packages/opencode/src/config/**` + `packages/opencode/test/config/**` write
  paths (everything else is already in scope); reconcile the shipped shapes/node
  names with the spec, ADR, schema corpus, and statechart.
- **Acceptance:** the guard admits the new config write paths; docs match shipped
  shapes.
- **Verification:** `speckit validate --json`.
- **Evidence (2026-07-19):** the Feature 014 `speckit.toml` guard block
  (`doc/arch/speckit.toml:445-472`) already declares the two genuinely new
  implement paths — `packages/opencode/src/config/**` (write/read alignment
  + cache invalidation, FR1-FR3) and `packages/opencode/test/config/**`
  (round-trip tests, FR4) — with the rest of the shipped surface
  (`operator/**`, `outputspool/**`, `mcp/**`, `semantic/**`, `jobs/**`, the
  per-package test trees) traced as already-covered by prior features'
  blocks; no guard edit was needed. Removed one piece of test pollution
  discovered during doc sync: an untracked `packages/opencode/config.json`
  left by an un-isolated live-CLI spot check (the operator's real global
  config plus a plaintext MCP API key) — deleted, never a deliverable,
  never committed. Doc sync: added an "Implementation notes" section to
  `plan.md` (the Feature 012/013 convention) recording the T001-T020
  shipped shapes + the fix round; ADR-0014 "Decision Outcome" already
  reflects the actual FR2 alignment choice (the scoped
  `loadOperatorNamespace` read, not a full write-target redirect) in clean
  English — checked for stray non-English characters, none found. `AGENTS.md`/
  `README.md` operator-domain descriptions were checked and found accurate
  (they describe the Feature 007 sole-registration-authority contract, not
  per-domain persistence claims that would need updating for Feature 014).

- [x] **T022 — `speckit analyze` + `speckit validate --json` green**
- **Depends:** T021
- **Paths:** documentary only
- **Deliverable:** run `speckit analyze` and `speckit validate --json` clean of new
  Feature 014 findings.
- **Acceptance:** `speckit validate --json` → 0 new findings on Feature 014
  artifacts; `speckit status` completeness ok.
- **Verification:** `speckit analyze` + `speckit validate --json`.
- **Evidence (2026-07-19):** `speckit analyze` → "analyzed 14 feature(s):
  consistent; 0 ADR overlap(s)" (only pre-existing spec-H1-vs-slug `info`
  drift notes on unrelated features, none touching Feature 014).
  `speckit validate --json` → `ok:true`, `waivedCount:4` (the four
  pre-existing `hygiene.empty-file` waivers, unrelated to Feature 014), 0
  new findings. `speckit status` → `completeness: ok` (health score flagged
  stale, informational only, not a completeness blocker).

---

## Fix round (2026-07-19) — post-implement adversarial + spot-check defects

Three confirmed defects closed after the report-only spot check and the adversarial
review. All are honest-degradation / false-success corrections; no catalog id, no
catalog version bump, no new dispatch path or flag (FR13 preserved).

- **FALSE SUCCESS on `smart.on` + `telemetry.*` global authorities (FR4, FR14) —
  ROOT CAUSE + FIX.** `smart`/`telemetry` persist to `global:routing` /
  `global:telemetry`, whose durable-store write reaches the global `opencode.jsonc`
  through `Config.updateGlobal` → `patchJsonc`
  (`packages/opencode/src/config/config.ts`). `patchJsonc` recursed per key via
  `Object.entries` and emitted NO edit for an empty object, so the required-but-empty
  `models.role_pools:{}` (routing) and `export.headers:{}` (telemetry) were silently
  dropped; the read-back `RoutingConfig.Info` / `TelemetryConfig` decode then failed
  and the effective read fell back to the default — a `cas_vN` success that never
  round-trips (the exact FR14 forbidden false success). `pools`/`budget` were immune
  because they write the PROJECT `routing` authority via `Config.update`
  (`mergeDeep`+`JSON.stringify`, which preserves `{}`). Fix: `patchJsonc` now writes
  an absent empty object explicitly (presence-checked via `parseTree`/
  `findNodeAtLocation` so populated targets keep merge semantics). Proven end-to-end
  (fresh XDG dirs, each `op` a new OS process): `smart on` → `smart status` re-reads
  `enabled:true, configured:true, cas_v1` (was `configured:false, cas_v1`);
  `telemetry on` → `telemetry status` re-reads `configured:true`; the persisted
  `opencode.jsonc` now carries `models.role_pools:{}` / `export.headers:{}`. This
  also resolves the spot-check "telemetry endpoint did not stick" finding (same
  empty-object drop broke the whole telemetry decode → default `localhost` endpoint).
  Regression test: `packages/opencode/test/config/config.test.ts` "global jsonc write
  preserves a required-but-empty nested object". (Updates the now-incorrect T004
  "Honest caveat", which misattributed this to a smart/telemetry backend asymmetry.)

- **`telemetry.test` REPRODUCIBLE HARD FAILURE (catalog/handler contract) — FIX.**
  `packages/core/src/operator/catalog.ts` declared `telemetry.test` as
  `mutates: true`, but the handler
  (`packages/opencode/src/operator/telemetry/telemetry-command-port.ts:196`) is a
  read-only reachability probe returning `kind:"query"` (like `routing.test`,
  `mutates:false`). The Feature 007 dispatcher's mutate-guard rejects a `query`
  result for a `mutates:true` descriptor, so `op telemetry test` could never succeed
  (`invalid_argument "mutation command cannot return query result"`). Fix: the
  descriptor is corrected to `mutates: false`, aligning the catalog with the handler.
  `catalogVersion()` returns the static `RESERVED_CATALOG_VERSION = "1.3.0"`, so no
  version bump; no id/dispatch-path change (FR13). Proven: `op telemetry test` now
  returns `outcome:"success"` with the typed probe result (`unreachable`/
  `misconfigured`), no longer a fabricated `invalid_argument`.

- **TUI Configure form → port payload mismatch (semantic + output) (FR12, FR14) —
  FIX.** The reusable Configure form dispatched `{ [field.key]: rawText }`, but the
  Feature 014 registry/policy verbs' descriptor keys did not match what the command
  ports read (top-level `id`/`newSecretRef`/`modelDescriptorId`/`name`/`baseUrl`/
  `ttlSeconds`/`quotaScope`). All nine semantic registry verbs failed via the real
  TUI path (`invalid_url`/`not_found`/`not_validated`) and the two output policy
  setters reported success while discarding the operator's input (persisted the
  default — a false success), violating FR12 "no verb may advertise persistence it
  lacks." Fix in `packages/tui/src/operator/form/{descriptor,index}.tsx`: scalar
  fields now carry the port's canonical key; JSON fields parse-and-spread their
  object to the top level via a new per-field `toPayload` builder (with a
  JSON-object validator that rejects malformed/non-object input before dispatch).
  Proven end-to-end: `semantic.provider.add` with the form-shaped `{name,baseUrl,
  secretRef}` persists and `provider.list` re-reads it (secret stored as a
  `SecretRef`, credentials `[REDACTED]`); `output.retention.set` with
  `{ttlSeconds:86400}` persists `ttlSeconds:86400` (not the default `0`). Tests:
  `packages/tui/test/operator/dispatch.test.ts` "Configure form payload matches the
  port contract" (scalar keys, JSON spread, malformed-JSON rejection).

- **Suites re-run green:** `bun run typecheck` (30/30 packages);
  `packages/tui` `test/operator/` 63 pass; `packages/core` `test/operator/` 95 pass;
  `packages/opencode` `test/config/` + `test/operator/` 661 pass / 5 skip / 0 fail
  (incl. the new config-write regression test); oxlint 0 errors on changed files.
  Not committed (orchestrator commits).

---

## Dependencies summary

```
T001 → T002 → T003 → T004                       config round-trip
(T005 ∥ T006)                                   langlock/jobs mutation_plan
(T007 ∥ T008 ∥ T009) ; T002 → T009              service backends
T002+T006 → T010 → T011                         jobs persistence + typed gaps
T009 → T012                                     TUI Partial refinement
T004 → T013 ; T005+T006 → T014                  round-trip / commit tests
T007→T015 ; T008→T016 ; T009→T017 ; T010+T011→T018   backend tests (T013..T018 ∥)
T012 → T019 ; T005+T006+T007+T008+T009 → T020   availability / parity
T013..T020 → T021 → T022                         guard + doc sync + validate
```

## Parallelism rules

- Only `[P]` tasks may run concurrently, and only when path sets do not overlap.
- T005/T006 touch distinct `operator/<domain>/` dirs and are parallel; T007/T008/T009
  touch distinct backend adapter seams but share `stack-live.ts` — sequence the
  `stack-live.ts` edits, parallelize the per-backend adapter work.
- T013-T018 touch distinct test files and are parallel.
- Never parallelize two tasks writing the same module (`stack-live.ts`, `palette.ts`,
  the `config/**` loader).

## Task counts

| Group                         | Tasks              | Phase |
| ----------------------------- | ------------------ | ----- |
| A Config round-trip           | T001–T004 (4)      | 1     |
| B Mutation-plan conversion    | T005–T006 (2)      | 2     |
| C Service backends            | T007–T011 (5)      | 3-6   |
| D TUI availability            | T012 (1)           | 7     |
| E Tests + doc sync            | T013–T022 (10)     | 8     |
| **Total actionable**          | **T001–T022 (22)** |       |

## Definition of done

- FR1–FR14 covered; operator config mutations round-trip persist and survive a
  restart across all six config-backed domains (FR1-FR4).
- `langlock` + `jobs` commit through `mutateAuthority` via the `mutation_plan`
  contract; no backend self-commits (FR5).
- OutputSpool, MCP, and the config-backed semantic registry expose real state;
  Milvus/executor/cancel edges stay typed capability gaps (FR6-FR11).
- Secrets are `SecretRef`-only through the SecretPort (FR11).
- The grouped TUI shows a truthful per-verb `Partial` badge for mixed domains (FR12).
- No new catalog id, no catalog version bump, no new dispatch path or flag; command
  ids unchanged; Feature 007 stays the sole registration authority (FR13).
- Every read/mutation honest-degrades to a typed envelope; no fabricated success or
  capability (FR14).
- Test suites green; `speckit validate --json` clean of new Feature 014 findings.
</content>
