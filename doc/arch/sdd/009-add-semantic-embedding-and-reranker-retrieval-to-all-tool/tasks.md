# Tasks: Add Semantic Embedding And Reranker Retrieval To All Tool

Ordered, measurable work breakdown derived from `plan.md` slices S0–S13, the
`data-model.md` entity definitions, `contracts/ports.ts`, ADR-0007, and the
`doc/arch/schemas/semantic/tool-doc*.cue` mirrors to be authored under S0–S1. Every
task stays inside the `specScopeGlobs` declared in `doc/arch/speckit.toml`. Phase 1
(schema/protocol) is additive and non-breaking; no runtime tool-list behavior changes
until the Phase 3 consumption seams are deliberately turned on per surface — the V1
default keeps all three tool-search surfaces (native / MCP / code-mode) at the
full-set passthrough floor (FR18, C9, C15).

**Feature 009 extends the implemented Feature 006 stack; it does not build a second
one.** The embedding model, reranker model, Milvus adapter, pinned
`SemanticModelBinding` slots, nine-stage pipeline stages 1–6+9, deterministic
tie-break, shared query-embedding cache, blue/green cutover executor, degradation
ladder, multilingual posture, content-free telemetry, and offline eval harness are all
reused verbatim (FR2, ADR-0007). Feature 009 adds only: the `ToolDoc` corpus shape, the
tool-scoped retrieval pass (`tool-pass.ts`, stages 1–6+9, omitting the agent-only 7–8),
the sanitized tool projection, the three coalesced reindex triggers, the per-surface
Config.Service flags, and the ToolRegistry / MCP catalog / code-mode consumption seams.
The Milvus `tools` collection is a **derived, rebuildable projection**: it never grants
tool availability, never overrides Permission/Policy visibility, and never decides
execution — ToolRegistry, the Feature 008 MCP catalog, Permission/Policy, and
Config.Service remain the sources of truth (FR1, C15). Every candidate is revalidated
against live core before the model sees it (FR3, C11); the parameter-schema projection
is sanitized to a names/types/descriptions allowlist that strips `default`/`example`/
`const`/`format`/paths/secrets (FR7, C6); the query embedding is derived once per Task
and shared across surfaces (FR14, C8). Management flows exclusively through the reserved
`semantic.*` catalog already at `RESERVED_CATALOG_VERSION = "1.3.0"` — **no new operator
ID and no catalog bump** (FR22). The module name is `semantic` across every package.

The canonical wire shape is `contracts/ports.ts` mirrored one-to-one by the
`doc/arch/schemas/semantic/tool-doc*.cue` / `enums-tool.cue` mirrors and by
`data-model.md`: the closed **4-member** `ToolSource` (`native|mcp|custom|plugin`), the
3-member `ToolSearchSurface` (`native|mcp|code_mode`), the branded `ToolDocId` /
`ToolContentHash`, the `ToolDoc` entity composing the reused `DocIdentity` / `DocScope` /
`DocAvailability` shared parts plus `ToolClassification` and the sanitized
`ParameterSchemaProjection`, the fixed `collection: "tools"` discriminator on
`ToolRetrievalRequest`, the three-rung `ToolRetrievalRung`
(`full_semantic|lexical_only|full_set_passthrough`) distinct from the 006 `RetrievalMode`,
and the reused 006 `DegradationGapCode` / `SemanticScore` / `QueryFingerprint` /
`TaskProfile` / `CollectionKind` (which already includes `"tools"`). No consumer ever
receives a secret, a raw parameter schema, an unsanitized description, or a filesystem
path.

## Task Breakdown

### Schema and protocol foundation (Phase 1)

- [x] T001 [S0] Author the tool identifiers and enums: add `ToolDocId` (branded composed
  tool id — native `tool.id`, MCP `toolName(client, name)`) and `ToolContentHash` (the
  incremental upsert/tombstone hash that doubles as the C3 tie-break version leg) to
  `packages/schema/src/semantic/ids.ts`, and the closed `ToolSource`
  (`native|mcp|custom|plugin`) and `ToolSearchSurface` (`native|mcp|code_mode`)
  `Schema.Literals` to `packages/schema/src/semantic/enums-state.ts`, each built
  base-then-annotate-then-check-then-brand with no cross-feature import; mirror them
  one-to-one in the new `doc/arch/schemas/semantic/ids-tool.cue` and
  `doc/arch/schemas/semantic/enums-tool.cue` (the `Collection`/`CollectionKind` literal
  already carries `"tools"` and is NOT changed) (FR6, FR8, C6, C7). Acceptance:
  `tsgo --noEmit` on `packages/schema` green and the schema test asserts `ToolSource` is a
  closed 4-member literal, `ToolSearchSurface` a closed 3-member literal, and `ToolDocId`
  retains its root identifier (annotate-before-check) on the brand.
- [x] T002 [S1] Author `packages/schema/src/semantic/tool-doc.ts` composing the reused
  `DocIdentity` / `DocScope` / `DocAvailability` shared parts from `documents.ts` (never
  redefined) with the tool-specific `ToolClassification` (`source`, `displayName`,
  sanitized `description`, nullable `mcpServerRef`), the `ToolParameterProjection` (name /
  JSON-Schema `type` / optional description only) and the bounded
  `ParameterSchemaProjection` (`parameters`, `truncated` flag) into the `ToolDoc` entity
  (`id`, `identity`, `classification`, `parameterSchema`, `scope`, `languageTag`,
  `availability` — 7 fields, within the calisthenics bound), keeping the module out of the
  near-full `documents.ts` per the DDD-role split; mirror `doc/arch/schemas/semantic/tool-doc.cue`
  and `doc/arch/schemas/semantic/tool-doc-parts.cue` one-to-one per the `-doc`/`-parts`
  precedent; no inline secret, default value, path, or raw prompt/reasoning is a field
  (FR6, FR7, FR10, FR17, C6, C13, AC18). Acceptance: `tsgo --noEmit` green and the redaction
  test asserts `ToolDoc` composes the three shared parts, carries the scalar `project_id`/
  `permission_ref` via `DocScope` and a `languageTag`, and exposes no `default`/`example`/
  `const`/`format`/path/secret field.
- [x] T003 [S0–S1] Extend the barrel `packages/schema/src/semantic/index.ts` to re-export
  `tool-doc.ts` and the new tool identifiers/enums, and confirm the barrel is registered in
  `packages/schema/src/index.ts` (already exported for Feature 006). Acceptance:
  `tsgo --noEmit` on `packages/schema` green and `bun test packages/schema` imports the
  barrel without a duplicate-export error and the schema contract-hygiene test asserts
  annotate-before-check on the `ToolDocId`/`ToolContentHash` brands.
- [x] T004 [S2] Extend the protocol tool surface: add `ToolRetrievalRequest` (with the
  fixed `collection: Extract<CollectionKind, "tools">` discriminator research.md identifies —
  the schema `RetrievalRequest` already carries `collection`, the protocol one does not),
  `ToolCandidate`, `ToolRetrievalResult`, `ToolDegradationOutcome`, the `ToolReindexTriggerEvent`/
  `ToolIndexFlushInput`/`ToolIndexFlushOutput`/`ToolProjectionInput`/`ToolProjectionOutput`
  index payloads, and the `ToolSearchSurfaceConfig` shape to
  `packages/protocol/src/semantic/commands.ts`; add `ToolRetrievalPort.retrieveTools`,
  `ToolPipelineRunnerPort.runTools`, the C11 `ToolIndexPort` wrapper over the reused
  `IndexPort` (no new lifecycle machinery, C7), and `ToolSearchConfigPort` to
  `packages/protocol/src/semantic/ports.ts`; register both in
  `packages/protocol/src/semantic/index.ts` — **sourcing every enum member from the
  `packages/schema/src/semantic/*` modules** (`ToolSource`, `ToolRetrievalRung`, the reused
  `DegradationGapCode`/`SemanticScore`) so the transport contract cannot drift, redefining no
  006 enum, wire mirror, or reserved catalog (FR11, FR12, C2). Acceptance: `tsgo --noEmit` on
  `packages/protocol` green and the protocol parity test asserts each new interface matches
  `contracts/ports.ts` reconciled to the schema modules, the collection discriminator is fixed
  to `"tools"`, and `ToolRetrievalRung` is distinct from the 006 `RetrievalMode`.

### Domain tool-retrieval pass (Phase 2)

- [x] T005 [S3] Author `packages/core/src/semantic/tool-pass.ts` implementing the immutable
  tool runner over the injected recall/rerank/revalidate/clock ports, executing pipeline
  stages **1 profile → 2 filter → 3 recall → 4 reduce → 5 rerank → 6 score → 9 revalidate**
  and OMITTING the agent-only **7 select_agent / 8 skill_pass**, reusing
  `packages/core/src/semantic/hybrid-fusion.ts` and `packages/core/src/semantic/tie-break.ts`
  verbatim (the tie-break total order `rerank → dense → sparse → canonical id → version` with
  canonical id = composed tool id and version = tool content hash), preserving the original
  query text for embedding with no mandatory translation LLM call, deriving the query
  embedding once per Task fingerprint (shared across surfaces), keeping `retrieval_top_k` ≥
  `rerank_top_k` bounded and the result list bounded, with no I/O in the hot logic and no
  invented tool on empty recall; re-export it from the `packages/core/src/semantic/index.ts`
  barrel (FR11, FR12, FR13, FR14, FR15, FR16, C2, C3, AC1, AC4, AC8, AC13). Acceptance:
  `bun test packages/core` asserts the stage order is fixed (1–6+9, no 7/8), the tie-break
  yields a total order over colliding scores down to tool id/version, an empty-recall path
  yields no invented tool, and identical inputs yield identical ordering with deterministic
  ports; the core barrel imports without a duplicate-export error.

### Application, projection, triggers, and consumption seams (Phase 3)

- [ ] T006 [S4] Author `packages/opencode/src/semantic/tool-projection.ts` projecting one
  canonical `ToolDoc` from the boundary already exposed — `registry.ts` `tools()`
  (`tool.description` + `tool.jsonSchema`) and `mcp/catalog.ts` `convertTool` (`description` +
  `inputSchema`) — with a content hash driving incremental upsert/tombstone and the sanitized
  parameter-schema projection enforcing the names/types/descriptions allowlist that strips
  `default`/`example`/`const`/`format`, paths, and any free-form secret-bearing string, bounded
  by a size cap that sets `truncated` and lists dropped field NAMES only (never values), so a
  malicious description or a secret-looking default never reaches the index (FR5, FR6, FR7, FR8,
  FR10, FR17, C6, AC10, AC18). Acceptance: `bun test packages/opencode` asserts sanitization
  strips secrets/paths/`default`/`example`/`const`/`format`, a content-hash change drives upsert
  vs tombstone, `sanitizedFieldsDropped` carries names only, and no raw schema or path is stored.
- [ ] T007 [S6] Wire the `tools` collection into the existing generic multi-collection
  lifecycle: thread a tool `LiveDoc` projection input for `runReconcile` into
  `packages/opencode/src/semantic/index-jobs.ts` (already `CollectionKind`-generic) and confirm
  `packages/opencode/src/semantic/cutover-executor.ts` `CutoverInput.collections` carries
  `"tools"` so `tools` shares the single Feature 006 embedding binding generation and cuts over
  atomically with `agents`/`skills`/`skill_chunks` under one CAS — no new lifecycle machinery,
  content-hash idempotent upsert/tombstone, and `select`/`reindex` alone never activate the live
  alias (FR2, FR8, FR9, FR22, C7, NFR2, AC9, AC10). Acceptance: `bun test packages/opencode`
  asserts `tools` joins the collection set, cutover moves all collections atomically,
  select/reindex leave the alias inactive, an embedding dimension change forces a new generation,
  and reindex flows through the reused `semantic.index.*` operators with no new ID.
- [ ] T008 [S7] Author `packages/opencode/src/semantic/tool-reindex-trigger.ts` implementing the
  three coalesced triggers — (a) ToolRegistry corpus change (the **honest derived wiring point**:
  ToolRegistry emits no native change event per research.md, so this trigger is a documented
  derived hook, not a fabricated event), (b) the Feature 008 `mcp.tools_changed` event scoped to
  one affected server (wired in `packages/opencode/src/mcp/index.ts`), and (c) tool-relevant
  Config.Service change — coalescing per affected server/scope within a bounded window into one
  incremental content-hash pass, never a full rebuild, parallel to and independent from the
  Feature 008 resource-index opt-in trigger (`mcp/reindex-trigger.ts`) which is never merged
  (FR8, C11, NFR2, AC9). Acceptance: `bun test packages/opencode` asserts the three sources
  coalesce to one reindex pass, `mcp_tools_changed` is scoped to one server (never the whole
  corpus), the trigger is independent from the 008 resource trigger, and the native
  registry-change trigger is a documented derived hook.
- [ ] T009 [S5] Extend `packages/opencode/src/semantic/retrieval-facade.ts` with `retrieveTools`
  (composed by the same `createRetrievalFacade` alongside `retrieveAgents`/`retrieveSkills` — a
  sibling port, not a second facade), the injected `runTools` on `ToolPipelineRunnerPort`, the
  reused `budgetError` guard, and the honest `FEATURE_009_TOOL_SELECTION_SEAM` mirroring the
  implemented `FEATURE_001_SELECTION_SEAM` — a documented, typed, test-covered wiring point that
  is NOT invoked on any live route until a surface flag (C9) turns it on, recording the effective
  binding versions and Feature 004 language tag without content (FR1, FR11, FR14, FR15, FR17, C2,
  C15, NFR5, AC1, AC13). Acceptance: `bun test packages/opencode` asserts the facade returns
  revalidated ranked candidates, records the effective binding versions and language tag without
  content, and the `FEATURE_009_TOOL_SELECTION_SEAM` is present, covered by a seam test, and not
  reached by a live route under the V1 default flags.
- [ ] T010 [S9–S10] Author `packages/opencode/src/semantic/tool-retrieval.ts` composing the
  per-surface flag gate and the ranked-subset application, and wire the live-consumption seams:
  `packages/opencode/src/session/tools.ts` (native + MCP `resolve()` seam),
  `packages/opencode/src/tool/registry.ts` `tools()` + `describeCodeMode`, and
  `packages/opencode/src/tool/code-mode.ts` `describeCatalog` (ranked bounded-subset parameter),
  so the ranked subset is applied **after** `Permission.visibleTools` and NEVER widens it, gated
  by the per-surface enable flag with the V1 default off = full-set passthrough unchanged (FR1,
  FR3, FR4, FR5, C4, C9, C10, C15, NFR5, AC1, AC3, AC7, AC16). Acceptance: `bun test
  packages/opencode` asserts the ranked subset is applied after visibility and never widens it,
  a wildcard-denied tool never appears, the default-off path renders the full permission-visible
  set unchanged, and `describeCatalog` consumes the ranked subset only when the code-mode flag
  is on.
- [ ] T011 [S11] Extend the degradation posture by reusing `packages/core/src/semantic/degradation.ts`
  with the tool-specific third rung: the `ToolRetrievalRung`
  `full_semantic → lexical_only → full_set_passthrough` ladder, dropping to `lexical_only` with a
  typed reused `DegradationGapCode` on any Milvus/embedding/reranker outage, staleness, timeout,
  or unpinned binding, and to `full_set_passthrough` (today's unranked permission-visible set) as
  the absolute floor so tool availability is never worse than today, NEVER auto-selecting or
  substituting another embedding/reranker model (binding surfaces `degraded`/`unavailable`), with
  the per-surface fail-closed opt-in returning a typed capability-gap error instead of degrading
  (FR18, FR19, FR20, C14, NFR1, AC5, AC6, AC7, AC14, AC19). Acceptance: `bun test packages/core`
  covers each rung, no model substitution on outage, the passthrough floor keeping availability
  no worse than today, and a fail-closed surface returning a typed error rather than degrading.

### Configuration (Phase 4)

- [x] T012 [S8] Extend `packages/core/src/config/experimental.ts` with the per-surface
  tool-search config (enable flag per native/mcp/code-mode, `retrieval_top_k`, `rerank_top_k`,
  result bound, retrieval latency budget, cache TTL, per-surface fail-closed switch) and thread
  it through `packages/core/src/v1/config/config.ts` and the `ToolSearchConfigPort.get` read-only
  projection, with defaults keeping every surface at the full-set passthrough floor
  (`enabled=false`, `failClosed=false`), `retrieval_top_k`/`rerank_top_k` inheriting the Feature
  006 `Values.TopK` bound (rerank ≤ retrieval) and no result list unbounded; config mutation
  flows through the existing Config.Service write surface with no new operator command ID (FR13,
  FR18, FR21, C5, C9, C12, NFR1, NFR3, AC13, AC14, AC19). Acceptance: `bun test packages/core`
  asserts the defaults keep all three surfaces at the passthrough floor, `retrieval_top_k`/
  `rerank_top_k` are bounded by `Values.TopK` with rerank ≤ retrieval, and fail-closed is
  per-surface defaulting off.

### Telemetry, evaluation, tests, and validation (Phase 5)

- [ ] T013 [S12] Extend `packages/core/src/semantic/semantic-instruments.ts` with the content-free
  `retrieve.tools` / `rerank.tools` / `semantic.fallback` spans (the shared `embed.query` span
  reused when the query embedding is shared across surfaces) and the bounded metrics (candidates
  before/after, cache hit, fallback/stale counts, rerank delta buckets, selected tool rank
  buckets, latency) — tool ids, MCP server names, session ids, query text, vectors, and paths
  NEVER appear as labels and selected rank is a bounded bucket — and extend
  `packages/opencode/src/semantic/eval-harness.ts` with a tool-retrieval golden fixture set
  (query→tool relevance, recall@k/nDCG/MRR, multilingual pt/es/en, permission-leakage) reusing
  the same `EvalPort` and the fixed zero-leakage gate, mutating no binding (FR16, FR23, FR24,
  FR25, C16, AC2, AC15, AC20). Acceptance: `bun test packages/core`/`packages/opencode` cardinality
  audit asserts no tool-id/server/session/query/vector/path label and selected rank is a bounded
  bucket, and the tool golden set records per-locale recall/nDCG/MRR, fails on any leakage, and
  mutates no binding.
- [ ] T014 [S13] Add pure deterministic unit tests under `packages/core/test/semantic/**` (tool
  pass stage order 1–6+9 with no 7/8, tie-break with tool id/version, no invented tool on empty
  recall) and schema/protocol tests under `packages/schema/test/semantic/**` and
  `packages/protocol/test/semantic/**` (the closed 4-member `ToolSource`, the `ToolDoc` redaction —
  no default/example/const/format/path/secret, the sanitized `ParameterSchemaProjection`, and
  `protocol/semantic` parity against `contracts/ports.ts` reconciled to the schema modules with the
  fixed `"tools"` discriminator and `ToolRetrievalRung` distinct from `RetrievalMode`) with
  deterministic ports and no I/O (FR3, C2, C3, C6, AC1, AC3, AC4, AC8, AC15, AC18). Acceptance:
  `bun test packages/core`, `bun test packages/schema`, and `bun test packages/protocol` green.
- [ ] T015 [S13] Add integration and fault-injection tests under `packages/opencode/test/semantic/**`
  through the Feature 007 sandbox: the `tools` collection over the Milvus adapter (HNSW + hybrid
  recall under mandatory scalar `DocScope` filters, cross-project isolation, content-hash
  upsert/tombstone/reconcile), the shared-embedding cache reuse (native then MCP querying the same
  Task fingerprint reuse the query embedding), the degradation matrix (Milvus down → lexical_only,
  reranker down → dense/lexical order, embedder + Milvus down → full_set_passthrough, no binding
  pinned → floor, per-surface fail-closed opt-in → typed error, no model substitution), the
  operator reindex via the reused `semantic.index.reindex`/`status` with zero model tokens and no
  new ID, a prompt/plugin/MCP/registry binding-or-corpus mutation attempt leaving both unchanged,
  and surface parity across native/MCP/code-mode (FR4, FR10, FR20, FR22, NFR2, NFR4, AC5, AC6, AC9,
  AC10, AC11, AC12, AC16, AC17, AC19). Acceptance: `bun test packages/opencode` green against a
  standalone Milvus server when present and against the injected fake adapter otherwise, with every
  degradation, isolation, cache-reuse, reserved-ID, and mutation-attempt point asserted.
- [ ] T016 [S13] Run per-package `tsgo --noEmit` typecheck and `bun test` for `packages/schema`,
  `packages/protocol`, `packages/core`, and `packages/opencode`; then close out: tick every
  checkbox above once its task is complete and verified, confirm `speckit validate` is green with
  only the four pre-existing waived hygiene findings, and confirm every FR1–FR25, NFR1–NFR5, and
  AC1–AC20 is mapped to a task per the Traceability section (FR22, AC15, AC17). Acceptance: all
  four packages typecheck and test green, `speckit validate` green, and the Traceability tables
  fully mapped.

## Dependencies

Feature 009 is a strict extension: it introduces no new external system and reuses the
implemented substrate of Features 006, 007, and 008. The dependencies that MUST be
available before the tasks above begin:

- **Feature 006 semantic substrate (reused verbatim, never rebuilt).** The single
  embedding/reranker stack and pinned `SemanticModelBinding` slots, the Milvus adapter
  (`packages/opencode/src/semantic/milvus-adapter.ts`), `hybrid-fusion.ts` + `tie-break.ts`
  (T005), the query-embedding cache `query-cache.ts` keyed by
  `fingerprint + binding_version + config_hash` (T005, T015), the generic multi-collection
  `cutover-executor.ts` + `index-jobs.ts` (T007), `degradation.ts` (T011),
  `semantic-instruments.ts` (T013), `eval-harness.ts` (T013), the `retrieval-facade.ts`
  `FEATURE_001_SELECTION_SEAM` precedent (T009), the shared `documents.ts`
  `DocIdentity`/`DocScope`/`DocAvailability` (T002), and the `Collection`/`CollectionKind`
  literal that already carries `"tools"` (T001, T007) — all implemented by Feature 006.
- **Feature 008 MCP catalog and the `mcp.tools_changed` event.** The MCP tool catalog
  (`mcp/catalog.ts` `convertTool`, `mcp/index.ts` `tools()`) as the projection source (T006)
  and the `mcp.tools_changed` event consumed as the C11(b) reindex trigger, scoped to one
  server and never merged with the 008 resource-index opt-in trigger (T008).
- **Feature 007 Config.Service and the reserved `semantic.*` catalog.** Config.Service for
  the per-surface flags/bounds (T012) and the reserved `semantic.*` catalog already at
  `RESERVED_CATALOG_VERSION = "1.3.0"` — the `semantic.index.*` operators are reused for
  `tools` reindex/reconcile/status with **no new operator ID and no catalog bump** (T007,
  T015, T016; FR22).
- **Feature 004 Lang Lock language metadata** for the `ToolDoc` `languageTag` and the
  effective-tag-without-content record on the retrieval decision (T002, T006, T009, T013).
- **Feature 005 OutputSpool** for large tool-reindex job outputs as refs, never duplicated
  bodies (T007, T008).
- **Feature 001 Smart Routing** for the `top_k` / result-bound authority separation
  (`Values.TopK`) reused by the tool pass and config (T004, T005, T012).

## Traceability

Requirements-to-task and acceptance-to-task coverage. The closed **4-member** `ToolSource`
(`native|mcp|custom|plugin`), the 3-member `ToolSearchSurface`, the branded `ToolDocId`/
`ToolContentHash`, the `ToolDoc` entity composing the reused `DocIdentity`/`DocScope`/
`DocAvailability` shared parts, the fixed `collection: "tools"` discriminator, and the
three-rung `ToolRetrievalRung` (`full_semantic|lexical_only|full_set_passthrough`,
distinct from the 006 `RetrievalMode`) are the `contracts/ports.ts` / CUE / `data-model.md`
authority. T004 reconciles the protocol mirror to that authority and sources the
`protocol/semantic` enums directly from the `packages/schema/src/semantic/*` modules so the
transport contract cannot drift; T014 pins that parity across the draft contract, the
protocol mirror, and the schema modules. Every reused Feature 006 type keeps its 006
identity — Feature 009 forks no second embedding/rerank stack, Milvus adapter, or operator
command surface (FR2, FR22, ADR-0007).

| Requirement | Tasks |
| ----------- | ----- |
| FR1 authorities source of truth; projection only | T005, T009, T010 |
| FR2 reuse 006 stack; no second stack/adapter/surface | T005, T007, T009 |
| FR3 permission hard filter before + revalidate after | T005, T010 |
| FR4 LLM/plugin/MCP/registry no admin or mutation | T010, T015 |
| FR5 one canonical tool corpus across all surfaces | T006, T010 |
| FR6 tool document fields | T001, T002, T003, T006 |
| FR7 no secrets/prompts/reasoning/paths | T002, T006 |
| FR8 content-hash upsert/tombstone; incremental triggers | T006, T007, T008 |
| FR9 tools collection binding version/dimension | T007 |
| FR10 tenant/project scalar filters; no cross-project | T002, T006, T015 |
| FR11 ordered retrieval pipeline | T004, T005, T009 |
| FR12 lexical sparse + dense recall; rerank reduced | T005 |
| FR13 deterministic tie-break; bounded result | T005, T012 |
| FR14 query embedding once per Task; shared cache | T005, T009, T015 |
| FR15 score provenance; input to ordering only | T005, T009 |
| FR16 multilingual match; no translation LLM | T005, T013 |
| FR17 preserve query text; language tag on decision | T002, T006, T009 |
| FR18 degradation ladder; never hard failure | T011, T012 |
| FR19 never auto-substitute a model | T011 |
| FR20 bounded cache/breaker/retries; same binding | T011, T015 |
| FR21 per-surface Config.Service flags | T012 |
| FR22 no new operator IDs; reuse semantic.index.* | T007, T015 |
| FR23 tool-retrieval spans | T013 |
| FR24 bounded content-free metrics | T013 |
| FR25 offline golden eval | T013 |
| NFR1 latency budget; timeout → ladder | T011, T012 |
| NFR2 idempotent upsert/reconcile under concurrency | T007, T008 |
| NFR3 bounded candidate memory | T005, T012 |
| NFR4 no embed/search per token; shared reuse | T005, T015 |
| NFR5 seam compatible; no second registry/router | T009, T010 |

| Acceptance | Tasks |
| ---------- | ----- |
| AC1 relevant subset over full set | T005, T009, T010, T014 |
| AC2 multilingual query / English tools | T005, T013 |
| AC3 permission hard filter | T010, T014 |
| AC4 stale-index revalidation | T005, T014 |
| AC5 Milvus down — lexical fallback | T011, T015 |
| AC6 reranker down — dense/lexical ranking | T011, T015 |
| AC7 embedder down — full-set floor | T010, T011 |
| AC8 deterministic ties | T005, T014 |
| AC9 MCP list_changed reindex | T008, T015 |
| AC10 content-hash upsert | T006, T007, T015 |
| AC11 cross-project isolation | T015 |
| AC12 shared query embedding cache | T015 |
| AC13 top_k bounds | T005, T012, T014 |
| AC14 no binding, no crash | T011, T012 |
| AC15 telemetry content-free | T013, T014 |
| AC16 no binding mutation via LLM | T010, T015 |
| AC17 operator reindex via reserved IDs | T015 |
| AC18 sanitized schema projection | T002, T006, T014 |
| AC19 fail-closed opt-in | T011, T012, T015 |
| AC20 multilingual offline eval | T013 |
