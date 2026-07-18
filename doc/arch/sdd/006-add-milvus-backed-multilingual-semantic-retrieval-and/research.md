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

## Empirical evidence (plan phase)

Verified from the workspace and the public npm registry on 2026-07-18. Path anchors and
versions are evidence, not authorization.

### Milvus client libraries for Bun/TypeScript

- `@zilliz/milvus2-sdk-node` latest is **3.0.3** and is the official Node/TS Milvus
  client. It is a **gRPC** client: its declared dependencies include `@grpc/grpc-js`
  `^1.14.3`, `@grpc/proto-loader`, `protobufjs`, `generic-pool`, `lru-cache`, and
  `@petamoriken/float16`.
- The SDK is **not currently a workspace dependency**: no `milvus`/`zilliz` entry appears
  in `bun.lock` or any `packages/*/package.json`, and `@grpc/grpc-js` is not installed
  in `node_modules`. Adding the SDK introduces a gRPC transitive stack.
- **gRPC-under-Bun implication (open risk).** `@grpc/grpc-js` targets Node; its behavior
  under the Bun runtime must be validated empirically in the tasks phase (connection
  lifecycle, keepalive, TLS, and pool behavior). This is a named prerequisite for the
  Phase 3 Milvus adapter, kept behind the single Milvus port so a fake adapter carries
  the unit-test path regardless of the driver outcome.

### gRPC-under-Bun empirical validation (T025)

Resolved in the tasks phase against the pinned SDK. `@zilliz/milvus2-sdk-node@3.0.3`
plus its gRPC transitive stack (`@grpc/grpc-js@1.14.4`, `@grpc/proto-loader@0.8.1`,
`protobufjs@7.6.2`, `generic-pool@3.9.0`, `lru-cache`, `@petamoriken/float16@3.9.3`)
were added to `packages/opencode/package.json` (pinned exact) and `bun.lock`. The
`grpc-probe.ts` module ran under the Bun runtime (macOS, Bun 1.3.x):

- **Import** — the SDK imports under Bun; `MilvusClient` is a function.
- **Construct** — a `MilvusClient` constructs with its `generic-pool` gRPC channel pool
  in ~44ms.
- **Channel lifecycle / keepalive / retries** — `checkHealth()` against an unreachable
  `127.0.0.1:19530` opened the channel, retried three times with backoff (20/40/80ms),
  and surfaced a **typed gRPC `Error 14 UNAVAILABLE`** (`connect ECONNREFUSED`) rather
  than crashing the runtime.
- **TLS** — the client accepts the `ssl` transport option at construct time under Bun.

**Recorded finding: `grpc_bun_supported`, driver = `grpc`.** A typed gRPC status on an
unreachable backend proves the channel constructs, pools, retries, and reports a typed
status under Bun — i.e. the gRPC driver is viable. The Milvus port therefore binds behind
the gRPC driver by default. The `grpc-probe.ts` classifier still distinguishes a genuine
Bun-runtime incompatibility (import/construct throws) — which would record
`grpc_bun_unsupported` and route the single Milvus port through the injected fake /
HTTP-fallback adapter — so the driver selection is data-driven and no probe outcome
hard-fails routing on an unreachable backend (FR7, C1, C20). **No Milvus Lite exists for
TS/Bun** (Python-only), so the dev/test topology remains a standalone Milvus server
(container) for integration plus injected fakes/in-memory adapters for unit tests.

### Milvus Lite for the dev/test path (honest gap)

- There is **no `milvus-lite` npm package** (registry lookup: not found). Milvus Lite is
  a Python-only embedded build; the TS/Node SDK has no embedded/Lite equivalent.
- **Typed consequence.** The C1 "Lite for dev/test" allowance maps, in this ecosystem, to:
  a **standalone Milvus server (container)** for integration tests, and **injected
  fakes/in-memory adapters** behind the Milvus port for unit tests. The plan records this
  as the concrete dev/test topology; no embedded Lite is available to Bun/TS.

### OpenAI-compatible client transport (reuse)

- `@ai-sdk/openai-compatible@2.0.41` is already a workspace dependency in both
  `packages/opencode/package.json` and `packages/core/package.json`, and
  `packages/core/src/plugin/provider/openai-compatible.ts` already wires base URL,
  headers, and secret ref. The full `@ai-sdk/*` provider set plus `ai` (catalog-pinned)
  are present.
- The embedding probe (`/v1/embeddings`) and the reranker profiles ride this existing
  transport (base URL + secret ref), not a new HTTP stack. The model resolver carries a
  test/embedding seam comment only (`packages/core/src/session/runner/model.ts:80`); the
  AI SDK's embedding-model surface for openai-compatible is verified against the pinned
  version in the tasks phase.

### Multilingual embedding precedent (independent)

- speckit itself runs semantic retrieval with **`potion-multilingual-128M` at 256
  dimensions** (`speckit status`: `semantic: on (potion-multilingual-128M, 256d)`),
  confirming a working multilingual small-embedding precedent. This is speckit's own
  tooling and is **independent** of opencode's product stack: Feature 006 pins its own
  operator-selected embedding/reranker bindings and does not reuse speckit's model.

### Agent and skill registry shapes to index

- AgentV2 (`packages/core/src/agent.ts:1-27`) exposes `Info`/`Selection` over an
  effect-service registry (`get`/`resolve`/`select`/`all`); agent documents project from
  `Agent.Info`.
- SkillV2 (`packages/core/src/skill.ts:1-60`, `:121-132`) exposes `Source`/`Info`, a
  `list()` over discovered sources, and `available(skills, agent)` which filters by
  `PermissionV2.evaluate("skill", ...)`. Skill summary + chunk documents project from
  `Skill.Info`, and permission revalidation reuses `available`/PermissionV2 rather than a
  parallel authority.

### Reserved operator catalog (no bump)

- `packages/core/src/operator/catalog.ts` declares exactly **30** `semantic.*` IDs at
  `RESERVED_CATALOG_VERSION = "1.3.0"` (`semantic.provider.*` 7, `semantic.model.*` 5,
  `semantic.embedding.*` 6, `semantic.reranker.*` 5, `semantic.binding.*` 2,
  `semantic.index.*` 5). Feature 006 registers typed domain impls only; **no additive
  catalog bump is required** (C15).

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
