---
id: 019f7712-e70c-73d1-b7b3-e767562f7df0
number: 009
slug: add-semantic-embedding-and-reranker-retrieval-to-all-tool
status: specified
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
