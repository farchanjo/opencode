---
status: proposed
date: 2026-07-18
deciders: [project maintainers]
---

# 0008 — Milvus-Backed Multilingual Semantic Retrieval and Reranking Stack

## Context and Problem Statement

Feature 006 (Semantic Agent and Skill Retrieval) adds **Milvus-backed multilingual
semantic retrieval and reranking** for canonical OpenCode agents and skills. It
improves candidate discovery for Feature 001 Smart Agent Routing without becoming a
second registry, permission authority, or route decider. The feature `spec.md` names
this ADR — **Milvus-Backed Multilingual Semantic Retrieval and Reranking** — as the
required decision record that formalizes the clarify package (Session 2026-07-18,
C1–C22) before `plan` completion and any implementation.

The research base (`research.md`) confirms that OpenCode carries no product vector
index or semantic agent/skill retrieval today. AgentV2 exposes a service-backed
registry (`packages/core/src/agent.ts:1-27`), SkillV2 exposes sources and an
`available(skills, agent)` permission filter (`packages/core/src/skill.ts:1-60`,
`:121-132`), and the model resolver carries only a test/embedding seam comment
(`packages/core/src/session/runner/model.ts:80`) — there is no dense recall, no
sparse/lexical recall, no reranker stage, and no two-pass agent→skill retrieval. The
reserved operator catalog already declares the complete semantic surface: exactly 30
`semantic.*` IDs at `RESERVED_CATALOG_VERSION = "1.3.0"`
(`packages/core/src/operator/catalog.ts`). The OpenAI-compatible client transport
already exists (`@ai-sdk/openai-compatible@2.0.41`;
`packages/core/src/plugin/provider/openai-compatible.ts`); no Milvus client, gRPC
dependency, or vector store is present in the workspace today.

Without one decision record, Feature 006 risks a second registry/permission/routing
authority beside AgentV2/SkillV2/Permission/Feature 001, a hard runtime dependency on
Milvus that breaks routing when the backend is down, hardcoded embedding/reranker model
IDs that the router or an LLM can silently swap, per-project collection explosion on
multi-root workspaces, cross-project leakage from a stale index, an online
self-optimizing ranking loop, secrets or prompts embedded in the index, and management
paths reachable by an LLM, plugin, or MCP tool. This ADR fixes those decisions so
`plan` and `tasks` proceed against a stable projection/pipeline/binding/degradation/
security contract without reopening Feature 001 hard-gate/ranking authority and Context,
Turn and Delegation Budget ownership, Feature 002 lifecycle authority, Feature 003
occurrence/reconcile ownership, Feature 004 Lang Lock provenance ownership, Feature 005
content-plane ownership, or Feature 007 native-only operator authority and reserved
catalog.

## Decision Drivers

- One derived projection, not a second authority: AgentV2/SkillV2/Catalog/Permission/
  Config remain the sources of truth for identity, availability, permissions, and
  config; Milvus is a rebuildable index that never grants availability, permissions, or
  final route selection.
- Never a hard runtime dependency: routing stays available through a deterministic
  catalog + lexical/rules fallback when Milvus, the embedding provider, or the reranker
  is down, stale, or times out, with an explicit typed degraded reason.
- No hardcoded models: the effective embedding and reranker are always the
  operator-pinned `SemanticModelBinding` slots; no LLM, router, agent, plugin, or MCP
  selects, swaps, or silently substitutes them; model names appear in docs only as
  examples requiring native probe/eval.
- One immutable pipeline with a deterministic tie-break so identical inputs yield
  identical ordering, matching the Feature 009 tool-search contract.
- Multilingual query posture: pt-BR/es/en queries match English Lang Lock artifacts via
  multilingual embedding/rerank without a mandatory translation LLM call.
- Project isolation and stale-index safety: mandatory scalar filters before search, a
  scalar project partition key (never per-project collections), and post-retrieval
  revalidation against live core state with zero cross-project or over-permission hits.
- Content-free telemetry, bounded memory, and one operator control plane: reuse
  ADR-0001 cardinality rules, the Feature 001 budget policy, and the Feature 007
  reserved `semantic.*` catalog with no new command IDs and no LLM/plugin/MCP admin
  surface.

## Considered Options

- **A Milvus-backed derived projection with operator-pinned embedding/reranker bindings,
  an immutable nine-stage pipeline with deterministic tie-break, a scalar project
  partition key, blue/green collection generations under an atomic CAS cutover, a typed
  degradation ladder with no silent model substitution, and content-free telemetry over
  the Feature 007 reserved catalog** — selected: one projection authority, honest
  degradation, deterministic ranking, project isolation, and no second registry,
  permission system, model-selection surface, or operator bus.
- **Hardcode a default embedding/reranker model (for example a fixed `bge-m3` /
  `bge-reranker-v2-m3` pair) as the sole runtime option** — rejected: makes model choice
  a runtime constant that an LLM, router, or plugin can assume or swap, defeats operator
  auditability, and breaks the SSOT `SemanticModelBinding` slot contract; model names
  remain examples that require native probe/eval before eligibility (C3, FR6, FR30).
- **Per-project Milvus collections** — rejected: a multi-root workspace explodes into a
  collection per project, multiplies index lifecycle and blue/green cutover cost, and
  fragments the binding generation; isolation is a mandatory scalar project partition
  key on shared `agents`/`skills`/`skill_chunks` collections with a filter on every
  search (C6, FR9, FR34).
- **Make Milvus a mandatory runtime dependency for Smart Agent Routing** — rejected: a
  down or cold backend would hard-fail routing; Milvus is the default/preferred backend
  but never mandatory, and an unreachable backend surfaces the typed `milvus_unavailable`
  gap and degrades to catalog + lexical/rules fallback (C1, C14, C20, FR7, FR24).
- **A feedback-loop / online self-optimizing ranking policy in V1** — rejected: an online
  loop that mutates ranking or bindings from live outcomes couples retrieval to volatile
  signals, risks drift, and can silently change effective models; V1 is strict two-pass
  Agent-then-Skill retrieval with offline golden evaluation only, and runtime never
  mutates bindings from telemetry (C13, C18, C22, FR43).
- **Infer rerank capability from a `/v1/models` name** — rejected: a model whose name
  suggests rerank is not a validated cross-encoder; rerank requires an explicit profile
  (A native `/v1/rerank`, B structured chat, C embedding-similarity labeled distinctly
  and never reranker-eligible) and a passing native probe/eval (C16, FR30).
- **A second embedding/rerank stack, Milvus adapter, or operator surface for tools
  (Feature 009)** — rejected: Feature 009 extends this stack with a `tools` collection
  under the same bindings, ladder, and reserved catalog (ADR-0007); duplicating the
  infrastructure violates the single-authority posture (C21).

## Decision Outcome

Chosen option: **a Milvus-backed derived projection with operator-pinned
embedding/reranker bindings, an immutable nine-stage retrieval pipeline with a
deterministic tie-break, a scalar project partition key, blue/green collection
generations under an atomic CAS cutover, a typed degradation ladder with no silent model
substitution, and content-free telemetry over the Feature 007 reserved catalog**.

- **Deployment mode and adapter boundary (C1).** V1 default is a Milvus standalone
  (single-node) server reached through one native adapter/port (FR7); Milvus Lite /
  embedded is allowed only for dev, test, and CI, with fake/in-memory adapters as the
  unit-test path; Zilliz Cloud is a valid remote endpoint under the same adapter and the
  C17 SSRF/TLS posture. Milvus is never a hard runtime dependency: an unreachable backend
  surfaces the typed `milvus_unavailable` capability gap and routing degrades per C14/C20.
  The adapter surface, driver, and pool sizing are provisional plan constants with
  acceptance hooks AC7/AC41.
- **Immutable pipeline and deterministic tie-break (C2).** The nine-stage pipeline in FR3
  is normative and immutable: profile → hard scalar filters → hybrid dense+sparse recall
  (`retrieval_top_k`) → reduced candidate set → rerank (`rerank_top_k`) → deterministic
  routing score / Feature 001 policy → selected Agent → constrained Skill
  retrieval/rerank → post-retrieval revalidation against live core. Ties break by a
  stable total order — rerank score, then dense score, then sparse/lexical score, then
  canonical ID/version — so identical inputs yield identical ordering, matching the
  Feature 009 tie-break contract. Score-fusion weights are provisional plan constants
  with acceptance hooks AC2/AC3/AC8.
- **No hardcoded models; example bindings only (C3).** No product model ID is hardcoded
  as the sole option; the effective models are always the operator-pinned
  `SemanticModelBinding` slots (FR6, FR28). V1 documents a provisional recommended
  multilingual example — a multilingual dense embedding model (for example `bge-m3`-class,
  normalized, cosine/inner-product metric) and a cross-encoder reranker (for example
  `bge-reranker-v2-m3`-class) covering pt-BR/es/en — as guidance only; the panel still
  requires native probe/eval before either becomes eligible (FR30). Dimension,
  normalization, and distance metric are stored per collection with the binding (FR12)
  and never inferred. Acceptance hooks AC19–AC24, AC40, AC41.
- **Privacy and residency (C4).** V1 supports both local OpenAI-compatible endpoints
  (localhost/LAN, optionally key-free) and remote endpoints under one privacy policy:
  embedding/rerank providers receive only sanitized index/query fields (FR17, FR37),
  never secrets, prompts, reasoning, or paths. A local/offline-only residency profile is
  a first-class operator option that blocks egress to remote hosts; it is not the
  mandatory default. The per-field sanitization allowlist and residency-enforcement point
  are provisional plan constants with acceptance hooks AC15, AC19, AC20.
- **OpenAI-compatible transport reuse (C5).** Provider profiles reuse the existing core
  OpenAI-compatible client transport (base URL, headers, secret ref) rather than a new
  HTTP stack; the embedding probe calls `/v1/embeddings` and the reranker follows the
  explicit profile of FR30. Rerank capability is never inferred from a model name. The
  reused client module and probe fixtures are provisional plan constants with acceptance
  hooks AC21, AC24, AC25, AC26.
- **Collection schema, partitioning, and consistency (C6).** The three conceptual
  collections `agents`, `skills`, `skill_chunks` are separate (FR9); the namespace is
  extensible for Feature 009's `tools` collection under the same binding generation (C21).
  Tenant/project/scope/visibility/role are scalar metadata with mandatory filters on
  every search (FR9, FR34); per-project isolation uses a scalar project key (partition
  key), never per-project collections, so multi-root workspaces never trigger collection
  explosion. Consistency level is Bounded staleness by default (the index is a derived
  projection and every candidate is revalidated against core per FR20/FR27), with Strong
  reserved for admin verification reads. Partition grammar, the scalar field set, and the
  bounded-staleness window are provisional plan constants with acceptance hooks AC5, AC6,
  AC41.
- **Index type, metric, and hybrid recall (C7).** Dense vectors use an HNSW index with
  the binding's stored metric (cosine / inner-product on normalized vectors); IVF
  variants remain a plan-tunable alternative for large corpora but HNSW is the V1 default.
  Sparse recall uses Milvus-native sparse/BM25 full-text search (Milvus 2.5+) as the
  preferred hybrid path, with an external lexical index allowed behind the same adapter
  when the backend lacks native BM25; dense and sparse are fused deterministically
  (weighted / RRF) before the C2 tie-break. Index build/search parameters (`M`,
  `efConstruction`, `ef`, fusion weights) are provisional plan constants with acceptance
  hooks AC1, AC17.
- **Retrieval windows and latency budget (C8).** `retrieval_top_k`, `rerank_top_k`,
  `max_skill_chunks`, and skill token budgets are consumed from the Feature 001 Context,
  Turn and Delegation Budget (FR38) and never free-form; exceeding them fails closed or
  degrades with an explicit reason (FR38). Provisional V1 defaults (plan-owned):
  `retrieval_top_k` 64, `rerank_top_k` 16, `max_skill_chunks` 8, retrieval latency budget
  in the low hundreds of milliseconds with timeout → C20 fallback. Embedding-probe batch
  size and per-request vector count are server-capped and schema-bounded. Exact numbers
  are provisional plan constants with acceptance hooks AC12, AC17.
- **Lazy skill chunking (C9).** Skills are lazy (FR39): summary metadata (`skills`
  collection) is indexed first; the full body is chunked into `skill_chunks` only within
  bounded, sanitized token windows with fixed overlap, carrying `parent_skill_id`/
  `chunk_id` (FR11). Chunking strips secrets, prompts, reasoning, and paths (FR17).
  Selected chunks are injected only after Agent/role selection under the C8 budget
  (FR38–FR40), spooled via Feature 005 refs (FR40). Chunk size, overlap, and sanitization
  rules are provisional plan constants with acceptance hooks AC12.
- **Query-embedding and metadata caches (C10).** The query embedding is derived once per
  logical Task from the structured profile and cached by task fingerprint/version (FR18),
  reused across the agent and skill passes and — per Feature 009 — across the tool pass
  while valid. A local bounded cache holds last-known index metadata (FR25). Caches
  invalidate by binding version and config hash (FR25); there is no per-token/per-turn
  remote query loop (NFR4). TTLs are provisional plan constants with acceptance hook AC16.
- **Freshness gate with mandatory revalidation (C11).** Freshness/version/confidence gates
  apply (FR27); stale candidates always revalidate against live AgentV2/SkillV2/Permission
  before injection (FR20, FR27) — stale-index safety never relies on freshness alone. A
  freshness bucket and a stale-confidence threshold gate whether semantic scores
  contribute or the result degrades to C20. Thresholds and bucket edges are provisional
  plan constants with acceptance hooks AC4, AC5.
- **Blue/green cutover and in-flight retention (C12).** Embedding binding/dimension
  changes use blue/green collection generations under one binding generation and an
  operator-confirmed atomic alias swap via `semantic.embedding.cutover` (FR12, FR32);
  `select` and `reindex` alone never activate the live alias, and
  `semantic.embedding.rollback` reverses under policy. Cutover swaps the aliases of all
  collections in the binding generation together under one CAS so the `tools` collection
  (Feature 009) never splits from `agents`/`skills`/`skill_chunks`. In-flight Tasks retain
  the binding versions captured at Task start; new Tasks use the post-cutover versions;
  there is no mid-task switch (FR32). Alias grammar, the dual-write window, and the
  in-flight retention horizon are provisional plan constants with acceptance hooks AC9,
  AC31, AC32, AC33, AC41.
- **No feedback loop in V1 (C13).** The default is strict two-pass Agent-then-Skill
  retrieval (FR21). An optional skill-coverage feedback loop is deferred beyond V1; V1
  adds no online self-optimizing loop. Acceptance hooks AC2, AC3.
- **Cold-start degrades, never force-configures (C14).** When the index is empty/cold or
  no binding is pinned, the semantic path is inactive and routing uses the deterministic
  catalog + lexical/rules fallback with binding state `unavailable` and an explicit
  degraded reason (FR24) — the default is degrade, not force-configure; existing
  AgentV2/SkillV2 remain authoritative. An operator may opt into fail-closed (FR24). This
  mirrors the Feature 009 "no binding, no crash" floor. Acceptance hooks AC7, AC8, AC18,
  AC29.
- **Reserved operator surface and confirmation matrix (C15).** All setup/config/management
  flows exclusively through the Feature 007 reserved `semantic.*` catalog in
  `packages/core/src/operator/catalog.ts`, version read live from
  `RESERVED_CATALOG_VERSION = "1.3.0"`. The reserved semantic IDs at this version are
  exactly the 30 entries: `semantic.provider.list|add|update|test|disable|delete|
  rotate-secret`; `semantic.model.list|discover|register|validate|disable`;
  `semantic.embedding.show|select|validate|reindex|cutover|rollback`;
  `semantic.reranker.show|select|validate|cutover|rollback`;
  `semantic.binding.status|history`; `semantic.index.status|test|reindex|reconcile|
  show-collections`. Binding mutation happens only via `embedding.select`/`cutover` and
  `reranker.select`/`cutover` (the `semantic.binding.*` pair is read-only status/history);
  `semantic.index.*` operate per collection, so no new IDs are needed. Default scope for
  provider/model/binding mutations is `project`; status/show/list are global-or-project.
  `cutover`, `rollback`, `delete`/`disable`-when-bound, and `rotate-secret` always require
  interactive confirmation. Adding IDs requires an additive catalog bump, never a second
  SDK list; plugin/MCP/custom registries never register these reserved IDs. **No catalog
  bump is required for Feature 006.** Acceptance hooks AC14, AC28, AC37, AC39.
- **Rerank profiles and manual-declaration trust (C16).** Profile A is a native
  `/v1/rerank`-compatible request/response adapter contract; Profile B is a structured
  chat/completions reranker with deterministic schema, fixed temperature, tool-free
  behavior, and explicit token/cost budget; Profile C (embedding-similarity) is a distinct
  capability, never badged cross-encoder/reranker and never eligible for the reranker slot
  (FR30). A manually registered model is untrusted until native probe/eval passes — there
  is no trust window; it cannot be selected before validation (FR30, AC22). The
  `/v1/rerank` schemas, the chat-rerank prompt/schema/temperature contract, probe
  fixtures, and pass thresholds are provisional plan constants with acceptance hooks AC22,
  AC24, AC25, AC26, AC34.
- **SSRF-safe URLs and DNS revalidation (C17).** SSRF-safe URL parsing, scheme/host/port
  policy, and post-resolution + post-redirect DNS revalidation are mandatory (FR33).
  Metadata, link-local, and private ranges are blocked unless an explicit local-profile
  allowance is set; remote endpoints require TLS by default; insecure HTTP is permitted
  only for an explicit local profile with a visible warning. The denylist CIDRs and
  allowed localhost/LAN ranges are provisional plan constants with acceptance hooks AC36,
  AC38.
- **Offline evaluation with zero leakage tolerance (C18).** Offline golden evaluation
  covers task→agent/skill relevance, recall/ranking metrics, multilingual pt/es/en tests,
  permission-leakage tests, and drift/model-migration checks (FR43); online self-optimizing
  policy is out of scope for V1. Evaluation never mutates bindings (FR43, AC40). Recall@k,
  ranking (nDCG/MRR), and zero-leakage acceptance thresholds are provisional plan constants
  with acceptance hooks AC40; leakage tolerance is fixed at zero cross-project/
  over-permission hits (AC4, AC6, AC11).
- **Secret backend (C19).** All provider secrets and Milvus URI/token credentials are
  stored only as secret refs through the Feature 007 secret backend: OS keychain is
  mandatory for stored secrets, env-ref is allowed for CI only (reference, not value), and
  vault/multi-user are deferred beyond V1. Plaintext secrets are forbidden in args,
  history, output, config JSON, and audit (FR35, Security). `semantic.provider.rotate-secret`
  changes secret_ref/version only, never endpoint/model/binding identity (FR31). Acceptance
  hooks AC20, AC30, AC35.
- **Typed degradation ladder, no silent substitution (C20).** Degradation is an explicit
  typed capability ladder with a stable capability-gap code at each rung, matching the
  Feature 009 ladder: full semantic (hybrid recall + rerank when binding + Milvus healthy)
  → catalog + lexical/rules fallback (embedding, reranker, or Milvus/index
  unavailable/stale/timeout) with binding state `degraded` | `unavailable` and an explicit
  degraded reason. The routing floor for agents/skills is the deterministic catalog +
  lexical/rules path. The system never auto-selects another embedding or reranker model and
  has no automatic fallback pool for these two slots in V1 (FR24, FR31). Fail-closed is
  operator opt-in only. Capability-gap enum values are provisional plan constants with
  acceptance hooks AC7, AC8, AC29.
- **Cross-feature ownership (C21).** Feature 006 owns the single embedding/reranker stack,
  the Milvus backend/adapter, the `SemanticProviderProfile` / `SemanticModelDescriptor` /
  `SemanticModelBinding` SSOT (FR28), and the `agents` / `skills` / `skill_chunks`
  collections. Feature 009 owns only the `tools` collection and the tool-scoped retrieval
  seam and reuses this stack, the pinned bindings, the C20 ladder, the multilingual
  posture, and the content-free telemetry verbatim (ADR-0007). Feature 008 owns the
  optional MCP resource semantic-index opt-in; Feature 006 ownership of the stack is
  unchanged by it. All collections share one embedding binding generation and cut over
  together (C12). Acceptance hooks AC41.
- **Content-free telemetry and bounds (C22).** Spans use stable enum names (FR41); metrics
  are bounded buckets whose labels never include query text, vectors, entity IDs, session
  IDs, or paths (FR42, ADR-0001). Candidate-set memory is bounded by `retrieval_top_k`/
  `rerank_top_k`/chunk budgets (NFR3); the hot path never embeds or searches per
  token/delta (NFR4); circuit breaker and retries are bounded, target the same pinned
  binding only, and never exceed the C8 retrieval budget (FR26). Startup/background index
  jobs run under Feature 002 lifecycle with Feature 005 OutputSpool for large outputs and
  Feature 003 scheduled reconcile using the current pinned binding without changing it
  (FR13). Bucket edges, breaker thresholds, and batch sizes are provisional plan constants
  with acceptance hooks AC13, AC15, AC17.

### V1 decisions accepted with this ADR (Feature 006 clarify package C1–C22)

Declarative clarify resolutions (Session 2026-07-18); full matrices live in Feature 006
`spec.md` Clarifications. Topology constants, numeric limits, model identities, index
internals, and evaluation thresholds this feature defers are provisional plan constants
with named acceptance hooks, never open placeholders:

1. **Deployment mode.** Standalone default; Lite/embedded for dev/test/CI; fakes for unit
   tests; Zilliz Cloud a valid remote endpoint; `milvus_unavailable` typed gap; never a
   hard dependency. Hooks AC7/AC41 (C1).
2. **Immutable pipeline.** Nine stages with a stable rerank→dense→sparse→canonical-id
   tie-break. Hooks AC2/AC3/AC8 (C2).
3. **No hardcoded models.** Operator-pinned `SemanticModelBinding` slots; example models
   only; native probe/eval before eligibility. Hooks AC19–AC24/AC40/AC41 (C3).
4. **Privacy and residency.** Sanitized fields only; local/offline residency profile a
   first-class option, not the default. Hooks AC15/AC19/AC20 (C4).
5. **Transport reuse.** Reuse the OpenAI-compatible client; `/v1/embeddings` probe;
   explicit rerank profile. Hooks AC21/AC24/AC25/AC26 (C5).
6. **Collections and partitioning.** `agents`/`skills`/`skill_chunks` separate; scalar
   project partition key; mandatory filters; bounded-staleness consistency. Hooks
   AC5/AC6/AC41 (C6).
7. **Index and hybrid recall.** HNSW + cosine/IP on normalized vectors; Milvus-native
   sparse/BM25 fused deterministically. Hooks AC1/AC17 (C7).
8. **Retrieval windows.** `retrieval_top_k` 64 / `rerank_top_k` 16 / `max_skill_chunks` 8
   provisional; consumed from the Feature 001 budget; fail-closed or degrade on excess.
   Hooks AC12/AC17 (C8).
9. **Lazy chunking.** Summary first; bounded sanitized chunks post-selection via Feature
   005 refs. Hook AC12 (C9).
10. **Caches.** Query embedding cached by task fingerprint; last-known metadata cache;
    invalidate by binding version + config hash. Hook AC16 (C10).
11. **Freshness gate.** Gate applies; stale candidates always revalidate against live
    core. Hooks AC4/AC5 (C11).
12. **Blue/green cutover.** Collection generations; atomic CAS `semantic.embedding.cutover`;
    all collections cut over together; in-flight version pinning. Hooks
    AC9/AC31/AC32/AC33/AC41 (C12).
13. **No feedback loop.** Strict two-pass; skill-coverage loop deferred. Hooks AC2/AC3 (C13).
14. **Cold-start degrade.** Empty/no-binding → catalog + lexical/rules with explicit
    reason; degrade, not force-configure; fail-closed opt-in. Hooks AC7/AC8/AC18/AC29 (C14).
15. **Reserved surface.** Exactly 30 `semantic.*` IDs at `RESERVED_CATALOG_VERSION 1.3.0`;
    no catalog change; confirmation matrix on cutover/rollback/delete-when-bound/
    rotate-secret. Hooks AC14/AC28/AC37/AC39 (C15).
16. **Rerank profiles.** A `/v1/rerank`; B structured chat; C embedding-similarity never
    reranker-eligible; manual declarations untrusted until probe/eval. Hooks
    AC22/AC24/AC25/AC26/AC34 (C16).
17. **SSRF safety.** SSRF-safe URLs; post-resolution and post-redirect DNS revalidation;
    TLS default. Hooks AC36/AC38 (C17).
18. **Offline eval.** Golden harness; zero cross-project/over-permission leakage;
    evaluation never mutates bindings. Hook AC40 (C18).
19. **Secret backend.** SecretRef only; OS keychain mandatory; env-ref CI-only;
    rotate-secret keeps identity. Hooks AC20/AC30/AC35 (C19).
20. **Degradation ladder.** Full → catalog + lexical/rules; typed gap codes; never
    auto-substitute a model; no fallback pool. Hooks AC7/AC8/AC29 (C20).
21. **Ownership.** 006 owns the stack + `agents`/`skills`/`skill_chunks`; 009 owns `tools`;
    008 owns MCP-resource opt-in; one binding generation. Hook AC41 (C21).
22. **Content-free telemetry.** Stable enum spans; bounded labels with no content;
    bounded memory; breaker on the same binding. Hooks AC13/AC15/AC17 (C22).

This ADR is **proposed**; it is the required decision record that unblocks Feature 006
`plan`/`tasks`. ADR-0001, ADR-0002, and ADR-0003 are accepted; ADR-0004, ADR-0005,
ADR-0006, and ADR-0007 are proposed.

### Consequences

#### Positive

- One derived projection, one embedding/reranker stack, one Milvus adapter, one operator
  surface (the reused `semantic.*` catalog, no new IDs), and one degradation ladder shared
  with Feature 009; no second registry, permission system, model-selection surface, or
  command bus.
- Routing availability never depends on Milvus, the embedding provider, or the reranker: a
  down/cold/stale/timeout backend degrades to catalog + lexical/rules with an explicit
  typed reason and never hard-fails.
- Effective models are operator-pinned and auditable; no LLM, router, agent, plugin, or
  MCP selects or silently substitutes a binding, and rerank capability is never inferred
  from a model name.
- Project isolation and stale-index safety are structural: a scalar project partition key
  with mandatory filters plus post-retrieval revalidation yield zero cross-project or
  over-permission hits.
- Telemetry and audit are content-free per ADR-0001; management flows through the reserved
  catalog and closes LLM/plugin/MCP/prompt administration paths.

#### Trade-offs

- Topology constants, index parameters, `top_k`/latency budgets, chunk sizes, cache TTLs,
  cutover alias grammar, denylist CIDRs, and evaluation thresholds remain provisional plan
  constants with named acceptance hooks, fixed in the tasks phase.
- The recommended multilingual embedding/reranker models are examples only; an operator
  must register, probe, and evaluate a binding before semantic retrieval activates, so a
  fresh install runs in catalog + lexical/rules fallback until then.
- The TypeScript/Bun ecosystem has no Milvus Lite equivalent: dev/test integration uses a
  standalone Milvus server (container) and unit tests use injected fakes, and the
  `@zilliz/milvus2-sdk-node` gRPC driver's Bun runtime behavior must be validated in the
  plan/tasks phase (`research.md`).
- Feature 009 tool search is coupled to this stack's delivery, pinned bindings, and health.

#### Follow-ups

- Feature 006 `plan`/`tasks` implement the schema/protocol semantic modules, the
  framework-free domain retrieval engine, the Milvus/embedding/rerank adapters over the
  OpenAI-compatible transport, the Feature 007 `semantic.*` operator wiring (no catalog
  bump), the CLI/TUI surfaces, and the offline golden eval harness.
- The Milvus driver/pool sizing, HNSW/BM25 parameters, score-fusion weights, `top_k`
  budgets, chunk/cache constants, cutover alias grammar, SSRF denylist, and eval thresholds
  require plan-phase contracts with named acceptance hooks.
- The `@zilliz/milvus2-sdk-node` gRPC-under-Bun validation and the standalone-server
  integration harness are prerequisites for the Phase 3 adapter and Phase 5 tests.

## Related

- Feature specification: [006 Semantic Agent and Skill Retrieval (Milvus)](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- Feature research: [006 research](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/research.md)
- Feature plan: [006 plan](../sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/plan.md)
- Routing/ranking authority: [001 Smart Agent Routing and Telemetry](../sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- Lifecycle dependency: [002 Task Lifecycle Event Bus and Process Table](../sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- Scheduled-reconcile dependency: [003 Scheduled Jobs and Async Main-Context Notification](../sdd/003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- Language provenance: [004 Lang Lock](../sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- Content plane: [005 OutputSpool and ArtifactStore](../sdd/005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- Management foundation: [007 Unified Native Operator Control Plane](../sdd/007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- Tool-search consumer: [009 Semantic Tool Search](../sdd/009-add-semantic-embedding-and-reranker-retrieval-to-all-tool/spec.md)
- MCP-resource opt-in consumer: [008 Complete MCP Client Tools and Resources Lifecycle](../sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md)
- Related ADR: [0001 — OpenTelemetry telemetry foundation](0001-opentelemetry-telemetry-foundation.md)
- Related ADR: [0002 — Core Smart Agent Routing](0002-core-smart-agent-routing.md)
- Related ADR: [0003 — Operator Control Plane and native command authority](0003-operator-control-plane-and-native-command-authority.md)
- Related ADR: [0004 — Scheduled Job Runtime and Async Notification Channel](0004-scheduled-job-runtime-and-async-notification-channel.md)
- Related ADR: [0005 — Lang Lock Artifact-Language Policy and Progressive Enforcement](0005-lang-lock-artifact-language-policy-and-progressive-enforcement.md)
- Related ADR: [0006 — OutputSpool Content Plane and Paged ArtifactStore](0006-output-spool-content-plane-and-paged-artifact-store.md)
- Related ADR: [0007 — Semantic Tool Search Over the Shared Feature 006 Retrieval Stack](0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md)
</content>
</invoke>
