# Tasks: Wire The Semantic Index Data Plane Production Pipeline

## Task Breakdown

### Phase 1 — Pure core (`packages/core/src/semantic/**`, zero I/O)

- [x] T001 Add `packages/core/src/semantic/agent-doc.ts`: the pure
  `Agent.Info → AgentDoc` builder (`data-model.md` mapping table) reusing
  `Projection.scrubText`/`sanitizeFields`; derive `identity.content_hash` over
  `{description(scrubbed), mode, hidden, permissions(serialized), color}`,
  `scope.permission_ref` as a stable hash of the serialized `Permission.Ruleset`,
  `classification.role` from `mode`, and honest empty `TagSet`/`[]` defaults for
  every field absent on `Agent.Info` (`domains`/`capabilities`/`tools`/`languages`).
- [x] T002 Add `packages/core/src/semantic/skill-doc.ts`: the pure
  `Skill.Info → SkillDoc` builder, sibling to `agent-doc.ts`; derive
  `identity.content_hash` over `{description(scrubbed), slash}` (never over
  `content`), `cost.token_estimate` via `Token.estimate(Skill.Info.content)`
  (`core/util/token.ts`), `compat.permission_ref` as a hash of `skill.name`
  alone, and `[]` defaults for `triggers`/`domains`/`capabilities`/`compat.*`.
- [x] T003 Unit tests for both builders in
  `packages/core/test/semantic/agent-doc.test.ts` and
  `packages/core/test/semantic/skill-doc.test.ts`: field mapping correctness,
  the empty-`TagSet` defaults, the `permission_ref` hash derivation, the
  hidden→`visibility:"project"`+`available:false` mapping (never a widened
  `"shared"` visibility), and that `content_hash` never incorporates `content`.
- [x] T004 Add `packages/core/src/semantic/skill-chunk.ts`: the chunker turning
  `Skill.Info.content` into `SkillChunkDoc[]` via `Projection.chunkBody`
  (`core/src/semantic/projection.ts:133`), capped by `max_skill_chunks`
  (`schema/routing/budget.ts:44`), using `Token.estimate` for the precomputed
  `totalTokens` input; emit chunk ids as `${skill.name}_c${chunk_index}`
  (never `#`, per the `SkillChunkId` brand pattern) and a `SpoolEntry`-shaped
  put request per chunk with the SANITIZED (post-`scrubText`) body only.
- [x] T005 Unit tests in
  `packages/core/test/semantic/skill-chunk.test.ts`: chunk window boundaries
  and overlap, the id-pattern-safe separator, the sanitize-before-hash
  ordering (`content_hash` computed over sanitized bytes, never the raw
  window), and that a boundary-only shift with unchanged sanitized bytes
  yields the same `content_hash`.

### Phase 2 — Adapters (`packages/opencode/src/semantic/**`, one seam at a time)

- [x] T006 Add `packages/opencode/src/semantic/milvus-composition.ts`:
  extract the `createGrpcMilvusAdapter(createHttpMilvusClient(...))`
  construction chain out of `packages/opencode/src/operator/stack-live.ts:588-610`
  into ONE shared `MilvusPortComposer.compose(config)` helper; edit
  `stack-live.ts` to call it. Verify via the EXISTING operator stack tests
  (`packages/opencode/test/operator/**`) staying green — no new test file for
  this extraction, per `plan.md`'s regression strategy.
- [x] T007 Extend `packages/opencode/src/util/effect-http-client.ts` with
  `withDataPlaneRetry<A, E>(schedule, isTransient)`: a sibling to
  `withTransientReadRetry` composed over a plain `Effect.Effect<A, E>`
  (`Effect.retry(Schedule.exponential(500ms).pipe(Schedule.jittered,
  Schedule.compose(Schedule.recurs(2)), Schedule.whileInput(isTransient)))`),
  classifying `milvus_unavailable`/transport-timeout/5xx as transient and
  `invalid_filters`/`dimension_mismatch`/`reranker_not_eligible`/schema
  rejects as never-retryable.
- [x] T008 Unit tests in
  `packages/opencode/test/util/effect-http-client-data-plane-retry.test.ts`:
  bounded attempts (≤3), jitter present, transient classification retries,
  domain-error classification never retries, and `cas_conflict` is excluded
  from blind retry (re-read-and-replan is the caller's job, not this helper's).
- [x] T009 Add `packages/opencode/src/semantic/embeddings-http-client.ts`:
  `createFetchEmbeddingsHttpClient` implementing `EmbeddingsHttpPort`
  (`embedding-client.ts:34-36`) following the `createFetchRerankHttpClient`
  transport shape (`rerank-probe.ts:154-164`) — POST JSON, one resolved
  Authorization header via `semantic/credential-resolver.ts`
  (`resolvePolicy`) exclusively, `secretRef: null` produces no header. No
  retry inlined in the raw transport; callers compose `withTransientReadRetry`
  / `withDataPlaneRetry` (T007) outside it.
- [x] T010 Unit tests in
  `packages/opencode/test/semantic/embeddings-http-client.test.ts` against a
  fake HTTP transport: request/response shape, `secretRef: null` → no
  Authorization header, a resolved `secretRef` → header present, and a
  non-2xx response surfaces a typed error (never a silent empty vector).
- [x] T011 Add `packages/opencode/src/semantic/dimension-probe.ts`: the
  `DimensionProbe.probe` three-rung ladder — (1) `EmbeddingClient.probe`
  (`embedding-client.ts:67-87`), authoritative; (2) a cached
  previously-probed `ProbedVectorSpace` for the same model/binding version on
  probe failure; (3) `ModelsDev.Service` metadata cross-check
  (`core/models-dev.ts:137`), warn-only, silently skipped offline. Map the
  probe's metric finding onto the shipped `"cosine" | "inner-product"` enum
  at this boundary (never the CUE `"ip"` shorthand). No cache and a failed
  probe returns a typed `DimensionProbeRefusal`, never a default dimension.
- [x] T012 Unit tests in
  `packages/opencode/test/semantic/dimension-probe.test.ts` against a fake
  `EmbeddingClient`/`ModelsDev.Service`: probe pass → `ProbedVectorSpace`
  stamped; probe fail + cache hit → cached value used; probe fail + no cache
  → `{type:"no_cached_dimension"}` refusal; catalog/probe mismatch → probe
  wins, warning emitted.
- [x] T013 Add `packages/opencode/src/semantic/output-spool-store.ts`: the
  `OutputSpoolStore` (`put`/`resolve`/`supersede`) façade REUSING the existing
  Feature 005 subsystem — `session/output-spool-writer.ts`
  (`SessionSpoolWriter.ingest`/`.seal`) to write sanitized chunk bodies, and
  `operator/outputspool/backend-live.ts` (`OutputSpoolBackend.read`) to
  resolve them — for `SkillChunkDoc.body_ref` bytes; replace the
  non-resolvable `boundedSpool` stub (`milvus-binding.ts:116-118`).
  `supersede` opens a fresh generation and never mutates sealed bytes in
  place.
- [x] T014 Unit tests in
  `packages/opencode/test/semantic/output-spool-store.test.ts` against a fake
  `SessionSpoolWriter`/`OutputSpoolBackend`: put → resolve round-trip returns
  the same sanitized body and `contentHash`; supersede marks the prior ref
  reclaimable and a new `put` yields a distinct ref; a missing ref resolves
  `{type:"not_found"}`.
- [x] T015 Add `packages/opencode/src/semantic/reconcile-lock.ts`: the
  per-profile `ReconcileLock.acquire`/`release`, CAS-guarded the same way
  `registry-backend.ts` guards the binding document (`readDoc`/
  `guardedPlan`); an incremental reconcile and a full rebuild for the same
  profile are mutually exclusive holders.
- [x] T016 Unit tests in
  `packages/opencode/test/semantic/reconcile-lock.test.ts`: a second
  `acquire` while held fails `{type:"held", holder, acquiredAt}`; `release` is
  idempotent; a held-then-released lock allows the next `acquire` to succeed.
- [x] T017 Add `packages/opencode/src/semantic/pipeline-runner.ts`:
  `createProductionPipelineRunner` implementing `PipelineRunnerPort`
  (`retrieval-facade.ts:87-92`) — `runAgents`/`runSkills` embed the prompt
  once (`EmbeddingClient.embed`), build `PipelinePorts` (`pipeline.ts:69-85`)
  over the T006 Milvus composer and `RerankClient`, and call `Pipeline.run`;
  `runTools` calls `ToolPass.run` (`tool-pass.ts:120`) instead, never
  `Pipeline.run`. After `Pipeline.run` returns for agents, re-check every
  ranked agent id against the live `AgentV2.Service` + permission and drop
  dead hits before the facade's `revalidated:true` stamp applies. Wrap each
  surface call in `Effect.timeout(deps.latencyBudgetMs)`
  (`config/experimental.ts:62`).
- [x] T018 Unit tests in
  `packages/opencode/test/semantic/pipeline-runner.test.ts` against fake
  Milvus/embedding/rerank/registry ports: a ranked agent id absent from the
  fake `AgentV2.Service` is dropped and never stamped `revalidated:true`; a
  slow fake port under `Effect.timeout` surfaces `undefined` for that surface
  only; `runTools` calls `ToolPass.run` and never `Pipeline.run` (spy
  assertion).
- [ ] T019 Add `packages/opencode/src/semantic/live-doc-source.ts`:
  `createLiveDocSource` implementing the EXTENDED `LiveDocSource.collect`
  (`contracts/ports.ts`) — `agents` via `AgentV2.Service.all()` + T001's
  builder, `skills`/`skill_chunks` via `SkillV2.Service.list()` + T002/T004's
  builders, each skipping the embedding call (not just the upsert) when the
  computed content hash equals `indexedHashes.get(canonicalId)`; a missing
  embedding provider rejects rather than fabricating a vector.
- [ ] T020 Unit tests in
  `packages/opencode/test/semantic/live-doc-source.test.ts` against fake
  `AgentV2.Service`/`SkillV2.Service`/`EmbeddingsHttpPort`/`OutputSpoolStore`:
  an unchanged doc (hash present in `indexedHashes`) makes zero embedding
  calls; a changed/new doc embeds and returns a `LiveDoc` row; skill_chunks
  route through `output-spool-store.put` before embedding.

### Phase 3 — Wiring (composition root)

- [x] T021 Edit `packages/opencode/src/operator/semantic/registry-backend.ts:696-702`
  (`generationVectorSpace`): call `dimension-probe.ts`'s `probe` instead of
  `defaultDimension ?? 1024`; edit `planReindexEmbedding` (`:729-768`) to
  propagate a `DimensionProbeRefusal` as a failed effect (typed capability
  gap), never reaching `buildGeneration` with a guessed dimension; assert the
  probed `metric` against the literal `"cosine" | "inner-product"` set before
  it is ever written to the registry document.
- [x] T022 Extend `packages/opencode/src/semantic/rerank-probe.ts`'s
  `createRerankValidationProbe` (`:117-146`) to capture the transport's
  reported capability envelope (`modes`, `maxDocuments`, `contextWindow`,
  `scoreRange`) into a `RerankCapabilities` value alongside the existing
  pass/fail boolean, instead of discarding it.
- [ ] T023 Edit `packages/opencode/src/operator/stack-live.ts:588-610`: supply
  `source` (T019's `LiveDocSource`), `context` (the P0 `project_id` plus
  skill `MandatoryFilters`), and `spool` (T013's `OutputSpoolStore`) into
  `MilvusIndexBindingDeps`; route Milvus construction through T006's
  `milvus-composition.ts`; add a runtime binding join helper that assembles
  `{baseUrl, modelRef, secretRef, compatibilityMode}` from the active
  `RegistryDocument`, mirroring `planValidateReranker`'s inline join
  (`registry-backend.ts:1005`) rather than re-deriving the shape.
- [x] T024 Edit `packages/opencode/src/session/budget-consume.ts:107`: add an
  `incrementRetryCount` helper called from every T007/T021 retry site,
  accumulating into `ConsumptionResilience.retry_count` via the existing
  `RoutingSessionStateStore.accumulateConsumption` path, activating the
  previously-inert `resilience.retry_depth` budget knob.
- [x] T025 Register the production facade as a per-instance singleton in
  `packages/opencode/src/semantic/retrieval-facade.ts` (or its composition
  entry point): declare it with the canonical
  `Context.Service<...>()("@opencode/semantic/RetrievalFacade")` pattern
  (mirroring `agent.ts:99`, `tool/registry.ts:85`), binding T017's
  `pipeline-runner.ts` as its `PipelineRunnerPort` — no second facade
  construction anywhere in the composition root.

### Phase 4 — CLI / live verification

- [ ] T026 Golden byte-identical test in
  `packages/opencode/test/semantic/golden-disabled-path.test.ts`: snapshot
  every live session/turn surface (tool list, skill listing, agent selection
  inputs) before and after this feature's changes, asserting the new runner
  is never invoked from a live turn (FR13).
- [ ] T027 Tool-id equality test in
  `packages/opencode/test/semantic/tool-id-equality.test.ts`: assert
  index-time `ToolDoc.id` (`tool-projection.ts:155`) equals the runtime key —
  `registry.tools()` item id (`${namespace}_${id}`, `registry.ts:191`) for
  native/plugin tools, and the `mcp.tools()` record key for MCP tools —
  across all three classes (FR11, AC6).
- [ ] T028 Staleness — delete, in
  `packages/opencode/test/semantic/staleness-delete.test.ts` (or a live-smoke
  script against `~/.opencodedev`): seed a skill file, index it, delete the
  file, run reconcile, assert the doc and its `SpoolEntry` are both gone and
  drift is 0 (AC3).
- [ ] T029 Staleness — edit, in
  `packages/opencode/test/semantic/staleness-edit.test.ts`: seed a skill,
  index it, edit its body, run reconcile, assert the doc/chunk is superseded
  by content-hash change and never duplicated (AC4).
- [ ] T030 Staleness — no-change, in
  `packages/opencode/test/semantic/staleness-nochange.test.ts`: re-run
  reconcile with no source changes and assert zero embedding calls via a
  call-count instrumentation seam on the fake/real embeddings client (AC5).
- [ ] T031 Live smoke — full reindex:
  `OPENCODE_CONFIG_DIR=~/.opencodedev opencode-cli op semantic index reindex`
  produces non-zero upserts across all four collections (`agents`, `skills`,
  `skill_chunks`, `tools`) at the probed 2560-dimension generation (AC1, AC2).
- [ ] T032 Retry test — transient bounded + domain never-retry, in
  `packages/opencode/test/semantic/retry-policy.test.ts`: a `milvus_unavailable`
  fault retries ≤3 times with jittered backoff and increments
  `ConsumptionResilience.retry_count`; a `dimension_mismatch`/schema-reject
  fault never retries (AC7).
- [ ] T033 Retry test — per-batch resume, extending
  `retry-policy.test.ts`: an interrupted embed batch mid-reindex retries only
  that batch (never restarting the whole reindex), and reconcile resumes from
  the last durable per-batch step (AC7).
- [ ] T034 Live smoke — probe failure fail-closed: point the bound model at
  an unreachable endpoint, run the dimension probe, assert exactly 2 bounded
  retries then a refused generation build with a typed capability-gap code,
  never a silent default dimension (AC8).
- [ ] T035 Live smoke — provider pluggability round trip: register a second
  embed provider via `semantic model register`/`semantic embedding select`,
  run `reindex`→`validate`→`cutover`, assert the atomic alias-swap activates
  the new generation at its newly-probed dimension, then `rollback` restores
  the solaris generation; a reranker mode switch (`structured-chat` and back)
  is config-only with no re-embed (AC10).

## Dependencies

- Feature 006 (`doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md`)
  owns `Pipeline.run`, `DocumentRow`, `MilvusPort`, `AgentDoc`/`SkillDoc`/
  `SkillChunkDoc`, and the retrieval facade this feature wires into
  production; none of these are redefined here.
- Feature 009 (`doc/arch/sdd/009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md`)
  owns the `tools` collection and `ToolPass.run` T017's runner calls for the
  tools surface.
- Feature 005 (`doc/arch/sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md`)
  owns `SessionSpoolWriter`/`OutputSpoolBackend`, reused unmodified by T013.
- Features 002/003 own the reindex/reconcile job lifecycle and schedule that
  T015/T023's triggers compose over (`IndexJobs.coalesceTriggers`).
- Live smoke tasks (T031, T034, T035) require the real solaris endpoints
  (`vm.services`) and the deployed `/opt/opencodev2/opencode` binary under
  `OPENCODE_CONFIG_DIR=~/.opencodedev`.

## Invariants Preserved

- Zero live-turn behavior change (FR13) — no session/turn code path calls
  the facade or T017's runner; T026 proves this structurally, not just by
  assertion.
- Fail-closed on unknown dimension (FR6) — a probe failure with no cached
  value always refuses generation build; never a silent `1024` fallback.
- Single shared Milvus-port composition (T006) — `stack-live.ts` and
  `pipeline-runner.ts` both call it; neither constructs a `MilvusAdapter`
  directly.
- Auth resolution exclusively through `semantic/credential-resolver.ts`; the
  `resolveAuthHeader` closure at `stack-live.ts:560-575` is never copied to a
  third call site.
- Retry classification is typed-transient-only — a domain error
  (`invalid_filters`, `dimension_mismatch`, `reranker_not_eligible`, schema
  rejects) never retries; `cas_conflict` is re-read-and-replanned once,
  never blind-retried.
- Reconcile and rebuild are mutually exclusive per profile via T015's lock —
  an in-flight alias-swap can never orphan a concurrent reconcile's upserts.
