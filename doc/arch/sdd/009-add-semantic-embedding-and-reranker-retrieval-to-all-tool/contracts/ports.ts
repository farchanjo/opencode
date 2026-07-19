/**
 * Feature 009 — Application Ports (Semantic Tool Search: Embeddings + Reranker
 * extended to the native ToolRegistry, MCP tool catalog, and code-mode catalog)
 *
 * These interfaces sketch the inbound ports Feature 009 ADDS on top of the
 * IMPLEMENTED Feature 006 stack. They are implemented by a new domain runner
 * (`packages/core/src/semantic/tool-pass.ts`) and application adapters
 * (`packages/opencode/src/semantic/{tool-projection,tool-reindex-trigger,
 * tool-retrieval}.ts`), and are consumed by the native `ToolRegistry.Service`
 * (`packages/opencode/src/tool/registry.ts`), the Feature 008 MCP catalog
 * (`packages/opencode/src/mcp/index.ts`), and `tool/code-mode.ts`
 * `describeCatalog` — all gated by the per-surface Config.Service flags (C9).
 *
 * REUSE DISCIPLINE: this file does NOT redeclare any Feature 006 enum, wire
 * mirror, or port already implemented and contracted in
 * `../../006-add-milvus-backed-multilingual-semantic-retrieval-and/contracts/ports.ts`
 * — it imports the exact reused shapes from that sibling contract file and
 * only declares what Feature 009 genuinely adds: the `ToolDoc` corpus shape,
 * `ToolRetrievalPort`/`retrieveTools`, the tool-specific three-rung
 * degradation ladder (C14, distinct from the 006 `RetrievalMode`), the C11
 * trigger-coalescing `ToolIndexPort` wrapper over the REUSED 006 `IndexPort`
 * (no new lifecycle machinery, C7), and the per-surface config port shape
 * (C9, C12). Every reused type keeps its 006 identity; nothing here forks a
 * second embedding/rerank stack, a second Milvus adapter, or a second
 * operator command surface (FR2, FR22, ADR-0007).
 *
 * Wire-shape source of truth for the genuinely new shapes: the forthcoming
 * `doc/arch/schemas/semantic/{tool-doc,tool-doc-parts,enums-tool}.cue` (S0,
 * S1 of `plan.md`, not yet authored — this file is the forward TypeScript
 * sketch those CUE mirrors will match one-to-one, per the `-doc`/`-parts`
 * precedent already used by `agent-doc.cue`/`document-parts.cue`). This file
 * does not redefine `packages/schema/src/semantic/documents.ts`
 * (`DocIdentity`/`DocScope`/`DocAvailability`, IMPLEMENTED) — those three
 * shared value objects are mirrored here read-only, exactly as `AgentDoc` /
 * `SkillDoc` compose them, because `ToolDoc` reuses them verbatim (C6, C13).
 */

import type { Effect } from "effect"
import type {
  CollectionKind,
  DegradationGapCode,
  OperatorPrincipal,
  OutputRef,
  QueryFingerprint,
  RetrievalFilters,
  Scope,
  SemanticScore,
  TaskProfile,
} from "../../006-add-milvus-backed-multilingual-semantic-retrieval-and/contracts/ports"

// =============================================================================
// Reused 006 shapes (imported above, listed here only for traceability —
// NEVER redeclared): CollectionKind (already includes "tools", C7),
// DegradationGapCode (the 6 typed capability-gap codes, C14),
// OperatorPrincipal, OutputRef (Feature 005 ref), QueryFingerprint (the C8
// shared query-embedding cache key), RetrievalFilters (mandatory scalar
// project/role/permission predicates, C13), Scope ("project" | "global"),
// SemanticScore (rerank/dense/sparse score provenance + confidence, reused
// verbatim by the tool tie-break, C3), TaskProfile (the C1 structured query
// that drives every pass, including the tool pass).
// =============================================================================

// =============================================================================
// New identifiers (wire shape: doc/arch/schemas/semantic/ids-tool.cue, S0)
// =============================================================================

/** Composed canonical tool document id (native `tool.id`; MCP `toolName(client, name)`, FR6). */
export type ToolDocId = string

/** Stable content hash driving incremental upsert/tombstone for one ToolDoc (FR8, C3 — doubles as the tie-break version leg). */
export type ToolContentHash = string

// =============================================================================
// New closed enum (wire shape: doc/arch/schemas/semantic/enums-tool.cue, S0)
// =============================================================================

/** The four tool provenance sources a ToolDoc may project from (FR6, C6). */
export type ToolSource = "native" | "mcp" | "custom" | "plugin"

/** The three tool-search consumption surfaces gated independently by Config.Service (FR21, C9, C12). */
export type ToolSearchSurface = "native" | "mcp" | "code_mode"

// =============================================================================
// Reused 006 document shared parts (mirrored read-only from the IMPLEMENTED
// packages/schema/src/semantic/documents.ts — never redefined, C6, C13)
// =============================================================================

/** Same shape as `documents.ts` `DocIdentity`: version, content hash, source tag (FR10, FR11, FR13). */
export interface DocIdentity {
  readonly version: number
  readonly content_hash: string
  readonly source: string
}

/** Same shape as `documents.ts` `DocScope`: the C13 mandatory scalar partition/filter set (FR9, FR34, C6). */
export interface DocScope {
  readonly project_id: string
  readonly scope: "project" | "global" | "session"
  readonly visibility: "project" | "global" | "shared"
  readonly permission_ref: string
}

/** Same shape as `documents.ts` `DocAvailability`: live enabled/available state, revalidated before injection (FR20, stage 9). */
export interface DocAvailability {
  readonly enabled: boolean
  readonly available: boolean
}

// =============================================================================
// ToolDoc corpus shape (wire shape: doc/arch/schemas/semantic/tool-doc-parts.cue, S1)
// =============================================================================

/** One sanitized parameter entry surviving the C6 projection allowlist — names, types, descriptions only (FR6, FR7, AC18). */
export interface ToolParameterProjection {
  readonly name: string
  readonly schemaType: string // JSON-Schema `type` value only, never `default`/`example`/`const`/`format` (FR7)
  readonly description?: string
}

/**
 * The bounded parameter-schema projection (FR6, FR7, C6). `truncated` is set
 * when the source JSON Schema exceeded the size cap (AC18); it is a bounded
 * flag, never the dropped content.
 */
export interface ParameterSchemaProjection {
  readonly parameters: readonly ToolParameterProjection[]
  readonly truncated: boolean
}

/** Tool classification part: provenance, display name, sanitized description, MCP server ref when applicable (FR6). */
export interface ToolClassification {
  readonly source: ToolSource
  readonly displayName: string
  readonly description: string // sanitized; never a raw prompt/reasoning payload (FR7)
  readonly mcpServerRef?: string // set only when source is "mcp" (FR6)
}

// =============================================================================
// ToolDoc entity (wire shape: doc/arch/schemas/semantic/tool-doc.cue, S1)
// =============================================================================

/**
 * The `tools` collection projection entity (FR6, C6, C13). Mirrors the
 * `AgentDoc`/`SkillDoc` composition exactly — id + `DocIdentity` +
 * classification + a document-specific projection + `DocScope` +
 * `languageTag` + `DocAvailability` — 7 fields, within the calisthenics
 * ≤7-field bound. `id` is the canonical composed tool id (never an embedded
 * entity, matching the AgentDoc/SkillDoc `id` convention).
 */
export interface ToolDoc {
  readonly id: ToolDocId
  readonly identity: DocIdentity
  readonly classification: ToolClassification
  readonly parameterSchema: ParameterSchemaProjection
  readonly scope: DocScope
  readonly languageTag: string // Feature 004 Lang Lock effective tag (FR6, FR17)
  readonly availability: DocAvailability
}

// =============================================================================
// Tool retrieval request/result (wire shape: doc/arch/schemas/semantic/retrieval-tool.cue)
// =============================================================================

/**
 * Protocol-layer tool-retrieval request. The schema `RetrievalRequest`
 * ALREADY carries `collection: EnumsState.Collection` (which already
 * includes `"tools"`); the protocol `RetrievalRequest` at
 * `packages/protocol/src/semantic/commands.ts` does NOT — this is the small,
 * typed protocol addition research.md identifies (a fixed `collection:
 * "tools"` discriminator), not a redesign of the reused shape (C2).
 */
export interface ToolRetrievalRequest {
  readonly profile: TaskProfile // reused verbatim (imported above, C1)
  readonly retrievalTopK: number // inherits the 006 `Values.TopK` bound via the reused `budgetError` guard (C5)
  readonly rerankTopK: number // MUST be <= retrievalTopK, enforced by the reused `budgetError` guard (C5)
  readonly filters: RetrievalFilters // reused verbatim (imported above, C13)
  readonly collection: Extract<CollectionKind, "tools"> // fixed discriminator; CollectionKind reused, not redeclared (C2, C7)
}

/** One candidate surviving the tool pass through stage 9 revalidation (FR3, FR11, C2). */
export interface ToolCandidate {
  readonly canonicalId: ToolDocId
  readonly canonicalVersion: ToolContentHash // C3: the tie-break version leg is the tool content hash, not a numeric version
  readonly source: ToolSource
  readonly mcpServerRef?: string
  readonly score: SemanticScore // reused verbatim; the tie-break comparator is the same code (C3)
  readonly revalidated: boolean // false only before stage 9 completes; never returned to a caller as true otherwise
}

/**
 * The tool-specific three-rung degradation ladder (C14). Distinct from the
 * 006 `RetrievalMode` (`full_semantic | catalog_lexical | fail_closed`,
 * `packages/schema/src/semantic/enums-state.ts`) because the tool floor is
 * NOT `fail_closed` by default — it is the current full-set exposure
 * (`full_set_passthrough`), so tool availability is never worse than today
 * unless an operator has opted a surface into fail-closed (C12). This is a
 * genuine Feature 009 addition, not a reuse of `RetrievalMode`.
 */
export type ToolRetrievalRung = "full_semantic" | "lexical_only" | "full_set_passthrough"

/** Explicit degraded outcome for one tool-retrieval call; never a silent empty result (FR18, FR19, C14). */
export interface ToolDegradationOutcome {
  readonly rung: ToolRetrievalRung
  readonly gapCode?: DegradationGapCode // reused verbatim from 006 (imported above); same 6 typed codes, no tool-specific gap vocabulary
  readonly reason?: string
}

/** Stage-9 tool result; `cacheHit` reports {@link QueryFingerprint} reuse across native/MCP/code-mode (FR14, C8). */
export interface ToolRetrievalResult {
  readonly candidates: readonly ToolCandidate[]
  readonly degradation: ToolDegradationOutcome
  readonly queryFingerprint: QueryFingerprint // reused verbatim (imported above, C8)
  readonly cacheHit: boolean
}

// =============================================================================
// ToolRetrievalPort — retrieveTools (FR11-FR15, C2, C15)
// =============================================================================

/**
 * Extends the 006 retrieval seam rather than forking a router (C2): composed
 * by the SAME `createRetrievalFacade` alongside `retrieveAgents`/
 * `retrieveSkills` — a sibling port, not a second facade. The tool pass runs
 * pipeline stages 1 profile -> 2 filter -> 3 recall -> 4 reduce -> 5 rerank ->
 * 6 score -> 9 revalidate, reusing `hybrid-fusion.ts`/`tie-break.ts`
 * verbatim and OMITTING the agent-only 7 select_agent / 8 skill_pass (C2).
 * Consumed only through the honest {@link FEATURE_009_TOOL_SELECTION_SEAM}
 * below until a surface flag (C9) deliberately wires it into
 * `session/tools.ts` / `registry.ts` `tools()` / `code-mode.ts`
 * `describeCatalog`.
 */
export interface ToolRetrievalPort {
  readonly retrieveTools: (input: ToolRetrievalRequest) => Effect.Effect<ToolRetrievalResult, ToolRetrievalError>
}

/**
 * The injected pipeline runner Feature 009 adds alongside the 006
 * `PipelineRunnerPort.runAgents`/`runSkills` (see the 006 contracts file);
 * `tool-pass.ts` implements this signature with zero framework/I/O
 * dependencies (C2).
 */
export interface ToolPipelineRunnerPort {
  readonly runTools: (request: ToolRetrievalRequest) => Promise<ToolPipelineOutcome>
}

/** The domain-layer tool pass outcome before facade assembly (mirrors the 006 `PipelineOutcome` shape, C2). */
export interface ToolPipelineOutcome {
  readonly candidates: readonly ToolCandidate[]
  readonly degradation: ToolDegradationOutcome
}

export type ToolRetrievalError =
  | { readonly type: "invalid_profile"; readonly reason: string }
  | { readonly type: "budget_exceeded"; readonly field: "retrieval_top_k" | "rerank_top_k" | "result_bound" } // guards C5
  | { readonly type: "timeout" } // triggers the C14 ladder at the call site, never surfaced as a hard failure by itself
  | { readonly type: "fail_closed_denied"; readonly surface: ToolSearchSurface; readonly gapCode?: DegradationGapCode } // guards the C12 per-surface opt-in
  | { readonly type: "not_implemented" }

/**
 * HONEST V1 SEAM (C15): mirrors the IMPLEMENTED `FEATURE_001_SELECTION_SEAM`
 * (`packages/opencode/src/semantic/retrieval-facade.ts:162`) exactly. This
 * wave delivers the facade, the domain tool pass, and this DOCUMENTED,
 * typed, test-covered wiring point — it does NOT silently rewrite the live
 * LLM tool list. `session/tools.ts` `resolve()` and `registry.ts` `tools()`/
 * `describeCodeMode` would call `port.retrieveTools(...)` here once a
 * surface flag (C9) is deliberately turned on; with every surface at its C9
 * default (off), this function is reachable only from tests, never from a
 * live route (FR1, FR11, NFR5).
 */
export const FEATURE_009_TOOL_SELECTION_SEAM = (port: ToolRetrievalPort): ToolRetrievalPort => port

// =============================================================================
// ToolIndexPort — the C11 trigger-coalescing wrapper over the REUSED 006
// IndexPort (FR8, FR9, C7, C11) — NOT a second index/reindex/reconcile surface
// =============================================================================

/** The three C11 trigger sources; `mcp_tools_changed` is scoped to one server, never the whole corpus (C11b). */
export type ToolReindexTriggerSource = "registry_change" | "mcp_tools_changed" | "config_change"

/** One raw trigger event before coalescing (FR8, C11). */
export interface ToolReindexTriggerEvent {
  readonly source: ToolReindexTriggerSource
  readonly mcpServerId?: string // set only for `mcp_tools_changed` (C11b); absent otherwise
  readonly occurredAt: string // ISO-8601
}

/** One coalesced flush target after the bounded coalescing window closes (NFR2, C11). */
export interface ToolIndexFlushInput {
  readonly affectedMcpServerId?: string // narrows the reindex to one server's tool documents (C11b)
  readonly principal: OperatorPrincipal // reused verbatim (imported above); "system" for automatic triggers, an operator principal when reused by manual `semantic.index.reindex` (FR22)
}

/** Mirrors the reused 006 `IndexReindexOutput` shape for the `tools` collection (FR8, FR13, C7). */
export interface ToolIndexFlushOutput {
  readonly upsertedCount: number
  readonly tombstonedCount: number
  readonly outputRef: OutputRef // reused verbatim (imported above); Feature 005 ref for the job log
}

/** Input to the sanitized ToolDoc projection (C6, FR6, FR7); sourced from the registry/MCP boundary already exposed. */
export interface ToolProjectionInput {
  readonly source: ToolSource
  readonly toolId: ToolDocId // native `tool.id`; MCP composed `toolName(client, name)`
  readonly displayName: string
  readonly mcpServerRef?: string
  readonly rawDescription: string // native `tool.description`; MCP `convertTool` description
  readonly rawParameterSchema: unknown // native `tool.jsonSchema`; MCP `convertTool` inputSchema — a JSONSchema7, NEVER stored raw
  readonly scope: DocScope
  readonly languageTag: string
}

/** Output of the sanitized ToolDoc projection; `sanitizedFieldsDropped` lists field NAMES only, never dropped values (AC18). */
export interface ToolProjectionOutput {
  readonly doc: ToolDoc
  readonly sanitizedFieldsDropped: readonly string[] // e.g. ["default", "example", "const", "format"]; content-free by construction
}

/**
 * `ToolIndexPort` owns ONLY the three-source trigger intake, the bounded
 * coalescing window, and the sanitized projection (`project`). Every actual
 * upsert/tombstone pass flows through the REUSED 006 `IndexPort.reindex({
 * collection: "tools" })` / `IndexPort.reconcile({ collection: "tools" })`
 * (imported conceptually from the 006 contracts `IndexPort` — already
 * generic over `CollectionKind`, which already includes `"tools"`; no new
 * lifecycle machinery, C7). This port is the parallel, independent sibling
 * of the Feature 008 resource-index trigger
 * (`packages/opencode/src/mcp/reindex-trigger.ts`) — never merged with it
 * (C11).
 */
export interface ToolIndexPort {
  /** Records one of the three C11 trigger sources; never reindexes synchronously (NFR2). */
  readonly recordTrigger: (event: ToolReindexTriggerEvent) => Effect.Effect<void, never>
  /** Flushes the coalesced window for one affected scope/server, driving the reused `IndexPort.reindex` (FR8, C7, C11). */
  readonly flush: (input: ToolIndexFlushInput) => Effect.Effect<ToolIndexFlushOutput, ToolIndexError>
  /** Projects one boundary tool record into a sanitized, content-hashed `ToolDoc` (FR6, FR7, FR8, C6). */
  readonly project: (input: ToolProjectionInput) => Effect.Effect<ToolProjectionOutput, ToolIndexError>
}

export type ToolIndexError =
  | { readonly type: "milvus_unavailable"; readonly reason: string } // reused gap vocabulary shape (006 C1), scoped to the tools collection
  | { readonly type: "reconcile_in_progress"; readonly collection: Extract<CollectionKind, "tools"> }
  | { readonly type: "schema_projection_too_large"; readonly toolId: ToolDocId } // guards the AC18 size cap
  | { readonly type: "denied"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// Per-surface Config.Service flags (FR21, C9, C12) — read-only projection;
// mutation flows through the existing Config.Service surface, no new
// operator command ID (FR22)
// =============================================================================

/**
 * One surface's tool-search configuration (FR21). `enabled` and
 * `failClosed` both default to `false` for every surface (C9, C12) — the
 * V1 floor is the unranked full-set passthrough, identical to today's
 * behavior, until an operator deliberately opts a surface in.
 */
export interface ToolSearchSurfaceConfig {
  readonly surface: ToolSearchSurface
  readonly enabled: boolean // default false (C9)
  readonly failClosed: boolean // default false; per-surface, never global-only (C12)
  readonly retrievalTopK: number // inherits the 006 `Values.TopK` bound (C5)
  readonly rerankTopK: number // MUST be <= retrievalTopK (C5)
  readonly resultBound: number // small bounded result list, never unbounded (C5, FR13)
  readonly latencyBudgetMs: number // expiry triggers the C14 ladder, never blocks exposure (C5, NFR1)
  readonly cacheTtlMs: number // local last-known index-metadata cache TTL; invalidates by binding_version/config_hash (C8)
}

/**
 * Read-only projection of the Config.Service experimental schema fields
 * Feature 009 adds (`packages/core/src/config/experimental.ts`,
 * `packages/core/src/v1/config/config.ts`). Config MUTATION is NOT a new
 * port here — it flows through the existing Config.Service write surface;
 * Feature 009 registers no new operator command ID (FR22).
 */
export interface ToolSearchConfigPort {
  readonly get: (surface: ToolSearchSurface) => Effect.Effect<ToolSearchSurfaceConfig, ToolSearchConfigError>
}

export type ToolSearchConfigError =
  | { readonly type: "invalid_argument"; readonly field: string }
  | { readonly type: "not_implemented" }

// =============================================================================
// Reused operator surface — NO new IDs (FR22)
// =============================================================================

/**
 * Documentation-only reminder: `tools` collection reindex/reconcile/status
 * flow through the reused reserved `semantic.index.reindex` /
 * `semantic.index.reconcile` / `semantic.index.status` /
 * `semantic.index.show-collections` operator IDs already registered at
 * `RESERVED_CATALOG_VERSION = "1.3.0"` (`packages/core/src/operator/catalog.ts`,
 * mirrored in the 006 contracts `RESERVED_SEMANTIC_COMMAND_IDS`). Feature 009
 * registers ZERO new operator command IDs and requires no catalog bump
 * (FR22).
 */
export const FEATURE_009_REUSES_RESERVED_SEMANTIC_INDEX_IDS = [
  "semantic.index.status",
  "semantic.index.reindex",
  "semantic.index.reconcile",
  "semantic.index.show-collections",
] as const
