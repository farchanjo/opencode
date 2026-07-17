---
id: 019f6f2f-d92f-7fa3-9a55-fc4b308a984d
number: 006
slug: add-milvus-backed-multilingual-semantic-retrieval-and
status: specified
created_at: 2026-07-17T08:27:14.607608Z
---

# Feature Specification: Semantic Agent and Skill Retrieval (Milvus)

Feature: 006-add-milvus-backed-multilingual-semantic-retrieval-and
Created: 2026-07-17

## Scope and intent

Feature 006 adds **Milvus-backed multilingual semantic retrieval and reranking** for
canonical OpenCode agents and skills. It improves candidate discovery for Feature 001
Smart Agent Routing without becoming a second registry, permission authority, or
route decider.

**Sources of truth remain:** AgentV2.Service, Catalog/ModelsDev, SkillV2,
Permission/Policy, and Config. **Milvus is a derived projection/index only.** It MUST
NOT grant availability, permissions, or final route selection.

**Reranker** improves semantic relevance among an already-filtered small candidate set.
It MUST NEVER choose the final route or override hard gates, admission, or policy.

Model IDs mentioned in product discussion are **examples only**. Role pools remain
user-configurable via Feature 001 / Feature 007 `pools.*`. **Embedding and reranker
models are not free-form runtime choices:** the operator registers OpenAI-compatible
(or explicit-profile) endpoints/models in the native panel and pins exactly one
embedding and one reranker binding via Feature 007. Architect, Manager, Worker, LLM,
router, plugin, and MCP MUST NOT select, swap, or silently substitute those bindings.

### Audit vs Feature 001 (no duplication)

| Owned by Feature 001 / ADR-0002                              | Owned by Feature 006                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Hierarchy Architect/Manager/Worker, hard gates, route record | Semantic index + hybrid recall + rerank                                        |
| Admission-bounded fanout, validation chain                   | Query embedding cache, two-pass agent→skill retrieval                          |
| Context/Turn/Delegation Budget policy (this change set)      | Applying retrieval_top_k / rerank_top_k / skill chunk budgets from that policy |
| Telemetry foundation, decision record                        | Semantic spans/metrics (content-free); route record captures binding versions  |
| Role pools, catalogs as authority                            | Milvus projection of catalog/skill documents                                   |
| Feature 007 Phase 1 management authority                     | Domain contracts for profiles, descriptors, fixed embedding/reranker bindings  |

## User Stories

### P1 — Better agent/skill fit without losing authority

- As an Architect, I want semantic retrieval over agents so that direct Worker or
  Manager selection uses relevance among hard-gate-eligible candidates only.
- As a Manager, I want semantic retrieval for Workers and skills constrained by role
  and permissions so that fanout units match domains without inventing agents.
- As a Worker, I want only selected skill chunks injected so that I execute without
  creating agents/children or loading the full skill corpus.

### P1 — Multilingual query, Lang Lock artifacts

- As a user querying in pt-BR/es/en, I want English Lang Lock skills/agents to match
  via multilingual embedding/rerank without a mandatory translation LLM call.

### P1 — Resilience and safety

- As an operator, I want routing to continue with catalog+lexical/rules fallback when
  Milvus, embedding, or reranker is down/stale/timeout, with an explicit degraded reason.
- As a security reviewer, I want project/tenant isolation, no cross-project hits, no
  secrets/prompts/reasoning in the index, and operator-only index admin.

### P1 — Fixed embedding/reranker bindings (operator panel)

- As an operator, I want to register local OpenAI-compatible endpoints (with optional
  API key/secret ref), discover or manually register models, and select one embedding
  model and one reranker model so that bindings are explicit and auditable.
- As an operator, I want pinned bindings to survive restart/session/job and to refuse
  silent model substitution when a provider is down so that retrieval degrades
  predictably instead of swapping models.
- As a security reviewer, I want SSRF-safe URLs, TLS defaults, secret refs only, and
  zero LLM/plugin authority over profiles or bindings.

### P2 — Index lifecycle and evaluation

- As a maintainer, I want content-hash incremental upsert, tombstones, scheduled
  reconciliation (Feature 003), and blue/green migration for embedding binding/model
  changes under operator-controlled alias cutover.
- As a maintainer, I want offline golden evaluation and permission-leakage tests
  without online self-optimizing policy.

## Functional Requirements

### Authority and pipeline

1. AgentV2.Service, Catalog/ModelsDev, SkillV2, Permission/Policy, and Config MUST
   remain sources of truth for identity, availability, permissions, and config.
2. Milvus MUST be a **derived projection/index** only. It MUST NOT be a parallel
   registry, availability authority, or permission authority.
3. The retrieval pipeline MUST be, in order:
   1. structured task profile
   2. hard filters / scalar predicates
   3. hybrid dense + sparse/lexical recall
   4. small candidate set
   5. reranker
   6. deterministic routing score / Feature 001 policy
   7. selected Agent
   8. constrained Skill retrieval/rerank
   9. final permission/capability validation against live core state
4. Reranker MUST improve semantic relevance only. It MUST NOT select the final route
   or bypass hard gates, admission, Permission/Policy, or Feature 001 ranking authority.
5. Architect MUST use retrieval for direct Worker or Manager candidate support.
   Manager MUST use retrieval for Workers/skills. Worker MUST NOT create agents or
   children and MUST receive only selected skills/chunks. Architect/Manager/Worker
   MUST NOT select or change embedding/reranker bindings; they only consume the
   currently pinned operator bindings for retrieval.
6. Role pools remain user-configurable via Feature 001 / Feature 007 `pools.*`.
   Embedding and reranker **slots** MUST be operator-pinned Feature 007 bindings
   (`SemanticModelBinding`), not free-form model IDs chosen by LLM, router, agent,
   plugin, or MCP. Product docs MAY cite model names only as examples.

### Milvus backend and adapter

7. When semantic retrieval is enabled, Milvus MUST be the **default/preferred
   configurable backend**, behind a native adapter/port for testability
   (fake/in-memory adapters allowed in tests). Routing MUST remain available without
   Milvus via deterministic catalog + lexical/rules fallback (FR24). Milvus remains a
   first-class product backend and user-configurable connection/index surface; it is
   not a hard runtime dependency for Smart Agent Routing.
8. Connection settings (endpoint, TLS, auth, database, collection prefix, timeouts)
   MUST be secure and native-operator-only (Settings/CLI/palette). LLM, tools, MCP,
   and custom commands MUST NOT administer Milvus or index config.
9. Conceptual collections MUST be separate: `agents`, `skills`, `skill_chunks`. The
   system MUST avoid per-project collection explosion. Tenant/project/scope/visibility/
   role MUST be scalar metadata with **mandatory filters** on every search.
10. Agent documents MUST include: canonical ID/version/hash, role/mode, description,
    domains, capabilities/tools, permission profile/ref, scope/project, language tags,
    source, enabled/available metadata. Volatile health/cost MUST NOT be embedded as
    authority fields in the vector document.
11. Skill documents/chunks MUST include: canonical skill ID/version/hash/source, name,
    description, triggers, domains, capabilities, compatible roles/agents, permissions,
    token/context cost estimate, language, parent_skill_id/chunk_id. Full body chunking
    MUST be bounded and sanitized.
12. Embedding binding version, model ID, dimension, normalization, and distance metric
    MUST be stored with the collection. Incompatible vectors MUST NEVER be mixed in one
    search space. Embedding binding/model/dimension changes MUST use blue/green
    collection generation and the explicit native `semantic.embedding.cutover` (FR32)
    with CAS/confirmation and rollback — never implicit activation on select or reindex
    alone.
13. Index updates MUST be content-hash incremental upsert, tombstone/removal, and
    idempotent event-driven where possible. Scheduled reconciliation MUST use Feature
    003 natively (no LLM by default) and MUST use the **current pinned** embedding
    binding without changing it. Startup/background index jobs MUST use Feature 002
    lifecycle and Feature 005 OutputSpool for large job outputs.

### Multilingual and Lang Lock

14. Queries MAY be pt-BR, es, or en while artifacts/skills follow Feature 004 Lang
    Lock (default en-US). Embedding and reranker MUST support these initial locales
    multilingually.
15. The system MUST preserve the original query text for embedding. A mandatory
    translation LLM call MUST NOT be required for retrieval.
16. BCP 47 metadata and confidence MUST be capturable; UI labels remain human-facing.
    Effective Feature 004 tag MUST be recorded on the route/retrieval decision without
    content.
17. Index MUST NOT store secrets, full prompts, reasoning, private payloads, or
    filesystem paths. Only sanitized summaries and explicit source boundaries.

### Retrieval and reranking behavior

18. Query embedding MUST be derived once per logical Task from the structured profile,
    cached by task fingerprint/version, and reused for agent and skill retrieval while
    valid.
19. Hybrid recall MUST use configurable `retrieval_top_k`. Rerank MUST run only on the
    reduced set (`rerank_top_k`). Ties MUST break deterministically.
20. Filters MUST apply before retrieval (Milvus scalar predicates) and candidates MUST
    be **revalidated after retrieval** against current AgentV2/SkillV2/Permission core
    state (stale index safety).
21. Default is **two-pass**: Agent retrieval, then Skill retrieval constrained by the
    chosen Agent/role/permissions. Optional skill-coverage feedback loop remains
    clarification.
22. Exposed scores MUST include provenance/components/confidence without chain-of-
    thought. Semantic score MUST remain separate from Feature 001 quality/telemetry
    score inputs.
23. Final ranking MUST combine semantic fit with structured domain/capability/skill
    coverage and Feature 001 quality metrics (TTFT, tokens/s, cost, health, failure)
    under hard gates. Embeddings MUST NOT encode volatile health/cost as authority.

### Resilience

24. **V1 default degradation.** When semantic binding is unavailable, no binding is
    pinned, Milvus/index is unavailable, or embedding/reranker is down/stale/timeout,
    routing MUST use deterministic catalog + lexical/rules fallback with an explicit
    degraded reason, **unless** the operator has explicitly configured fail-closed for
    semantic retrieval. Binding state MUST be `degraded` or `unavailable` as
    applicable. The system MUST NEVER automatically select another embedding or
    reranker model (no silent substitution; no automatic fallback pool for these two
    slots in V1).
25. A local bounded cache and last-known index metadata MUST be used. There MUST be
    no remote backend query loop per token/turn. Caches MUST invalidate by binding
    version and config hash.
26. Circuit breaker and retries MUST be bounded and MUST NOT block the hot path beyond
    the configured retrieval budget. Retries MUST target the same pinned binding only.
27. Index freshness/version/confidence gates MUST apply. Stale candidates MUST always
    revalidate against core.

### Semantic provider profiles, models, and fixed bindings

28. **Single source of truth (SSOT).** Feature 006 owns the field definitions of
    `SemanticProviderProfile`, `SemanticModelDescriptor`, and `SemanticModelBinding`.
    Feature 007 references these schemas and exposes operator commands; it MUST NOT
    redefine or diverge field sets. Records MUST NOT embed secrets on descriptors or
    bindings:
    - **`SemanticProviderProfile`:** id, version, name, base_url, compatibility profile,
      transport/TLS policy, optional secret_ref, header refs, local/remote/data policy,
      enabled, created/updated/audit metadata.
    - **`SemanticModelDescriptor`:** canonical model ref, provider profile ref, display
      name, source (`discovered` | `manual` | `core-catalog`), capability kinds,
      endpoint mode, dimensions/limits when known, language support/eval status,
      validation provenance/time/version, enabled.
    - **`SemanticModelBinding`:** slot (`embedding` | `reranker`), immutable binding
      version, provider/model refs, compatibility mode, effective capability contract,
      `selected_by` operator, `selected_at`, config version/hash, index generation/alias
      refs.

29. Settings MUST expose **Semantic Search / Models** (or equivalent native panel)
    wired to Feature 007 commands: list/add/edit/test/disable/delete/rotate-secret of
    provider profiles; base URL and compatibility profile; secret input only through
    secure store/reference (local endpoints MAY use no key); discover via `/v1/models`
    when supported plus manual model registration; inclusion of eligible core
    providers/models only when credential/integration exists and semantic capability is
    validated; capability badges (embedding, reranker, multilingual, dimensions, limits,
    validated/declared/failed/stale); selectors **Embedding model** and **Reranker
    model** showing only eligible enabled validated candidates; current pinned binding
    shown prominently with effective state, origin, version, and degraded status.

30. Compatibility profiles MUST be explicit:
    - **Embedding OpenAI-compatible:** `/v1/embeddings`, native deterministic probe with
      a harmless sample; capture dimension/normalization/limits.
    - **Rerank is NOT OpenAI-standard.** Require an explicit profile:
      - **A)** native `/v1/rerank`-compatible (documented request/response adapter
        contract);
      - **B)** structured chat/completions reranker profile with deterministic
        schema/temperature/tool-free behavior and explicit token/cost budget;
      - **C)** embedding-similarity fallback MUST be labeled a **distinct** capability
        (for example embedding-similarity), MUST NEVER be labeled or badged as
        cross-encoder or reranker, and MUST NOT satisfy a reranker-slot eligibility
        check.
    - Rerank capability MUST NEVER be inferred from `/v1/models` name alone. Manual
      declarations are untrusted until native probe/eval passes.

31. Binding immutability and no silent failover:
    - Model/router/LLM/agent/plugin/MCP MUST NOT set, update, or delete bindings or
      provider profiles.
    - Bindings remain selected across sessions, restarts, resume, and jobs until the
      operator changes them via Feature 007.
    - Unavailable provider/model → binding state `degraded` | `unavailable`; retrieval
      follows FR24 V1 default degradation; never auto-selects another semantic model.
    - No automatic fallback pool for embedding/reranker slots in V1.
    - Runtime MUST NOT mutate bindings based on telemetry.
    - Secret rotation MUST use Feature 007 `semantic.provider.rotate-secret`, updating
      only secret_ref/version without changing endpoint, model, or binding identity;
      rotation is audited and redacted.
    - Endpoint/model/compatibility/dimension changes create a new profile and/or
      binding version (not a secret rotation).
    - Delete/disable of a bound model requires confirmation and explicit
      replacement/disable policy; MUST NOT orphan silently.

32. Binding change semantics (select, reindex, and cutover are distinct):
    - **Embedding:** native `validate` first; `select` stages a candidate binding
      version without activating index alias; dimension/vector-space change requires
      full blue-green reindex into a new Milvus collection generation via
      `semantic.embedding.reindex`; old alias remains active until the new index is
      validated; **`semantic.embedding.cutover`** is the explicit native operation that
      atomically switches the live alias under CAS and operator confirmation;
      `semantic.embedding.rollback` reverses cutover when policy allows; no mixing
      vectors/models/dimensions; caches invalidated by binding/version.
    - **Reranker:** no re-embedding by default; invalidate rerank cache/evaluation
      version; run multilingual/golden validation; **`semantic.reranker.cutover`**
      activates the new binding version under CAS and explicit operator confirmation;
      `semantic.reranker.rollback` reverses when policy allows; in-flight Tasks keep
      the binding versions captured at Task start; new Tasks use the new version after
      cutover; no mid-task switch.

33. Network/SSRF and DNS rebinding (MUST): SSRF-safe URL parsing; scheme/host/port
    policy; localhost/LAN only with explicit operator allowance. Each connection and
    redirect MUST resolve DNS and re-validate the resolved address against policy
    before connect; metadata, link-local, and private ranges MUST be blocked unless an
    explicit local profile allowance is set; revalidation MUST run post-resolution and
    after redirects (DNS rebinding defense). Remote endpoints require TLS by default;
    insecure HTTP only for an explicit local profile with a visible warning.
    Management connection/probe paths are native and zero-LLM for ordinary setup.
    Structured-chat rerank **runtime** MAY invoke the pinned binding via fixed native
    schema; management/test/selection remain native, audited, and cost-disclosed for
    explicit validate/test only.

### Security

**Normative transversal rule (Feature 007 Operator Control Plane).** All setup,
configuration, and management for semantic index, provider profiles, model
descriptors, and embedding/reranker bindings MUST use
[Feature 007](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
unified Operator Control Plane and native Settings/menu/palette/native-slash/CLI/App/
Desktop adapters calling typed core domain commands/queries directly. MUST NOT use
Config.command/custom templates, `session.command` prompt path, ToolRegistry, MCP
tools/prompts, plugins, skills, shell commands issued by an LLM, or free-form model
instructions as management authority. Native slash is intercepted before prompt
admission/transcript; ordinary status/show/select/config MUST NOT invoke a model;
explicit validate/test may call the candidate endpoint via fixed native probe only
(no conversation/transcript/tools) with cost/data disclosure. Mutations require
operator principal, explicit scope, version/CAS, idempotency, and audit; secret refs
only. Canonical semantic IDs are the complete Feature 007 catalog
(`semantic.provider.*`, `semantic.model.*`, `semantic.embedding.*`,
`semantic.reranker.*`, `semantic.binding.*`, `semantic.index.*`). Reindex/reconcile/
probe create native lifecycle jobs (Features 002/003), not LLM turns.
Plugin/MCP/custom registries MUST NOT register reserved operator IDs.

34. Project/tenant/scope authorization MUST run before search and after rerank. Cross-
    project results MUST NOT be returned.
35. Credentials and auth headers MUST use secure refs. Native Settings/CLI/palette
    commands for profiles, models, bindings, status, test, reindex, cutover, show
    collections, validate, and rotate-secret MUST be Feature 007 operator-only and
    never LLM/tool/MCP admin surfaces. Secrets MUST never appear in plaintext config
    JSON, history, or command output.
36. Plugin/custom skill sources MUST retain visibility/permission metadata. Malicious
    descriptions MUST NOT alter router policy or hard gates. Plugins MUST NOT register
    reserved Feature 007 semantic operator IDs or change bindings.
37. Embedding providers MAY receive only sanitized index/query fields under privacy
    policy. Local/offline embedding and data residency remain clarification.

### Context budget integration (Feature 001 policy)

38. Feature 006 MUST consume Feature 001 **Context, Turn and Delegation Budget** fields
    for `retrieval_top_k`, `rerank_top_k`, `max_skill_chunks`, and skill token budgets.
    Exceeding those budgets MUST fail closed or degrade with explicit reason — never
    silent unbounded recall.
39. Skills MUST be lazy: summary metadata first; full selected chunks only after
    selection under budget.
40. OutputSpool (Feature 005) refs and offset/limit MUST prevent duplicating full
    skill/agent bodies into context.

### Observability and evaluation

41. Spans MUST include: `semantic.profile`, `embed.query`, `retrieve.agents`,
    `rerank.agents`, `retrieve.skills`, `rerank.skills`, `semantic.fallback`,
    `index.upsert`, `index.reconcile` (names illustrative; stable enums required).
42. Metrics MUST be bounded: latency buckets, candidates before/after, cache hit,
    fallback/stale counts, rerank delta buckets, selected semantic rank buckets, index
    freshness buckets, failures. Labels MUST NOT include query text, vectors, entity
    IDs, session IDs, or paths (ADR-0001).
43. Offline evaluation MUST support golden task→agent/skill relevance, recall/ranking
    metrics, multilingual tests, permission leakage tests, and drift/model migration
    checks. Online self-optimizing policy is out of scope for V1.

## Non-Functional Requirements

1. Retrieval latency MUST respect configured budget; timeout triggers fallback.
2. Index upsert/reconcile MUST be idempotent and safe under concurrent catalog changes.
3. Memory for candidate sets MUST be bounded by top_k and chunk budgets.
4. Hot path MUST NOT embed or search per token/delta.
5. Compatibility with V1/V2 routing seams without a second router.

## Acceptance Scenarios

1. **Multilingual pt query / English skills.** Given a pt-BR task profile and en-US
   Lang Lock skills, when retrieval runs, then relevant English skills appear among
   candidates without a translation LLM call.
2. **Direct Worker path.** Given a small task, when Architect classifies direct Worker,
   then agent retrieval yields hard-gate-eligible Workers and skill retrieval is
   constrained to the selected Worker.
3. **Manager workers.** Given a complex task, when Manager decomposes, then each work
   unit retrieves Workers/skills under role/permission filters and admission budgets.
4. **Permission filtering.** Given a skill outside the agent's permission profile,
   when retrieval returns it from a stale index, then post-retrieval revalidation
   drops it before injection.
5. **Stale index revalidation.** Given an agent disabled in AgentV2 but still in
   Milvus, when search returns it, then revalidation rejects it.
6. **Cross-project isolation.** Given two projects, when project A searches, then no
   project B document is returned.
7. **Milvus down fallback.** Given Milvus unavailable and default V1 policy, when
   routing runs, then catalog+lexical/rules fallback succeeds with degraded reason and
   no hard failure of routing availability; fail-closed only if operator configured it.
8. **Reranker down.** Given reranker timeout and default V1 policy, when recall
   completed, then deterministic ranking proceeds without rerank scores and records
   degraded reason without selecting another reranker model.
9. **Embedding model migration.** Given dimension change, when blue/green alias
   swaps, then searches use only compatible vectors.
10. **Skill changed/deleted.** Given content-hash change or delete, when reconcile
    runs, then upsert/tombstone reflects core state.
11. **Malicious skill.** Given a skill description claiming elevated permissions, when
    ranking runs, then Permission/Policy and hard gates ignore the claim.
12. **Context cost.** Given skill token estimates, when max_skill_chunks/tokens budget
    is reached, then further chunks are not injected.
13. **Scheduled reconciliation.** Given Feature 003 schedule, when it fires, then
    index reconcile runs natively without LLM and coalesces triggers.
14. **Native command no LLM.** Given operator reindex/status command, when executed,
    then no model tool/MCP path is used.
15. **Telemetry no content.** Given retrieval spans/metrics, when exported, then no
    query text, vector, or entity/session ID labels appear.
16. **Cache reuse.** Given the same task fingerprint, when agent then skill retrieval
    run, then query embedding is reused from cache.
17. **top_k budgets.** Given retrieval_top_k and rerank_top_k, when recall runs, then
    candidate counts never exceed configured caps.
18. **No matching candidate.** Given all candidates fail gates or empty recall, when
    routing decides, then no-candidate path applies without inventing an agent.
19. **Local no-key embedding register.** Given a local OpenAI-compatible embedding
    endpoint without API key, when the operator adds the profile, discovers/validates,
    and selects embedding, then the binding pins that model with no secret stored.
20. **Local key endpoint secure ref.** Given a local endpoint with API key, when the
    operator saves credentials, then only a secure secret_ref is stored; key never
    appears in history, output, or config JSON.
21. **Core catalog model with credential.** Given an existing core model with
    available credential and validated semantic capability, when listed in the panel,
    then it is eligible for embedding or reranker selection as applicable.
22. **Manual registration needs validation.** Given a manually registered model ID,
    when not yet probe/eval-validated, then it cannot be selected until validation
    passes.
23. **Wrong embedding dimension/probe failure.** Given probe failure or incompatible
    dimension, when eligibility is computed, then the model is excluded from the
    embedding selector.
24. **Rerank name alone insufficient.** Given `/v1/models` listing a model whose name
    suggests rerank, when no explicit rerank profile and probe pass, then it is not
    eligible as reranker.
25. **Native `/v1/rerank` profile.** Given profile A and successful probe, when the
    operator selects that reranker, then the binding records the adapter contract and
    version.
26. **Structured chat reranker explicit.** Given profile B, when selected, then
    deterministic schema/temperature/tool-free constraints and cost disclosure are
    recorded; management path remains native-audited.
27. **Restart preserves bindings.** Given pinned embedding and reranker bindings, when
    process restarts, then the same binding versions remain effective.
28. **LLM/prompt/plugin cannot alter.** Given a prompt, plugin, MCP, or ToolRegistry
    attempt to change embedding/reranker, when processed, then config/bindings are
    unchanged.
29. **Outage no silent substitution.** Given the pinned embedding or reranker
    unavailable, when retrieval runs, then binding state is degraded/unavailable and
    lexical/catalog fallback or explicit failure applies without selecting another
    semantic model.
30. **Secret rotation same identity.** Given secret_ref rotation for the same endpoint
    and model, when rotated, then SemanticModelBinding identity/version for model
    selection is unchanged.
31. **Embedding switch blue-green.** Given operator runs validate/select/reindex then
    explicit `semantic.embedding.cutover` after dimension change, when cutover
    succeeds under CAS/confirmation, then new searches use the new collection
    generation and `rollback` remains available; vectors are never mixed; select or
    reindex alone MUST NOT activate the live alias.
32. **Reranker switch no re-embed.** Given operator runs validate/select then explicit
    `semantic.reranker.cutover`, when confirmed under CAS, then no full re-embedding
    runs by default; rerank cache/eval version invalidates; new binding activates only
    after cutover.
33. **In-flight version pinned.** Given an in-flight Task that captured binding
    versions at start, when the operator cutovers to new versions, then the in-flight
    Task retains the captured versions and new Tasks use the post-cutover versions.
34. **Profile C distinct label.** Given an embedding-similarity (profile C) candidate,
    when capability badges and eligibility are shown, then it is labeled
    embedding-similarity (or equivalent), NEVER cross-encoder or reranker, and is not
    eligible for the reranker slot.
35. **Rotate-secret identity stable.** Given `semantic.provider.rotate-secret` for a
    pinned model endpoint, when completed, then secret_ref/version changes, binding
    endpoint/model identity is unchanged, and audit is redacted.
36. **DNS rebinding blocked.** Given a hostname that resolves to a blocked
    metadata/link-local/private address without local-profile allowance, when
    provider test/connect runs, then the connection is rejected after post-resolution
    validation.
37. **Delete bound model confirmation.** Given a model currently bound, when the
    operator disables/deletes it, then confirmation and explicit replacement/disable
    policy are required; silent orphan is forbidden.
38. **SSRF/TLS policy.** Given a remote non-TLS URL or blocked metadata/link-local
    target, when profile add/test runs, then it is rejected or requires explicit local
    insecure allowance with warning.
39. **Surface parity zero admin tokens.** Given the same binding select/validate
    command from Settings, palette, slash, or CLI, when executed, then the same
    effective binding/version/audit result occurs with zero admin transcript injection
    and zero management-path LLM tokens.
40. **Multilingual pt/es/en eval.** Given pinned multilingual embedding/reranker, when
    offline golden eval runs for pt/es/en, then results are recorded without changing
    bindings.
41. **Milvus metadata/version consistency.** Given pinned embedding binding version B,
    when collections are inspected, then stored model/dimension/binding version match B
    and index jobs capture B.

## Security Requirements

- **Data sensitivity.** Index holds sanitized agent/skill metadata and chunks —
  sensitive configuration surface; treat as private project data.
- **Authentication/authorization.** Search and admin require project/tenant scope;
  operator-only for Milvus admin; revalidation against Permission/Policy.
- **Input validation.** Queries, filters, top_k, and collection names are schema-
  bounded; no arbitrary collection scan.
- **Cryptography.** TLS to Milvus when configured; credential refs not in transcripts.
- **Logging/audit.** Content-free; no query text/vectors in logs/metrics.
- **Error exposure.** Stable degraded codes without leaking endpoints/credentials.

## Privacy Requirements

1. Embedding providers receive only sanitized fields under explicit policy.
2. No indexing of user prompts, reasoning, secrets, or private file paths.
3. Local/offline embedding option remains clarification for residency.

## Observability

Integrate ADR-0001 / Feature 001. Semantic spans and metrics as FR41–FR42. Process
Table (Feature 002) MAY show retrieval job lifecycle and degraded flags without raw
queries. Feature 005 spool may hold index job logs as refs only.

## Compatibility and Migration

- Phased enablement behind config; default fallback path must work without Milvus.
- Existing AgentV2/SkillV2 remain authoritative during empty/cold index.
- Blue/green for embedding model/dimension changes.
- Feature 001 ranking consumes semantic scores as inputs, not as authority.
- Feature 003 schedules reconcile; Feature 004 language metadata; Feature 005 spool
  for job outputs and context slices.

## Out of Scope

- Milvus as registry or permission/availability authority.
- Embedding secrets, full prompts, reasoning, or private payloads.
- LLM as final routing policy or hard-gate override.
- LLM/router/agent/plugin/MCP selection or silent substitution of embedding/reranker
  bindings.
- Automatic fallback pool for embedding/reranker slots in V1.
- Online auto-training or self-optimizing retrieval policy in V1.
- Unbounded candidates, chunks, or per-project collection explosion.
- Mandatory remote dependency (routing must work degraded without Milvus).
- Cross-project retrieval.
- Hardcoding embedding/reranker/model product IDs as sole options.
- Inferring rerank capability from model name alone.

## Clarification Questions

1. Exact Milvus topology, collection/index types, and consistency level?
2. Default embedding/reranker models, dimensions, and distance metrics (examples only)?
3. Local vs remote embedding and data residency policy for V1?
4. Default retrieval_top_k / rerank_top_k and latency SLA?
5. Sparse/hybrid implementation (BM25-in-Milvus vs external lexical)?
6. Skill chunking strategy (size, overlap, sanitization rules)?
7. Tenant/project scalar model and multi-root behavior?
8. Cache TTL and invalidation for query embeddings and last-known metadata?
9. Index freshness SLA and stale confidence thresholds?
10. Blue/green alias naming, dual-write window, and operator cutover confirmation UX?
11. Offline evaluation acceptance thresholds for recall/ranking/leakage?
12. Skill-coverage feedback loop in or out of V1?
13. Exact surface aliases for Feature 007 `semantic.*` IDs and scopes?
14. Bootstrap/cold-start and failure policy when index empty or no binding pinned?
15. Exact OpenAI-compatible provider adapter reuse from core?
16. Exact `/v1/rerank` request/response schemas for profile A?
17. Chat rerank prompt/schema/temperature/tool-free contract for profile B?
18. Allowed local network policy (localhost/LAN ranges) and SSRF denylist defaults?
19. Model probe fixtures and validation thresholds?
20. Secure secret backend for profile secret_ref?
21. Global vs project scope for profiles/bindings?
22. In-flight Task retention window for old binding versions after cutover?
23. Operator confirmation matrix for select/delete/cutover/rollback?
24. Default when no binding is pinned: disabled semantic path vs force configure?
25. Manual declaration trust window before probe?
26. Batch/dimension limits for embedding probes?

## Related Features and Decisions

- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — hard gates, ranking authority, Context/Turn/Delegation Budget; route record captures binding versions; Architect/Manager do not select embedding/reranker
- [Feature 002 Task Lifecycle Event Bus and Process Table](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md) — reindex/probe job lifecycle; binding version metadata; no secrets
- [Feature 003 Scheduled Jobs](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md) — scheduled reconcile uses current pinned binding; cannot change it
- [Feature 004 Lang Lock](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md) — language metadata, multilingual query vs artifact language; human display labels
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — context slices; large index/probe outputs file-backed
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — sole management authority for profiles/models/bindings; `semantic.*` command IDs
- [Feature 008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — optional MCP resource semantic reindex only with opt-in + classification; Feature 006 ownership unchanged
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002 Core Smart Agent Routing](../../adr/0002-core-smart-agent-routing.md) — remains proposed; ranking authority; semantic fit separate from telemetry
- [ADR-0003 Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — proposed; operator authority and no silent substitution for semantic bindings
- [Feature 006 research](research.md) — evidence only

## Initial Traceability Matrix

| Outcome                             | Requirements    | Acceptance scenarios     | Phase |
| ----------------------------------- | --------------- | ------------------------ | ----- |
| Projection not authority            | FR1–FR6         | 4–5, 7, 11, 18           | 1     |
| Milvus backend + documents          | FR7–FR13        | 9–10, 13, 41             | 1     |
| Multilingual / Lang Lock            | FR14–FR17       | 1, 15, 40                | 1     |
| Hybrid recall + two-pass            | FR18–FR23       | 2–3, 16–17               | 1     |
| Resilience no silent swap           | FR24–FR27       | 7–8, 29                  | 1     |
| Profiles / models / bindings SSOT   | FR28–FR33       | 19–28, 30–36             | 1     |
| Security isolation                  | FR34–FR37       | 6, 11, 14, 20, 28, 35–38 | 1     |
| Budget integration                  | FR38–FR40       | 12, 17                   | 1–2   |
| OTEL / evaluation                   | FR41–FR43       | 15, 40                   | 2     |
| Cutover / rotate-secret / profile C | FR12, FR30–FR32 | 31–36, 41                | 1–2   |
