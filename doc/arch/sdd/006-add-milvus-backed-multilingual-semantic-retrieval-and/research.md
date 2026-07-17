# Semantic Agent and Skill Retrieval Research

Feature: [006 Semantic Agent and Skill Retrieval (Milvus)](spec.md)

This note records audit coverage against Features 001–005, current-core evidence, and
explicit gaps. It is not an ADR and does not authorize implementation.

## Audit: Feature 001 vs Feature 006 (no duplication)

### Already in Feature 001 / ADR-0002

- Hierarchical adaptive Architect → Manager → Worker routing, hard gates, route
  decision record, admission-bounded fanout, validation chain, role pools
  ([001 research](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/research.md),
  [ADR-0002](../../adr/0002-core-smart-agent-routing.md)).
- Catalog/AgentV2/SkillV2/Permission as routing authorities (001 FR core reuse).
- Budgets referenced as open parameters (fanout, cost/token) without a named
  **Context, Turn and Delegation Budget** policy (added to Feature 001 in this change
  set; not owned by 006).
- Telemetry foundation (ADR-0001) and hierarchy metrics cardinality rules.

### Gaps closed by Feature 006

- No Milvus or vector index for agents/skills in product features (search hits only
  speckit.toml semantic tooling, unrelated to OpenCode agent routing).
- No hybrid dense+sparse recall, reranker stage, or two-pass agent→skill retrieval.
- No multilingual query embedding policy for pt-BR/es/en vs Lang Lock English skills.
- No projection/index lifecycle (content-hash upsert, tombstone, reconcile, blue/green).
- No semantic fallback when vector backend is down.
- No retrieval_top_k / rerank_top_k / skill chunk budgets as first-class retrieval
  contracts (now consumed from Feature 001 budget policy).

## Current-core evidence (read-only)

### Agent and skill authorities

- AgentV2 service export and selection types at
  [`packages/core/src/agent.ts:1-27`](../../../../packages/core/src/agent.ts#L1-L27).
- SkillV2 service, sources, and `available(skills, agent)` filter at
  [`packages/core/src/skill.ts:1-60`](../../../../packages/core/src/skill.ts#L1-L60)
  and [`:121-132`](../../../../packages/core/src/skill.ts#L121-L132).
- Skill discovery and permissions in Feature 004 research at
  [`packages/core/src/skill.ts`](../../../../packages/core/src/skill.ts) (see 004 research).

### No product Milvus / agent embedding path

- Repository search for Milvus/agent vector index in `packages/core` and
  `packages/opencode` did not show a product OutputSpool-style semantic agent index.
  Copilot file-search vector store IDs are provider-tool specific, not OpenCode agent
  catalog indexing.
- Model resolver has an embedding seam comment only at
  [`packages/core/src/session/runner/model.ts:80`](../../../../packages/core/src/session/runner/model.ts#L80)
  (test/embedding seam for model resolver — not a semantic agent index).

### Related feature seams

- Feature 002 lifecycle for background index jobs; Process Table observation without
  raw queries.
- Feature 003 scheduled jobs for reconcile without LLM by default.
- Feature 004 Lang Lock for artifact language vs conversational/query language.
- Feature 005 OutputSpool for index job outputs and context slice budgets.

## Policies confirmed for specify

1. Milvus = projection, never authority; default/preferred backend when semantic
   retrieval is enabled; routing works without Milvus via fallback.
2. Reranker ≠ final router.
3. Multilingual embed/rerank; no mandatory translation LLM.
4. Filter before + revalidate after retrieval.
5. Fallback catalog+lexical/rules when backend degraded — **without** silent
   embedding/reranker model substitution.
6. Operator-only admin via Feature 007; no LLM/tool/MCP index or binding control.
7. Content-free OTEL; offline eval only for V1 optimization.
8. **Fixed bindings (user-confirmed):** operator pins one embedding and one reranker
   via Feature 007 panel. Feature 006 is SSOT for
   `SemanticProviderProfile` / `SemanticModelDescriptor` / `SemanticModelBinding`.
   Architect/Manager/LLM/router/plugin/MCP cannot change bindings. Rerank requires
   explicit compatibility profile (A/B/C); profile C is embedding-similarity only
   (never cross-encoder/reranker). Explicit `cutover` activates; select/reindex alone
   do not. Embedding change → blue-green reindex then cutover; reranker change → no
   re-embed by default. V1 default unavailable → catalog+lexical with degraded reason.

## Evidence boundaries

- Path anchors may drift; they do not authorize implementation.
- Numeric top_k, models, chunk sizes, and SLA remain clarification.
- This research does not select embedding vendors or Milvus topology.
- Binding/panel/SSRF details are specified in `spec.md` and Feature 007; this note
  does not restate the full control-plane contract.

## Related evidence

- [Feature 006 specification](spec.md)
- [Feature 001 specification](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/spec.md)
- [Feature 001 research](../001-define-one-cohesive-smart-agent-routing-and-opentelemetry/research.md)
- [Feature 002 specification](../002-build-an-event-driven-asynchronous-task-lifecycle-engine/spec.md)
- [Feature 003 specification](../003-add-persistent-bun-native-scheduled-jobs-with-event/spec.md)
- [Feature 004 specification](../004-add-lang-lock-to-enforce-a-configurable-artifact-language/spec.md)
- [Feature 005 specification](../005-add-a-canonical-file-backed-outputspool-and-paged/spec.md)
- [Feature 007 Unified Native Operator Control Plane](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- [ADR-0001](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0002](../../adr/0002-core-smart-agent-routing.md)
- [ADR-0003](../../adr/0003-operator-control-plane-and-native-command-authority.md)
