# Data Model: Semantic Tool Search (Feature 009)

Feature: [009 Semantic Tool Search (Embeddings + Reranker)](spec.md)
Plan: [plan.md](plan.md)
Research: [research.md](research.md)
ADR: [ADR-0007 Semantic Tool Search](../../adr/0007-add-semantic-embedding-and-reranker-retrieval-to-all-tool.md) (proposed; Option A — extend the Feature 006 stack with a `tools` collection)
Status: draft (finalized in the tasks phase; `retrieval_top_k` / `rerank_top_k` / result
bound / latency budget / cache TTL and the parameter-schema sanitization allowlist and size
cap are provisional plan constants resolved in ADR-0007 and the tasks phase — C5, C6, C8,
C9, C12)

**Feature 009 extends the Feature 006 data model; it does not fork one.** The
[Feature 006 data model](../006-add-milvus-backed-multilingual-semantic-retrieval-and/data-model.md)
already owns every shared shape this feature reuses verbatim: `DocIdentity` / `DocScope` /
`DocAvailability`, `TaskProfile` / `QueryFingerprint`, `RetrievalRequest`, `Candidate` /
`CandidateList` / `SemanticScore`, `IndexGeneration` / `CollectionAlias`, the `Collection`
namespace (which **already includes `"tools"`**), the `DegradationGap` typed capability
codes, the `Values.TopK` / `LatencyBudgetMs` budget windows, the query-embedding cache key,
and the content-free `semantic.*` event envelope. Feature 009 adds **only** the shapes
below: the `ToolDoc` projection entity and its tool-specific parts, one branded tool id and
its ranking ref, five tool enums, the tool retrieval result/degradation outcome, the three
coalesced reindex trigger shapes, and the per-surface config. Every added shape is a
**derived, rebuildable projection or a transient value object** — never a second tool
registry, availability authority, permission authority, or execution decider beside
ToolRegistry, the Feature 008 MCP catalog, Permission/Policy, and Config.Service (FR1, C15).
Every retrieved tool candidate is revalidated against live ToolRegistry / MCP / Permission
before it reaches the model (FR3, C11). No record embeds a secret, credential, prompt,
reasoning, private payload, or filesystem path (FR7, C6).

## Schema surface conventions

All TypeScript shapes use this repository's Effect `Schema` v4 surface exactly as the
Feature 006 data model documents — matching `packages/schema/src/schema.ts` and the existing
`packages/schema/src/semantic/**`, `lifecycle/**`, `jobs/**`, `langlock/**`, and
`outputspool/**` modules:

- Closed enums use `Schema.Literals([...])`; a single discriminant literal uses
  `Schema.Literal("...")`.
- **Annotate-first on a plain base for every checked scalar.** Each identifier, counter, and
  bounded-text ValueObject is built on the plain `Schema.String` / `Schema.Number` base,
  `.annotate({ identifier })` is applied BEFORE any `.check(...)`, and `Schema.brand(...)` is
  applied last for identifier-shaped definitions. Annotating an already-checked schema drops
  the root identifier from `.ast.annotations` in favor of the last check, so
  base-then-check-then-brand is load-bearing for contract hygiene (see
  `packages/schema/src/semantic/ids.ts` and `test/contract-hygiene.test.ts`).
- Optional keys use the shared `optional(...)` helper; explicit nullable fields use
  `Schema.NullOr(...)`.
- First-class collections wrap a named element with `Schema.Array(Element)`; no bare arrays.
- No stale `Schema.literal` / `Schema.Clamp` / `Schema.Positive` / bare `Schema.Number`
  forms are used; those are not part of this repository's surface.

Each shape names its target module under `packages/schema/src/semantic/**` and mirrors a CUE
definition under `doc/arch/schemas/semantic/*.cue` one-to-one. The new CUE packages/files this
feature adds are `tool-shared.cue` (`semantic.shared`), `enums-tool.cue` (`semantic.enums`),
`tool-doc.cue` + `tool-doc-parts.cue` (`semantic.documents`), `tool-retrieval.cue`
(`semantic.retrieval`), `tool-trigger.cue` (`semantic.index`), and `tool-config.cue`
(`semantic.config`); `budget-values.cue` and `retrieval.cue` gain one field each.

---

## Reused-verbatim shapes (NOT redefined here)

| Reused shape | Feature 006 module / CUE | How Feature 009 reuses it |
| ------------ | ------------------------ | ------------------------- |
| `DocIdentity` / `DocScope` / `DocAvailability` | `documents.ts` / `document-shared.cue` | composed by `ToolDoc`; `DocScope.project_id` is the mandatory scalar tool-search filter (C13) |
| `TaskProfile` / `QueryFingerprint` | `profile.ts` / `profile.cue` | drives the tool pass as stage 1; the fingerprint keys the shared query-embedding cache (C1, C8) |
| `RetrievalRequest` | `retrieval.ts` / `retrieval.cue` | reused with `collection: "tools"`; no new request type (C2) |
| `Candidate` / `CandidateList` / `SemanticScore` | `retrieval.ts` / `retrieval.cue` | a tool candidate reuses `Candidate`; its `candidate_ref` union gains `ToolRef` (C2, C3) |
| `Collection` | `enums-state.ts` / `enums-state.cue` | `"tools"` member already present — no enum change (C7) |
| `DegradationGap` | `enums-state.ts` / `enums-state.cue` | reused as the typed capability-gap code on the tool outcome (C14) |
| `Values.TopK` / `LatencyBudgetMs` | `values.ts` / `budget-values.cue` | `retrieval_top_k` / `rerank_top_k` / result bound / latency budget inherit these bounds (C5) |
| `IndexGeneration` / `CollectionAlias` | `index-generation.ts` / `*.cue` | `tools` joins the single binding generation and the generic multi-collection cutover (C7) |
| `SemanticEnvelope` + `semantic.index_*` events | `events.ts` / `events*.cue` | `tools` reindex/tombstone/reconcile reuse the existing durable event members (FR8, C11) |

---

## Tool identifiers and flags (FR6, FR7, C6)

The composed tool id keys the `ToolDoc` entity with stable identity across content-hash
upserts; the tool ref is a ranking pointer revalidated against live ToolRegistry / MCP /
Permission, never an embedded Entity (FR3, C11). The MCP server ref is a Feature 008 catalog
handle, null on native tools. Neither id widens to a filesystem path; the id character class
is widened over the Feature 006 `idPattern` only to admit the `.` / `:` composition
separators of `mcp`-composed tool ids. Mirrors `tool-shared.cue`.

```typescript
// packages/schema/src/semantic/ids.ts (extend) — grouped with the existing Doc ids

const toolIdPattern = /^[A-Za-z0-9_.:-]{1,192}$/
const idPattern = /^[A-Za-z0-9_-]{1,128}$/ // reused from Feature 006

// ToolDocId is the canonical composed tool id keying one ToolDoc projection (FR6, C6).
export const ToolDocId = Schema.String.annotate({ identifier: "SemanticIds.ToolDocId" })
  .check(Schema.isPattern(toolIdPattern)).pipe(Schema.brand("Semantic.ToolDocId"))
export type ToolDocId = typeof ToolDocId.Type

// ToolRef is a ranking pointer revalidated against ToolRegistry/MCP/Permission (FR3, C11).
export const ToolRef = Schema.String.annotate({ identifier: "SemanticRefs.ToolRef" })
  .check(Schema.isPattern(toolIdPattern)).pipe(Schema.brand("Semantic.ToolRef"))

// McpServerRef references the Feature 008 MCP server owning a tool; null on native tools (FR6, C11).
export const McpServerRef = Schema.String.annotate({ identifier: "SemanticRefs.McpServerRef" })
  .check(Schema.isPattern(idPattern)).pipe(Schema.brand("Semantic.McpServerRef"))
```

```typescript
// packages/schema/src/semantic/text-values.ts (extend) — flag + TTL

// Truncated flags whether the bounded parameter-schema projection was size-capped (FR7, C6, AC18).
export const Truncated = Schema.Boolean.annotate({ identifier: "SemanticFlags.Truncated" })

// packages/schema/src/semantic/values.ts (extend) — bounded safety TTL
// CacheTtlMs is the bounded safety TTL; version/hash invalidation leads it (FR20, FR21, C8).
export const CacheTtlMs = Schema.Number.annotate({ identifier: "SemanticBudget.CacheTtlMs" })
  .check(Schema.isInt(), Schema.isGreaterThan(0))
```

---

## Tool enumerations (FR6, FR8, FR18, FR21, C6, C9, C11, C14)

Every enum is a ValueObject (calisthenics). The degradation ladder rung never auto-substitutes
a model; `full_set_passthrough` is the absolute floor that keeps tool exposure no worse than
today (FR19, C14). The per-surface axis gates live consumption and defaults off (C9, C12, C15).
Mirrors `enums-tool.cue`.

```typescript
// packages/schema/src/semantic/enums-state.ts (extend)

// ToolSource is the provenance of a projected tool document (FR6, C6).
export const ToolSource = Schema.Literals(["native", "mcp", "custom", "plugin"])
  .annotate({ identifier: "SemanticEnums.ToolSource" })

// JsonSchemaType is the sanitized parameter type kept in the bounded projection (FR7, C6, AC18).
export const JsonSchemaType = Schema.Literals(["string", "number", "integer", "boolean", "object", "array", "null"])
  .annotate({ identifier: "SemanticEnums.JsonSchemaType" })

// ToolRetrievalMode is the tool degradation ladder rung; full_set_passthrough is the floor (FR18, C14).
export const ToolRetrievalMode = Schema.Literals(["full_semantic", "lexical_only", "full_set_passthrough", "fail_closed"])
  .annotate({ identifier: "SemanticEnums.ToolRetrievalMode" })

// ToolSurface is the per-surface enablement axis gating live consumption; default off (FR21, C9, C12, C15).
export const ToolSurface = Schema.Literals(["native", "mcp", "code_mode"])
  .annotate({ identifier: "SemanticEnums.ToolSurface" })

// ToolTriggerSource is the origin of an incremental tool reindex, coalesced per scope (FR8, C11).
export const ToolTriggerSource = Schema.Literals(["registry_change", "mcp_tools_changed", "config_change"])
  .annotate({ identifier: "SemanticEnums.ToolTriggerSource" })
```

The tool ladder maps the three-rung C14 degradation onto `ToolRetrievalMode`:

| Rung | `ToolRetrievalMode` | Trigger | Typed `DegradationGap` |
| ---- | ------------------- | ------- | ---------------------- |
| Full semantic | `full_semantic` | pinned binding + Milvus/index healthy | `none` |
| Lexical-only | `lexical_only` | embedder / reranker / Milvus unavailable, stale, or timed out | `milvus_unavailable` / `embedding_unavailable` / `reranker_unavailable` / `index_stale` / `retrieval_timeout` / `no_binding` |
| Full-set passthrough (floor) | `full_set_passthrough` | below lexical — the entire permission-visible set, unranked (today's behavior) | `cold_index` / `no_binding` |
| Operator opt-in | `fail_closed` | per-surface fail-closed configured (C12) | typed capability-gap error, no degrade |

---

## ToolDoc entity + parts (FR5, FR6, FR7, C6, C13)

`ToolDoc` is the single canonical projection in the `tools` collection covering all three
surfaces (native ToolRegistry, MCP catalog, code-mode). It is an **Entity** (stable canonical
identity across content-hash upserts). Descriptor and parameter projection are ranking signals
only — a malicious description never widens permission or execution authority (FR3, C15).
Volatile availability is never an authority field; every candidate is revalidated against live
ToolRegistry / MCP / Permission before it reaches the model (FR3, C11). The **parameter-schema
projection is the only Feature-009-novel sub-object**: it keeps parameter names, JSON-Schema
types, and descriptions ONLY, stripping `default` / `example` / `const` values, `format`,
paths, and any free-form string that could carry a secret, bounded by a size cap with a
truncation flag (FR7, C6, AC18). Mirrors `tool-doc.cue` and `tool-doc-parts.cue`.

```typescript
// packages/schema/src/semantic/tool-doc.ts (new) — kept out of documents.ts for the ≤10-def bound

import { DocIdentity, DocScope, DocAvailability } from "./documents"
import { ToolDocId, McpServerRef, Truncated } from "./ids"
import { ToolSource, JsonSchemaType } from "./enums-state"
import { DisplayName, Name, Description, LanguageTag } from "./text-values"

// Sanitized display name, source, MCP server ref, and description (FR6, C6).
export const ToolDescriptor = Schema.Struct({
  name: DisplayName,
  source: ToolSource,
  server_ref: Schema.NullOr(McpServerRef),   // null on native/custom/plugin (FR6, C11)
  description: Description,                   // ranking signal only (FR15)
})

// One sanitized parameter: name, JSON-Schema type, description — no value/format/path (FR7, C6, AC18).
export const ToolParameter = Schema.Struct({
  name: Name,
  type: JsonSchemaType,
  description: Description,
})
export const ToolParameterSet = Schema.Array(ToolParameter)

// Bounded parameter-schema projection with a size-cap truncation flag (FR7, C6, AC18).
export const ToolParameterProjection = Schema.Struct({
  parameters: ToolParameterSet,
  truncated: Truncated,
})

export const ToolDoc = Schema.Struct({
  id: ToolDocId,                             // entity identity — canonical composed tool id (FR6)
  identity: DocIdentity,                     // version + content_hash + source; drives upsert/tombstone (FR8, AC10)
  descriptor: ToolDescriptor,
  parameters: ToolParameterProjection,
  scope: DocScope,                           // scalar project partition filtered every search (FR10, C13)
  language: LanguageTag,                     // Feature 004 Lang Lock provenance of the English text (FR16, FR17)
  availability: DocAvailability,             // mirrors live core; revalidated before injection (FR3, C11)
})
export type ToolDoc = Schema.Schema.Type<typeof ToolDoc>
```

**Sanitization constraints (AC18).** The projection builder in `tool-projection.ts` applies a
strict allowlist: for each parameter it keeps `name`, maps its JSON-Schema `type` onto
`JsonSchemaType` (unknown/compound types collapse to the nearest base or `object`), and keeps
`description`. It drops `default`, `example`, `const`, `enum` values, `format`, `pattern`,
`$ref` targets, and every other keyword. Parameter count and cumulative description length are
bounded by the size cap; overflow sets `truncated = true`. The `content_hash` in `DocIdentity`
is computed over the sanitized projection only, so a change to a stripped field never
re-embeds and a change to a kept field always does (FR8, AC10).

---

## Tool retrieval request and result (FR11, FR12, C1, C2, C3, C5, C14)

Tool retrieval reuses the Feature 006 `RetrievalRequest` verbatim with `collection: "tools"`;
there is no second request type (C2). The `Candidate` union is widened by one member so a tool
candidate carries a `ToolRef` ranking pointer under the same ranking contract and tie-break
(C3). Feature 009 adds only the tool-specific result and degradation outcome, whose floor is
the full permission-visible set (C14). Mirrors `retrieval.cue` (Candidate edit) and
`tool-retrieval.cue`.

```typescript
// packages/schema/src/semantic/retrieval.ts (extend the Candidate union)

export const Candidate = Schema.Struct({
  candidate_ref: Schema.Union(AgentRef, SkillRef, ToolRef),  // +ToolRef (FR20, C2, C11)
  collection: Collection,                                     // "tools" for a tool candidate (C7)
  score: SemanticScore,
  rank: TopK,
  freshness: FreshnessBucket,
})

// packages/schema/src/semantic/tool-retrieval.ts (new)

import { CandidateList } from "./retrieval"
import { ToolRetrievalMode } from "./enums-state"
import { DegradationGap } from "./enums-state"
import { DegradedReason, Fingerprint } from "./text-values"

// Tool ladder rung, typed capability gap, and explicit reason — never a silent model swap (FR18, C14).
export const ToolDegradationOutcome = Schema.Struct({
  mode: ToolRetrievalMode,
  gap: DegradationGap,
  degraded_reason: Schema.NullOr(DegradedReason),
})

// Ranked, revalidated tool candidates + effective rung + fingerprint for content-free correlation (FR11, C14, C16).
export const ToolRetrievalResult = Schema.Struct({
  candidates: CandidateList,                 // bounded by top_k / result bound (FR13, NFR3, C5)
  mode: ToolRetrievalMode,
  outcome: ToolDegradationOutcome,
  fingerprint: Fingerprint,
})
export type ToolRetrievalResult = Schema.Schema.Type<typeof ToolRetrievalResult>
```

**Pipeline stages (C2).** The `tool-pass.ts` runner executes stages **1 profile → 2 filter →
3 recall → 4 reduce → 5 rerank → 6 score → 9 revalidate**, reusing `hybrid-fusion.ts` and
`tie-break.ts` verbatim and omitting the agent-only **7 select_agent / 8 skill_pass**. The
tie-break total order is reused unchanged — `rerank → dense → sparse → canonical id →
version` — where the canonical id is the composed tool id and the version is the tool content
hash (C3). `retrieval_top_k` / `rerank_top_k` inherit the `Values.TopK` bound enforced by the
reused facade `budgetError` guard (C5).

---

## Tool reindex triggers and coalescing (FR8, NFR2, C11)

Three triggers — ToolRegistry corpus change, the Feature 008 `mcp.tools_changed` event for one
server, and a tool-relevant Config.Service change — coalesce per affected server/scope within a
bounded window into one incremental content-hash upsert/tombstone pass, never a full rebuild.
This tool trigger is independent from and parallel to the Feature 008 resource-index opt-in;
tools and resources are distinct document kinds (C11). Mirrors `tool-trigger.cue`.

```typescript
// packages/schema/src/semantic/tool-trigger.ts (new)

import { ProjectId } from "./ids"
import { McpServerRef } from "./ids"
import { ToolTriggerSource } from "./enums-state"

// One incremental reindex trigger scoped to a project and optional server (FR8, C11).
export const ToolReindexTrigger = Schema.Struct({
  source: ToolTriggerSource,
  project_id: ProjectId,
  server_ref: Schema.NullOr(McpServerRef),   // present only for mcp_tools_changed (C11)
})
export const ToolTriggerSet = Schema.Array(ToolReindexTrigger)

// Coalesced reindex batch per affected server/scope; one pass per burst (FR8, NFR2, C11).
export const ToolReindexBatch = Schema.Struct({
  project_id: ProjectId,
  server_ref: Schema.NullOr(McpServerRef),
  triggers: ToolTriggerSet,
})
export type ToolReindexBatch = Schema.Schema.Type<typeof ToolReindexBatch>
```

The batch feeds the already-generic `index-jobs.ts` `coalesceTriggers` / `runReconcile` and the
`tools` member of `cutover-executor.ts` `CutoverInput.collections`; no new lifecycle machinery
is added (C7). Reindex/tombstone/reconcile publish the existing durable `semantic.index_upserted`
/ `semantic.index_tombstoned` / `semantic.index_reconciled` events with `collection: "tools"`.

---

## Per-surface tool-search config (FR13, FR21, C5, C9, C12)

Enablement is a per-surface Config.Service flag; V1 defaults every surface to the full-set
passthrough floor so no surface silently narrows the model's tool list before deliberate opt-in
(FR18, C9, C15). Fail-closed is per-surface and defaults off — degrade, never hard-fail (FR18,
C12). Mirrors `tool-config.cue`; threaded through `packages/core/src/config/experimental.ts` and
`packages/core/src/v1/config/config.ts` (Feature 007 Config.Service).

```typescript
// packages/schema/src/semantic/tool-config.ts (new) — mirrored into Config.Service Experimental

import { ToolSurface } from "./enums-state"
import { Enabled } from "./text-values"
import { TopK, LatencyBudgetMs, CacheTtlMs } from "./values"

// Per-surface enablement + fail-closed; both default false = full-set floor (FR21, C9, C12).
export const ToolSurfaceConfig = Schema.Struct({
  surface: ToolSurface,
  enabled: Enabled,        // default false (C9)
  fail_closed: Enabled,    // default false (C12)
})
export const ToolSurfaceConfigSet = Schema.Array(ToolSurfaceConfig)

// Bounded tool-search config over all surfaces; every window bounded, no unbounded list (FR13, C5).
export const ToolSearchConfig = Schema.Struct({
  surfaces: ToolSurfaceConfigSet,
  retrieval_top_k: TopK,
  rerank_top_k: TopK,
  result_bound: TopK,
  latency_budget_ms: LatencyBudgetMs,
  cache_ttl_ms: CacheTtlMs,
})
export type ToolSearchConfig = Schema.Schema.Type<typeof ToolSearchConfig>
```

---

## Offline eval extension (FR25, C16)

The offline golden harness `packages/opencode/src/semantic/eval-harness.ts` is reused verbatim;
`GoldenCase` and `runGolden` are id-generic (recall@k / nDCG / MRR per pt-BR/es/en locale with a
fixed zero-tolerance permission-leakage gate). Feature 009 adds a tool-retrieval golden set
where the expected relevance targets are `ToolRef` ids — no new harness, no new `EvalPort`, and
no online self-optimizing policy (out of scope for V1). This shape lives in TS only (test
fixtures); it has no CUE mirror.

```typescript
// packages/opencode/test/semantic/tool-golden.ts (new fixtures) — reuses the id-generic GoldenCase

// A tool golden case: a multilingual query fingerprint → the expected relevant ToolRef set,
// plus the permission-hidden ToolRefs that MUST NEVER appear (zero-leakage gate) (FR25, C16, AC20).
export const ToolGoldenCase = Schema.Struct({
  profile: TaskProfile,                      // reused query representation (C1)
  expected: ToolRefSet,                      // relevance targets (recall@k / nDCG / MRR)
  forbidden: ToolRefSet,                     // permission-hidden; zero-leakage tolerance (AC3, AC11, AC20)
})
export const ToolRefSet = Schema.Array(ToolRef)
```

---

## Parameters

Every provisional contract is declared here as a plan constant with a named acceptance hook;
ADR-0007 and the tasks phase fix final values (plan Non-goals; C5, C6, C8, C9, C12). No value
is a hidden default: each is an explicit, overridable data constant on the domain module, never
inlined into an algorithm. Tool ids never appear as metric labels; selected rank is a bounded
bucket, reusing the Feature 001 / Feature 006 cardinality allowlist (FR24, C16, AC15).
`retrieval_top_k` / `rerank_top_k` / result bound / latency budget are the Feature 006
`Values.TopK` / `LatencyBudgetMs` windows, never a parallel store (FR13, C5).

| Parameter | Provisional default | Scope | Acceptance hook |
| --------- | ------------------- | ----- | --------------- |
| `retrieval_top_k` | inherits Feature 006 `Values.TopK` (64 provisional) | per recall | FR13, C5, AC13 |
| `rerank_top_k` | inherits Feature 006 `Values.TopK` (16 provisional; ≤ retrieval window) | per rerank | FR13, C5, AC13 |
| `tool_result_bound` | small bounded list (single-digit-to-low-tens) | per result | FR13, C5, AC13 |
| `retrieval_latency_budget_ms` | low hundreds of ms; timeout → C14 ladder | per retrieval | NFR1, C5, AC13 |
| `param_schema_allowlist` | keep name/type/description; strip default/example/const/format/pattern/path | per tool document | FR7, C6, AC18 |
| `param_schema_size_cap` | bounded parameter count + cumulative description length; overflow sets `truncated` | per tool document | FR7, C6, AC18 |
| `tie_break_order` | reused verbatim: rerank → dense → sparse → composed tool id → content hash | per ranking | FR13, C3, AC8 |
| `sparse_signal` | reuse/extend `Permission.visibleTools` wildcard/name-and-id matching | per recall | FR12, C4, AC1 |
| `partition_grammar` | scalar `DocScope.project_id`; mandatory filter every search | per collection | FR10, C13, AC11 |
| `surface_enable_default` | native / MCP / code-mode all OFF = full-set passthrough floor | per surface | FR18, FR21, C9, AC7, AC14 |
| `fail_closed_default` | per-surface, OFF (degrade, never hard-fail) | per surface | FR18, C12, AC19 |
| `query_cache_ttl` / `cache_ttl_ms` | invalidate by binding version + config hash; bounded safety TTL | per fingerprint | FR14, FR20, C8, AC12 |
| `metadata_cache_ttl` | last-known index metadata cache; version/hash invalidation | per binding | FR20, C8, AC12 |
| `coalesce_window` | bounded window collapsing a catalog-churn burst into one pass | per server/scope | FR8, NFR2, C11, AC9 |
| `eval_thresholds` | recall@k / nDCG / MRR bars; permission-leakage tolerance zero | offline eval | FR25, C16, AC20 |
| `selected_rank_buckets` | bounded rank buckets; tool ids never labels | metric labels | FR24, C16, AC15 |

Feature 006 telemetry queue / cardinality-allowlist / budget-policy constants, the Feature 006
`Values.TopK` / `LatencyBudgetMs` bounds, and the Feature 007 Config.Service CAS/idempotency
parameters are reused unchanged and are not re-declared here (C5, C7, C8).

---

## Cross-artifact traceability

| Entity / shape | CUE mirror | TS module | Requirements / clarifications |
| -------------- | ---------- | --------- | ----------------------------- |
| `ToolDocId` / `ToolRef` / `McpServerRef` / `Truncated` | `tool-shared.cue` | `ids.ts`, `text-values.ts` (extend) | FR6, FR7, C6, C11 |
| `CacheTtlMs` | `budget-values.cue` (extend) | `values.ts` (extend) | FR20, FR21, C8 |
| `ToolSource` / `JsonSchemaType` / `ToolRetrievalMode` / `ToolSurface` / `ToolTriggerSource` | `enums-tool.cue` | `enums-state.ts` (extend) | FR6, FR8, FR18, FR21, C6, C9, C11, C14 |
| `ToolDoc` / `ToolDescriptor` / `ToolParameter*` | `tool-doc.cue`, `tool-doc-parts.cue` | `tool-doc.ts` | FR5, FR6, FR7, C6, C13, AC10, AC18 |
| `Candidate` (+`ToolRef`) / `ToolDegradationOutcome` / `ToolRetrievalResult` | `retrieval.cue` (edit), `tool-retrieval.cue` | `retrieval.ts` (edit), `tool-retrieval.ts` | FR11, FR12, FR13, FR18, C2, C3, C5, C14 |
| `ToolReindexTrigger` / `ToolTriggerSet` / `ToolReindexBatch` | `tool-trigger.cue` | `tool-trigger.ts` | FR8, NFR2, C11 |
| `ToolSurfaceConfig` / `ToolSearchConfig` | `tool-config.cue` | `tool-config.ts`, `experimental.ts` (Feature 007) | FR13, FR21, C5, C9, C12 |
| `ToolGoldenCase` / `ToolRefSet` (eval fixtures) | — (TS test only) | `eval-harness.ts` (reused), `tool-golden.ts` | FR25, C16, AC20 |

---

## Notes on authority and reuse

- No shape here is a second store of record: ToolRegistry, the Feature 008 MCP catalog,
  Permission/Policy, and Config.Service remain the sources of truth; the Milvus `tools`
  collection is a rebuildable projection revalidated against live core before injection
  (FR1, FR3, C11, C15).
- `ToolDoc` reuses `DocIdentity` / `DocScope` / `DocAvailability` and the `Collection`
  namespace unchanged; `tools` shares the single Feature 006 binding generation and the generic
  multi-collection cutover — no new lifecycle machinery (FR9, C7).
- Budgets (`retrieval_top_k`, `rerank_top_k`, result bound, latency budget) inherit the Feature
  006 `Values.TopK` / `LatencyBudgetMs`; telemetry reuses the content-free bounded-cardinality
  helpers and the single exporter — no new exporter, SDK, or pipeline (FR13, FR24, C5, C16).
- Feature 009 registers no new operator command IDs; `tools` reindex/reconcile/status flow
  through the reserved `semantic.index.*` catalog at `RESERVED_CATALOG_VERSION = 1.3.0` (FR22).
