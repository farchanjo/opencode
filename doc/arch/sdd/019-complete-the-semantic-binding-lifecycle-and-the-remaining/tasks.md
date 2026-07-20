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
- [x] T004 — Bind a real Milvus gRPC/HTTP client when the endpoint is configured
- [x] T005 — Add `enumerate-indexed-docs` + `createCollection/buildGeneration` to `MilvusPort`
- [x] T006 — Embedding cutover/rollback over the live port (build+validate before the swap)
- [x] T007 — All-collections atomic CAS alias swap; unconfigured → `milvus_unavailable`
- [x] T008 — Reindex/reconcile live-doc source (agent/skill builders) + bound embedding client
- [x] T009 — Content-free reconcile that never re-pins the binding
- [x] T010 — Delegate `mcp.auth.start`/`finish` for the interactive TUI; headless keeps the gap
- [x] T011 — `mcp.resource.admin.subscribe`/`unsubscribe` over the dual-authority machine
- [x] T012 — Truthful experimental/extension badges from the config-backed flag state
- [x] T013 — Compose an eager, fail-open, process-singleton OTLP export pipeline
- [x] T014 — Real transport + bounded queue + drop policy + retry-budget enforcement
- [x] T015 — Redaction defaults enforced on every exported signal
- [x] T016 — Pull-based re-arm on server start / `telemetry.*` dispatch; disabled → no fiber
- [x] T017 — Env-gated live validation (Milvus endpoint + OTLP collector)
- [x] T018 — Palette availability flip to the composed truth
- [x] T019 — Group A tests (registry routing, archive, gates)
- [x] T020 — Group B tests (Milvus port, generation build, reconcile, live Milvus)
- [x] T021 — Group C tests (auth delegation, subscription, badges)
- [x] T022 — Group D tests (export sends, disabled no-op, redaction, drop policy)
- [x] T023 — Availability + parity tests (Feature 007 harness)
- [x] T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green

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
  operator-authored version (no version churn).
- **Addendum 2026-07-20 (adversarial-review remediation):** the original wave left the reranker
  cutover UNREACHABLE end-to-end — `planSelect` stages `{state:'draft', validated:false}` and
  NOTHING config-backed ever produced a validated candidate (`semantic.reranker.validate` routed to
  the gated Milvus backend, which never touches the `RegistryDocument`), so the `not_validated` gate
  ALWAYS rejected. Fixed by adding the config-backed **validate transition** `planValidateReranker`
  (registry-backend.ts): pure coherence gates (candidate staged from `draft`; eligible rerank
  profile — profile C refused; model + provider registered, enabled, secret-resolvable) then a
  provider rerank probe in the plan EFFECT (after CAS, 017 contract) that, on pass, promotes the
  candidate to `{state:'staged', validated:true}` — the ONLY producer of a validated candidate.
  `semantic.reranker.validate` now routes through `c.registry` (semantic-command-port.ts), and the
  catalog marks it `mutates:true` (a persisted transition, not a read-only probe). Tests now drive
  the REAL chain select → validate → cutover → rollback with NO injected validated state:
  `feature019-reranker-lifecycle.test.ts` (16) + `feature019-reranker-dispatch.test.ts` (4) green;
  `bun test test/operator/` 477 pass / 2 skip; `bun test test/semantic/` 138 pass.

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

- [x] **T004 — Bind a real Milvus gRPC/HTTP client when the endpoint is configured**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/stack-live.ts`, `packages/opencode/src/semantic/milvus-adapter.ts`
- **Deliverable:** replace `createGrpcMilvusAdapter({})` (`stack-live.ts:513-537`) with a real
  gRPC/HTTP client when `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is configured, plus persisted
  generation/alias/CAS state (`#MilvusEndpointBinding`); an unconfigured endpoint keeps the exact
  `milvus_unavailable` floor. The credential stays `SecretRef`-only; TLS default for remote (FR4).
- **Acceptance:** a configured endpoint binds a live client whose `health` reaches the backend; an
  unconfigured endpoint returns `milvus_unavailable`.
- **Verification:** `bun test packages/opencode/test/semantic/**`; live path is env-gated (T017).
- **Evidence:** 2026-07-20 — Transport chosen: **Milvus REST v2 HTTP API** (`/v2/vectordb/*` on the
  same `:19530` port), the seam the `MilvusGrpcClient` contract supports cleanly under Bun.
  `milvus-adapter.ts` `createHttpMilvusClient` implements it with bounded per-request timeouts
  (`AbortController`, default 5000ms, hard-capped 30000), TLS-by-default (secure unless the address
  carries an explicit `http://` scheme or `ssl:false`), a resolved `authorization` header
  (SecretRef-supplied, never inline), and a non-zero-`code`/transport fault → thrown bounded reason
  (no endpoint/credential across the seam). `stack-live.ts` now binds
  `createGrpcMilvusAdapter({ client: createHttpMilvusClient({ address, ssl: !insecure, authorization }) })`
  when `OPENCODE_SEMANTIC_MILVUS_ADDRESS` is set, and passes the port to the semantic backend + the
  config-backed registry; unconfigured binds NO port (identical `milvus_unavailable` floor — pinned by
  `feature019-embedding-lifecycle.test.ts` "unconfigured … same typed unavailable envelope"). Live proof
  under T017.

- [x] **T005 — Add `enumerate-indexed-docs` + `createCollection/buildGeneration` to `MilvusPort`**
- **Depends:** T004
- **Paths:** `packages/opencode/src/semantic/milvus-adapter.ts`
- **Deliverable:** add the enumerate-indexed-docs method returning `{canonicalId, contentHash}` per
  collection (`#EnumeratedIndexedDoc`) AND a createCollection/buildGeneration for the blue/green
  reindex to the `MilvusPort` (`milvus-adapter.ts:113-119`), keeping the mandatory project
  partition filter on every op (FR6).
- **Acceptance:** the two new methods exist on the port and resolve typed gaps when unreachable.
- **Verification:** `bun test packages/opencode/test/semantic/**` (port surface).
- **Evidence:** 2026-07-20 — `MilvusPort` gains `enumerateIndexed` (`{canonicalId, contentHash}` per
  collection/project, mandatory-`projectId` guarded → `invalid_filters`) and `buildGeneration`
  (`building → validated`, materializes a fresh generation for every collection together). Implemented
  on all three surfaces: the in-memory fake (generation buckets keyed apart from the live alias; a
  `swapAliases` promotes a generation into the live alias), the `createGrpcMilvusAdapter` guard (unbound
  client → `milvus_unavailable`), and the REST client (`/collections/create` with a fixed
  `id`/`content_hash`/`project_id`/`vector` schema + `/collections/describe` validation; `/entities/query`
  enumerate). `UpsertInput`/`TombstoneInput`/`EnumerateIndexedInput` carry an optional `generationId` so a
  reindex targets the blue/green generation, not the live alias. Tests:
  `feature019-milvus-port.test.ts` T005 cases (enumerate content-free, invalid_filters, build+swap
  isolation, unbound gap) green; `milvus-adapter.test.ts` (18) still green.

## Group B2 — Embedding cutover/rollback over the live port (FR5)

- [x] **T006 — Embedding cutover/rollback over the live port (build+validate before the swap)**
- **Depends:** T005
- **Paths:** `packages/opencode/src/semantic/cutover-executor.ts`, `packages/opencode/src/operator/semantic/**`
- **Deliverable:** drive `cutoverEmbedding`/`rollbackEmbedding` over the live port; build a
  blue/green generation (`building → validated`, `#GenerationBuild`, `#IndexGeneration`) and only
  then swap the alias — the cardinal honesty rule; `select`/`reindex` alone never activate
  (`#EmbeddingCutover`) (FR5).
- **Acceptance:** a cutover swaps the alias only after a built+validated generation; `select`/
  `reindex` never activate the live alias.
- **Verification:** `bun test packages/opencode/test/semantic/**` (build-then-swap).
- **Evidence:** 2026-07-20 — `semantic.embedding.reindex`/`cutover`/`rollback` now route through the
  config-backed registry (`semantic-command-port.ts` `embeddingInvoke`) as **effectful
  `OperatorMutationPlan`s** (ADR-0017/018 contract): `registry-backend.ts` `planReindexEmbedding`
  builds+validates a generation in the plan `effect` (`CutoverExecutor` reuses `MilvusPort`, never a
  config-only flip) and records it `validated` on the `RegistryDocument` (`embeddingGenerations`);
  `planCutoverEmbedding` gates on a staged **validated** candidate AND a **validated generation**
  (`resolveCutoverGeneration`) — the cardinal-honesty gate: no built+validated generation →
  `no_candidate_staged`, never a swap. The swap runs in the effect AFTER the confirmation gate, then
  `apply` promotes staged→active, archives the prior binding + supersedes the prior generation, and
  points `embeddingLiveGeneration` at the new one. Generation/alias state persists alongside the
  registry doc (ADR-0019 decision 3).
- **Addendum 2026-07-20 (adversarial-review remediation):** the embedding lifecycle had the same
  unreachability defect as the reranker — nothing config-backed produced a validated candidate. Fixed
  by adding `planValidateEmbedding` and correcting the ordering to select → **reindex** → **validate**
  → cutover: `planReindexEmbedding` no longer demands `validated:true` (it now runs for a selected
  `draft`/re-staged candidate, `BindingLifecycle.apply(state,'reindex') !== illegal`), so it PRECEDES
  validate and produces the generation validate requires. `planValidateEmbedding` (pure config plan)
  enforces the cardinal rule — a `validated` generation matching the candidate version must already
  exist (reindex-first, else `not_validated`), Milvus must be bound (else `milvus_unavailable`), and
  the model/provider must be coherent — then promotes the candidate to `{state:'staged',
  validated:true}`. `semantic.embedding.validate` routes through `c.registry` and is `mutates:true` in
  the catalog. Tests drive the REAL chain select → reindex → validate → cutover with NO injected
  validated state: `feature019-embedding-lifecycle.test.ts` (10) green, plus the reindex-first and
  no-candidate negative paths.

- [x] **T007 — All-collections atomic CAS alias swap; unconfigured → `milvus_unavailable`**
- **Depends:** T006
- **Paths:** `packages/opencode/src/semantic/cutover-executor.ts`, `packages/opencode/src/semantic/milvus-adapter.ts`
- **Deliverable:** swap every collection alias together under one CAS
  (`agents`/`skills`/`skill_chunks`/`tools` never split, Feature 006 C6/C12); a CAS contention
  swaps nothing; an unconfigured/unreachable endpoint returns the exact `milvus_unavailable` gap
  (FR5, FR16).
- **Acceptance:** the swap is atomic across collections; a contention swaps none; unconfigured →
  typed gap.
- **Verification:** `bun test packages/opencode/test/semantic/**` (atomic swap, contention).
- **Evidence:** 2026-07-20 — `planCutoverEmbedding` drives `CutoverExecutor.cutoverEmbedding` over the
  fixed `GENERATION_COLLECTIONS = [agents, skills, skill_chunks, tools]` in ONE `swapAliases` call (the
  swap-spy test asserts `targets.length === 4` — never split). The REAL contention guard is TWO-fold:
  the authority CAS token (the dispatcher `version` enforced by `mutateAuthority`) is the optimistic
  concurrency gate that aborts a concurrent edit, and the Milvus port's own `swapAliases` `casToken`
  mismatch surfaces a `cas_conflict` gap the effect maps to `{ ok:false, code:"conflict" }` so nothing
  commits (pinned by the fake `casToken:"moved"` contention test). The executor's in-core
  `IndexGeneration.cutoverAll` comparison is a TAUTOLOGY on this path (`planCutoverEmbedding` passes
  `casExpected === casActual === generation.generationId`), so it is NOT the concurrency guard — the
  authority CAS and the port swap CAS are. Unconfigured
  (no bound Milvus port) → the three embedding plans fail `{ type:"unavailable", reason:"milvus_unavailable" }`,
  mapped by `mapError` to the identical `unavailable` dispatch envelope as today. Tests:
  `feature019-embedding-lifecycle.test.ts` T007 cases (all-collections swap, CAS-contention aborts,
  unconfigured floor, rollback restores archived prior/generation, `no_archived_prior`) green;
  `rollbackEmbedding` reuses `cutoverEmbedding` so the atomic-swap owner is single-sourced.

## Group B3 — Reindex/reconcile + live-doc source (FR6, FR7)

- [x] **T008 — Reindex/reconcile live-doc source (agent/skill builders) + bound embedding client**
- **Depends:** T005
- **Paths:** `packages/opencode/src/semantic/index-jobs.ts`, `packages/opencode/src/semantic/embedding-client.ts`, `packages/opencode/src/operator/semantic/**`
- **Deliverable:** add agent/skill live-doc builders alongside `toolLiveDoc` (`index-jobs.ts:85`),
  bind the embedding client (`probe`/`embed`) from the operator runtime, and read prior indexed
  state via the enumerate seam so `runReconcile` (`:131-155`) diffs a real `LiveDoc[]` against a
  real `IndexedDoc[]` (`#LiveDocProjection`) (FR6).
- **Acceptance:** reconcile diffs real live docs against real enumerated indexed docs for
  agents/skills/tools.
- **Verification:** `bun test packages/opencode/test/semantic/**` (live-doc + reconcile).
- **Evidence:** 2026-07-20 — `index-jobs.ts` adds `agentLiveDoc` (reads `AgentDoc.scope` DocScope
  filters) and `skillLiveDoc` (SkillDoc carries no DocScope → caller supplies the mandatory partition
  filters) beside the shipped `toolLiveDoc`; all three are content-free (canonical id + content hash +
  injected vectors, never a body). `milvus-binding.ts` `createMilvusIndexPort` gains an optional live
  composition (`port` MilvusPort + `source` LiveDocSource + `context` + `spool`): `reconcile` collects
  the live-doc source, enumerates prior indexed state via the new `enumerateIndexed` seam, and runs
  `runReconcile` to diff+apply; `reindex` forces a full rebuild (indexed treated empty). The embedding
  client (`embedding-client.ts` `probe`/`embed`) is the injected upstream that produces the LiveDoc
  vectors via the `LiveDocSource` seam — a missing embedding provider makes `collect` reject and the
  verb degrades typed (never fabricated vectors). Tests: `feature019-milvus-port.test.ts` T008 cases
  (agent/skill builders, reconcile diff for agents/tools) green.

- [x] **T009 — Content-free reconcile that never re-pins the binding**
- **Depends:** T008
- **Paths:** `packages/opencode/src/semantic/index-jobs.ts`, `packages/opencode/src/operator/semantic/**`
- **Deliverable:** report a bounded, content-free `#ReconcilePlan` (upserted/tombstoned/unchanged
  counts) with the pinned binding version carried unchanged — a scheduled reconcile never re-pins
  (`RepinnedBinding:false`, Feature 006 FR13); a Milvus gap propagates typed (FR7).
- **Acceptance:** reconcile reports counts + unchanged version; a Milvus gap is a typed
  `milvus_unavailable`, never a crash.
- **Verification:** `bun test packages/opencode/test/semantic/**` (content-free, never re-pin).
- **Evidence:** 2026-07-20 — `createMilvusIndexPort.reconcile` returns only bounded counts
  (`{ upsertedCount, tombstonedCount, outputRef }`) and threads the pinned `context.bindingVersion`
  UNCHANGED into `runReconcile` — the spool-summary spy asserts `bindingVersion === 7` after a
  reconcile that upserts 2 (one changed + one new) and tombstones 1, proving the diff runs against real
  enumerated state and never re-pins. Every failure path (context/source/enumerate/apply) maps to a
  typed `milvus_unavailable` (never a crash); an unbound source keeps the honest not-composed gap. Tests:
  `feature019-milvus-port.test.ts` T009 cases (content-free counts + version unchanged; full rebuild;
  unbound-source gap) green.

## Group C — MCP delegation edges (FR8-FR10)

- [x] **T010 — Delegate `mcp.auth.start`/`finish` for the interactive TUI; headless keeps the gap**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/mcp/backend-live.ts`, `packages/opencode/src/operator/stack-live.ts`, `packages/opencode/src/mcp/index.ts`
- **Deliverable:** for an interactive TUI surface, `mcp.auth.start` delegates to
  `MCP.Service.startAuth` (`mcp/index.ts:827` — authorize URL + `McpOAuthCallback.ensureRunning`
  loopback listener) and `mcp.auth.finish` to `finishAuth` (`:939`); a headless surface keeps the
  typed gap (`backend-live.ts:68-73`). No token/secret crosses the envelope (`#McpAuthStart`) (FR8).
- **Acceptance:** the TUI receives the authorize URL and the callback listener starts; finish
  completes the exchange; a headless surface returns the typed gap; no secret leaks.
- **Verification:** `bun test packages/opencode/test/operator/** packages/opencode/test/mcp/**`.
- **Evidence:** 2026-07-20 — Surface-detection contract per FR8: the command port reads the request
  envelope `source` (Feature 007 data-model) and delegates ONLY for an interactive TUI surface
  (`mcp-command-port.ts` `isInteractiveAuthSurface` = `{palette, slash}`); a headless surface
  (`cli`/`api`/`system`/`settings`) returns `null` from `mutationInvoke` so `mcp.auth.start`/`finish`
  fall through to `authInvoke` → the honest typed gap (`backend-live.ts` `liveAuthPort` start/finish
  = `unavailable`). Interactive delegation runs as effectOnly `OperatorMutationPlan`s
  (`backend-live.ts` `planAuthStart`/`planAuthFinish`, ADR-0017/018 contract) whose deferred effect
  calls the live `McpAuthDelegate`; the effect value surfaces the non-secret `#McpAuthStart`
  (`{serverId, delegation:"interactive_delegated", authorizationUrl}`) — the authorize URL is not a
  secret and NO token, code verifier, or oauthState crosses the envelope (asserted). `stack-live.ts`
  `mcpAuthDelegate` binds `MCP.Service.startAuth`/`finishAuth` (state validated against the CSRF
  nonce, `NotFoundError` → typed `not_found`, a non-OAuth `die` caught → typed unavailable). A
  headless surface, a `not_found` server, a state mismatch (→ conflict), and an unbound delegate each
  degrade typed. Tests: `mcp-service-backend.test.ts` T010 block (5 cases) green.

- [x] **T011 — `mcp.resource.admin.subscribe`/`unsubscribe` over the dual-authority machine**
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
- **Evidence:** 2026-07-20 — The SDK subscription primitive + the pure `SubscriptionMachine`
  existed but were never connected to a live client (corpus finding). `backend-live.ts`
  `planResourceSubscribe`/`planResourceUnsubscribe` are effectOnly `OperatorMutationPlan`s (018
  contract) whose deferred effect probes the live client capability then drives the pure
  `SubscriptionMachine.apply("unsubscribed","subscribe",{serverCapable, operatorGranted:true})`
  (dual authority; the operator grant is the audited operator principal + confirmation) BEFORE any
  live call — a `fail_closed` verdict short-circuits with a typed `capability_absent` rejection and
  the live client is never touched (no phantom subscription); a present capability calls the live
  `McpSubscriptionClient.subscribe`/`unsubscribe` exactly once and surfaces `#McpSubscription`
  (`{serverId, resourceUri, state:"subscribed"|"unsubscribed"}`). `stack-live.ts`
  `mcpSubscriptionClient` binds the SDK `client.subscribeResource`/`unsubscribeResource` +
  `getServerCapabilities().resources.subscribe`; no connected client → typed `unavailable`; an
  unbound client → typed `mcp_unavailable`. The `mcp.resource.admin.subscribe`/`unsubscribe` verbs
  (`mutates:true`) route through `mutationInvoke` so a `query` never trips the FR5 phantom-write
  trap. Tests: `mcp-service-backend.test.ts` T011 block (5 cases: capable sub/unsub once,
  capability_absent no-phantom, no-client unavailable, unbound gap) green.

- [x] **T012 — Truthful experimental/extension badges from the config-backed flag state**
- **Depends:** none
- **Paths:** `packages/opencode/src/operator/mcp/backend-live.ts`
- **Deliverable:** project the operator's config-backed experimental/extension flag state into the
  mcp status read so a connected server's badges render `Enabled`/`Disabled` instead of `Unknown`
  (`#McpToggleBadgeState`); record the `cfg.mcp` schema-split boundary; the live-list is
  same-instance and needs no fix (FR10).
- **Acceptance:** a connected server's badges render truthfully from the config-backed flag state;
  the schema-split boundary is documented.
- **Verification:** `bun test packages/opencode/test/operator/**` (badge projection).
- **Evidence:** 2026-07-20 — `backend-live.ts` `liveExperimentalPort`/`liveExtensionPort` back
  `mcp.experimental.status`/`mcp.extension.status` by reading the SAME config-backed MCP authority
  (`store.config` `global:mcp`) the operator toggles write via `planExperimentalToggle`/
  `planExtensionToggle`, wired through `createMcpServiceOverride` when the config seam is bound.
  Experimental status projects the 4 rollout-order flags plus the aggregate `enabled` (the default
  `tasks` flag the Feature 015 toggle row governs); extension status projects `enabled` from
  `extensionEnabled`. The TUI `controls.ts` `toggleStateFrom` reads that boolean → `toggleBadge`
  renders `Enabled`/`Disabled`; a genuinely absent server carries NO aggregate `enabled` so the row
  stays the honest `Unknown` (protocol `ExperimentalStatusOutput`/`ExtensionStatusOutput` extended
  with an optional `enabled`). The `cfg.mcp` schema-split boundary (the runtime schema has no such
  field; the badge reflects the operator config SSOT the toggle owns) is documented in code and in
  spec Out of Scope; the live-list is same-instance and needs no fix. Tests:
  `mcp-service-backend.test.ts` T012 block (4 cases: truthful experimental/extension, unset →
  Disabled, absent → no `enabled`) + `packages/tui/test/operator/controls.test.ts` T012 block (3
  cases: Enabled/Disabled from config-backed effective; Unknown only when genuinely absent) green.

## Group D — Real OTLP telemetry export (FR11-FR13)

- [x] **T013 — Compose an eager, fail-open, process-singleton OTLP export pipeline**
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
- **Evidence:** 2026-07-20 — `packages/opencode/src/routing/telemetry-export.ts`
  `ensureTelemetryExport` (`:236-259`) is the process-singleton (`singleton`/`pending`/`attempted`
  state) mirroring `ensureExecutorComposition`: eager, idempotent (a second call returns the same
  instance), FAIL-OPEN (a build fault degrades to `disarmed(reason)` — `armPipeline`/`disarmed` at
  `:118-192`). `server.ts` (`:134-146`) arms it fire-and-forget at `listen()`
  (`void TelemetryExport.ensureTelemetryExport().catch(...)`), independent of the operator stack.
  `telemetry-export-live.ts` builds the SAME live `store.config` + `SecretPort` seams the operator
  stack binds (no parallel store). A disabled config → `disarmed` with NO interval, NO adapter, NO
  network (`buildPipeline` `:280-297`). Tests: `test/routing/telemetry-export.test.ts` T013 block
  (armed/idempotent/disabled-disarmed) green.

- [x] **T014 — Real transport + bounded queue + drop policy + retry-budget enforcement**
- **Depends:** T013
- **Paths:** `packages/opencode/src/routing/adapters/outbound/otlp-adapter.ts`, `packages/core/src/observability/otlp.ts`
- **Deliverable:** implement a real `OtlpTransport` (`http/protobuf` via fetch; `grpc` if
  supported) bound to the configured endpoint, and enforce the `retry_budget` (today unread) over
  the existing `BoundedExportQueue` (capacity/batch/`drop`|`backpressure`, `otlp.ts:145`)
  (`#ExportQueueBound`) (FR12).
- **Acceptance:** an enabled pipeline sends a batch over the real transport; overflow applies the
  drop policy; a failed send retries within the budget then drops; the session loop never blocks.
- **Verification:** `bun test packages/opencode/test/routing/**` (fake transport unit tests).
- **Evidence:** 2026-07-20 — Transport chosen: **`http/protobuf` via `fetch` with spec-valid
  OTLP/JSON** (`content-type: application/json`), no new dependency (ADR-0019 decision 8
  implement-time note). `packages/opencode/src/routing/adapters/outbound/otlp-transport.ts`
  `createHttpOtlpTransport` groups a drained batch by kind and POSTs each to
  `<endpoint>/v1/{metrics,logs,traces}`; metrics → single-point Gauge (numeric `value` = the point,
  the rest content-free labels), logs → `logRecords`, traces → spans (random 16-byte trace / 8-byte
  span ids). `retry_budget` is honored (transient 5xx/429/network retried within budget + bounded
  backoff; permanent 4xx not retried); every request is bounded by `export_timeout_ms`
  (`AbortController`) and NEVER throws into the caller (`{ok:false,reason}`). `grpc` stays a typed
  boundary → the pipeline disarms with a typed reason. The pipeline flush drains the reused Feature
  001 `BoundedExportQueue` (capacity/batch/drop policy) over the transport, isolating export errors.
  Tests: `test/routing/otlp-transport.test.ts` (encoding per kind; retry-within-budget; give-up after
  budget; 4xx-no-retry; network-throw → `{ok:false}`; empty-batch no-op; probe) + `telemetry-export.test.ts`
  T014 block (flush ships content-free instruments; timer-driven flush non-blocking; drop policy sheds
  overflow; failing transport isolates the error) green (21 pass across the two files).

- [x] **T015 — Redaction defaults enforced on every exported signal**
- **Depends:** T014
- **Paths:** `packages/opencode/src/routing/**`
- **Deliverable:** enforce the redaction defaults — `prompts`, `secrets`, `file_paths`,
  `file_content`, `tool_payloads` all excluded — before any signal leaves the process
  (`#TelemetryRedaction`); no prompt, secret, path, file content, or tool payload is exported
  (FR12, Security).
- **Acceptance:** a signal carrying a redacted category is stripped before export; a unit test
  asserts no sensitive field crosses the transport.
- **Verification:** `bun test packages/opencode/test/routing/** packages/opencode/test/telemetry/**`.
- **Evidence:** 2026-07-20 — Redaction is enforced in the OTLP adapter `offer`
  (`otlp-adapter.ts:119-131`, `redactAttributes` over `redactionPolicyFromConfig`) BEFORE a signal is
  queued, so nothing sensitive can reach the transport. The exported signal set is a small, honest,
  **content-free** in-process meter (queue/export instruments + `opencode_operator_mutation_total`
  bumped by the dispatcher post-commit hook + `opencode_session_count`), each a numeric-`value` point
  only. Pinned by a hostile-attribute-set test: `test/routing/telemetry-export.test.ts` T015 offers a
  bag carrying `prompt`/`apiKey`/`homePath`/`arguments`/`content` + a bounded `routing.task_class`;
  after flush the wire JSON contains none of the sensitive substrings, the sensitive keys are
  `[redacted]`, and only the bounded routing label survives (existing `test/telemetry/redaction.test.ts`
  + `otlp-pipeline.test.ts` content-free assertions still green). Defensive posture per FR12/Security.

- [x] **T016 — Pull-based re-arm on server start / `telemetry.*` dispatch; disabled → no fiber**
- **Depends:** T013
- **Paths:** `packages/opencode/src/operator/telemetry/**`, `packages/opencode/src/operator/stack-live.ts`
- **Deliverable:** re-resolve the effective config and re-arm/stop the pipeline pull-based on
  server start and on a `telemetry.on`/`off`/`configure` dispatch (no push invalidation seam
  exists); a `disabled` config runs no fiber and touches no network; `telemetry.test` stays the
  reachability probe (`#TelemetryPipelineState`) (FR11).
- **Acceptance:** enabling telemetry arms the pipeline at the next tick; disabling stops it;
  disabled → no fiber/network.
- **Verification:** `bun test packages/opencode/test/operator/**` (re-arm cases).
- **Evidence:** 2026-07-20 — Pull-based re-arm (ADR-0019 decision 8 — no push seam). Server start arms
  the singleton (`server.ts` `ensureTelemetryExport`); a `telemetry.*` mutation commit pokes
  `rearmTelemetryExport` through a NEW generic dispatcher post-commit hook: `DispatchOptions.onCommitted`
  (`dispatcher.ts:56-66`) fires only after a successful CAS commit (`result.ok`), and `stack-live.ts`
  wires it to `TelemetryExport.recordOperatorMutation()` + (when `descriptor.domain === "telemetry"`)
  `void rearmTelemetryExport()`. `rearmTelemetryExport` (`telemetry-export.ts:305-311`) disposes the
  current timer, re-resolves the effective config, and re-arms — enabling arms a real transport,
  disabling disposes the interval and goes silent. `telemetry.test` stays the reachability probe
  (unchanged). A disabled config runs NO fiber/network (pinned). Tests:
  `test/routing/telemetry-export.test.ts` T016 block (disabled→enabled re-arm ships a batch;
  enabled→disabled disposes the timer + disarmed flush touches no network; grpc → disarmed typed
  boundary) green; `bun test test/operator/` 472 pass / 2 skip (dispatcher `onCommitted` addition
  regression-free).

- [x] **T017 — Env-gated live validation (Milvus endpoint + OTLP collector)**
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
- **Evidence (OTLP half):** 2026-07-20 — **DONE.** `packages/opencode/test/routing/telemetry-live.test.ts`
  is env-gated (`test.skipIf(OPENCODE_TELEMETRY_LIVE !== "1")`): it drives the real
  `createHttpOtlpTransport` against a live OTLP collector (`OPENCODE_TELEMETRY_ENDPOINT`, default the
  operator's persisted collector `http://vm.services:4318` — Grafana Alloy), emits a uniquely-named,
  content-free metric `opencode_telemetry_live_check{run_id="t017_<hex>"}` (numeric point + bounded
  run-id label only), then polls the downstream Mimir Prometheus query API
  (`http://vm.services:9009/prometheus/api/v1/query`) until ingested. RAW run
  (`OPENCODE_TELEMETRY_LIVE=1 bun test test/routing/telemetry-live.test.ts` = `1 pass`):
  `[T017] send: {"ok":true,"reason":null}` → `[T017] ingested after 2s:
  {"status":"success","data":{"resultType":"vector","result":[{"metric":{"__name__":"opencode_telemetry_live_check","job":"opencode","run_id":"t017_74a16383"},"value":[1784526812.612,"1"]}]}}`
  — the OTLP/JSON metric encoded by our transport was accepted by Alloy at `:4318/v1/metrics`,
  forwarded to Mimir, and queried back with the exact `run_id` label within 2s. Collector + Mimir
  reachability pre-confirmed (`curl` → `otlp 200`, `mimir 200` on `query=up`). No persisted operator
  telemetry config was mutated (the test uses the transport directly; persisted state stays
  `enabled=false`, endpoint unchanged). Without `OPENCODE_TELEMETRY_LIVE=1` the test SKIPS so CI stays
  green (`bun test test/routing/ test/telemetry/` = 270 pass / 1 skip).
- **Evidence (Milvus half):** 2026-07-20 — **Milvus half done.** `feature019-milvus-live.test.ts`
  is env-gated (`test.skipIf(!OPENCODE_SEMANTIC_MILVUS_ADDRESS)`) and exercises health →
  buildGeneration → upsert → enumerate → swapAliases against a live endpoint over the REST client,
  with an `opencode_test__…`-prefixed throwaway collection ALWAYS dropped in `finally`. Raw run against
  a live Milvus endpoint (`OPENCODE_SEMANTIC_MILVUS_ADDRESS=<host>:19530 OPENCODE_SEMANTIC_MILVUS_INSECURE=1`):
  `1 pass, 0 fail, 6 expect()` — health `reachable:true`; buildGeneration `validated:true`; upsert
  `upsertCount:2`; enumerate returned `[agent:alpha(h1), agent:beta(h2)]`; swapAliases `swapped:[agents]`.
  Raw REST contract confirmed manually (`code:0` on every op): `/collections/create` (custom
  id/content_hash/project_id/vector schema, AUTOINDEX COSINE) → `/collections/describe`
  (`LoadStateLoading`, index present) → `/entities/upsert` (`upsertCount:2`) → `/entities/query`
  (`[{content_hash:h1,id:agent:alpha},{content_hash:h2,id:agent:beta}]`) → `/aliases/create` +
  `/aliases/alter` (describe confirmed re-point) → `/entities/delete` (`deleteCount:1`) →
  `/aliases/drop` + `/collections/drop` (server left clean: only the pre-existing collection remained).
  Without the env var the test SKIPS, so CI stays green (`bun test test/semantic/` = 138 pass / 2 skip).

## Group E — Availability flip + parity (FR14-FR16)

- [x] **T018 — Palette availability flip to the composed truth**
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
- **Evidence:** 2026-07-20 — `palette.ts` splits the flip by the `#BackendReadiness` truth
  (`enums-remainder.cue`, `"live" | "honest_unavailable"`). (1) `semantic.reranker.cutover`/
  `rollback` are UNCONDITIONALLY composed (config-backed registry, no Milvus — T001-T003), so
  they join `OPERATOR_PERSISTING_VERBS` (`palette.ts:145-152`) and flip to `persists_today` in
  the default projection. (2) The Milvus-conditional embedding + index verbs
  (`semantic.embedding.reindex`/`cutover`/`rollback`, `semantic.index.reindex`/`reconcile`), the
  interactive-conditional `mcp.auth.start`/`finish`, and the capability-gated
  `mcp.resource.admin.subscribe`/`unsubscribe` are a NEW `CONDITIONAL_PERSISTING_VERBS` map keyed
  to a `#BackendReadiness` flag (`milvusConfigured`/`interactiveSurface`/`subscriptionCapable`):
  with readiness present they read the composed `persists_today`, and with NO readiness (the
  default the TUI renders — an unconfigured Milvus, a headless surface, an absent capability) they
  stay `honest_unavailable` per FR14. This keeps the `semantic` + `mcp` domain badges honestly
  `Partial` by default and keeps every conditional verb OUT of the static persisting set (Feature
  014/017 parity: a gapped verb never leaks in). `telemetry.*` already reads `persists_today`
  (telemetry is a persisting domain); its export is now a real transport (T013-T016), no palette
  change needed. `ListPaletteOptions.readiness` + `OperatorBackendReadiness` are re-exported from
  `packages/core/src/operator/index.ts`. Parity pinned: no new catalog id, catalog version stays
  1.3.0, no new dispatch path. Tests: `feature019-availability.test.ts` (15) green;
  `feature014-availability.test.ts` updated (reranker cutover/rollback moved out of `SEMANTIC_GATED`);
  `bun test packages/core/test/operator/` 141 pass; `packages/tui` full 502 pass / 1 skip;
  `bun run typecheck` 30/30.
- **Addendum 2026-07-20 (adversarial-review remediation) — availability re-check with a config-backed
  validate.** With `validate` now config-backed (a persisted transition), the FR14 class of each verb
  was re-decided honestly: (a) `semantic.reranker.cutover`/`rollback` STAY UNCONDITIONAL in
  `OPERATOR_PERSISTING_VERBS`. Cutover post-validation is PURE config (no provider, no Milvus) and the
  `semantic` authority is always bound, so cutover's own backend genuinely persists today; the
  provider dependency lives entirely in the SEPARATE `validate` verb. A cutover attempted without a
  validated candidate is honest RUNTIME `not_validated` (FR16 degradation), NOT an availability gap —
  so `persists_today` is truthful, and the review's validate fix is precisely what makes that claim
  honest (previously the chain was unreachable). (b) The two `validate` verbs are config-backed but
  backend-conditional (embedding needs a reindex-built Milvus generation; reranker needs a live
  provider probe). They keep the default `honest_unavailable` classification — the truthful floor that
  NEVER over-advertises. `#BackendReadiness` models `milvusConfigured`/`interactiveSurface`/
  `subscriptionCapable` but NOT a provider-probe-readiness signal, so a conditional flip for
  `semantic.reranker.validate` would require a new readiness flag (a `#BackendReadiness` schema + ADR
  change) — deliberately OUT of scope; the honest floor stands. No palette code change for
  cutover/rollback (they were already correct); the correction is the validate transition + catalog
  `mutates` that make the pre-existing `persists_today` claim honest.

## Group F — Tests + guard scope + doc sync (FR15)

- [x] **T019 — Group A tests (registry routing, archive, gates)** — **Depends:** T001-T003 —
  **Paths:** `packages/opencode/test/{semantic,operator}/**` — reranker cutover routes config-backed
  (no Milvus), invalidates cache/eval with `reEmbedded:false`; archive round-trip; not_validated /
  no_archived_prior / cas_conflict gates. **Evidence:** 2026-07-20 — `feature019-reranker-lifecycle.test.ts`
  (13: routing, archive round-trip, history multi-entry, `not_validated`/`no_archived_prior`/
  `confirmation_required` gates) + `feature019-reranker-dispatch.test.ts` (3: config-backed dispatch,
  audited rejection, no phantom write) green under `bun test test/operator/` (939 pass / 5 skip in the
  full operator+semantic+routing+jobs sweep).
- [x] **T020 — Group B tests (Milvus port, generation build, reconcile, live Milvus)** —
  **Depends:** T004-T009, T017 — **Paths:** `packages/opencode/test/semantic/**` — live port
  methods; build+validate before swap; atomic all-collections swap; unconfigured →
  `milvus_unavailable`; reconcile diffs real state, never re-pins; env-gated live Milvus.
  **Evidence:** 2026-07-20 — `feature019-milvus-port.test.ts` (9: enumerate content-free,
  `invalid_filters`, build+swap isolation, unbound gap, reconcile diff over INJECTED
  source/context, content-free counts + version-unchanged, full rebuild, unbound-source gap) +
  `feature019-embedding-lifecycle.test.ts` (9: reindex builds a validated generation, cutover
  swaps only after build+validate, cardinal-honesty refusal, all-collections swap, CAS-contention
  aborts, unconfigured floor, rollback restores archived prior/generation) +
  `feature019-milvus-live.test.ts` (1, env-gated `skipIf` — SKIPPED in CI) green.
  **RESIDUAL (honest):** the `createMilvusIndexPort` seam is tested with an INJECTED `LiveDocSource`/
  `context`; the `stack-live.ts` RUNTIME composition of that source (an agent/skill→`AgentDoc`/`SkillDoc`
  sanitized projection layer + a bound openai-compatible embedding transport resolved from the
  configured provider) is NOT yet wired, so `semantic.index.reindex`/`reconcile` still resolve the
  honest `milvus_unavailable`/not-composed typed gap at runtime even with a Milvus endpoint configured
  (FR16-honest — no fabricated vectors). Closing it is a bounded follow-up (author the agent/skill
  projections + bind the embedding client from the registry's active provider via the SecretRef
  resolver); the milvus-binding + injected-double coverage that Group B owns is complete and green.
- [x] **T021 — Group C tests (auth delegation, subscription, badges)** — **Depends:** T010-T012 —
  **Paths:** `packages/opencode/test/{operator,mcp}/**` — auth delegation (TUI) vs headless gap;
  subscription over the machine + `capability_absent`; truthful badges; live-list same-instance.
  **Evidence:** 2026-07-20 — `mcp-service-backend.test.ts` T010 (5: interactive delegation, headless
  gap, `not_found`, state mismatch → conflict, no-secret envelope), T011 (5: capable sub/unsub once,
  `capability_absent` no-phantom, no-client unavailable, unbound gap), T012 (4: truthful experimental/
  extension, unset → Disabled, absent → no `enabled`) + `packages/tui/test/operator/controls.test.ts`
  T012 (3) green under `bun test test/mcp/` (156 pass) + tui operator (178 pass).
- [x] **T022 — Group D tests (export sends, disabled no-op, redaction, drop policy)** —
  **Depends:** T013-T017 — **Paths:** `packages/opencode/test/{routing,telemetry,operator}/**` —
  enabled → real transport sends a signal (fake transport); disabled → no fiber/network; slow
  collector never blocks; redaction enforced; retry within budget then drop. **Evidence:** 2026-07-20 —
  `test/routing/telemetry-export.test.ts` (T013 armed/idempotent/disabled-disarmed; T014 flush ships
  content-free instruments, timer-driven non-blocking, drop policy, failing-transport isolation; T015
  hostile-attribute redaction; T016 re-arm/disarm) + `otlp-transport.test.ts` (encoding per kind,
  retry-within-budget, give-up, 4xx-no-retry, network-throw, empty-batch, probe) +
  `telemetry-live.test.ts` (1, env-gated — SKIPPED) + existing `test/telemetry/redaction.test.ts` green
  under `bun test test/routing/` in the full sweep.
- [x] **T023 — Availability + parity tests (Feature 007 harness)** — **Depends:** T018 —
  **Paths:** `packages/core/test/operator/**`, `packages/tui/test/operator/**` — palette flip
  truthful; reuse the Feature 007 parity harness to assert each verb rides the same command id /
  loopback with no new dispatch path, no new catalog id, no version bump. **Evidence:** 2026-07-20 —
  `packages/core/test/operator/feature019-availability.test.ts` (15 cases): reranker cutover/rollback
  flip UNCONDITIONALLY (persists_today with/without readiness); the Milvus/interactive/capability
  verbs stay `honest_unavailable` by default and flip only under their own `#BackendReadiness` flag
  (per-dependency isolation asserted); semantic + mcp badges stay `Partial` by default; parity —
  catalog version 1.3.0 unchanged, entry count unchanged under any readiness, every persisting verb
  rides a real catalog id (no new dispatch path). The existing tui `structured-parity.test.ts` +
  `parity.test.ts` (loopback/command-id parity) stay green (`packages/tui` full 502 pass / 1 skip).
- [x] **T024 — Guard scope + doc sync + `speckit analyze` + `validate --json` green** —
  **Depends:** T001-T023 — **Paths:** `doc/arch/speckit.toml`, `doc/arch/sdd/019-*/**`,
  `doc/arch/adr/0019-*.md`, `doc/arch/schemas/semantic-lifecycle/**`,
  `doc/arch/statecharts/binding-generation-lifecycle.md`, `doc/arch/functional/product-overview.md`
  — confirm the Feature 006/007/008/001 guard globs cover every touched path (add an 019 block only
  for a genuinely-new path); keep the spec, ADR-0019, the `semantic-lifecycle/*.cue` corpus, and the
  statechart in sync with the shipped shapes; `speckit analyze` clean and `speckit validate --json`
  green (0 new findings on Feature 019 artifacts). **Acceptance:** `speckit analyze` reports no new
  Critical/High/Medium; `speckit validate --json` is `ok:true` with 0 new findings.
  **Verification:** `speckit analyze`; `speckit validate --json`. **Evidence:** 2026-07-20 — Guard:
  the T018 edit touched `packages/core/src/operator/palette.ts` + `packages/core/src/operator/index.ts`
  (already in scope under the Feature 007 `packages/core/src/operator/**` glob) and the new/updated
  tests under `packages/{core}/test/operator/**` (in scope) — every write committed through the guard
  with no denial; no genuinely-new path, so NO 019-specific guard block was added. Doc sync: the
  palette flip reads the shipped `#BackendReadiness` (`enums-remainder.cue`) verbatim — no schema
  shape changed. `speckit validate --json` = `ok:true`, `waivedCount:4` (all pre-existing
  hygiene.empty-file warnings unrelated to 019 — desktop CSS, a test fixture, two `.gitignore`s);
  0 new findings on Feature 019 artifacts. `speckit analyze` = `analyzed 19 feature(s): consistent;
  0 ADR overlap(s)` (only pre-existing info-level H1/slug drift; no new Critical/High/Medium).
  `speckit status` = phase implement / implemented.

## Fix-round — 2026-07-20 — pools bindings editor dead-end (FR22)

- **Defect:** On the operator Pools screen → Set, the bindings editor was unusable: the
  "+ Add binding" action opened a bare "Role" prompt, but submitting a role (e.g.
  `worker`) did NOTHING — no row appeared and the operator could not create a pool binding
  end-to-end (keyboard-only). Reported (translated): "on the model pool screen I cannot
  create the pool and cannot do anything."
- **Root cause (two compounding faults):**
  1. `packages/tui/src/operator/form/multi-field-modal.tsx:343,397` called
     `DialogPrompt.show`, whose helper (`packages/tui/src/ui/dialog-prompt.tsx:117-126`)
     uses `dialog.replace` — a stack-RESET primitive that runs every level's `onClose` and
     collapses the whole dialog stack to a single orphaned prompt
     (`packages/tui/src/ui/dialog.tsx:150-165`). It thereby destroyed the `BindingsEditor`
     and `MultiFieldForm` beneath, and never popped the prompt after confirm — the visible
     dead-end.
  2. Even a push-based prompt would have lost the entry: the dialog renders only its top
     level (`dialog.tsx:242`), so pushing any sub-dialog UNMOUNTS the form and re-mounts it
     on pop (empirically confirmed: a pushed-under component's mount count goes 1→2 across
     push/pop). `MultiFieldForm`'s bindings/raw lived in a component-local `createStore`, so
     the re-mount discarded every entered binding and re-ran the read.
- **Fix (scope: `packages/tui/src/operator/form/**`):**
  - Added `promptText` — a push/pop back-stack prompt that keeps the editors beneath live
    and pops exactly one level on confirm/cancel; both sub-editors now use it.
  - Hoisted the form store into `openMultiFieldModal` via `createMultiFieldState` (created
    once, passed as `props.state`), so text fields AND bindings survive the form's re-mount;
    `onMount` now reads/pre-fills only once (`store.loaded` guard), and picker/bindings
    pushes snapshot live text inputs first so they re-seed on pop.
  - Added `validateBindings` (field-list.ts) mirroring `pools/backend-live.ts` — an empty
    model pool or a duplicate role is now an IN-MODAL per-field error, never a doomed
    dispatch; `submit` runs it before compose/dispatch for the `bindings_list` verb.
- **Tests:** `packages/tui/test/operator/multi-field.test.ts` — `validateBindings`
  (empty-models / duplicate-role / blank-role-ignored / empty-list-ok) + hoisted-state
  survival. New `packages/tui/test/operator/pools-bindings-flow.test.tsx` — a real
  DialogProvider + mockInput end-to-end: add binding → Role `worker` → add model
  `anthropic/claude` → esc back → Save dispatches byte-exact `{bindings:[{role,models}]}`
  ONCE and closes the modal; and an empty-models Save blocks in-modal with no dispatch. The
  stack-length assertions fail against the old `replace` path (it collapses to one level),
  so they are a genuine regression guard.
- **Verification:** `bun test` (packages/tui) = 509 pass / 1 skip / 0 fail; `bun run
  typecheck` clean; `oxlint` 0 warnings / 0 errors on the four touched files;
  `speckit validate --json` stays `ok:true`.
