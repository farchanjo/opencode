# Tasks: Add Milvus Backed Multilingual Semantic Retrieval And

Ordered, measurable work breakdown derived from `plan.md` slices S0–S25, the
`data-model.md` entity definitions, `contracts/ports.ts`, ADR-0008, and the
`doc/arch/schemas/semantic/*.cue` mirrors (34 files). Every task stays inside the
`specScopeGlobs` declared in `doc/arch/speckit.toml`. Phase 1 (schema/protocol) is
additive and non-breaking; no runtime behavior changes until the Phase 3 adapters,
operator wiring, and the honest Feature 001 retrieval seam. Feature 006 adds no second
registry, availability authority, permission authority, or route decider beside
AgentV2/SkillV2/Catalog/Permission and Feature 001 (FR1, FR2, C21): Milvus is a derived,
rebuildable projection whose every candidate is revalidated against live core before
injection (FR20, FR27, C11), embedding/reranker are operator-pinned `SemanticModelBinding`
slots that no LLM/router/agent/plugin/MCP may select or substitute (FR6, FR31, C3, C20),
credentials are Feature 007 SecretPort refs only (FR35, C19), and skill bodies are reached
through Feature 005 OutputSpool refs, never duplicated into context (FR40, C9). Management
flows exclusively through the reserved `semantic.*` catalog already present at
`RESERVED_CATALOG_VERSION = "1.3.0"` — **no catalog bump is performed** (C15). The module
name is `semantic` across every package. No consumer ever receives a secret, a raw
endpoint credential, an unsanitized document body, or a filesystem path.

The canonical wire shape is the CUE corpus under `doc/arch/schemas/semantic/*.cue`
mirrored one-to-one by `data-model.md`: the closed **12-member** `semantic.*` event
vocabulary (`event-types.cue` / `events-index.cue` / `events-live.cue`, **9 durable + 3
live**, underscore-named), the `Slot`/`RerankProfile`/`Metric`/`Consistency`/`Collection`
enums, the 5-member `BindingState` and `GenerationState` machines, the 8-member
`DegradationGap`, the three-rung `RetrievalMode` ladder, the three SSOT aggregates
(`SemanticProviderProfile` / `SemanticModelDescriptor` / `SemanticModelBinding`), the
`AgentDoc` / `SkillDoc` / `SkillChunkDoc` projections, and the real-valued score domain
(`Score`/`RerankScore`/`DenseScore`/`SparseScore`/`Confidence`, deliberately not
integer-checked). The `protocol/semantic` port surface mirrors `contracts/ports.ts`
interfaces while **sourcing its enum members from the schema modules** so a single
vocabulary is enforced (see the Traceability reconciliation note).

## Task Breakdown

### Schema and protocol foundation (Phase 1)

- [x] T001 [S0] Author `packages/schema/src/semantic/ids.ts` and
  `packages/schema/src/semantic/refs.ts` with the branded identifiers and opaque handles
  from `data-model.md`: `ProviderProfileId`, `ModelDescriptorId`, `BindingId`, `AgentDocId`,
  `SkillDocId`, `SkillChunkId`, `GenerationId`, `CollectionAliasId`, `ProjectId`, `EventId`
  (the EventV2 `evt_` id), plus the ranking/lineage pointers `ProviderRef`, `ModelRef`,
  `ParentSkillId`, `AgentRef`, `SkillRef`, the gate/secure refs `PermissionRef`, `SecretRef`,
  `HeaderRef`, `OperatorRef`, the Feature 005 `OutputRef`, and the `CorrelationId`/
  `CausationId`/`DecisionId` correlation refs; each built base-then-annotate-then-check-then-
  brand (`Schema.String.annotate({ identifier }).check(...).pipe(Schema.brand("Semantic.*"))`),
  mirroring `ids.cue`, `refs.cue`, and `correlation.cue` one-to-one with no cross-feature
  import, `SecretRef`/`HeaderRef` staying opaque non-empty handles that never carry raw
  material and `OutputRef` never a path (FR28, FR34, FR35, FR40, C11, C19). Acceptance:
  `tsgo --noEmit` on `packages/schema` and the schema contract-hygiene test assert the root
  identifier is retained (annotate-before-check) on every brand.
- [x] T002 [S0] Author `packages/schema/src/semantic/values.ts` with the integer counter/
  dimension/budget ValueObjects (`BindingVersion`, `SchemaVersion`, `ConfigVersion`,
  `Dimension`, `Sequence`, `ByteOffset`, `ByteLimit`, `ChunkIndex`, `ChunkOverlap`, `TopK`,
  `ChunkBudget`, `TokenBudget`, `BatchSize`, `VectorCount`, `LatencyBudgetMs`) folding
  `Schema.isInt()` into the bound check, and the deliberately **real-valued** score domain
  (`Score`, `RerankScore`, `DenseScore`, `SparseScore` with no `isInt`, `Confidence` bounded
  `[0,1]`, `FreshnessAgeMs` integer), mirroring `values.cue`, `budget-values.cue`, and
  `score-values.cue`; budget windows are consumed from the Feature 001 budget and never
  free-form (FR12, FR19, FR22, FR38, C7, C8). Acceptance: `tsgo --noEmit` green and the
  schema test asserts counters/dimensions are integer-checked while the five score
  components are continuous and `Confidence` is bounded to `[0,1]`.
- [x] T003 [S1] Author `packages/schema/src/semantic/text-values.ts` and
  `packages/schema/src/semantic/collections.ts` with the bounded content-classified text/
  hash/flag ValueObjects (`Name`, `DisplayName`, `Description`, `BaseUrl`, `LanguageTag` on
  the canonical BCP 47 pattern, `Tag`, `ModeTag`, `DegradedReason`, `Reason`, `ContentHash`,
  `ConfigHash`, `Fingerprint`, `Enabled`, `Available`, `Normalized`, `InsecureAllowed`)
  excluding secrets, full prompts, reasoning, private payloads, and paths, plus the
  first-class collections (`TagSet`, `LanguageSet`, `AgentRefSet`, `SkillRefSet`,
  `HeaderRefSet`, `AliasRefSet`) that replace bare arrays, mirroring `text-values.cue`,
  `hash-values.cue`, and `collections.cue`; `LanguageTag` preserves the original query
  language for embedding without a mandatory translation LLM call (FR14, FR15, FR17, FR25,
  C4, C10). Acceptance: `tsgo --noEmit` green and the redaction test confirms no free-form
  content/secret/path field is exported and every ref set wraps a branded element.
- [x] T004 [S1] Author `packages/schema/src/semantic/enums.ts`, `enums-state.ts`,
  `enums-event.ts`, and `event-types.ts` with the closed enums as `Schema.Literals([...])`:
  `Slot`, `TransportProfile`, the three-member `RerankProfile`
  (`native-rerank|structured-chat|embedding-similarity`, C never reranker-eligible),
  `EndpointMode`, `Consistency`, `CapabilityKind`, `Metric`, `IndexType`, `ModelSource`,
  `ValidationStatus`; the 5-member `BindingState` (`draft|staged|active|degraded|unavailable`)
  and `GenerationState` (`building|validated|live|superseded|retired`), the 8-member
  `DegradationGap` (`none|milvus_unavailable|embedding_unavailable|reranker_unavailable|
  index_stale|retrieval_timeout|no_binding|cold_index`), the three-rung `RetrievalMode`
  (`full_semantic|catalog_lexical|fail_closed`), `ResidencyProfile`, `TlsPolicy`, the
  4-member `Collection` (`agents|skills|skill_chunks|tools`), `ScopeKind`, `Visibility`,
  `RoleKind`; the event enums `EventClass`, `EventSource`, `ActorKind`, `CutoverOutcome`,
  `FreshnessBucket`; and the closed **12-member** `SemanticEventType` `semantic.*` vocabulary,
  mirroring `enums.cue`, `enums-state.cue`, `enums-event.cue`, and `event-types.cue` (FR9,
  FR24, FR30, FR31, C6, C16, C20, C22). Acceptance: `tsgo --noEmit` green and the schema
  test asserts the 12-member vocabulary is closed with the nine durable members
  (`binding_selected`/`binding_cutover`/`binding_rolled_back`/`index_upserted`/
  `index_tombstoned`/`index_reconciled`/`generation_built`/`generation_cutover`/
  `generation_retired`) distinct from the three live members (`retrieval_degraded`/
  `provider_probed`/`binding_state_changed`), and that `embedding-similarity` is a distinct
  `CapabilityKind`/`RerankProfile` never equal to `reranker`.
- [x] T005 [S0] Author `packages/schema/src/semantic/provider-profile.ts` composing the
  bounded sub-structs `ProviderIdentity` (`name`, `base_url`, `transport`), `ProviderTransport`
  (`tls_policy`, `residency`, `insecure_allowed`), `ProviderCredentials` (nullable
  `secret_ref`, `headers`), and `ProviderAudit` (`enabled`, `created_at`, `updated_at`,
  `selected_by`) into the SSOT aggregate root `SemanticProviderProfile` (identity `id`,
  immutable `version`), embedding no secret — credentials are Feature 007 SecretPort refs
  only and a local endpoint may be key-free — and its base URL parsed under the SSRF-safe
  policy, mirroring `provider-profile.cue` and `provider-parts.cue` (FR28, FR29, FR33, FR35,
  FR37, C5, C17, C19). Acceptance: `tsgo --noEmit` green and the schema test constructs a
  key-free local profile and a keyed remote profile and asserts no raw secret field exists
  and `secret_ref` is a nullable `SecretRef`.
- [x] T006 [S0] Author `packages/schema/src/semantic/model-descriptor.ts` composing
  `ModelIdentity` (`display_name`, `source`, `endpoint_mode`, nullable `rerank_profile`),
  `CapabilityKindSet`, `ModelLimits` (nullable `batch_size`/`vector_count`/`token_limit`),
  `ModelCapability` (`kinds`, nullable `dimension`/`metric`/`normalized`, `limits`), and
  `ModelValidation` (`status`, `provenance`, nullable `validated_at`/`eval_version`) into the
  SSOT aggregate root `SemanticModelDescriptor` (identity `id`, `provider_ref`, `enabled`),
  so rerank capability is never inferred from a model name and a manual descriptor starts
  `declared` and is untrusted until native probe/eval passes, mirroring `model-descriptor.cue`
  and `model-parts.cue` (FR28, FR30, C3, C5, C16). Acceptance: `tsgo --noEmit` green and the
  schema test asserts an embedding descriptor carries a null `rerank_profile`, a manual
  descriptor is `declared`, and dimension/normalization/metric are captured only from a probe.
- [x] T007 [S0] Author `packages/schema/src/semantic/binding.ts` composing `BindingRefs`
  (`provider_ref`, `model_ref`, nullable `rerank_profile`), `CapabilityContract` (`kind`,
  nullable `dimension`/`metric`/`normalized`), `BindingSelection` (`selected_by`,
  `selected_at`, `config_version`, `config_hash`), and `BindingGeneration` (`generation_id`,
  `aliases`, `state`) into the SSOT aggregate root `SemanticModelBinding` (identity `id`,
  `slot`, immutable `version`) plus the runtime `BindingStatus` read model (`slot`, `state`,
  `version`, nullable `degraded_reason`), so bindings persist across sessions/restarts/
  resume/jobs until an operator changes them and the `degraded`/`unavailable` state never
  auto-substitutes another model, mirroring `binding.cue` and `binding-parts.cue` (FR28, FR31,
  FR32, C12, C20). Acceptance: `tsgo --noEmit` green and the schema test constructs an
  embedding and a reranker binding and asserts the version is an immutable positive counter
  and `BindingStatus` carries a typed `degraded_reason`.
- [x] T008 [S2] Author `packages/schema/src/semantic/documents.ts` composing `DocIdentity`
  (`version`, `content_hash`, `source`), `DocScope` (`project_id`, `scope`, `visibility`,
  `permission_ref`), `DocAvailability` (`enabled`, `available`), the agent parts
  (`AgentClassification`, `AgentTaxonomy`) and `AgentDoc` entity, the skill parts
  (`SkillDescriptor`, `SkillTaxonomy`, `SkillCompat`, `SkillCost`) and `SkillDoc` entity, and
  the chunk parts (`ChunkPosition`, `ChunkBodyRef` = Feature 005 `output_ref`+`offset`+`limit`)
  and `SkillChunkDoc` entity carrying `parent_skill_id`/`chunk_id` and a `language_tag`, each
  a stable-identity projection keyed by canonical id with a scalar `project_id` partition key
  filtered on every search, descriptions/domains/triggers as ranking signals only, volatile
  health/cost never authority fields, and the chunk body reached only through the Feature 005
  ref (never stored inline), mirroring `document-shared.cue`, `document-parts.cue`,
  `agent-doc.cue`, `skill-doc.cue`, and `chunk-doc.cue` (FR10, FR11, FR17, FR36, FR39, FR40,
  C4, C6, C9, C11). Acceptance: `tsgo --noEmit` green and the schema test constructs each
  document, asserts the scalar `project_id` and `permission_ref` are present, and that
  `SkillChunkDoc` carries a `ChunkBodyRef` and no inline body or path.
- [x] T009 [S3] Author `packages/schema/src/semantic/profile.ts` and
  `packages/schema/src/semantic/retrieval.ts` composing `QueryFingerprint` (`fingerprint`,
  `binding_version`, `config_hash`) and `TaskProfile` (`fingerprint`, `role_hint`, `domains`,
  `languages`, `project_id`); and `RetrievalRequest` (`profile`, `collection`,
  `retrieval_top_k`, `rerank_top_k`, `consistency`, `mode`), `ScoreComponents` (nullable
  `rerank`, `dense`, `sparse`), `ScoreProvenance` (`mode`, `gap`, `binding_version`,
  `generation_id`), `SemanticScore` (`composite`, `components`, `confidence`, `provenance`),
  `Candidate` (`candidate_ref` as an `AgentRef|SkillRef` union, `collection`, `score`, `rank`,
  `freshness`), the `CandidateList` collection, `DegradationOutcome` (`mode`, `gap`, nullable
  `degraded_reason`), and `RetrievalResult` (`candidates`, `mode`, `outcome`, `fingerprint`),
  so the query fingerprint keys a once-per-Task embedding reused across passes, the top_k
  caps come from the Feature 001 budget, a candidate is a ranking pointer never an embedded
  entity, and `rerank` is null on reranker outage, mirroring `profile.cue`, `retrieval.cue`,
  and `retrieval-result.cue` (FR3, FR15, FR18, FR19, FR20, FR22, FR24, FR38, C2, C8, C10,
  C11, C20). Acceptance: `tsgo --noEmit` green and the schema test asserts `rerank` is
  nullable, `confidence` is a bounded number, and a `Candidate` holds a ranking ref not an
  entity.
- [x] T010 [S4] Author `packages/schema/src/semantic/index-generation.ts` composing the
  `IndexGeneration` aggregate root (identity `id`, `binding_version`, `state`, `metric`,
  `dimension`, `aliases`, `created_at`) storing the embedding dimension/normalization/metric
  WITH the generation so incompatible vectors are never mixed, and the `CollectionAlias`
  entity (identity `id`, `collection`, `generation_id`, `active`) mapping a conceptual
  collection (`agents`/`skills`/`skill_chunks`/`tools`) to a physical generation so all
  aliases in a binding generation cut over together and `tools` never splits, mirroring
  `index-generation.cue` and `collection-alias.cue` (FR12, C12, C21). Acceptance:
  `tsgo --noEmit` green and the schema test asserts the generation stores `metric`+`dimension`
  and the alias set includes the Feature 009 `tools` extension point.
- [x] T011 [S4] Author `packages/schema/src/semantic/events.ts` composing the content-free
  common carrier `SemanticEnvelope` (`event_id`, `EventKind` = `event_type`/`schema_version`/
  `event_class`/`source`/`actor_kind`/`visibility`, `EventSubject` = nullable `binding_id`/
  `generation_id`/`collection` plus `project_id`, `Ordering` = per-aggregate `sequence`/
  `correlation_id`/nullable `causation_id`, `Delivery` = `visibility`/`timestamp`/redacted
  key-value `redacted_metadata`), the detail sub-objects (`BindingSelectionDetail`,
  `CutoverDetail`, `IndexMutationDetail`, `ReconcileDetail`, `GenerationDetail`,
  `DegradationDetail`, `ProbeDetail`, `StateChangeDetail`), one `Schema.Struct` per closed
  12-member vocabulary entry (each carrying `envelope`; distinct-payload members add one
  `detail`), the closed `Schema.TaggedUnion("type", ...)` `SemanticEvent`, and the per-member
  `EventV2.define` `Definition`s carrying `durable {version: 1, aggregate: "correlation_id"}`
  on the nine durable members and omitting `durable` on the three live members, mirroring
  `envelope.cue`, `envelope-parts.cue`, `events.cue`, `events-index.cue`, and `events-live.cue`
  (FR12, FR13, FR24, FR30, FR31, FR42, C12, C20, C22). Acceptance: `tsgo --noEmit` green and
  the schema test asserts every vocabulary member has a distinct Struct, the union is
  exhaustive, `redacted_metadata` carries no query/vector/prompt/path/secret, and only the
  nine durable members carry the durable annotation.
- [x] T012 [S0–S4] Author the barrel `packages/schema/src/semantic/index.ts` re-exporting
  every semantic schema module and register the barrel in `packages/schema/src/index.ts`.
  Acceptance: `tsgo --noEmit` on `packages/schema` green and `bun test packages/schema`
  imports the barrel without a duplicate-export error.
- [x] T013 [S4] Extend `packages/schema/src/durable-event-manifest.ts` to join the nine
  durable `semantic.*` definitions from `events.ts` into the canonical `Durable` inventory
  through `Event.durable([...])`, leaving the three live `retrieval_degraded`/`provider_probed`/
  `binding_state_changed` members out of the durable set, so no second event authority is
  introduced (C22). Acceptance: `bun test packages/schema` durable-manifest test green with
  the nine durable semantic members present and the three live members absent.
- [x] T014 [S5] Author `packages/protocol/src/semantic/ports.ts`,
  `packages/protocol/src/semantic/commands.ts`, and `packages/protocol/src/semantic/index.ts`
  mirroring `contracts/ports.ts`: the `ProviderPort`, `ModelPort`, `BindingPort`, `IndexPort`,
  `RetrievalPort`, and `EvalPort` interfaces, the provider/model/binding/index-generation/
  retrieval wire read models, the `OperatorPrincipal` shape, the retrieval + 30 `semantic.*`
  operator command/query payloads, and the typed `ProviderError`/`ModelError`/`BindingError`/
  `IndexError`/`RetrievalError`/`EvalError` unions (including `ssrf_blocked`, `not_validated`,
  `reranker_not_eligible`, `vector_space_mismatch`, `cas_conflict`, `confirmation_required`,
  `milvus_unavailable`, `no_candidate_staged`, `budget_exceeded`, `fail_closed_denied`),
  **sourcing every enum member from the `packages/schema/src/semantic/*` modules** — the
  three-member `RerankProfile` (`native-rerank`/`structured-chat`/`embedding-similarity`), the
  4-member `CapabilityKind` (`embedding`/`reranker`/`embedding-similarity`/`multilingual`),
  the 8-member `DegradationGap`, the 5-member `BindingState`/`GenerationState`, and the closed
  **12-member** event vocabulary — so the transport contract never diverges from the wire
  shape, and never redefining the event payload schemas or the reserved catalog (FR3, FR7,
  FR9, FR12, FR19, FR29, FR30, FR38, C1, C15, C16, C20). Acceptance: `tsgo --noEmit` on
  `packages/protocol` green and the protocol parity test asserts each interface member matches
  `contracts/ports.ts` reconciled to the schema modules and the reconciled 12-member vocabulary
  and 8-member gap enum match `packages/schema/src/semantic/*`.

### Domain retrieval engine (Phase 2)

- [x] T015 [S6] Author `packages/core/src/semantic/pipeline.ts` implementing the immutable
  nine-stage orchestrator over the injected Milvus/embedding/rerank/core-state/clock/config
  ports: structured profile → hard scalar filters → hybrid dense+sparse recall
  (`retrieval_top_k`) → reduced candidate set → rerank (`rerank_top_k`) → deterministic
  routing score/Feature 001 policy → selected Agent → constrained Skill retrieval/rerank →
  post-retrieval revalidation against live core, preserving the original query text for
  embedding with no mandatory translation LLM call and never letting the reranker choose the
  final route, mirroring the C2 pipeline contract with no I/O in the hot logic (FR3, FR4,
  FR5, FR15, FR21, C2). Acceptance: `bun test packages/core` asserts the stage order is
  fixed, a no-candidate/empty-recall path yields no invented agent, and identical inputs yield
  identical stage sequencing with deterministic ports.
- [x] T016 [S7] Author `packages/core/src/semantic/tie-break.ts` and
  `packages/core/src/semantic/hybrid-fusion.ts` implementing the stable total order **rerank
  score → dense score → sparse/lexical score → canonical id/version** and the deterministic
  dense+sparse fusion (weighted / RRF) applied before the tie-break, so identical inputs yield
  identical ordering and the fusion is reproducible, mirroring `retrieval.cue` and the C2/C7
  contracts (FR4, FR19, FR22, C2, C7). Acceptance: `bun test packages/core` asserts a total
  order over colliding scores down to canonical id, deterministic fusion output, and rerank
  absence falling through to dense→sparse→id.
- [x] T017 [S8] Author `packages/core/src/semantic/binding-lifecycle.ts` implementing the
  closed `draft→staged→active→degraded→unavailable` machine with `select` staging a candidate
  version, `validate`/`reindex` moving to `staged` without activating the alias, `cutover`
  under CAS+confirmation activating `active`, a provider/model outage degrading to `degraded`
  then `unavailable`, and `rollback` restoring a superseded version, pinning in-flight Task
  binding versions at Task start with no mid-task switch and never auto-selecting another model,
  mirroring the C12/C20 state machine (FR6, FR31, FR32, C12, C20). Acceptance: `bun test
  packages/core` asserts every legal transition, rejects illegal transitions, confirms
  in-flight version pinning across a cutover, and confirms no auto-substitution on outage.
- [x] T018 [S9] Author `packages/core/src/semantic/index-generation.ts` implementing the
  blue/green `building→validated→live→superseded→retired` generation machine so a
  select/reindex never activates the live alias, cutover swaps all collection aliases together
  under one CAS (agents/skills/skill_chunks and the Feature 009 tools extension), rollback
  reverts the alias, and a generation stores its embedding dimension/metric so incompatible
  vectors are never mixed, mirroring the C12 lifecycle (FR12, C12, C21). Acceptance: `bun test
  packages/core` asserts select/reindex leave the alias inactive, cutover moves all aliases
  atomically, a dimension change forces a new generation, and vectors are never mixed.
- [x] T019 [S10] Author `packages/core/src/semantic/degradation.ts` implementing the typed
  capability-gap ladder `full_semantic → catalog_lexical → fail_closed`, dropping to
  `catalog_lexical` with a stable gap code (`milvus_unavailable`/`embedding_unavailable`/
  `reranker_unavailable`/`index_stale`/`retrieval_timeout`/`no_binding`/`cold_index`) on any
  binding/Milvus/embedding/reranker outage, staleness, timeout, cold index, or unpinned
  binding, never auto-selecting another model and never a silent empty result, with
  fail-closed operator opt-in and bounded breaker/retries targeting the same pinned binding,
  mirroring the C14/C20 ladder (FR7, FR24, FR25, FR26, FR38, C14, C20). Acceptance: `bun test
  packages/core` covers each gap code, catalog+lexical floor without model substitution,
  fail-closed opt-in, and bounded retry on the same binding.
- [x] T020 [S11] Author `packages/core/src/semantic/query-cache.ts` deriving the query
  embedding once per logical Task from the structured profile, keying it by task
  fingerprint/version, reusing it across the agent and skill passes while valid, and
  invalidating by binding version and config hash with no per-token/per-turn remote loop,
  mirroring `profile.cue` and the C10 contract (FR18, FR25, NFR4, C10). Acceptance: `bun test
  packages/core` asserts one embed per fingerprint reused across passes, invalidation on
  binding-version or config-hash change, and no re-embed per token.
- [x] T021 [S12] Author `packages/core/src/semantic/freshness-gate.ts` implementing the
  freshness/stale-confidence gate and the post-retrieval revalidation contract so every
  candidate is revalidated against live AgentV2/SkillV2/Permission before injection — a
  disabled agent or a removed/over-permission skill from a stale index is dropped, a
  stale-confidence candidate degrades to C20 rather than contributing a semantic score, and
  stale-index safety never relies on freshness alone, mirroring the C11 gate (FR20, FR27, FR34,
  C11). Acceptance: `bun test packages/core` covers a stale disabled agent dropped, an
  over-permission skill dropped, and a stale-confidence candidate degraded.
- [x] T022 [S13] Author `packages/core/src/semantic/projection.ts` projecting `AgentDoc`/
  `SkillDoc`/`SkillChunkDoc` from live core with a content hash driving incremental upsert/
  tombstone, enforcing the sanitized-field allowlist that strips secrets, prompts, reasoning,
  and paths, indexing skill summaries first and chunking full bodies into bounded sanitized
  token windows with fixed overlap carrying `parent_skill_id`/`chunk_id` and a Feature 005
  `OutputRef` (never inline), and treating descriptions/domains/triggers as ranking signals
  only so a malicious description never alters router policy or hard gates, mirroring the
  document schemas and C4/C9 (FR1, FR2, FR10, FR11, FR13, FR17, FR23, FR36, FR39, FR40, C4,
  C9). Acceptance: `bun test packages/core` asserts sanitization strips secrets/prompts/
  reasoning/paths, content-hash change drives upsert vs tombstone, and a malicious description
  is a ranking signal only.
- [x] T023 [S14] Author `packages/core/src/semantic/semantic-instruments.ts` adding the
  `semantic.profile`/`embed.query`/`retrieve.agents`/`rerank.agents`/`retrieve.skills`/
  `rerank.skills`/`semantic.fallback`/`index.upsert`/`index.reconcile` spans linked to the
  Feature 001 session/routing/LLM/job spans, and the content-free metrics (latency buckets,
  candidates before/after, cache hit, fallback/stale counts, rerank delta buckets, selected
  semantic rank buckets, index freshness buckets, failures) with bounded-enum/bucket labels,
  reusing the Feature 001 cardinality allowlist so query text, vectors, entity IDs, session
  IDs, and paths never appear as metric labels, over-budget dynamic values map to `other`, the
  effective binding versions and Feature 004 language tag are recorded without content, and
  async bounded export never blocks the hot path, mirroring FR41/FR42 and C22 (FR16, FR41,
  FR42, NFR3, C22). Acceptance: `bun test packages/core` cardinality audit asserts no
  id/query/vector/path appears as a metric label and OTEL-down does not block retrieval.
- [x] T024 [S6–S14] Author the barrel `packages/core/src/semantic/index.ts` re-exporting the
  pipeline, tie-break, hybrid-fusion, binding-lifecycle, index-generation, degradation,
  query-cache, freshness-gate, projection, and semantic-instruments modules. Acceptance:
  `tsgo --noEmit` on `packages/core` green and the barrel imports without a duplicate-export
  error.

### Application, adapters, and operator wiring (Phase 3)

- [x] T025 [S15] **EARLY dependency + gRPC-under-Bun validation.** Add
  `@zilliz/milvus2-sdk-node@3.0.3` to `packages/opencode/package.json` and lock it plus its
  gRPC transitive stack (`@grpc/grpc-js`, `@grpc/proto-loader`, `protobufjs`, `generic-pool`,
  `lru-cache`, `@petamoriken/float16`) into `bun.lock`, then author
  `packages/opencode/src/semantic/grpc-probe.ts` empirically validating the SDK's connection
  lifecycle, keepalive, TLS, and pool behavior under the Bun runtime against a standalone
  Milvus server (skipped without one) and recording a typed capability outcome. **Honest
  outcome:** if the SDK works under Bun, record it and route the Milvus port through the gRPC
  driver; if it fails, record the typed capability gap and route the Milvus port through an
  injected fake / HTTP-fallback adapter — the task's acceptance is the recorded finding, not
  forced success (FR7, C1; research.md gRPC-under-Bun open risk). Acceptance: `bun test
  packages/opencode` asserts the probe emits a typed `grpc_bun_supported` or
  `grpc_bun_unsupported` finding with the driver-selection consequence recorded, and no code
  path hard-fails routing on an unreachable backend.
- [x] T026 [S15] Author `packages/opencode/src/semantic/milvus-adapter.ts` implementing the
  single Milvus port over standalone (default) / Lite-for-dev / Zilliz Cloud behind one
  adapter (driver chosen per T025's recorded finding), with an HNSW dense index on the stored
  cosine/inner-product metric, Milvus-native sparse/BM25 hybrid recall fused deterministically,
  mandatory scalar filters (project partition key, scope/visibility/role/permission) on every
  search with no per-project collection explosion, Bounded-staleness consistency (Strong for
  admin verification reads), the typed `milvus_unavailable` capability gap when the backend is
  unreachable, and an injected fake/in-memory adapter carrying the unit-test path, mirroring
  C1/C6/C7 (FR7, FR9, C1, C6, C7). Acceptance: `bun test packages/opencode` asserts the fake
  adapter serves hybrid recall under mandatory filters, an unreachable backend yields
  `milvus_unavailable` not a crash, and the scalar project key isolates projects.
- [x] T027 [S16] Author `packages/opencode/src/semantic/embedding-client.ts` implementing the
  `/v1/embeddings` deterministic probe (capturing dimension/normalization/limits with a
  harmless sample) and query/doc embedding over the reused `@ai-sdk/openai-compatible` core
  transport (base URL + secret ref, no new HTTP stack), with server-capped batch/vector counts
  and no per-token loop, excluding a model from the embedding selector on probe failure or
  incompatible dimension, mirroring C5 (FR30, FR37, C5, C8). Acceptance: `bun test
  packages/opencode` against a fake endpoint asserts the probe captures dimension/normalization,
  batch caps are enforced, and a dimension-mismatch model is excluded.
- [x] T028 [S17] Author `packages/opencode/src/semantic/rerank-client.ts` implementing the
  three explicit rerank profiles — A native `/v1/rerank` request/response adapter, B structured
  chat/completions with deterministic schema/fixed-temperature/tool-free behavior and explicit
  token/cost budget, C embedding-similarity as a **distinct** capability never badged
  cross-encoder/reranker and never eligible for the reranker slot — never inferring rerank
  capability from a `/v1/models` name and treating a manual declaration as untrusted until the
  native probe passes, mirroring C16 (FR30, FR4, C16). Acceptance: `bun test packages/opencode`
  asserts profile A/B round-trips against fakes, profile C is rejected for the reranker slot,
  and a rerank-suggestive model name without a passing probe is ineligible.
- [x] T029 [S18] Author `packages/opencode/src/semantic/url-guard.ts` implementing SSRF-safe
  URL parsing, scheme/host/port policy, and **post-resolution + post-redirect DNS
  revalidation** so metadata/link-local/private ranges are blocked unless an explicit
  local-profile allowance is set, remote endpoints require TLS by default, insecure HTTP is
  permitted only for an explicit local profile with a visible warning, and a DNS-rebinding
  target that resolves to a blocked address after the redirect is rejected, mirroring C17
  (FR33, C17). Acceptance: `bun test packages/opencode` covers a blocked metadata/link-local
  target, a rejected non-TLS remote, an allowed local-insecure profile with warning, and a
  post-redirect DNS-rebinding rejection.
- [x] T030 [S19] Author `packages/opencode/src/semantic/index-jobs.ts` implementing
  content-hash upsert / tombstone / reconcile jobs on the Feature 002 lifecycle with Feature
  003 scheduled reconcile using the **current pinned** embedding binding without changing it,
  coalesced triggers, no LLM by default, and Feature 005 OutputSpool refs for large job
  outputs, mirroring C22 (FR13, FR40, C22). Acceptance: `bun test packages/opencode` asserts
  upsert/tombstone reflect core state, a scheduled reconcile keeps the pinned binding and
  coalesces triggers, and large outputs are spooled as refs with no LLM turn.
- [x] T031 [S20] Author `packages/opencode/src/semantic/cutover-executor.ts` implementing the
  blue/green alias swap under CAS + operator confirmation so all collections in a binding
  generation cut over together, an embedding dimension change runs full reindex into a new
  generation before an explicit cutover, `select`/`reindex` alone never activate the live
  alias, rollback reverses under policy, and caches are invalidated by binding/version with a
  reranker cutover requiring no re-embedding, mirroring C12 (FR12, FR32, C12). Acceptance:
  `bun test packages/opencode` covers a CAS-success cutover of all collections together, a CAS
  contention reject, rollback, and a reranker cutover with no re-embed.
- [x] T032 [S21] Author `packages/opencode/src/semantic/credential-resolver.ts` resolving
  provider and Milvus credentials as SecretRef-only through the Feature 007 SecretPort with OS
  keychain mandatory for stored secrets and env-ref allowed for CI only, so `rotate-secret`
  changes only `secret_ref`/version without changing endpoint/model/binding identity, secrets
  never appear in args/history/output/config JSON/audit, and rotation is redacted and audited,
  mirroring C19 (FR35, FR31, C19). Acceptance: `bun test packages/opencode` asserts a secret is
  resolved only through a ref, rotate-secret keeps binding identity, and no plaintext secret
  appears in any output.
- [x] T033 [S19] Author `packages/opencode/src/semantic/durable-events.ts` projecting the nine
  durable `semantic.*` events over a new `publishSemanticEvent` boundary added to
  `packages/opencode/src/event-v2-bridge.ts` (mirroring `publishLifecycleEvent`/`publishJobEvent`/
  `publishLangLockEvent`/`publishOutputEvent`: location attach, single publish boundary),
  keeping the three live `retrieval_degraded`/`provider_probed`/`binding_state_changed` signals
  on the bounded live channel droppable under `allBounded` load, carrying only opaque ids and
  redacted metadata — never query text, vectors, or paths — so `semantic.*` events ride the
  existing bridge and no second channel exists, mirroring C22 (FR12, FR13, FR41, FR42, C22).
  Acceptance: `bun test packages/opencode` asserts a durable settlement event reaches the
  bridge boundary once, a live signal is droppable, and no payload carries content or a path.
- [x] T034 [S22] Author `packages/opencode/src/operator/semantic/**` with the typed
  `ProviderPort`/`ModelPort`/`BindingPort`/`IndexPort`/`EvalPort` domain implementations for
  the **30** reserved `semantic.*` IDs (`semantic.provider.*` 7, `semantic.model.*` 5,
  `semantic.embedding.*` 6, `semantic.reranker.*` 5, `semantic.binding.*` 2, `semantic.index.*`
  5), each registered through the Feature 007 registry with zero provider/model calls for
  ordinary status/show/select/config (explicit validate/test call the candidate endpoint via a
  fixed native probe only with cost/data disclosure), redacted/versioned human and JSON output,
  mutations requiring an operator principal plus explicit scope plus version/CAS plus
  idempotency plus audit, and `cutover`/`rollback`/`delete`-or-`disable`-when-bound/
  `rotate-secret` requiring interactive confirmation; the existing reserved catalog
  `packages/core/src/operator/catalog.ts` already declares the `semantic` domain and all 30
  IDs at `RESERVED_CATALOG_VERSION = "1.3.0"`, so **no catalog bump is performed** and
  plugin/MCP/custom registration of these IDs is rejected with a structured `reserved_name`
  error, no LLM/router/agent/plugin/MCP may set/update/delete a binding, and binding mutation
  happens only via `embedding.select`/`cutover` and `reranker.select`/`cutover` (the
  `semantic.binding.*` pair read-only) (FR6, FR8, FR28, FR29, FR31, FR34, FR35, FR36, C15,
  C19). Acceptance: `bun test packages/opencode` under the Feature 007 sandbox asserts the 30
  operations dispatch with zero model calls on ordinary paths, a reserved-ID collision is
  rejected, a prompt/plugin/MCP attempt to change a binding leaves it unchanged, and
  confirmation is required for cutover/rollback/rotate-secret.
- [x] T035 [S23] Author `packages/opencode/src/semantic/eval-harness.ts` implementing the
  offline golden evaluation driver over the `EvalPort`: golden task→agent/skill relevance,
  recall@k / nDCG / MRR, multilingual pt/es/en suites, permission-leakage tests with a fixed
  **zero** cross-project/over-permission tolerance, and drift/model-migration checks, budgeting
  skill-chunk context slices through Feature 005 `read(offset, limit)` so no full body is
  injected, and never mutating a binding, mirroring C18 (FR14, FR40, FR43, C18). Acceptance:
  `bun test packages/opencode` asserts the harness records per-locale recall/nDCG/MRR, fails on
  any leakage, injects only budgeted chunk ranges, and mutates no binding.
- [x] T036 [S6] Author `packages/opencode/src/semantic/retrieval-facade.ts` exposing the
  `RetrievalPort` (`retrieveAgents`/`retrieveSkills`) to Feature 001 Architect/Manager
  candidate support and wiring the deterministic score/tie-break/revalidation into a
  ranked-candidate result, and **honestly task the live agent/skill selection integration as a
  documented seam**: V1 delivers the facade module plus its tests plus a documented wiring
  point where Feature 001 Architect/Manager selection would consume it, mirroring the langlock
  injection-seam precedent — the seam may be an unreachable path in V1 until Feature 001 wires
  it, and the Worker path never calls it to create agents or children (FR1, FR2, FR5, FR16,
  FR21, FR23, FR39, C2, C11). Acceptance: `bun test packages/opencode` asserts the facade
  returns revalidated ranked candidates, records the effective binding versions and Feature 004
  language tag without content, and the documented Feature 001 seam is present and covered by a
  seam test.
- [x] T037 [S13–S23] Author the barrel `packages/opencode/src/semantic/index.ts` re-exporting
  the grpc-probe, milvus-adapter, embedding-client, rerank-client, url-guard, index-jobs,
  cutover-executor, credential-resolver, durable-events, eval-harness, and retrieval-facade
  modules. Acceptance: `tsgo --noEmit` on `packages/opencode` green and the barrel imports
  without a duplicate-export error.

### CLI and TUI surfaces (Phase 4)

- [x] T038 [S24] Author `packages/cli/src/**/semantic/**` for `opencode op semantic
  provider|model|embedding|reranker|binding|index <op>`, each dispatching through the Feature
  007 registry to the `ProviderPort`/`ModelPort`/`BindingPort`/`IndexPort` with
  registry-generated names (no divergent hardcoded verbs), emitting redacted/versioned human and
  JSON output, working offline for status/show/list, requiring interactive confirmation for
  cutover/rollback/rotate-secret, and making zero management-path provider/model calls or LLM
  tokens with no secret or path exposure, so the same command from Settings/palette/slash/CLI
  yields the same effective binding/version/audit (FR29, FR35, C15, AC19, AC21, AC22).
  Acceptance: `bun test packages/cli` asserts human and JSON output, surface parity with zero
  admin-time model tokens, confirmation on mutating verbs, and no secret/path in output.
- [x] T039 [S24] Author `packages/tui/src/**/operator/semantic/**` rendering the Semantic
  Search / Models panel over the `semantic.*` provider/model/binding/index commands as a thin
  adapter over the Feature 007 registry with registry-generated names, showing capability badges
  (embedding, reranker, multilingual, dimensions, limits, validated/declared/failed/stale) with
  `embedding-similarity` labeled distinctly and never as reranker, the current pinned binding
  with effective state/origin/version/degraded status, embedding/reranker selectors listing only
  eligible enabled validated candidates, secret input only through the secure store reference,
  and screen-reader text independent of color with no secret or path exposure (FR29, FR30, C16,
  AC21, AC34). Acceptance: `bun test packages/tui` asserts the panel shows current-binding and
  degraded state, badges profile C distinctly and excludes it from the reranker selector, and
  exposes no secret or path.

### Tests and validation (Phase 5)

- [x] T040 [S25] Add pure deterministic unit tests under `packages/core/test/semantic/**` for
  the nine-stage pipeline order (fixed order, no-candidate path, no invented agent), the
  tie-break total order and deterministic hybrid fusion, the binding lifecycle (legal/illegal
  transitions, in-flight version pinning, no auto-substitution), the index-generation lifecycle
  (select/reindex inactive alias, atomic all-collection cutover, no vector mixing), the
  degradation ladder (each gap code, catalog+lexical floor, fail-closed opt-in), the query-cache
  invalidation (one embed per fingerprint, binding-version/config-hash invalidation), the
  freshness gate/revalidation (stale disabled agent, over-permission skill, stale-confidence
  degrade), and the projection/content-hash + sanitization, with deterministic ports and no I/O
  (AC2, AC3, AC4, AC5, AC7, AC8, AC16, AC17, AC18, AC29, AC33). Acceptance: `bun test
  packages/core` green.
- [x] T041 [S25] Add schema and protocol tests under `packages/schema/test/semantic/**` and
  `packages/protocol/test/semantic/**` asserting contract hygiene (annotate-before-check
  identifiers on every brand), the closed 12-member `semantic.*` vocabulary and the durable
  (9) versus live (3) split, the real-valued score domain (`Score`/`RerankScore`/`DenseScore`/
  `SparseScore` continuous, `Confidence` bounded `[0,1]`) versus the integer counters, the SSOT
  aggregates embedding no secret, envelope/document/chunk redaction (no query/vector/prompt/
  path/secret), and `protocol/semantic` parity against `contracts/ports.ts` reconciled to the
  schema modules — the 12-member vocabulary, the 8-member `DegradationGap`, the three-member
  `RerankProfile`, and the 4-member `CapabilityKind` (FR17, FR22, FR28, FR42, C7, C16, C20,
  C22, AC15). Acceptance: `bun test packages/schema` and `bun test packages/protocol` green.
- [x] T042 [S25] Add integration tests under `packages/opencode/test/semantic/**` through the
  Feature 007 sandbox for the Milvus adapter against a standalone Milvus server (container) —
  HNSW + cosine/IP dense recall, Milvus-native sparse/BM25 hybrid, mandatory scalar filters,
  cross-project isolation, the typed `milvus_unavailable` gap, upsert/tombstone/reconcile — with
  the injected fake adapter carrying the pure path, and the embedding/rerank probes against
  fakes (`/v1/embeddings` dimension/normalization/limits; rerank profile A/B; profile C never
  reranker-eligible; manual declaration untrusted until validated) (FR7, FR9, FR30, C1, C6, C7,
  C16, AC1, AC6, AC7, AC10, AC19, AC22, AC23, AC24, AC25, AC26). Acceptance: `bun test
  packages/opencode` green against the standalone server when present and against fakes
  otherwise.
- [ ] T043 [S25] Add fault-injection tests under `packages/opencode/test/semantic/**` driving
  the degradation matrix (Milvus down, reranker timeout, embedding down, cold index, no binding
  pinned → typed gap code + catalog/lexical floor, no model substitution, fail-closed opt-in),
  the cutover fault matrix (select/reindex do not activate the alias, cutover CAS success/
  contention, all collections together, rollback, in-flight version pinning, no vector mixing),
  and the SSRF/DNS matrix (metadata/link-local/private blocked, non-TLS remote rejected,
  local-insecure allowance with warning, post-resolution + post-redirect DNS-rebinding
  rejection) through injected ports (FR12, FR24, FR31, FR32, FR33, C12, C17, C20, AC7, AC8, AC9,
  AC29, AC31, AC32, AC33, AC36, AC38, AC41). Acceptance: `bun test packages/opencode` green with
  every degradation, cutover, and SSRF/DNS point asserted.
- [ ] T044 [S25] Add contract and end-to-end tests through the Feature 007 sandbox covering the
  30 `semantic.*` IDs versus the existing reserved catalog (already at 1.3.0) with reserved-ID
  collision rejection, surface parity (same binding select/validate from Settings/palette/slash/
  CLI yields the same effective binding/version/audit with zero admin transcript injection and
  zero management-path LLM tokens), a prompt/plugin/MCP binding-change attempt leaving bindings
  unchanged, secret rotation keeping binding identity with redacted audit, a local no-key
  embedding register, a delete-bound-model confirmation, and the offline golden eval harness for
  pt/es/en with the fixed zero leakage tolerance and no binding mutation (FR28, FR31, FR35, FR43,
  C15, C18, C19, AC14, AC19, AC20, AC21, AC27, AC28, AC30, AC35, AC37, AC39, AC40). Acceptance:
  `bun test packages/opencode`/`packages/cli`/`packages/tui` green under the sandbox.
- [ ] T045 [S25] Run per-package `tsgo --noEmit` typecheck and `bun test` for `packages/schema`,
  `packages/protocol`, `packages/core`, `packages/opencode`, `packages/cli`, and `packages/tui`,
  plus a telemetry cardinality audit under `packages/core/test/semantic/**` asserting query
  text, vectors, entity IDs, session IDs, and paths never appear as metric labels, over-budget
  dynamic values map to `other`, the `semantic.*` spans correlate with the Feature 001 spans,
  the effective binding versions and Feature 004 language tag are recorded without content, and
  OTEL-down does not block retrieval; then close out: tick every checkbox above once its task is
  complete and verified, confirm `speckit validate` is green with only the four pre-existing
  waived hygiene findings, and confirm every FR1–FR43 and AC1–AC41 is mapped to a task per the
  Traceability section (Observability, FR16, FR41, FR42, C22, AC15). Acceptance: all six packages
  typecheck and test green, `speckit validate` green, and the Traceability tables fully mapped.

## Traceability

Requirements-to-task and acceptance-to-task coverage. The closed **12-member** `semantic.*`
event vocabulary (9 durable + 3 live, underscore-named), the three-member `RerankProfile`, the
4-member `CapabilityKind`, the 8-member `DegradationGap`, the 5-member `BindingState`/
`GenerationState`, and the real-valued score domain are the CUE / `data-model.md` authority.
`contracts/ports.ts` presents a divergent provisional surface — a **20-member** `semantic.*`
event vocabulary (13 dotted durable `semantic.binding.selected`/`…activated`/… plus 7 live
`semantic.retrieval.fallback`/… ), a 6-member `DegradationGapCode` (`no_binding_pinned`/
`timeout`), a 5-member `CapabilityKind` (`rerank_native`/`rerank_chat`), underscore-spelled
`RerankProfile` (`native_rerank`/`structured_chat`/`embedding_similarity`), and an enum
`SemanticScore.confidence` (`high`/`medium`/`low`). **T014 reconciles the protocol mirror to
the CUE authority** (the 12 underscore-named event names with the 9-durable/3-live split, the
hyphen-spelled three-member `RerankProfile`, the 4-member `CapabilityKind`, the 8-member
`DegradationGap`, and the real-valued `Confidence`) and sources the `protocol/semantic` enums
directly from the `packages/schema/src/semantic/*` modules so the transport contract cannot
drift; T041 pins that parity across the draft, the protocol mirror, and the schema modules.

| Requirement | Tasks |
| ----------- | ----- |
| FR1 authorities remain source of truth | T015, T021, T022, T036 |
| FR2 Milvus derived projection not authority | T022, T026, T036 |
| FR3 nine-stage pipeline | T014, T015 |
| FR4 reranker relevance only, not route | T016, T028 |
| FR5 Architect/Manager use retrieval; Worker no children | T015, T036 |
| FR6 role pools; operator-pinned slots not free-form | T007, T017, T034 |
| FR7 Milvus default backend behind adapter; fallback | T025, T026, T019 |
| FR8 connection settings operator-only | T032, T034 |
| FR9 separate collections; mandatory filters; no explosion | T008, T026 |
| FR10 agent documents | T008, T022 |
| FR11 skill documents/chunks | T008, T022 |
| FR12 binding-with-collection; blue/green cutover | T007, T010, T018, T031 |
| FR13 content-hash upsert/tombstone/reconcile; F002/003/005 | T022, T030, T033 |
| FR14 multilingual locales | T003, T009, T035 |
| FR15 preserve query text; no translation LLM | T009, T015 |
| FR16 BCP47 metadata; effective tag on decision | T009, T023, T036 |
| FR17 no secrets/prompts/reasoning/paths | T003, T022 |
| FR18 query embedding once per Task, cached | T009, T020 |
| FR19 hybrid recall top_k; rerank reduced; ties deterministic | T009, T016 |
| FR20 filters before + revalidate after | T021, T026 |
| FR21 two-pass agent→skill | T015, T036 |
| FR22 scores provenance/components/confidence | T009, T016 |
| FR23 final ranking combines; no volatile health authority | T022, T036 |
| FR24 V1 degradation; no auto substitution | T017, T019 |
| FR25 local bounded cache; no per-token loop; invalidate | T020, T019 |
| FR26 bounded breaker/retries; same binding | T019, T023 |
| FR27 freshness gates; stale revalidate | T021 |
| FR28 SSOT records | T005, T006, T007 |
| FR29 Settings Semantic Search / Models panel | T034, T038, T039 |
| FR30 rerank profiles A/B/C; probe; never infer from name | T006, T027, T028 |
| FR31 binding immutability; no silent failover; rotate-secret | T017, T032, T034 |
| FR32 select/reindex/cutover distinct semantics | T017, T031 |
| FR33 SSRF/DNS rebinding | T029 |
| FR34 authorization before + after | T021, T026, T034 |
| FR35 credentials secret refs; operator-only | T032, T034 |
| FR36 plugin sources visibility; malicious description | T022, T034 |
| FR37 sanitized fields; residency | T005, T022, T027 |
| FR38 consume Feature 001 budget; fail closed/degrade | T009, T019 |
| FR39 skills lazy | T008, T022, T036 |
| FR40 OutputSpool refs | T008, T030, T035 |
| FR41 spans | T023, T033 |
| FR42 metrics bounded content-free | T023, T033 |
| FR43 offline eval | T035 |
| NFR1 latency budget; timeout → fallback | T019, T026 |
| NFR2 idempotent upsert/reconcile | T030 |
| NFR3 bounded candidate memory | T009, T023 |
| NFR4 no embed/search per token | T020 |
| NFR5 V1/V2 seam, no second router | T036 |

| Acceptance | Tasks |
| ---------- | ----- |
| AC1 multilingual pt / English skills | T027, T028, T035, T042 |
| AC2 direct Worker path | T015, T036, T040 |
| AC3 Manager workers | T015, T036, T040 |
| AC4 permission filtering post-reval | T021, T026, T040 |
| AC5 stale index revalidation | T021, T040 |
| AC6 cross-project isolation | T026, T034, T042 |
| AC7 Milvus down fallback | T019, T026, T043 |
| AC8 reranker down | T019, T028, T040, T043 |
| AC9 embedding migration blue/green | T018, T031, T043 |
| AC10 skill changed/deleted reconcile | T022, T030, T042 |
| AC11 malicious skill | T022, T034 |
| AC12 context cost budget | T009, T022, T035 |
| AC13 scheduled reconciliation | T030 |
| AC14 native command no LLM | T034, T044 |
| AC15 telemetry no content | T023, T041, T045 |
| AC16 cache reuse | T020, T040 |
| AC17 top_k budgets | T009, T016, T040 |
| AC18 no matching candidate | T015, T019, T040 |
| AC19 local no-key embedding register | T027, T034, T038, T044 |
| AC20 local key endpoint secure ref | T032, T034, T044 |
| AC21 core catalog model with credential | T034, T038, T039 |
| AC22 manual registration needs validation | T006, T028, T042 |
| AC23 wrong dimension / probe failure | T006, T027, T042 |
| AC24 rerank name alone insufficient | T006, T028, T042 |
| AC25 native `/v1/rerank` profile A | T028, T042 |
| AC26 structured chat reranker B | T028, T042 |
| AC27 restart preserves bindings | T017, T032, T044 |
| AC28 LLM/prompt/plugin cannot alter | T034, T044 |
| AC29 outage no silent substitution | T017, T019, T040 |
| AC30 secret rotation same identity | T032, T044 |
| AC31 embedding switch blue-green | T018, T031, T043 |
| AC32 reranker switch no re-embed | T031, T043 |
| AC33 in-flight version pinned | T017, T040 |
| AC34 profile C distinct label | T028, T039 |
| AC35 rotate-secret identity stable | T032, T044 |
| AC36 DNS rebinding blocked | T029, T043 |
| AC37 delete bound model confirmation | T034, T044 |
| AC38 SSRF/TLS policy | T029, T043 |
| AC39 surface parity zero admin tokens | T034, T038, T044 |
| AC40 multilingual pt/es/en eval | T035, T044 |
| AC41 Milvus metadata/version consistency | T018, T026, T031, T043 |

## Dependencies

**Sequencing (internal):**

- Schema and protocol (T001–T014) precede every domain, application, and surface task. Within
  Phase 1: T001 and T002 precede T003–T011 (identifiers and value objects are referenced by
  every enum and struct); T003 (text/collections) precedes T005–T011; T004 (enums + vocabulary)
  precedes T005–T011; T005 (provider) depends on T001–T004; T006 (model descriptor) depends on
  T001–T004; T007 (binding) depends on T004–T006 and T010's `GenerationId`; T008 (documents)
  depends on T001–T004; T009 (profile + retrieval) depends on T002–T004; T010 (index generation)
  depends on T004; T011 (events) depends on T004 and T010; T012 (schema barrel) depends on
  T001–T011; T013 (durable manifest) depends on T011; T014 (protocol) depends on T004–T011.
- Domain engine (T015–T024) depends on the schemas (T001–T012). T015 (pipeline) depends on T009;
  T016 (tie-break + fusion) depends on T009 and T015; T017 (binding lifecycle) depends on T007;
  T018 (index generation lifecycle) depends on T010 and T017; T019 (degradation) depends on T004;
  T020 (query cache) depends on T009; T021 (freshness gate) depends on T009; T022 (projection)
  depends on T008; T023 (instruments) depends on T004 and T011; T024 (core barrel) depends on
  T015–T023.
- Application and adapters (T025–T037) depend on the domain engine, schemas, and protocol. T025
  (dependency + gRPC-under-Bun validation) is the **early** driver-selection prerequisite for the
  Milvus port and may run in parallel with Phases 1–2 (it touches only `package.json`/`bun.lock`/
  `grpc-probe.ts`); T026 (Milvus adapter) depends on T014, T016, and T025's recorded finding;
  T027 (embedding client) depends on T014; T028 (rerank client) depends on T014; T029 (URL guard)
  depends on T027 and T028; T030 (index jobs) depends on T022 and T026; T031 (cutover executor)
  depends on T018 and T026; T032 (credential resolver) depends on T029; T033 (durable events)
  depends on T011, T013, and T017; T034 (operator commands) depends on T014, T031, T032, and
  T033; T035 (eval harness) depends on T015, T021, and T034; T036 (retrieval facade + Feature 001
  seam) depends on T015, T016, and T021; T037 (application barrel) depends on T025–T036.
- CLI/TUI surfaces (T038–T039) depend on the operator commands (T034); T039 additionally depends
  on T028 for the profile-C badge and reranker-selector eligibility.
- Tests and validation (T040–T045) depend on their corresponding implementation tasks; T042–T044
  run only through the Feature 007 sandbox wrapper (and, for T042, an optional standalone Milvus
  container — absent it, the fake adapter carries the path); T045 (typecheck + cardinality audit
  + close-out) depends on T001–T044 and a green `speckit validate`.

**External dependencies (must be available or accepted first):**

- **ADR-0008 (Milvus-Backed Multilingual Semantic Retrieval and Reranking Stack, proposed)** is
  the required decision record; its provisional constants — Milvus/pool sizing, HNSW/BM25 params,
  score-fusion weights, `retrieval_top_k`/`rerank_top_k`/`max_skill_chunks`/latency budgets,
  chunk/cache constants, cutover alias grammar, dual-write and in-flight retention windows, SSRF
  denylist CIDRs, probe batch limits, breaker thresholds, and eval thresholds — are plan constants
  in `data-model.md` fixed by acceptance testing (AC1, AC5, AC6, AC12, AC17, AC23, AC31, AC32,
  AC33, AC36, AC38, AC40) and deferred to the ADR (C1–C12, C16–C20, C22).
- **`@zilliz/milvus2-sdk-node@3.0.3` is not yet a workspace dependency** (absent from `bun.lock`
  and every `package.json`); it is a gRPC client whose behavior under the Bun runtime is a
  task-phase validation prerequisite. T025 adds it and empirically validates gRPC-under-Bun; the
  Milvus port stays behind one adapter so a fake/HTTP-fallback carries the path regardless of the
  driver outcome. **No Milvus Lite exists for TS/Bun** (Python-only); the dev/test topology is a
  standalone Milvus server (container) for integration plus injected fakes for unit tests, the
  honest mapping of the C1 "Lite for dev/test" allowance (research.md).
- **EventV2 remains the single event authority**: `packages/schema/src/event.ts`
  (`EventV2.define`), `packages/core/src/event.ts` (`Service`, `readAggregate`, `allBounded`), the
  `packages/schema/src/durable-event-manifest.ts` inventory, and the existing
  `packages/opencode/src/event-v2-bridge.ts` publish boundary are reused, not replaced. The nine
  durable `semantic.*` events register through `EventV2.define` and publish through the new
  `publishSemanticEvent` boundary (T033); the three live signals ride the bounded live channel; no
  second bus or channel is introduced (C22).
- **Feature 001 (Smart Agent Routing and Telemetry)** supplies the hard-gate/ranking authority and
  the Context, Turn and Delegation Budget (`retrieval_top_k`/`rerank_top_k`/`max_skill_chunks`/
  token budgets, consumed by T009/T019), the telemetry instruments plus cardinality allowlist, and
  the async content-free OTLP exporter reused by T023/T033/T045; semantic fit stays separate from
  Feature 001 quality inputs and semantic scores are ranking inputs, never route authority (FR3,
  FR22, FR38, C2, C8, C22). T036 is the honest V1 seam for live Architect/Manager consumption of
  the `RetrievalPort` — module + tests + documented wiring point, possibly unreachable until
  Feature 001 wires it, mirroring the langlock injection-seam precedent.
- **Feature 002 (Task Lifecycle Event Bus and Process Table)** owns the reindex/probe/reconcile job
  lifecycle and binding-version metadata; Process Table observes retrieval job lifecycle and
  degraded flags without raw queries (T030) (FR13, C22).
- **Feature 003 (Scheduled Jobs and Async Notification)** owns the scheduled reconcile occurrence,
  which uses the current pinned embedding binding without changing it and coalesces triggers with
  no LLM by default (T030) (FR13, C22).
- **Feature 004 (Lang Lock)** owns the language tag/version/provenance; T009/T023/T035 carry the
  multilingual query posture against Lang Lock (default en-US) artifacts and record the effective
  Feature 004 tag on the retrieval decision without content (FR14, FR16, C4).
- **Feature 005 (OutputSpool and ArtifactStore)** owns content-plane settlement; index/probe job
  outputs and skill-chunk injection are Feature 005 `OutputRef`s with `offset`/`limit` slices,
  never duplicated bodies (T008/T030/T035) (FR40, C9).
- **Feature 007 (Operator Control Plane, ADR-0003 accepted)** is the sole management authority: its
  Config.Service, PermissionV2 principals and scopes, the SecretPort SecretRef redaction, the
  reserved `semantic.*` catalog already present at `RESERVED_CATALOG_VERSION = "1.3.0"` (all 30 IDs;
  **no bump required**), the registry, CAS, idempotency, audit, and the `.dev/opencode-operator/`
  sandbox wrapper are the only path for `semantic.*` registration (T034/T038/T039) and for
  integration/fault/e2e tests (T042–T044). Feature 006 registers no parallel command registry,
  permission system, or store authority (FR28, FR35, C15, C19).
- **Feature 008 (MCP Tools/Resources)** may opt in an MCP resource semantic-index with
  classification; Feature 006 stack ownership is unchanged (spec Related, C21).
- **Feature 009 (Semantic Tool Search)** reuses this stack, the pinned bindings, the C20 ladder,
  the multilingual posture, and the content-free telemetry, and owns only the `tools` collection.
  The `Collection` enum, the alias set, and the cutover executor are designed so all collections
  cut over together and Feature 009 adds `tools` without touching Feature 006 code (T004, T010,
  T018, T031) (spec Related, ADR-0007, C21).

**Shared seams already in `specScopeGlobs` and NOT duplicated:**
`packages/opencode/src/event-v2-bridge.ts` (Feature 001) for `publishSemanticEvent`;
`packages/schema/src/durable-event-manifest.ts` and `packages/core/src/event.ts` and
`packages/core/src/operator/**` and `packages/core/test/operator/**` and
`packages/opencode/src/operator/**` and `packages/opencode/test/operator/**` (Feature 007) for the
durable manifest, the EventV2 authority, the reserved `semantic.*` catalog
(`packages/core/src/operator/catalog.ts`, already at 1.3.0 with all 30 IDs), and the operator
command impls; `packages/tui/src/**/operator/**` and `packages/tui/src/**/settings/**` (Feature
007) for the panel host and Settings row; `packages/schema/src/index.ts` and
`packages/schema/test/**` (Feature 001) and `packages/protocol/test/**` (Feature 001) for the
schema barrel and schema/protocol tests. `package.json` and `bun.lock` are already in scope under
the repository-health block; T025 adds the Milvus SDK there without a new glob.
</content>
</invoke>
