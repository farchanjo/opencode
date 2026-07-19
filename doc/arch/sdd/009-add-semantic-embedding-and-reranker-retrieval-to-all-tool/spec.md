---
id: 019f7712-e70c-73d1-b7b3-e767562f7df0
number: 009
slug: add-semantic-embedding-and-reranker-retrieval-to-all-tool
status: implemented
created_at: 2026-07-18T21:12:35.34095Z
---
# Feature Specification: Semantic Tool Search (Embeddings + Reranker)

Feature: 009-add-semantic-embedding-and-reranker-retrieval-to-all-tool
Created: 2026-07-18
Scope: Extend the Feature 006 Milvus-backed embedding + reranker retrieval stack to
**every tool-search surface** in OpenCode — the native ToolRegistry, the MCP tool
catalog, and the code-mode catalog — so that a task-scoped query selects the most
relevant tools by hybrid lexical + semantic relevance with deterministic ranking and
graceful degradation to lexical-only when the semantic stack is unavailable.

## Scope and intent

Today OpenCode exposes tools to the model by set membership, not relevance. The
ToolRegistry hands the model the full permission-visible tool set filtered only by
Wildcard allow/deny rules and a handful of hardcoded model-specific toggles
(`packages/opencode/src/tool/registry.ts` `tools()`, `Permission.visibleTools`,
`packages/opencode/src/permission/index.ts:216`). MCP tools are cataloged and merged
the same way (`packages/opencode/src/mcp/catalog.ts`, `packages/opencode/src/mcp/index.ts`
`tools()`), and code-mode renders the entire MCP catalog into an API surface
(`packages/opencode/src/tool/code-mode.ts:58` `describeCatalog`). There is **no
lexical ranking and no semantic retrieval for tools today** — only exact/wildcard
match and full-set exposure.

Feature 009 adds a **relevance layer over the existing tool-exposure surfaces**. It
indexes the tool corpus (tool id, description, parameter JSON Schema, MCP server,
permission metadata) into a Milvus `tools` collection alongside the Feature 006
`agents`, `skills`, and `skill_chunks` collections, and answers a task-scoped query
with a bounded, deterministically ranked candidate set produced by hybrid lexical +
dense recall followed by reranking over the reduced set.

**Feature 009 reuses the Feature 006 stack; it MUST NOT build a second one.** The
embedding model, reranker model, Milvus backend/adapter, operator-pinned
`SemanticModelBinding` slots, multilingual posture, degradation ladder, content-free
telemetry conventions, and native operator control-plane authority are all owned by
Feature 006 and Feature 007. Feature 009 adds only the tool corpus, the tool-scoped
retrieval seam, and the integration into ToolRegistry/MCP/code-mode.

**Sources of truth remain:** ToolRegistry (native tool identity/availability), MCP
client catalog (Feature 008 — MCP tool identity/lifecycle), Permission/Policy
(visibility and allow/deny authority), and Config.Service (feature configuration).
The Milvus `tools` collection is a **derived projection/index only**. It MUST NOT
grant tool availability, override permission visibility, or decide execution.

### Ownership split (no duplication)

| Concern                                                              | Owner                          |
| ------------------------------------------------------------------- | ------------------------------ |
| Embedding/reranker models, Milvus backend/adapter, pinned bindings  | Feature 006                    |
| Degradation ladder, multilingual posture, content-free telemetry    | Feature 006 (reused verbatim)  |
| Operator control-plane authority, `semantic.*` command catalog      | Feature 007                    |
| Native tool identity/registration/permission visibility             | ToolRegistry / Permission      |
| MCP tool catalog, `tools/list`, `list_changed`, lifecycle           | Feature 008                    |
| Tool corpus documents, tool-scoped retrieval seam, ranking contract | **Feature 009**                |
| Agent/skill retrieval (`agents`/`skills`/`skill_chunks`)            | Feature 006 (unchanged by 009) |

### Relationship to Feature 008 (complement, not duplicate)

Feature 008 owns the MCP client runtime: `tools/list` pagination, the
`notifications/tools/list_changed` refresh, the tool catalog cache, and the canonical
call adapter. Feature 009 **consumes** that catalog as an index source and
**subscribes** to the Feature 008 `mcp.tools_changed` event to trigger incremental
reindex of the affected server's tool documents. Feature 009 MUST NOT manage MCP
connections, negotiate capabilities, refresh the runtime catalog, or call tools;
those remain Feature 008. Feature 008 already carves out **optional semantic reindex
of MCP resources** under Feature 006 opt-in; Feature 009 covers **tool** documents
specifically and MUST NOT re-specify or duplicate the resource-index opt-in.

## User Stories

Priority uses P1 (must have), P2 (should have), and P3 (could have).

### P1 — Relevant tools instead of the whole set

- As an agent, I want a task-scoped query to return the most relevant tools ranked by
  hybrid lexical + semantic relevance so that tool selection matches the task without
  scanning the entire registry and MCP catalog.
- As a maintainer, I want native tools, MCP tools, and code-mode entries indexed from
  one canonical tool corpus so that all three tool-search surfaces share one retrieval
  seam and one ranking contract.

### P1 — Multilingual query against English tool descriptions

- As a user querying in pt-BR, es, or en, I want English (Feature 004 Lang Lock) tool
  names and descriptions to match my query via the multilingual embedding/reranker
  without a mandatory translation LLM call.

### P1 — Never a hard failure

- As an operator, I want tool search to degrade to lexical-only ranking (and, below
  that, to the current permission-visible full set) when Milvus, the embedding model,
  or the reranker is unavailable, stale, or times out, with an explicit degraded
  reason and no hard failure of tool availability.
- As a security reviewer, I want the semantic layer to never expand the tool set
  beyond what Permission/Policy already makes visible.

### P1 — Shared stack, single authority

- As an operator, I want tool retrieval to reuse the exact Feature 006 pinned
  embedding and reranker bindings so that there is one semantic stack, one set of
  operator controls, and no second model selection surface.
- As a security reviewer, I want the LLM, tools, MCP, plugins, and custom commands to
  have zero authority over embedding/reranker bindings, index administration, or the
  tool corpus contents.

### P2 — Corpus freshness

- As a maintainer, I want the tool corpus to reindex incrementally on registry changes
  and on the Feature 008 `mcp.tools_changed` event so that new, changed, and removed
  tools are reflected by content-hash upsert and tombstone without a full rebuild.

### P2 — Observability without content

- As an operator, I want content-free spans and bounded metrics for tool retrieval
  (candidate counts before/after, cache hits, fallback/stale counts, rerank delta,
  selected rank, latency) with no query text, vectors, tool ids, or session ids as
  labels.

### P3 — Offline evaluation

- As a maintainer, I want offline golden query→tool relevance evaluation, including
  multilingual and permission-leakage tests, without any online self-optimizing
  policy.

## Functional Requirements

### Authority and non-duplication

1. ToolRegistry, the MCP tool catalog (Feature 008), Permission/Policy, and
   Config.Service MUST remain the sources of truth for tool identity, availability,
   visibility, and configuration. The Milvus `tools` collection MUST be a derived
   projection/index only and MUST NOT be a parallel tool registry, availability
   authority, or permission authority.
2. Feature 009 MUST reuse the Feature 006 embedding model, reranker model, Milvus
   backend/adapter, and operator-pinned `SemanticModelBinding` slots. It MUST NOT
   introduce a second embedding/rerank service, a second Milvus adapter, or a second
   model-selection surface.
3. Semantic ranking MUST NOT return any tool that is not already permission-visible
   for the requesting agent/session. Permission/Policy visibility (Wildcard allow/deny
   via `Permission.visibleTools`) MUST be applied as a hard filter before retrieval
   and MUST be revalidated on the candidate set after retrieval (stale-index safety).
4. The LLM, agents, tools, MCP servers, plugins, and custom commands MUST NOT
   administer the `tools` collection, change embedding/reranker bindings, or mutate
   the tool corpus. All semantic administration remains Feature 007 operator-only.

### Tool corpus and indexing

5. Feature 009 MUST project one canonical **tool corpus** covering all tool-search
   surfaces: native ToolRegistry tools (`all()`/`tools()`), MCP catalog tools
   (Feature 008), and the code-mode catalog. Each surface MUST index from the same
   corpus so retrieval and ranking are consistent across surfaces.
6. Each tool document MUST include: canonical composed tool id, display name, source
   (`native` | `mcp` | `custom` | `plugin`), MCP server id when applicable, sanitized
   description, a sanitized/bounded projection of the parameter JSON Schema (parameter
   names, types, and descriptions), permission pattern/visibility metadata, language
   tag (Feature 004), and content hash. Tool descriptions and parameter schemas are
   readily available at the registry boundary (`registry.ts` `tools()` exposes
   `description` + `jsonSchema`; `mcp/catalog.ts` `convertTool` exposes `description` +
   `inputSchema`).
7. The tool corpus MUST NOT store secrets, credentials, full prompts, reasoning,
   private payloads, or filesystem paths. Only sanitized tool metadata and bounded
   schema projections are indexed.
8. Index updates MUST be content-hash incremental upsert with tombstone/removal and
   MUST be idempotent. Reindex MUST be triggered on ToolRegistry corpus change and on
   the Feature 008 `mcp.tools_changed` / `notifications/tools/list_changed` event for
   the affected server only, never a full rebuild per change.
9. The `tools` collection MUST carry the Feature 006 embedding binding version, model
   id, dimension, normalization, and distance metric. Incompatible vectors MUST NEVER
   be mixed in one search space; embedding binding/dimension changes MUST follow the
   Feature 006 blue/green reindex and explicit `semantic.embedding.cutover` path and
   MUST NOT activate on select or reindex alone.
10. Tenant/project/scope MUST be scalar metadata with mandatory filters on every
    search. Cross-project tool documents MUST NEVER be returned.

### Hybrid retrieval and ranking

11. Tool retrieval MUST run as an ordered pipeline: (1) task-scoped query, (2) hard
    permission/scope filters as scalar predicates, (3) hybrid dense + lexical recall
    bounded by `retrieval_top_k`, (4) reduced candidate set, (5) reranker over that
    reduced set bounded by `rerank_top_k`, (6) deterministic ranking, (7) bounded
    result list, (8) post-retrieval permission revalidation against live core state.
12. Lexical recall MUST reuse or extend the existing wildcard/name-based matching as
    the sparse signal; dense recall MUST use the Feature 006 pinned embedding of the
    query. Reranking MUST run only on the reduced candidate set, never on the full
    corpus.
13. The ranking contract MUST be deterministic: ties MUST break by a stable, documented
    order (for example rerank score, then dense score, then lexical score, then
    canonical tool id) so identical inputs yield identical output ordering. Result
    count MUST be bounded by configuration and MUST NEVER be unbounded.
14. The query embedding MUST be derived once per logical task from the structured query
    and cached by task fingerprint/version, reused across the native, MCP, and
    code-mode surfaces while valid. There MUST be no per-token or per-turn embedding or
    remote query loop.
15. Retrieval MUST expose score provenance (lexical/dense/rerank components and
    confidence) without chain-of-thought. The semantic score MUST remain an input to
    tool ordering only and MUST NOT alter permission visibility or execution authority.

### Multilingual and Lang Lock

16. Queries MAY be pt-BR, es, or en while tool names/descriptions follow Feature 004
    Lang Lock (default en-US). The Feature 006 multilingual embedding and reranker MUST
    match across these locales without a mandatory translation LLM call.
17. The system MUST preserve the original query text for embedding. The effective
    Feature 004 language tag MAY be recorded on the retrieval decision without content.

### Degradation ladder (never a hard failure)

18. Tool search MUST degrade honestly through a typed capability ladder, never a hard
    failure of tool availability, unless the operator has explicitly configured
    fail-closed for semantic retrieval:
    - **Full semantic** — hybrid lexical + dense recall + rerank when the pinned
      binding and Milvus/index are healthy.
    - **Lexical-only** — when the embedding model, reranker, or Milvus/index is
      unavailable, stale, or times out: rank by lexical/wildcard signal with an
      explicit degraded reason and typed capability gap.
    - **Full-set passthrough** — below lexical, the current behavior (the entire
      permission-visible tool set, unranked) remains the floor so tool exposure is
      never worse than today.
19. The system MUST NEVER automatically select or substitute another embedding or
    reranker model (no silent substitution; no automatic fallback pool for these two
    slots — Feature 006 FR24/FR31). Binding state MUST surface as `degraded` or
    `unavailable`.
20. A local bounded cache and last-known index metadata MUST back retrieval; caches
    MUST invalidate by binding version and config hash. Circuit breaker and retries
    MUST be bounded, MUST target the same pinned binding only, and MUST NOT block the
    hot path beyond the configured retrieval budget.

### Configuration

21. Feature 009 MUST be configured through Config.Service: an enable flag per
    tool-search surface (native, MCP, code-mode), `retrieval_top_k`, `rerank_top_k`,
    result bound, retrieval latency budget, cache TTL, and the optional fail-closed
    switch. Defaults MUST keep tool exposure at least as capable as today (FR18
    full-set passthrough floor).
22. Feature 009 MUST NOT define any new operator command IDs for embedding/reranker
    management. It reuses the Feature 007 `semantic.*` catalog already registered in
    `packages/core/src/operator/catalog.ts` (`semantic.provider.*`, `semantic.model.*`,
    `semantic.embedding.*`, `semantic.reranker.*`, `semantic.binding.*`,
    `semantic.index.*`). Reindex/status/reconcile of the `tools` collection MUST flow
    through the existing `semantic.index.reindex` / `semantic.index.reconcile` /
    `semantic.index.status` / `semantic.index.show-collections` operator IDs.
    Plugin/MCP/custom registries MUST NOT register reserved operator IDs.

### Observability and evaluation

23. Spans MUST cover tool retrieval: `embed.query` (reused from Feature 006 when the
    query embedding is shared), `retrieve.tools`, `rerank.tools`, and
    `semantic.fallback` (names illustrative; stable enums required).
24. Metrics MUST be bounded: latency buckets, candidates before/after rerank, cache
    hit, fallback/stale counts, rerank delta buckets, selected tool rank buckets, and
    failures. Labels MUST NOT include query text, vectors, tool ids, MCP server names,
    session ids, or paths (ADR-0001).
25. Offline evaluation MUST support golden query→tool relevance, recall/ranking
    metrics, multilingual tests, and permission-leakage tests. Online self-optimizing
    ranking policy is out of scope for V1.

## Non-Functional Requirements

1. Tool retrieval latency MUST respect the configured budget; timeout MUST trigger the
   degradation ladder rather than blocking tool exposure.
2. Index upsert/reconcile of the `tools` collection MUST be idempotent and safe under
   concurrent catalog changes (registry reload, MCP `list_changed`).
3. Candidate-set memory MUST be bounded by `retrieval_top_k`, `rerank_top_k`, and the
   result bound.
4. The hot path MUST NOT embed or search per token or per delta; the shared query
   embedding MUST be reused across surfaces.
5. The retrieval seam MUST be compatible with the native, MCP, and code-mode surfaces
   without introducing a second tool registry or a second router.

## Acceptance Scenarios

1. **Relevant subset over full set.** Given a task-scoped query and a large
   permission-visible tool set, when tool search runs at full semantic capability,
   then a bounded, deterministically ranked candidate set of the most relevant tools
   is returned rather than the entire set.
2. **Multilingual query / English tools.** Given a pt-BR query and en-US Lang Lock
   tool descriptions, when retrieval runs, then relevant English tools appear among
   the candidates without a translation LLM call.
3. **Permission hard filter.** Given a tool hidden by Wildcard deny for the agent, when
   retrieval runs, then that tool never appears in candidates even if semantically
   similar.
4. **Stale-index revalidation.** Given a tool removed from ToolRegistry but still in
   Milvus, when search returns it, then post-retrieval revalidation drops it before it
   reaches the model.
5. **Milvus down — lexical fallback.** Given Milvus unavailable and default policy,
   when tool search runs, then ranking degrades to lexical-only with an explicit
   degraded reason and no hard failure of tool availability.
6. **Reranker down — dense/lexical ranking.** Given a reranker timeout and default
   policy, when recall completed, then ranking proceeds without rerank scores under the
   deterministic tie-break order and records the degraded reason without selecting
   another reranker model.
7. **Embedder down — full-set floor.** Given the embedding model unavailable and Milvus
   also unavailable, when tool search runs, then the permission-visible full set is
   exposed unranked (today's behavior) and binding state is `unavailable`.
8. **Deterministic ties.** Given two tools with identical rerank and dense scores, when
   ranking runs twice with identical inputs, then both runs produce identical ordering
   by the documented tie-break.
9. **MCP list_changed reindex.** Given a connected MCP server emitting
   `notifications/tools/list_changed` (Feature 008 `mcp.tools_changed`), when the event
   fires, then only that server's tool documents are incrementally upserted/tombstoned,
   not a full rebuild.
10. **Content-hash upsert.** Given a native tool whose description changes, when the
    registry reloads, then the tool document is re-embedded by content hash and stale
    vectors are not retained.
11. **Cross-project isolation.** Given two projects, when project A searches tools, then
    no project B tool document is returned.
12. **Shared query embedding cache.** Given the native surface then the MCP surface
    query the same task fingerprint, when both run, then the query embedding is reused
    from cache and not recomputed.
13. **top_k bounds.** Given `retrieval_top_k` and `rerank_top_k`, when recall and rerank
    run, then candidate counts never exceed the configured caps and the result list is
    bounded.
14. **No binding, no crash.** Given no embedding/reranker binding pinned in Feature 006,
    when tool search runs under default policy, then it degrades to lexical-only /
    full-set floor with a typed capability gap and no hard failure.
15. **Telemetry content-free.** Given tool retrieval spans and metrics, when exported,
    then no query text, vector, tool id, MCP server name, or session id appears as a
    label.
16. **No binding mutation via LLM.** Given a prompt, plugin, MCP, or ToolRegistry
    attempt to change the embedding/reranker binding or the tool corpus, when
    processed, then bindings and corpus are unchanged.
17. **Operator reindex via reserved IDs.** Given an operator runs
    `semantic.index.reindex` (or `semantic.index.status`) for the `tools` collection,
    when executed, then reindex/status runs natively with zero model tokens and no new
    Feature 009 operator ID is required.
18. **Sanitized schema projection.** Given a tool whose parameter schema contains a
    default value that looks like a secret or a path, when the tool document is built,
    then only sanitized parameter names/types/descriptions are indexed and no secret or
    path is stored.
19. **Fail-closed opt-in.** Given the operator explicitly configured fail-closed for
    semantic retrieval, when the semantic stack is unavailable, then tool search fails
    closed with a typed error instead of degrading, per operator policy.
20. **Multilingual offline eval.** Given the pinned multilingual embedding/reranker,
    when offline golden eval runs for pt/es/en query→tool relevance, then results are
    recorded without changing any binding.

## Security Requirements

- **Data sensitivity/classification.** The tool corpus holds sanitized tool metadata —
  ids, descriptions, and bounded parameter-schema projections. Treat as private
  project configuration surface. Secrets, credentials, prompts, reasoning, and
  filesystem paths MUST NOT be indexed (FR7).
- **Authentication/authorization.** Tool search introduces no new authenticated
  surface. Retrieval reuses the Feature 006 pinned bindings and the existing
  Permission/Policy visibility; the semantic layer MUST NEVER widen the
  permission-visible set (FR3). Index administration is Feature 007 operator-only
  (FR4, FR22).
- **Input validation.** Queries, filters, `retrieval_top_k`, `rerank_top_k`, result
  bounds, and collection names MUST be schema-bounded and server-capped; no arbitrary
  collection scan and no unbounded result set (FR13, FR21).
- **Cryptography in transit/at rest.** Tool search moves no new secret material.
  Milvus/embedding transport reuses the Feature 006 TLS and secret-ref posture; no
  credentials appear in the tool corpus or in transcripts.
- **Logging/audit.** Retrieval telemetry is content-free: no query text, vectors, tool
  ids, MCP server names, or session ids in logs or metric labels (FR24). Operator
  reindex/status actions are audited through the existing Feature 007 `semantic.*`
  catalog.
- **Error-handling information exposure.** Degraded and failure paths MUST return
  stable typed capability-gap codes and MUST NOT leak endpoints, credentials, or index
  internals in messages or output.

## Privacy Requirements

1. The embedding provider receives only sanitized tool metadata and the original query
   text under the Feature 006 privacy policy; no user prompts, reasoning, secrets, or
   private file paths are indexed or sent.
2. Retrieval telemetry and audit are content-free and reuse the Feature 006 / ADR-0001
   bounded-label conventions.
3. Local/offline embedding and data-residency options for the tool corpus follow the
   Feature 006 residency posture and are not re-decided here.

## Observability

Integrate with ADR-0001 and Feature 006. Tool-retrieval spans and metrics follow
FR23–FR24 with stable enum names and bounded labels. The shared query embedding span
is reused from Feature 006 when the embedding is shared across surfaces. Feature 002
Process Table MAY show reindex job lifecycle and degraded flags without raw queries;
Feature 005 spool holds large reindex job outputs as refs only.

## Compatibility and Migration

- Phased enablement behind Config.Service flags per surface; the default path keeps
  tool exposure at least as capable as today (full-set passthrough floor, FR18).
- Existing ToolRegistry, MCP catalog, and code-mode behavior remain authoritative
  during an empty/cold `tools` collection.
- Blue/green for embedding model/dimension changes reuses the Feature 006 cutover.
- Feature 008 remains the MCP catalog/lifecycle authority; Feature 009 consumes its
  catalog and `mcp.tools_changed` events.
- Feature 006 remains the semantic stack authority; Feature 009 adds only the `tools`
  collection and the tool-scoped retrieval seam.

## Out of Scope

- A second embedding/rerank service, Milvus adapter, or model-selection surface
  (Feature 006 owns the single stack).
- Any new operator command IDs for embedding/reranker/binding/index management
  (Feature 007 `semantic.*` catalog is reused).
- Widening tool visibility beyond Permission/Policy, or the semantic layer deciding
  tool execution.
- MCP connection/capability/lifecycle management or the MCP resource semantic index
  (Feature 008).
- Agent/skill retrieval (`agents`/`skills`/`skill_chunks` collections — Feature 006).
- Indexing secrets, prompts, reasoning, private payloads, or filesystem paths.
- Unbounded candidate sets or result lists.
- Online auto-training or self-optimizing ranking policy in V1.
- Mandatory remote dependency (tool search MUST work degraded without Milvus).
- Cross-project tool retrieval.

## Clarification Questions

1. Which structured query drives tool retrieval — the task profile reused from
   Feature 006, the last user turn, or a dedicated tool-selection query?
2. Default `retrieval_top_k` / `rerank_top_k` / result bound and latency budget for
   tool search?
3. Sparse/lexical implementation for tools — reuse Wildcard name matching, BM25-in-
   Milvus, or an external lexical index?
4. Exact tie-break order for the deterministic ranking contract?
5. Does the `tools` collection share the Feature 006 embedding binding generation and
   alias, or hold an independent generation with the same model/dimension?
6. Bounded parameter-schema projection rules (which fields, size caps, sanitization)?
7. Does code-mode `describeCatalog` consume the ranked subset, or only the top-level
   MCP tool surface?
8. Per-surface enablement defaults (native / MCP / code-mode) for V1?
9. Cache TTL and invalidation for the shared query embedding versus the tool corpus?
10. Interaction with the Feature 008 opt-in resource index — one reindex trigger or
    two independent triggers?
11. Does fail-closed apply per surface or globally?
12. Tenant/project scalar model for the `tools` collection and multi-root behavior?

## Related Features and Decisions

- [Feature 006 Semantic Agent and Skill Retrieval (Milvus)](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md) — owns the embedding/reranker models, Milvus backend/adapter, pinned bindings, degradation ladder, multilingual posture, and telemetry conventions that Feature 009 reuses for the `tools` collection
- [Feature 008 Complete MCP Client Tools and Resources Lifecycle](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md) — MCP catalog/lifecycle authority; `mcp.tools_changed` reindex trigger; resource index opt-in stays with 008/006
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md) — sole management authority; reused `semantic.*` command IDs (no new Feature 009 IDs)
- [Feature 001 Smart Agent Routing and Telemetry](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md) — Context/Turn/Delegation Budget fields for top_k/result bounds; ranking authority separation
- [Feature 004 Lang Lock](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md) — English tool descriptions vs multilingual query; language metadata
- [Feature 005 OutputSpool and ArtifactStore](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md) — large reindex job outputs file-backed as refs
- [ADR-0001 OpenTelemetry telemetry foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0003 Operator Control Plane and native command authority](../../adr/0003-operator-control-plane-and-native-command-authority.md) — operator authority; no silent substitution for semantic bindings
- [ADR-0007 Semantic Tool Search](../../adr/0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md) — this feature's decision record

## Initial Traceability Matrix

| Outcome                            | Requirements | Acceptance scenarios   | Phase |
| ---------------------------------- | ------------ | ---------------------- | ----- |
| Projection not authority           | FR1–FR4      | 3–4, 16                | 1     |
| Tool corpus + indexing             | FR5–FR10     | 9–11, 18               | 1     |
| Hybrid retrieval + ranking         | FR11–FR15    | 1, 8, 12–13            | 1     |
| Multilingual / Lang Lock           | FR16–FR17    | 2, 20                  | 1     |
| Degradation ladder no silent swap  | FR18–FR20    | 5–7, 14, 19            | 1     |
| Configuration + reused operator IDs| FR21–FR22    | 17, 19                 | 1     |
| Observability / evaluation         | FR23–FR25    | 15, 20                 | 2     |

## Clarifications

### Session 2026-07-18

Declarative resolutions for the Feature 009 clarify phase. Each decision closes one or
more Clarification Questions (CQ1–CQ12 above) or an inline ambiguity surfaced against
the **now-implemented** Feature 006 and Feature 008 code, without reopening confirmed
Feature 006 ownership of the single semantic stack, the pinned `SemanticModelBinding`
slots, the nine-stage pipeline order and tie-break contract, the C10 shared
query-embedding cache, the C12 blue/green cutover, or the content-free telemetry
posture; Feature 007 native-only operator authority and the reserved `semantic.*`
catalog; Feature 008 MCP catalog/lifecycle authority and the `mcp.tools_changed` event;
Feature 004 Lang Lock provenance; Feature 001 ranking/selection authority. Feature 009
adds only the `tools` collection, the tool document projection, the tool-scoped
retrieval seam, and the ToolRegistry/MCP/code-mode integration points. Topology
constants, numeric limits, and thresholds this feature defers are resolved here as
explicit deferrals to `plan` and to [ADR-0007](../../adr/0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md),
each with a provisional stance and a named acceptance-test hook (AC = Acceptance
Scenario above), never as open placeholders. Where the original spec assumed a paper
006/008, this session pins the decision to the real seams that now exist —
`packages/core/src/semantic/pipeline.ts`, `packages/opencode/src/semantic/{retrieval-facade,cutover-executor}.ts`,
`packages/schema/src/semantic/{enums-state,documents,retrieval}.ts`,
`packages/opencode/src/mcp/reindex-trigger.ts`, and `packages/core/src/operator/catalog.ts`.

**C1 — Structured query that drives tool retrieval (CQ1, FR14, FR16–FR17).** Tool
retrieval reuses the **Feature 006 structured `TaskProfile` / `QueryFingerprint`**
(`packages/schema/src/semantic/profile.ts`, threaded as stage 1 of
`pipeline.ts`), not the raw last user turn and not a second dedicated tool-selection
query. The original query text is preserved for embedding with no mandatory translation
LLM call (FR16, FR17); the same fingerprint that drives the agent and skill passes drives
the tool pass, which is what makes the C8 shared-embedding cache reuse honest. A
dedicated tool-selection query is out of scope for V1. Acceptance hooks AC1, AC2, AC12.

**C2 — Tool retrieval pass API and pipeline-stage reuse (CQ1, FR11, FR12, NFR5).** The
tool pass extends the Feature 006 retrieval seam rather than forking a router: a
**`retrieveTools` method added to the existing `RetrievalPort`** (or a sibling
`ToolRetrievalPort` composed by the same `createRetrievalFacade`,
`packages/opencode/src/semantic/retrieval-facade.ts`) — decided at `plan` against the
facade's shape, with no second facade and no second pipeline. The tool pass reuses
pipeline stages **1 profile → 2 filter → 3 recall → 4 reduce → 5 rerank → 6 score** and
the deterministic **9 revalidate**, and **omits stages 7 select_agent / 8 skill_pass**
(those are agent/skill-only in `pipeline.ts`): a tool pass produces a bounded ranked
tool list, never an Agent selection or a constrained skill sub-pass. This is a single-pass
retrieval over `collection: "tools"` (the `RetrievalRequest.collection` field already
carries the target), not the two-pass agent→skill flow. Exact port signature is a
provisional plan constant with acceptance hooks AC1, AC13.

**C3 — Ranking contract and tie-break reuse (CQ4, FR13).** Feature 009 reuses the
**exact Feature 006 deterministic tie-break total order verbatim** —
`rerank score → dense score → sparse/lexical score → canonical id → version` — as
implemented in `packages/core/src/semantic/tie-break.ts` (descending by relevance,
canonical id/version ascending, absent rerank treated as `NEGATIVE_INFINITY`). Feature
009 does NOT define a new tie-break: the canonical id here is the composed tool id and
the version is the tool content hash/version, but the comparator is the same code. Result
count is bounded by config (C5) and never unbounded. Acceptance hooks AC8, AC13.

**C4 — Sparse/lexical signal for tools (CQ3, FR12).** The sparse signal **reuses/extends
the existing Wildcard name-and-id matching** already applied at the tool boundary
(`Permission.visibleTools`, `registry.ts` `tools()`) as the lexical recall component;
V1 does NOT stand up an external lexical index and does NOT require BM25-in-Milvus. Dense
recall uses the Feature 006 pinned query embedding; the two fuse through the existing
`hybrid-fusion.ts` weighted strategy at stage 4. Whether sparse is served as a
Milvus scalar/BM25 field or as an in-process wildcard rank over the recall window is a
provisional plan constant; the fixed requirement is one hybrid recall bounded by
`retrieval_top_k` with rerank only over the reduced set (FR11, FR12). Acceptance hooks
AC1, AC6.

**C5 — Default retrieval/rerank/result bounds and latency budget (CQ2, FR13, FR21,
NFR1, NFR3).** V1 provisional defaults, all Config.Service-tunable and server-capped:
`retrieval_top_k` and `rerank_top_k` **inherit the Feature 006 `Values.TopK` bounds**
(rerank window ≤ retrieval window, enforced by the facade `budgetError` guard), the
tool result bound is a small bounded list (provisional single-digit-to-low-tens window),
and the retrieval latency budget is a bounded per-pass budget whose expiry triggers the
C14 degradation ladder rather than blocking exposure (NFR1). Exact numeric defaults are
provisional plan constants with acceptance hooks AC13; the fixed requirement is that
every window is bounded and no result list is unbounded (FR13).

**C6 — Tool document (`ToolDoc`) corpus shape and parameter-schema projection (CQ6,
FR6, FR7, FR18).** One canonical `ToolDoc` projection (a new document mirroring the
`documents.ts` `DocIdentity` / `DocScope` / `DocAvailability` shared parts, to be added
under the Feature 009 CUE corpus) carries: composed tool id, display name, source
(`native` | `mcp` | `custom` | `plugin`), MCP server id when applicable, sanitized
description, a **bounded parameter-schema projection** (parameter names, types, and
descriptions only), permission pattern/visibility metadata, Feature 004 language tag,
and content hash — mirroring how `AgentClassification`/`SkillDescriptor` carry sanitized
name+description with taxonomy as ranking-only signal. The schema projection **strips
`default`/`example`/`const` values, formats, paths, and any free-form string that could
carry a secret**; only names, JSON-Schema types, and descriptions survive, bounded by a
size cap. Descriptions and schemas are already available at the boundary
(`registry.ts` `tools()` → `description` + `jsonSchema`; `mcp/catalog.ts` `convertTool`
→ `description` + `inputSchema`). No secrets, credentials, prompts, reasoning, payloads,
or filesystem paths are ever indexed (FR7). Exact allowlist and cap are provisional plan
constants with acceptance hooks AC18.

**C7 — `tools` collection lifecycle: shared binding generation and blue/green cutover
(CQ5, FR9, FR12).** The `tools` collection **shares the single Feature 006 embedding
binding generation and cuts over atomically with `agents`/`skills`/`skill_chunks`** — it
is NOT an independent generation. Verified against the real code: the `Collection`
literal already includes `"tools"`
(`packages/schema/src/semantic/enums-state.ts`), `SemanticIndexGeneration` /
`CollectionAlias` already map any conceptual collection into one binding generation
(`index-generation.ts`), and the implemented cutover executor already swaps
**every collection in the generation together under one CAS token** and names the
`tools` extension explicitly (`packages/opencode/src/semantic/cutover-executor.ts`
`CutoverInput.collections: readonly CollectionKind[]`). So `tools` requires **no new
lifecycle machinery** — it joins the existing generic multi-collection cutover. Embedding
binding/dimension changes follow `semantic.embedding.cutover`; `select`/`reindex` alone
never activate the live alias (FR9, C12). Acceptance hooks AC9, AC10.

**C8 — Query-embedding cache vs tool-corpus cache TTL and invalidation (CQ9, FR14, FR20,
NFR4).** The **shared query embedding reuses the Feature 006 C10 cache verbatim** — keyed
by `fingerprint + binding_version + config_hash`
(`packages/core/src/semantic/query-cache.ts`), reused across the native, MCP, and
code-mode tool surfaces while valid, invalidated by binding version and config hash, with
no per-token/per-turn remote loop (NFR4). The **tool corpus** is a separate concern:
document freshness is content-hash upsert/tombstone (FR8), and the local last-known
index-metadata cache invalidates by binding version and config hash (FR20). The two are
distinct caches with distinct keys; neither has a wall-clock TTL that overrides
content-hash/binding-version invalidation. Exact TTLs are provisional plan constants with
acceptance hooks AC12, AC16.

**C9 — Per-surface enablement defaults for V1 (CQ8, FR21).** Enablement is a
**per-surface Config.Service flag (native / MCP / code-mode)**, and V1 **defaults all
three to the full-set passthrough floor** (semantic ranking disabled by default) so tool
exposure is at least as capable as today and no surface silently narrows the model's tool
list before the feature is deliberately turned on (FR18, FR21). Operators opt each surface
in independently. Exact default enum is a provisional plan constant; the fixed requirement
is a floor no worse than today (FR18). Acceptance hooks AC7, AC14.

**C10 — code-mode `describeCatalog` consumption (CQ7, FR5, FR11).** When the code-mode
surface flag is enabled, `describeCatalog`
(`packages/opencode/src/tool/code-mode.ts`, reached via
`registry.ts` `describeCodeMode`) consumes the **ranked, bounded tool subset from the
same retrieval seam**, not the entire MCP catalog — so all three surfaces share one
corpus and one ranking contract (FR5). When the flag is off (default, C9), it renders the
current full permission-visible catalog unchanged. The retrieval subset is applied
**after** `Permission.visibleTools`, never widening it (FR3). Acceptance hooks AC1, AC13.

**C11 — Indexing triggers, coalescing, and Feature 008 resource-index interaction (CQ10,
FR8).** Tool reindex is triggered by **(a) ToolRegistry corpus change, (b) the Feature
008 `mcp.tools_changed` event for the affected server only, and (c) tool-relevant
Config.Service changes**, always incremental content-hash upsert/tombstone, never a full
rebuild per change (FR8). Triggers **coalesce** per affected server/scope within a bounded
window so a burst of catalog churn yields one reindex pass (NFR2). Feature 009's **tool**
trigger is **separate from and parallel to** Feature 008's optional **resource**-index
opt-in seam (`packages/opencode/src/mcp/reindex-trigger.ts`, which gates on
operator opt-in + Feature 006 classification + resource policy): they are **two
independent triggers over the same event stream**, not one merged trigger — tools and
resources are distinct document kinds and Feature 009 MUST NOT re-specify or duplicate the
008 resource opt-in. Acceptance hooks AC9, AC10.

**C12 — Fail-closed scope (CQ11, FR18, FR21).** The optional fail-closed switch is a
**per-surface** Config.Service option, defaulting **off** (degrade, never hard-fail). An
operator MAY fail-closed a specific surface (e.g. code-mode) while leaving others on the
honest degradation ladder; there is no single global-only switch, because per-surface
enablement (C9) already partitions the surfaces. When a surface is fail-closed and the
semantic stack is unavailable, that surface returns a typed capability-gap error instead
of degrading (FR18). Acceptance hooks AC19.

**C13 — Tenant/project scalar model and multi-root behavior (CQ12, FR10).** The `tools`
collection reuses the **Feature 006 scalar `DocScope`** — `project_id` (partition key),
`scope`, `visibility`, `permission_ref`
(`packages/schema/src/semantic/documents.ts`) — with **mandatory scalar filters on every
search** and **no per-project collections** (a scalar project key, never collection
explosion), matching Feature 006 C6. Multi-root workspaces map each root to a scalar
project key; cross-project tool documents are never returned (FR10). Acceptance hooks
AC11.

**C14 — Degradation ladder third rung and no silent model swap (FR18, FR19, NFR1).** The
tool-search ladder reuses the Feature 006 C20 posture with a third, tool-specific floor:
**Full semantic** (hybrid + rerank) → **Lexical-only** (wildcard/name signal, typed
degraded reason, when embedder/reranker/Milvus is unavailable/stale/timed-out) →
**Full-set passthrough** (the entire permission-visible tool set, unranked — today's
behavior — as the absolute floor). No automatic substitution of another embedding or
reranker model ever occurs (Feature 006 FR24/FR31); binding state surfaces as `degraded`
or `unavailable` (FR19). The passthrough floor is what makes "never a hard failure of tool
availability" true unless the operator opted a surface into fail-closed (C12). Acceptance
hooks AC5, AC6, AC7, AC14, AC19.

**C15 — Honest V1 live-consumption seam (FR1, FR11, NFR5).** V1 delivers the tool
retrieval **module + facade + a DOCUMENTED wiring point** where `session/tools.ts`
`resolve()` / `registry.ts` `tools()` would consume the ranked subset — mirroring the
implemented `FEATURE_001_SELECTION_SEAM` and the langlock injection-seam precedent — and
does **NOT** silently rewrite the live LLM tool list by default. The live tool list is
gated by the per-surface enablement flags (C9): with a surface disabled (V1 default) the
seam is present, typed, and covered by a seam test but not invoked on the hot path; with
a surface enabled the ranked subset is applied **after** `Permission.visibleTools` and
never widens it (FR3). This keeps the feature's V1 claim honest: the retrieval engine and
its integration point are real and tested; live consumption is deliberate operator opt-in,
not a hidden default narrowing of the model's tools. Acceptance hooks AC1, AC7, AC14.

**C16 — Content-free telemetry, tool-id labels, and offline eval extension (CQ8, FR23–
FR25).** Retrieval telemetry reuses the Feature 006 / ADR-0001 content-free posture
verbatim: stable enum span names (`embed.query` shared, `retrieve.tools`, `rerank.tools`,
`semantic.fallback`) and bounded metrics (candidates before/after, cache hit,
fallback/stale, rerank delta, selected rank, latency). **Tool ids are NOT emitted as
labels even though they are a bounded set** — the spec (FR24) and Security/Privacy
sections forbid tool ids, MCP server names, session ids, query text, vectors, and paths
as labels; selected-tool rank is exported as a **bounded rank bucket**, never the id
itself, to keep cardinality bounded and avoid leaking which tools a session used. Offline
evaluation **extends the implemented Feature 006 golden harness**
(`packages/opencode/src/semantic/eval-harness.ts` — recall@k/nDCG/MRR per pt-BR/es/en
locale with fixed zero-tolerance permission-leakage) with a **tool-retrieval golden set**
(query→tool relevance, multilingual, permission-leakage), reusing the same `EvalPort` and
zero-leakage gate; online self-optimizing ranking stays out of scope for V1. Acceptance
hooks AC15, AC20.
