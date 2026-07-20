# Tasks: Complete the Semantic Binding Lifecycle and the Remaining Operator Residuals (Feature 019)

Synced with plan.md (Phase A reranker lifecycle FIRST, Phase B1 live Milvus client + port
methods, Phase B2 embedding cutover/rollback, Phase B3 reindex/reconcile + live-doc source,
Phase C MCP, Phase D telemetry export, Phase E availability flip + parity, Phase F tests +
guard + doc sync) and the specScopeGlobs in doc/arch/speckit.toml. ADR-0019 proposed.

Composition ONLY. NO new semantic engine, NO new catalog id, NO catalog version bump, NO new
dispatch path, NO new flag — the Feature 007 registration + `OperatorClient` loopback parity
invariant (FR15) is preserved. Every mutation commits through `mutateAuthority`; a reranker
cache/eval-version invalidation reuses the Feature 018 `effectOnly` pattern; an embedding
cutover physically builds and validates a Milvus generation before the alias swaps (cardinal
honesty, FR5); every unreachable dependency honest-degrades to a typed capability gap (FR16).
The MCP auth delegation is scoped to the interactive TUI (headless keeps the gap). No code is
executed in this documentary pass; tasks are the implement backlog. All items start unchecked.

Legend:

- `[P]` — may run in parallel with other `[P]` tasks that share no overlapping paths
- `Depends:` — task IDs that must complete first
- Verification — acceptance checks for the task
- Evidence — filled during implement (date + file:line + test result)

## Task Breakdown

Checkbox backlog (details under each group below). Group A (reranker lifecycle) is FIRST —
it needs no Milvus and unblocks the archive the embedding rollback also reads.

- [x] T001 — Route `semantic.reranker.cutover`/`rollback` through the config-backed registry
- [x] T002 — Extend the `RegistryDocument` with a per-slot binding version archive
- [x] T003 — Honest reranker gates (`not_validated` / `no_archived_prior` / `cas_conflict`)
- [ ] T004 — Bind a real Milvus gRPC/HTTP client when the endpoint is configured
- [ ] T005 — Add `enumerate-indexed-docs` + `createCollection/buildGeneration` to `MilvusPort`
- [ ] T006 — Embedding cutover/rollback over the live port (build+validate before the swap)
- [ ] T007 — All-collections atomic CAS alias swap; unconfigured → `milvus_unavailable`
- [ ] T008 — Reindex/reconcile live-doc source (agent/skill builders) + bound embedding client
- [ ] T009 — Content-free reconcile that never re-pins the binding
- [ ] T010 — Delegate `mcp.auth.start`/`finish` for the interactive TUI; headless keeps the gap
- [ ] T011 — `mcp.resource.admin.subscribe`/`unsubscribe` over the dual-authority machine
- [ ] T012 — Truthful experimental/extension badges from the config-backed flag state
- [ ] T013 — Compose an eager, fail-open, process-singleton OTLP export pipeline
- [ ] T014 — Real transport + bounded queue + drop policy + retry-budget enforcement
- [ ] T015 — Redaction defaults enforced on every exported signal
- [ ] T016 — Pull-based re-arm on server start / `telemetry.*` dispatch; disabled → no fiber
- [ ] T017 — Env-gated live validation (Milvus endpoint + OTLP collector)
- [ ] T018 — Palette availability flip to the composed truth
- [ ] T019 — Group A tests (registry routing, archive, gates)
- [ ] T020 — Group B tests (Milvus port, generation build, reconcile, live Milvus)
- [ ] T021 — Group C tests (auth delegation, subscription, badges)
- [ ] T022 — Group D tests (export sends, disabled no-op, redaction, drop policy)
- [ ] T023 — Availability + parity tests (Feature 007 harness)
- [ ] T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green

---

## Group A — Reranker lifecycle over a config-backed archive (FR1-FR3) — FIRST

- [x] **T001 — Route `semantic.reranker.cutover`/`rollback` through the config-backed registry**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/semantic/semantic-command-port.ts`, `packages/opencode/src/operator/semantic/registry-backend.ts`
- **Deliverable:** move `semantic.reranker.cutover`/`rollback` (`semantic-command-port.ts:243-244`)
  off the gated Milvus backend `b` onto the config-backed registry `c.registry` as
  `OperatorMutationPlan`s (the `planSelect` precedent, `registry-backend.ts:403-418`) committed
  by `mutateAuthority`; reuse the pure `cutoverReranker` (no `MilvusPort`), invalidate the rerank
  cache/eval version with `reEmbedded:false`, and reuse the Feature 018 `effectOnly` pattern for
  the non-versioned invalidation (`#RerankerCutoverPlan`, `#RerankerActivationResult`) (FR1).
- **Acceptance:** a reranker cutover commits config-backed with no Milvus call; the rerank
  cache/eval version is invalidated; a successful activation does not churn the CAS version.
- **Verification:** `bun test packages/opencode/test/semantic/** packages/opencode/test/operator/**`.
- **Evidence:** 2026-07-20 — `semantic-command-port.ts:239-251` routes
  `semantic.reranker.cutover`/`rollback` through `c.registry` (`planCutoverReranker`/
  `planRollbackReranker`) as `OperatorMutationPlan`s when the registry is bound, keeping the
  gated Milvus path only as the unbound fallback. `registry-backend.ts` `planCutoverReranker`
  reuses the pure `CutoverExecutor.cutoverReranker` (no `MilvusPort`, `reEmbedded:false`) and
  bumps `rerankEvalVersion` in the committed transform; the activated binding keeps its
  operator-authored version (no version churn). Tests: `feature019-reranker-lifecycle.test.ts`
  (13) + `feature019-reranker-dispatch.test.ts` (3) green; `bun test test/operator/` 449 pass /
  2 skip; `bun test test/semantic/` 129 pass; `bun run typecheck` 30/30.

- [x] **T002 — Extend the `RegistryDocument` with a per-slot binding version archive**
- **Depends:** T001
- **Paths:** `packages/opencode/src/operator/semantic/registry-backend.ts`
- **Deliverable:** extend the `RegistryDocument` with a per-slot archive — current + superseded
  entries (`#BindingVersionArchive`, `#ArchivedBindingVersion`) — so `bindingHistory`
  (`:285-291`, currently single-entry) returns the real archive and `bindingStatus` (`:281`)
  reports the real degradation rung instead of a hardcoded `full_semantic`. A cutover moves the
  prior into the superseded set (FR2).
- **Acceptance:** `bindingHistory` returns the multi-entry archive; `bindingStatus` reports the
  real rung; a cutover retains the prior as superseded.
- **Verification:** `bun test packages/opencode/test/operator/**` (archive round-trip).
- **Evidence:** 2026-07-20 — `registry-backend.ts` extends `RegistryDocument` with
  `embeddingStaged`/`rerankerStaged` (the in-flight candidate a `select` stages),
  `embeddingArchive`/`rerankerArchive` (superseded priors, newest-first), and
  `rerankEvalVersion`; every new field is `Schema.optional` + `normalizeDocument` so a pre-019
  document round-trips losslessly (no provider/model loss). `bindingHistory` now composes
  `slotHistory` = staged + current + superseded; `bindingStatus` derives the rung via
  `degradationRung` (active embedding → `full_semantic`, else `catalog_lexical`) instead of the
  hardcoded `full_semantic`. A cutover archives the outgoing active (`activateReranker`). Tests:
  `feature019-reranker-lifecycle.test.ts` archive/history/status cases green; existing
  `feature014-registry-wire.test.ts` (draft `binding.history` length 1) still green.

- [x] **T003 — Honest reranker gates (`not_validated` / `no_archived_prior` / `cas_conflict`)**
- **Depends:** T002
- **Paths:** `packages/opencode/src/operator/semantic/registry-backend.ts`, `packages/opencode/src/operator/semantic/semantic-command-port.ts`
- **Deliverable:** gate the activation — a cutover without a validated staged candidate →
  `not_validated`; a rollback resolving `#RollbackTarget` with no superseded prior →
  `no_archived_prior`; a CAS contention swaps nothing (`cas_conflict`); an unconfirmed activation
  → `confirmation_required` (`#CutoverGate`, `#RollbackTarget`) (FR3).
- **Acceptance:** each gate returns its typed refusal and commits nothing; no path fabricates a swap.
- **Verification:** `bun test packages/opencode/test/operator/**` (gate cases).
- **Evidence:** 2026-07-20 — `planCutoverReranker` gates: no/unvalidated staged candidate →
  `not_validated`; a candidate whose state is not a legal `staged → active` source
  (`BindingLifecycle.apply` non-transition) → `not_validated`; unconfirmed → `confirmation_required`
  (via the pure `cutoverReranker`). `planRollbackReranker` gates: empty/unknown archive target →
  `no_archived_prior` (new `BindingError` member added to `packages/protocol/src/semantic/commands.ts`
  + mapped in `semantic-command-port.ts` `mapError`); unconfirmed with a real prior →
  `confirmation_required`. `cas_conflict` is enforced by `mutateAuthority` on the authority CAS token
  (a contention swaps nothing). All refusals are `Effect.fail` BEFORE producing a plan, so nothing is
  committed; the dispatch test asserts the audited rejection + no phantom active binding. Tests:
  `feature019-reranker-lifecycle.test.ts` (7 gate cases) + `feature019-reranker-dispatch.test.ts`
  (rejection audited, no phantom write) green.

## Group B1 — Live Milvus client + port methods (FR4, FR6)

- [ ] **T004 — Bind a real Milvus gRPC/HTTP client when the endpoint is configured**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/stack-live.ts`, `packages/opencode/src/semantic/milvus-adapter.ts`
- **Deliverable:** replace `createGrpcMilvusAdapter({})` (`stack-live.ts:513-537`) with a real
  gRPC/HTTP client when `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is configured, plus persisted
  generation/alias/CAS state (`#MilvusEndpointBinding`); an unconfigured endpoint keeps the exact
  `milvus_unavailable` floor. The credential stays `SecretRef`-only; TLS default for remote (FR4).
- **Acceptance:** a configured endpoint binds a live client whose `health` reaches the backend; an
  unconfigured endpoint returns `milvus_unavailable`.
- **Verification:** `bun test packages/opencode/test/semantic/**`; live path is env-gated (T017).
- **Evidence:** _(reserved)_

- [ ] **T005 — Add `enumerate-indexed-docs` + `createCollection/buildGeneration` to `MilvusPort`**
- **Depends:** T004
- **Paths:** `packages/opencode/src/semantic/milvus-adapter.ts`
- **Deliverable:** add the enumerate-indexed-docs method returning `{canonicalId, contentHash}` per
  collection (`#EnumeratedIndexedDoc`) AND a createCollection/buildGeneration for the blue/green
  reindex to the `MilvusPort` (`milvus-adapter.ts:113-119`), keeping the mandatory project
  partition filter on every op (FR6).
- **Acceptance:** the two new methods exist on the port and resolve typed gaps when unreachable.
- **Verification:** `bun test packages/opencode/test/semantic/**` (port surface).
- **Evidence:** _(reserved)_

## Group B2 — Embedding cutover/rollback over the live port (FR5)

- [ ] **T006 — Embedding cutover/rollback over the live port (build+validate before the swap)**
- **Depends:** T005
- **Paths:** `packages/opencode/src/semantic/cutover-executor.ts`, `packages/opencode/src/operator/semantic/**`
- **Deliverable:** drive `cutoverEmbedding`/`rollbackEmbedding` over the live port; build a
  blue/green generation (`building → validated`, `#GenerationBuild`, `#IndexGeneration`) and only
  then swap the alias — the cardinal honesty rule; `select`/`reindex` alone never activate
  (`#EmbeddingCutover`) (FR5).
- **Acceptance:** a cutover swaps the alias only after a built+validated generation; `select`/
  `reindex` never activate the live alias.
- **Verification:** `bun test packages/opencode/test/semantic/**` (build-then-swap).
- **Evidence:** _(reserved)_

- [ ] **T007 — All-collections atomic CAS alias swap; unconfigured → `milvus_unavailable`**
- **Depends:** T006
- **Paths:** `packages/opencode/src/semantic/cutover-executor.ts`, `packages/opencode/src/semantic/milvus-adapter.ts`
- **Deliverable:** swap every collection alias together under one CAS
  (`agents`/`skills`/`skill_chunks`/`tools` never split, Feature 006 C6/C12); a CAS contention
  swaps nothing; an unconfigured/unreachable endpoint returns the exact `milvus_unavailable` gap
  (FR5, FR16).
- **Acceptance:** the swap is atomic across collections; a contention swaps none; unconfigured →
  typed gap.
- **Verification:** `bun test packages/opencode/test/semantic/**` (atomic swap, contention).
- **Evidence:** _(reserved)_

## Group B3 — Reindex/reconcile + live-doc source (FR6, FR7)

- [ ] **T008 — Reindex/reconcile live-doc source (agent/skill builders) + bound embedding client**
- **Depends:** T005
- **Paths:** `packages/opencode/src/semantic/index-jobs.ts`, `packages/opencode/src/semantic/embedding-client.ts`, `packages/opencode/src/operator/semantic/**`
- **Deliverable:** add agent/skill live-doc builders alongside `toolLiveDoc` (`index-jobs.ts:85`),
  bind the embedding client (`probe`/`embed`) from the operator runtime, and read prior indexed
  state via the enumerate seam so `runReconcile` (`:131-155`) diffs a real `LiveDoc[]` against a
  real `IndexedDoc[]` (`#LiveDocProjection`) (FR6).
- **Acceptance:** reconcile diffs real live docs against real enumerated indexed docs for
  agents/skills/tools.
- **Verification:** `bun test packages/opencode/test/semantic/**` (live-doc + reconcile).
- **Evidence:** _(reserved)_

- [ ] **T009 — Content-free reconcile that never re-pins the binding**
- **Depends:** T008
- **Paths:** `packages/opencode/src/semantic/index-jobs.ts`, `packages/opencode/src/operator/semantic/**`
- **Deliverable:** report a bounded, content-free `#ReconcilePlan` (upserted/tombstoned/unchanged
  counts) with the pinned binding version carried unchanged — a scheduled reconcile never re-pins
  (`RepinnedBinding:false`, Feature 006 FR13); a Milvus gap propagates typed (FR7).
- **Acceptance:** reconcile reports counts + unchanged version; a Milvus gap is a typed
  `milvus_unavailable`, never a crash.
- **Verification:** `bun test packages/opencode/test/semantic/**` (content-free, never re-pin).
- **Evidence:** _(reserved)_

## Group C — MCP delegation edges (FR8-FR10)

- [ ] **T010 — Delegate `mcp.auth.start`/`finish` for the interactive TUI; headless keeps the gap**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/mcp/backend-live.ts`, `packages/opencode/src/operator/stack-live.ts`, `packages/opencode/src/mcp/index.ts`
- **Deliverable:** for an interactive TUI surface, `mcp.auth.start` delegates to
  `MCP.Service.startAuth` (`mcp/index.ts:827` — authorize URL + `McpOAuthCallback.ensureRunning`
  loopback listener) and `mcp.auth.finish` to `finishAuth` (`:939`); a headless surface keeps the
  typed gap (`backend-live.ts:68-73`). No token/secret crosses the envelope (`#McpAuthStart`) (FR8).
- **Acceptance:** the TUI receives the authorize URL and the callback listener starts; finish
  completes the exchange; a headless surface returns the typed gap; no secret leaks.
- **Verification:** `bun test packages/opencode/test/operator/** packages/opencode/test/mcp/**`.
- **Evidence:** _(reserved)_

- [ ] **T011 — `mcp.resource.admin.subscribe`/`unsubscribe` over the dual-authority machine**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/mcp/backend-live.ts`, `packages/opencode/src/mcp/resource-adapter.ts`, `packages/core/src/mcp/subscription-machine.ts`, `packages/opencode/src/mcp/index.ts`
- **Deliverable:** connect the existing dual-authority subscription machine
  (`subscription-machine.ts`, `resource-adapter.ts:104` `beginSubscribe`) to a live
  subscribe-capable client (SDK `subscribeResource`/`unsubscribeResource`) with `resources/updated`
  handling, gated by BOTH the server `resources.subscribe` capability AND the operator grant; an
  absent capability → `capability_absent` (`#McpSubscription`) (FR9).
- **Acceptance:** subscribe/unsubscribe drive the client subscription; a client without the
  capability returns `capability_absent`; the machine stays fail-closed.
- **Verification:** `bun test packages/opencode/test/mcp/** packages/opencode/test/operator/**`.
- **Evidence:** _(reserved)_

- [ ] **T012 — Truthful experimental/extension badges from the config-backed flag state**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/mcp/backend-live.ts`
- **Deliverable:** project the operator's config-backed experimental/extension flag state into the
  mcp status read so a connected server's badges render `Enabled`/`Disabled` instead of `Unknown`
  (`#McpToggleBadgeState`); record the `cfg.mcp` schema-split boundary; the live-list is
  same-instance and needs no fix (FR10).
- **Acceptance:** a connected server's badges render truthfully from the config-backed flag state;
  the schema-split boundary is documented.
- **Verification:** `bun test packages/opencode/test/operator/**` (badge projection).
- **Evidence:** _(reserved)_

## Group D — Real OTLP telemetry export (FR11-FR13)

- [ ] **T013 — Compose an eager, fail-open, process-singleton OTLP export pipeline**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/stack-live.ts`, `packages/opencode/src/routing/**`
- **Deliverable:** a process-singleton export pipeline mirroring `ensureProcessSpoolWriter`
  (`spool-process-writer.ts:39-56`) and `ensureExecutorComposition`
  (`executor-composition.ts:504-519`) — eager, idempotent, fail-open — composed at server start
  when the effective config has `enabled=true`, replacing the offline `createUnavailableTransport`
  at `stack-live.ts:354-361` (`#TelemetryExportPipeline`) (FR11).
- **Acceptance:** the pipeline arms eagerly and fails open on a fault; a second call reuses the
  armed instance; a disabled config leaves it disarmed.
- **Verification:** `bun test packages/opencode/test/routing/** packages/opencode/test/operator/**`.
- **Evidence:** _(reserved)_

- [ ] **T014 — Real transport + bounded queue + drop policy + retry-budget enforcement**
- **Depends:** T013
- **Paths:** `packages/opencode/src/routing/adapters/outbound/otlp-adapter.ts`, `packages/core/src/observability/otlp.ts`
- **Deliverable:** implement a real `OtlpTransport` (`http/protobuf` via fetch; `grpc` if
  supported) bound to the configured endpoint, and enforce the `retry_budget` (today unread) over
  the existing `BoundedExportQueue` (capacity/batch/`drop`|`backpressure`, `otlp.ts:145`)
  (`#ExportQueueBound`) (FR12).
- **Acceptance:** an enabled pipeline sends a batch over the real transport; overflow applies the
  drop policy; a failed send retries within the budget then drops; the session loop never blocks.
- **Verification:** `bun test packages/opencode/test/routing/**` (fake transport unit tests).
- **Evidence:** _(reserved)_

- [ ] **T015 — Redaction defaults enforced on every exported signal**
- **Depends:** T014
- **Paths:** `packages/opencode/src/routing/**`
- **Deliverable:** enforce the redaction defaults — `prompts`, `secrets`, `file_paths`,
  `file_content`, `tool_payloads` all excluded — before any signal leaves the process
  (`#TelemetryRedaction`); no prompt, secret, path, file content, or tool payload is exported
  (FR12, Security).
- **Acceptance:** a signal carrying a redacted category is stripped before export; a unit test
  asserts no sensitive field crosses the transport.
- **Verification:** `bun test packages/opencode/test/routing/** packages/opencode/test/telemetry/**`.
- **Evidence:** _(reserved)_

- [ ] **T016 — Pull-based re-arm on server start / `telemetry.*` dispatch; disabled → no fiber**
- **Depends:** T013
- **Paths:** `packages/opencode/src/operator/telemetry/**`, `packages/opencode/src/operator/stack-live.ts`
- **Deliverable:** re-resolve the effective config and re-arm/stop the pipeline pull-based on
  server start and on a `telemetry.on`/`off`/`configure` dispatch (no push invalidation seam
  exists); a `disabled` config runs no fiber and touches no network; `telemetry.test` stays the
  reachability probe (`#TelemetryPipelineState`) (FR11).
- **Acceptance:** enabling telemetry arms the pipeline at the next tick; disabling stops it;
  disabled → no fiber/network.
- **Verification:** `bun test packages/opencode/test/operator/**` (re-arm cases).
- **Evidence:** _(reserved)_

- [ ] **T017 — Env-gated live validation (Milvus endpoint + OTLP collector)**
- **Depends:** T007, T014
- **Paths:** `packages/opencode/test/semantic/**`, `packages/opencode/test/routing/**`
- **Deliverable:** an env-gated integration path that (a) exercises probe + create-generation +
  upsert + enumerate + swapAliases against a live Milvus endpoint, and (b) enables telemetry
  against a live OTLP collector, emits at least one real signal, and verifies ingestion via the
  collector's downstream query API; unit tests use fake ports/transports and CI never requires the
  live endpoints (FR13).
- **Acceptance:** the env-gated path passes against real infrastructure and records raw evidence;
  CI is green without the endpoints.
- **Verification:** env-gated `bun test`; manual acceptance against a live Milvus endpoint and a
  live OTLP collector.
- **Evidence:** _(reserved — implement runs this against the real hosts and records raw evidence)_

## Group E — Availability flip + parity (FR14-FR16)

- [ ] **T018 — Palette availability flip to the composed truth**
- **Depends:** T003, T007, T012, T016
- **Paths:** `packages/core/src/operator/palette.ts`
- **Deliverable:** update the palette per-verb classification so each completed verb
  (`semantic.reranker.cutover`/`rollback`, `semantic.embedding.cutover`/`rollback`,
  `semantic.index.reindex`/`reconcile`, `mcp.auth.start`/`finish`,
  `mcp.resource.admin.subscribe`/`unsubscribe`, the mcp badges, telemetry export) reads the
  composed truth (`#BackendReadiness`); still-gapped verbs stay `honest_unavailable` (FR14).
- **Acceptance:** the completed verbs no longer read `unavailable`; still-gapped verbs stay honest;
  no verb advertises a capability it lacks.
- **Verification:** `bun test packages/core/test/operator/**` (palette).
- **Evidence:** _(reserved)_

## Group F — Tests + guard scope + doc sync (FR15)

- [ ] **T019 — Group A tests (registry routing, archive, gates)** — **Depends:** T001-T003 —
  **Paths:** `packages/opencode/test/{semantic,operator}/**` — reranker cutover routes config-backed
  (no Milvus), invalidates cache/eval with `reEmbedded:false`; archive round-trip; not_validated /
  no_archived_prior / cas_conflict gates. **Evidence:** _(reserved)_
- [ ] **T020 — Group B tests (Milvus port, generation build, reconcile, live Milvus)** —
  **Depends:** T004-T009, T017 — **Paths:** `packages/opencode/test/semantic/**` — live port
  methods; build+validate before swap; atomic all-collections swap; unconfigured →
  `milvus_unavailable`; reconcile diffs real state, never re-pins; env-gated live Milvus.
  **Evidence:** _(reserved)_
- [ ] **T021 — Group C tests (auth delegation, subscription, badges)** — **Depends:** T010-T012 —
  **Paths:** `packages/opencode/test/{operator,mcp}/**` — auth delegation (TUI) vs headless gap;
  subscription over the machine + `capability_absent`; truthful badges; live-list same-instance.
  **Evidence:** _(reserved)_
- [ ] **T022 — Group D tests (export sends, disabled no-op, redaction, drop policy)** —
  **Depends:** T013-T017 — **Paths:** `packages/opencode/test/{routing,telemetry,operator}/**` —
  enabled → real transport sends a signal (fake transport); disabled → no fiber/network; slow
  collector never blocks; redaction enforced; retry within budget then drop. **Evidence:** _(reserved)_
- [ ] **T023 — Availability + parity tests (Feature 007 harness)** — **Depends:** T018 —
  **Paths:** `packages/core/test/operator/**`, `packages/tui/test/operator/**` — palette flip
  truthful; reuse the Feature 007 parity harness to assert each verb rides the same command id /
  loopback with no new dispatch path, no new catalog id, no version bump. **Evidence:** _(reserved)_
- [ ] **T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green** —
  **Depends:** T001-T023 — **Paths:** `doc/arch/speckit.toml`, `doc/arch/sdd/019-*/**`,
  `doc/arch/adr/0019-*.md`, `doc/arch/schemas/semantic-lifecycle/**`,
  `doc/arch/statecharts/binding-generation-lifecycle.md`, `doc/arch/functional/product-overview.md`
  — confirm the Feature 006/007/008/001 guard globs cover every touched path (add an 019 block only
  for a genuinely-new path); keep the spec, ADR-0019, the `semantic-lifecycle/*.cue` corpus, and the
  statechart in sync with the shipped shapes; `speckit analyze` clean and `speckit validate --json`
  green (0 new findings on Feature 019 artifacts). **Acceptance:** `speckit analyze` reports no new
  Critical/High/Medium; `speckit validate --json` is `ok:true` with 0 new findings.
  **Verification:** `speckit analyze`; `speckit validate --json`. **Evidence:** _(reserved)_
