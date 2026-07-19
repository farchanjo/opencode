# Semantic Tool Search Research

Feature: [009 Semantic Tool Search (Embeddings + Reranker)](spec.md)

This note records the empirical audit of the **implemented** Feature 006 semantic
stack and the **implemented** Feature 008 MCP client against the Feature 009
extension surface. Every path anchor and export below was read from the working
tree on 2026-07-18; anchors are evidence for the plan, not authorization to
implement. It confirms what the shared stack already exposes for reuse, names the
exact seams Feature 009 extends, and records the honest gaps where an extension is
a genuine addition rather than pure reuse.

## Scope of the audit

Feature 009 adds only the `tools` collection, the tool document projection, the
tool-scoped retrieval pass, the three C11 reindex triggers, and the
ToolRegistry / MCP catalog / code-mode integration. Feature 006 owns the
embedding/reranker models, the Milvus backend/adapter, the pinned bindings, the
degradation ladder, the multilingual posture, and the content-free telemetry.
Feature 008 owns the MCP catalog/lifecycle and the `mcp.tools_changed` event.
This audit verifies each reuse claim (C1–C16) against the real code.

## Feature 006 substrate — verified exports

### Pipeline stages (`packages/core/src/semantic/pipeline.ts`)

- `Pipeline.run(ports, request, options)` executes the FIXED nine-stage order and
  is **agent/skill-specific**: stage 7 `select_agent` calls `ports.selectAgent`,
  stage 8 `skill_pass` calls `ports.retrieveSkills`, and the returned `PipelineRun`
  carries `agents` / `selection` / `skills`. `STAGES` and `PipelinePorts` are
  agent-shaped.
- **Reusable as-is:** stage 1 `embedQuery`, stage 3 `recall`, the stage 4 `reduce`
  helper (`HybridFusion.fuseRank` fusion sliced to `rerank_top_k`), stage 5
  `rerank`, and stage 6 `TieBreak.order`. These are the exact stages C2 reuses for
  the tool pass.
- **Honest gap (C2):** there is NO generic tool runner. A tool pass that runs
  stages 1→6 then the deterministic stage 9 `revalidate` — omitting 7 `select_agent`
  and 8 `skill_pass` — is a genuine addition. It reuses the fusion + tie-break code
  verbatim but needs a distinct runner (a new `tool-pass.ts` in
  `packages/core/src/semantic/`, not a mutation of `run`), because `run` hardcodes
  the agent→skill two-pass shape.

### Retrieval facade (`packages/opencode/src/semantic/retrieval-facade.ts`)

- `createRetrievalFacade(deps)` returns the protocol `RetrievalPort`
  (`retrieveAgents` / `retrieveSkills`). `PipelineRunnerPort` exposes
  `runAgents` / `runSkills`. `RetrievalFacadeDeps` composes a `pipeline` runner and
  a content-free `recorder`.
- **Reusable verbatim:** `budgetError` (rejects `retrieval_top_k`/`rerank_top_k`
  overflow, enforces rerank window ≤ retrieval window — the C5 `Values.TopK` bound),
  `toCandidate`, `clamp01`, and `assemble`.
- **Extension seam (C2, C15):** add `retrieveTools` to the port (or a sibling
  `ToolRetrievalPort` composed by the same factory) plus `runTools` on
  `PipelineRunnerPort`. The `FEATURE_001_SELECTION_SEAM` export at line 162 is the
  exact precedent for the C15 honest seam: a typed, documented, test-covered wiring
  point that no live route invokes until deliberately wired. Feature 009 mirrors it
  as a `FEATURE_009_TOOL_SELECTION_SEAM`.

### Retrieval request shape (`packages/schema/src/semantic/retrieval.ts`)

- The schema `RetrievalRequest` (line 25) ALREADY carries `collection:
  EnumsState.Collection`, and `Collection` includes `"tools"`
  (`enums-state.ts:61`). `Candidate` also carries a `collection` discriminator.
- **Discrepancy to resolve in the plan:** the protocol `RetrievalRequest`
  (`packages/protocol/src/semantic/commands.ts:401`) does NOT carry a collection
  field — it holds `profile` / `retrievalTopK` / `rerankTopK` / `filters`. The
  facade consumes the protocol shape. So the tool pass needs a collection
  discriminator at the protocol layer (a `ToolRetrievalRequest`, or a `collection`
  field), even though the schema layer already models it. This is a small, typed
  protocol addition, not a redesign.

### Collection lifecycle is already multi-collection generic (C7)

- `Collection` literal includes `"tools"` (`enums-state.ts:61`); protocol
  `CollectionKind` mirrors it (`commands.ts:119`).
- `CutoverExecutor.cutoverEmbedding` takes `CutoverInput.collections: readonly
  CollectionKind[]` and swaps EVERY collection in the generation together under one
  CAS token; its docblock names the `tools` extension explicitly
  (`cutover-executor.ts:6`). `IndexPort.reindex` is per-collection
  (`ports.ts:165`). `IndexJobs.coalesceTriggers(collections)` and
  `runReconcile({ collection })` are already generic over `CollectionKind`
  (`index-jobs.ts:66`, `:98`).
- **Confirmed:** `tools` requires NO new lifecycle machinery — it joins the
  existing generic multi-collection cutover, reindex, and reconcile. Feature 009
  wires the collection in; it does not fork the executor.

### Query-embedding cache is generic (C8)

- `QueryCache.keyOf(qf)` keys on `fingerprint + binding_version + config_hash`
  (`query-cache.ts:22`, `:30`); `create<E>()` is generic and reused across passes.
  The tool pass reuses the same cache and the same key verbatim; no per-surface key
  variation is required.

### Offline eval harness is id-generic (C16)

- `eval-harness.ts` `runGolden(cases, k)` computes recall@k / MRR / nDCG per locale
  over `GoldenCase { queryId, locale, relevant, retrieved, leaked }`
  (`eval-harness.ts:16`, `:91`); `leaked` is the zero-tolerance permission-leakage
  signal. The ids are opaque strings, so a tool golden set (query→tool-id) reuses
  the same harness and the same zero-leakage gate with only new fixtures.

### Document shared parts to reuse (C6, C13)

- `documents.ts` exposes `DocIdentity` (version / content_hash / source),
  `DocScope` (project_id / scope / visibility / permission_ref — the C13 scalar
  partition), and `DocAvailability` (enabled / available). The `ToolDoc` projection
  reuses these three shared value objects exactly as `AgentDoc` / `SkillDoc` do,
  and the mandatory scalar `DocScope` filter is what enforces C13 cross-project
  isolation.
- **Calisthenics bound:** `documents.ts` already defines AgentDoc, SkillDoc,
  SkillChunkDoc plus their parts (14 exported structs). Adding the ToolDoc entity
  and its tool-specific parts to the same file risks the ≤10-definitions warning
  bound and mixes a new id-bearing entity into a shared file. The plan puts the
  ToolDoc entity in its own `tool-doc.ts` module and its sub-objects in a
  `tool-doc-parts` split, mirroring the `document-parts` / `-doc` CUE precedent.

## Feature 008 / native tool substrate — verified identity and change events

### Native ToolRegistry (`packages/opencode/src/tool/registry.ts`)

- `ToolRegistry.Service` exposes `ids()`, `all()`, `named()`, and `tools(model)`
  (`registry.ts:73`). Tool identity is the stable composed `tool.id`; the
  description is `tool.description`; the parameter schema is `tool.jsonSchema`
  (a `JSONSchema7`). These are exactly the fields C6 projects into a `ToolDoc`.
- The registry builds its tool set once through `InstanceState.make` (lazy memo,
  `registry.ts:117`) and emits **no corpus-change event**. So the C11(a)
  "ToolRegistry corpus change" trigger has NO existing event seam — it must be
  derived from registry (re)construction / config reload. This is an honest gap the
  plan records: the tool trigger for the native arm is a new wiring point, not a
  subscription to an existing event.
- `describeCodeMode(input)` (`registry.ts:281`) is the code-mode consumption point:
  it computes `Permission.visibleTools(yield* mcp.tools(), ruleset)` then calls
  `codeMode.describeCatalog(tools, servers)`. The ranked subset (C10) is applied
  here, AFTER `Permission.visibleTools`, never widening it (FR3).
- `tools(input)` (`registry.ts:292`) is the native live-tool-list seam (C15); it
  filters `all()` and is consumed by `session/tools.ts`.

### MCP catalog (`packages/opencode/src/mcp/index.ts`, `mcp/catalog.ts`)

- `MCP.Service.tools()` returns `Record<string, McpTool>` keyed by the composed
  `McpCatalog.toolName(clientName, name)` = sanitized `client_tool`
  (`catalog.ts:127`, `index.ts:684`). `McpTool = { def, client, timeout }`
  (`index.ts:157`); `def` is the MCP `Tool` with `.name`, `.description`,
  `.inputSchema`. `convertTool` (`catalog.ts:50`) exposes `description` +
  `inputSchema` at the boundary — the C6 projection source for MCP tools.
  `McpCatalog.sanitize` gives the stable server-id label.
- The **C11(b)** trigger is the Feature 008 `mcp.tools_changed` event (renamed from
  `mcp.tools.changed` per 008 C3, `packages/schema/src/mcp-event.ts`). Feature 009
  subscribes for the affected server only and reprojects that server's tool
  documents.
- **Confirmed separation (C11):** `mcp/reindex-trigger.ts` (008) gates on
  `resources/updated` for RESOURCE documents (operator opt-in + Feature 006
  classification + resource policy). It is NOT a tool trigger. Feature 009 adds a
  distinct tool trigger module parallel to it; the two are independent triggers over
  the same event stream, never merged.

### code-mode catalog (`packages/opencode/src/tool/code-mode.ts`)

- `describeCatalog(mcpTools, servers)` (`code-mode.ts:58`) groups the
  permission-visible MCP tools by server and renders the confined-interpreter
  catalog. The ranked-subset consumption (C10) is applied in `describeCodeMode`
  (registry.ts) before this call; `describeCatalog` may need a bounded-subset
  parameter if the ranking is threaded through rather than pre-filtered.

### Live-consumption seams (C15)

- `session/tools.ts` `resolve()` iterates `registry.tools({...})`
  (`tools.ts:92`) and `mcp.tools()` (`tools.ts:390`) to build the live LLM tool
  map. These two loops plus `registry.tools()` and `describeCodeMode` are the
  documented wiring points where a ranked subset would be applied, gated by the
  per-surface enable flags (C9, default off → seam present but not invoked).

## Configuration surface (C9, C12, C21)

- Per-surface flags land on the Config.Service experimental schema
  (`packages/core/src/config/experimental.ts` `Experimental` class), following the
  Feature 007 `operator_control_plane: Schema.Boolean` optional-flag precedent, and
  are threaded through `packages/core/src/v1/config/config.ts` (its `experimental`
  field, `config.ts:169`). Feature 009 defines no new operator command IDs and
  reuses the reserved `semantic.*` catalog (C22, FR22) already at
  `RESERVED_CATALOG_VERSION = "1.3.0"`.

## Scope-glob findings (for the plan)

- Every semantic path (`packages/{schema,protocol,core,opencode}/src/semantic/**`
  and their test globs) is ALREADY in `doc/arch/speckit.toml` from Feature 006.
- `packages/opencode/src/mcp/**` is in scope from Feature 008; the MCP tool trigger
  wiring is covered.
- `packages/opencode/src/tool/registry.ts` and `packages/core/src/config/**` are in
  scope from Feature 007.
- **Genuinely new paths NOT in scope:** `packages/opencode/src/session/tools.ts`
  (native + MCP live-consumption seam) and `packages/opencode/src/tool/code-mode.ts`
  (code-mode ranked-subset seam). Both are C15 wiring points and require narrow
  file-exact globs. The CUE mirrors live under the always-derived `doc/arch/**`
  scope and need no glob.

## ADR alignment

[ADR-0007](../../adr/0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md)
chose "extend the Feature 006 stack with a `tools` collection" (Option A). Every
finding above is consistent with that decision: one embedding/rerank stack, one
Milvus adapter, one operator surface, honest degradation to the current full-set
floor. No plan decision contradicts ADR-0007; no refinement is required.

## Evidence boundaries

- Path anchors and line numbers may drift; they do not authorize implementation.
- Numeric `retrieval_top_k` / `rerank_top_k` / result bounds / latency budgets /
  cache TTLs / parameter-schema size caps remain provisional plan constants with
  named acceptance hooks, finalized in the tasks phase.
- This note selects no embedding vendor, Milvus topology, or fusion weight; those
  remain Feature 006 authority.

## Related evidence

- [Feature 009 specification](spec.md)
- [Feature 006 specification](../006-add-milvus-backed-multilingual-semantic-retrieval-and/spec.md)
- [Feature 006 plan](../006-add-milvus-backed-multilingual-semantic-retrieval-and/plan.md)
- [Feature 008 specification](../008-add-complete-mcp-client-tools-and-resources-lifecycle-with/spec.md)
- [Feature 007 specification](../007-add-a-unified-native-operator-control-plane-for-all-opencode/spec.md)
- [ADR-0007 Semantic Tool Search](../../adr/0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md)
- [ADR-0001 Telemetry Foundation](../../adr/0001-opentelemetry-telemetry-foundation.md)
- [ADR-0003 Operator Control Plane](../../adr/0003-operator-control-plane-and-native-command-authority.md)
</content>
</invoke>
