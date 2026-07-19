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

- [ ] T001 — Accept the `operator` namespace in `ConfigV1.Info` (config schema)
- [ ] T002 — Align the `Config.update` write path with the loader read path
- [ ] T003 — Invalidate the authority-scoped config cache on commit
- [ ] T004 — Round-trip acceptance per config-backed domain (restart-proven)
- [ ] T005 — Convert `langlock` command port to the `mutation_plan` contract
- [ ] T006 — Convert `jobs` command port to the `mutation_plan` contract
- [ ] T007 — Wire the real OutputSpool backend (resolve the AppLayer `Database`)
- [ ] T008 — Wire the real MCP admin backend (resolve `MCP.Service` + `McpAuth`)
- [ ] T009 — Wire the config-backed semantic registry backend + typed Milvus gap
- [ ] T010 — Persist `jobs` mutations over the `JobPersistence` seam
- [ ] T011 — Keep `jobs.run-now` + lifecycle `cancel` typed capability gaps
- [ ] T012 — Refine the palette persistence classification to per-verb `Partial`
- [ ] T013 — Round-trip tests + false-success negative (FR1 without FR2)
- [ ] T014 — Commit-contract tests: `langlock`/`jobs` `mutation_plan` end-to-end
- [ ] T015 — OutputSpool backend tests (real control store)
- [ ] T016 — MCP admin backend tests (live host double)
- [ ] T017 — Semantic registry tests + `milvus_unavailable` gate
- [ ] T018 — Jobs persistence tests + typed `run-now`/`cancel` gaps
- [ ] T019 — TUI `Partial` availability tests
- [ ] T020 — Parity test: same command id, no new path / id / version bump (FR13)
- [ ] T021 — Guard scope (`speckit.toml` 014 block) + doc sync
- [ ] T022 — `speckit analyze` + `speckit validate --json` green

---

## Group A — Config persistence round-trip (FR1, FR2, FR3, FR4)

- [ ] **T001 — Accept the `operator` namespace in `ConfigV1.Info`**
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
- **Evidence:** _(pending implement)_

- [ ] **T002 — Align the `Config.update` write path with the loader read path**
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
- **Evidence:** _(pending implement)_

- [ ] **T003 — Invalidate the authority-scoped config cache on commit**
- **Depends:** T002
- **Paths:** `packages/opencode/src/config/**`
- **Deliverable:** on a committed CAS mutation, invalidate the loader's cached
  document for the mutated authority so an immediate re-read reflects the new state;
  keep the invalidation authority-scoped (do not drop unrelated cached config) (FR3).
- **Acceptance:** a mutate → immediate re-read reflects the new state; unrelated
  cached authorities are untouched.
- **Verification:** `bun test packages/opencode/test/config/**`.
- **Evidence:** _(pending implement)_

- [ ] **T004 — Round-trip acceptance per config-backed domain (restart-proven)**
- **Depends:** T003, T005, T006, T010
- **Paths:** `packages/opencode/test/operator/**`, `packages/opencode/test/config/**`
- **Deliverable:** prove, per config-backed domain (`langlock`, `telemetry`,
  `smart`, `budget`, `pools`, `jobs`), the CLI mutation → `success` + version bump →
  immediate re-read → process-restart re-read chain, with no `cas_vN` the loader
  fails to read back (FR4).
- **Acceptance:** every domain round-trips and survives a simulated restart; no
  false success.
- **Verification:** `bun test packages/opencode/test/operator/** packages/opencode/test/config/**`.
- **Evidence:** _(pending implement)_

---

## Group B — Mutation-plan commit contract (FR5)

- [ ] **T005 — Convert `langlock` command port to the `mutation_plan` contract**
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
- **Evidence:** _(pending implement)_

- [ ] **T006 — Convert `jobs` command port to the `mutation_plan` contract**
- **Depends:** none
- **[P]** with T005 (distinct domain dir)
- **Paths:** `packages/opencode/src/operator/jobs/**`
- **Deliverable:** convert the `jobs` command port from self-commit + `kind:"query"`
  to the `OperatorMutationPlan` contract exactly as T005, so `mutateAuthority` owns
  the commit; reads unchanged (FR5).
- **Acceptance:** a `jobs` mutation commits via `mutateAuthority`; no self-committed
  `query` result is rejected after a write.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence:** _(pending implement)_

---

## Group C — Service backends (FR6, FR7, FR8, FR9, FR10, FR11)

- [ ] **T007 — Wire the real OutputSpool backend**
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
- **Evidence:** _(pending implement)_

- [ ] **T008 — Wire the real MCP admin backend**
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
- **Evidence:** _(pending implement)_

- [ ] **T009 — Wire the config-backed semantic registry backend + typed Milvus gap**
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
- **Evidence:** _(pending implement)_

- [ ] **T010 — Persist `jobs` mutations over the `JobPersistence` seam**
- **Depends:** T002, T006
- **Paths:** `packages/opencode/src/operator/jobs/**`, `packages/opencode/src/jobs/**`
- **Deliverable:** persist the `jobs` mutations (`create`/`update`/`enable`/
  `disable`/`delete`/`reschedule`/`show`/`history`) over the `JobPersistence` seam
  (`jobs/persistence.ts`, over config; depends on the Group A round-trip) under CAS,
  honest-degrading to typed envelopes (FR9, FR14).
- **Acceptance:** a `jobs.create`/`update` persists + re-reads under CAS and survives
  a restart; config outage → typed `unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`; `bun run typecheck`.
- **Evidence:** _(pending implement)_

- [ ] **T011 — Keep `jobs.run-now` + lifecycle `cancel` typed capability gaps**
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
- **Evidence:** _(pending implement)_

---

## Group D — TUI availability (FR12)

- [ ] **T012 — Refine the palette persistence classification to per-verb `Partial`**
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
- **Evidence:** _(pending implement)_

---

## Group E — Tests + doc sync

- [ ] **T013 — Round-trip tests + false-success negative**
- **Depends:** T004
- **[P]** with T014, T015, T016, T017, T018
- **Paths:** `packages/opencode/test/config/**`, `packages/opencode/test/operator/**`
- **Deliverable:** assert the per-domain round-trip (mutation → success + version →
  re-read → restart) AND a negative test proving FR1 without FR2 is a false success
  (re-read `configured:false`) so the write/read alignment is load-bearing (FR2, FR4).
- **Acceptance:** round-trip green per domain; the false-success negative fails
  without the alignment.
- **Verification:** `bun test packages/opencode/test/config/** packages/opencode/test/operator/**`.
- **Evidence:** _(pending implement)_

- [ ] **T014 — Commit-contract tests: `langlock`/`jobs` `mutation_plan` end-to-end**
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
- **Evidence:** _(pending implement)_

- [ ] **T015 — OutputSpool backend tests**
- **Depends:** T007
- **[P]** with T013, T014, T016, T017, T018
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `output.stat`/`read`/`follow` against a real control store
  over an in-memory `Database`, `retention.set`/`quota.set` mutate real policy under
  the deny-by-default guard, and a store outage → typed `unavailable` (FR6, FR14).
- **Acceptance:** suite green across read/mutation/deny/unavailable.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(pending implement)_

- [ ] **T016 — MCP admin backend tests**
- **Depends:** T008
- **[P]** with T013, T014, T015, T017, T018
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `mcp.*` admin verbs reflect a live host double across the
  server/auth/resource/logging/experimental/extension sub-ports, and an unbound
  service → typed `mcp_unavailable` (FR7, FR14).
- **Acceptance:** suite green; unbound → typed `mcp_unavailable`.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(pending implement)_

- [ ] **T017 — Semantic registry tests + `milvus_unavailable` gate**
- **Depends:** T009
- **[P]** with T013, T014, T015, T016, T018
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert the config-backed registry ops persist + re-read under CAS
  (provider/model/binding/embedding/reranker), `rotate-secret` stores a `SecretRef`
  only, and the Milvus-gated `index`/`reindex`/`cutover`/`validate` → typed
  `milvus_unavailable` (FR8, FR11, FR14).
- **Acceptance:** registry persists; index verbs → typed gap; no plaintext secret.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(pending implement)_

- [ ] **T018 — Jobs persistence tests + typed `run-now`/`cancel` gaps**
- **Depends:** T010, T011
- **[P]** with T013, T014, T015, T016, T017
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** assert `jobs` mutations persist + re-read + survive a restart over
  the persistence seam, and `jobs.run-now` + process/task `cancel` → typed
  `unavailable` capability gaps, never fabricated (FR9, FR10, FR14).
- **Acceptance:** persistence round-trips; the two edges return typed gaps.
- **Verification:** `bun test packages/opencode/test/operator/**`.
- **Evidence:** _(pending implement)_

- [ ] **T019 — TUI `Partial` availability tests**
- **Depends:** T012
- **Paths:** `packages/core/test/operator/**`
- **Deliverable:** assert the grouped menu derives `Partial` for the mixed semantic
  domain, its registry Configure entries are editable, its index entries surface the
  typed gap, and the pre-existing domains are unchanged (FR12).
- **Acceptance:** suite green; `Partial` shown honestly; others intact.
- **Verification:** `bun test packages/core/test/operator/**`.
- **Evidence:** _(pending implement)_

- [ ] **T020 — Parity test: same command id, no new path / id / version bump**
- **Depends:** T005, T006, T007, T008, T009
- **Paths:** `packages/opencode/test/operator/**`
- **Deliverable:** reuse the Feature 007 parity harness to assert each wired verb
  rides the SAME canonical command id through the SAME `OperatorClient` loopback as
  slash/CLI, with no new dispatch path, no new catalog id, and no catalog version
  bump (FR13).
- **Acceptance:** command-id parity holds; the catalog version is unchanged.
- **Verification:** parity assertion green.
- **Evidence:** _(pending implement)_

- [ ] **T021 — Guard scope (`speckit.toml` 014 block) + doc sync**
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
- **Evidence:** _(pending implement)_

- [ ] **T022 — `speckit analyze` + `speckit validate --json` green**
- **Depends:** T021
- **Paths:** documentary only
- **Deliverable:** run `speckit analyze` and `speckit validate --json` clean of new
  Feature 014 findings.
- **Acceptance:** `speckit validate --json` → 0 new findings on Feature 014
  artifacts; `speckit status` completeness ok.
- **Verification:** `speckit analyze` + `speckit validate --json`.
- **Evidence:** _(pending implement)_

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
