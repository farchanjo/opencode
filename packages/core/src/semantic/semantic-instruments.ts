export * as SemanticInstruments from "./semantic-instruments"

import { Metric } from "effect"
import { TelemetryInstruments } from "../observability/telemetry-instruments"

// Feature 006 / T023 (S14) — Semantic Retrieval telemetry instruments
// (Observability, FR16, FR41, FR42, NFR3, C22, AC15).
//
// Adds no new exporter, SDK, or pipeline: the Feature 001 / ADR-0001 OTLP
// foundation (bounded async sink, drop-oldest/drop backpressure, redaction) stays
// the only export path, and async bounded export never blocks the profile /
// embed / retrieve / rerank / index hot path — when OTEL is unavailable retrieval
// continues and metric loss does not block routing (AC15). Query text, vectors,
// entity IDs, session IDs, and paths are NEVER metric labels — they stay in
// traces/logs only (C22, AC15); every dynamic label is passed through
// `TelemetryInstruments.boundEnum` / `createCardinalityAllowlist` so an
// out-of-budget value collapses to `OTHER` instead of growing cardinality
// unbounded. Every metric is content-free: only bounded enums, buckets, and
// counts. The effective binding versions and the Feature 004 language tag are
// recorded as bounded labels WITHOUT content (FR16).

export const OTHER = TelemetryInstruments.OTHER
export const boundEnum = TelemetryInstruments.boundEnum
export const createCardinalityAllowlist = TelemetryInstruments.createCardinalityAllowlist

// --- Concept spans --------------------------------------------------------
// The nine semantic.* concept spans (Observability). They link to — never
// replace — the Feature 001 concept spans; Feature 006 runs no second router or
// executor (C2, C22).

export const SpanName = {
  profile: "semantic.profile",
  embedQuery: "embed.query",
  retrieveAgents: "retrieve.agents",
  rerankAgents: "rerank.agents",
  retrieveSkills: "retrieve.skills",
  rerankSkills: "rerank.skills",
  fallback: "semantic.fallback",
  indexUpsert: "index.upsert",
  indexReconcile: "index.reconcile",
} as const
export type SpanName = (typeof SpanName)[keyof typeof SpanName]

// Feature 009 / T013 (S12) — the tool-search concept spans (Observability, FR23,
// C16, AC15). Kept in a SEPARATE object so the Feature 006 nine-span `SpanName`
// set is unchanged: `retrieve.tools` / `rerank.tools` are the two genuinely new
// tool spans, while `embed.query` and `semantic.fallback` are REUSED from
// `SpanName` verbatim (the query embedding is shared across surfaces, and the
// degradation floor is the same fallback span, C16). No span name carries a tool
// id, MCP server name, session id, query text, vector, or path.
export const ToolSpanName = {
  retrieveTools: "retrieve.tools",
  rerankTools: "rerank.tools",
  embedQuery: SpanName.embedQuery,
  fallback: SpanName.fallback,
} as const
export type ToolSpanName = (typeof ToolSpanName)[keyof typeof ToolSpanName]

/** The existing spans the semantic.* spans correlate with (Observability, FR41, C22). */
export const CorrelatedSpanName = {
  routingEvaluate: TelemetryInstruments.SpanName.routingEvaluate,
  taskExecute: TelemetryInstruments.SpanName.taskExecute,
  sessionExecution: "session.execution",
  llmRequest: TelemetryInstruments.SpanName.llmRequest,
  toolExecute: TelemetryInstruments.SpanName.toolExecute,
} as const
export type CorrelatedSpanName = (typeof CorrelatedSpanName)[keyof typeof CorrelatedSpanName]

// --- Bounded label enums ---------------------------------------------------
// Local literals mirroring `@opencode-ai/schema/semantic/enums(-state|-event)` so
// this module carries no cross-package dependency; the schema package stays the
// source of truth for the value sets (mirrors `jobs/jobs-instruments.ts`,
// `langlock/langlock-instruments.ts`, and `outputspool/spool-instruments.ts`).
// Every dynamic value is passed through `boundEnum` at record time so a label
// never exceeds its enum budget. `language_tag` is a bounded allowlisted enum
// (Feature 004 provenance), never a free-form id (FR16, C22, AC15).

export const Labels = {
  mode: ["full_semantic", "catalog_lexical", "fail_closed"] as const,
  gap: [
    "none",
    "milvus_unavailable",
    "embedding_unavailable",
    "reranker_unavailable",
    "index_stale",
    "retrieval_timeout",
    "no_binding",
    "cold_index",
  ] as const,
  collection: ["agents", "skills", "skill_chunks", "tools"] as const,
  slot: ["embedding", "reranker"] as const,
  binding_state: ["draft", "staged", "active", "degraded", "unavailable"] as const,
  rerank_profile: ["native-rerank", "structured-chat", "embedding-similarity"] as const,
  validation_status: ["validated", "declared", "failed", "stale"] as const,
  freshness: ["fresh", "bounded", "stale"] as const,
  language_tag: ["en-US", "en-CA", "en-GB", "en-AU", "pt-BR", "es-ES", "es-MX", "es-AR"] as const,
  outcome: ["success", "failure", "blocked", "degraded"] as const,
  // Feature 009 / T013 (S12) — the tool degradation ladder rung and the per-surface
  // enablement axis as bounded enums (FR18, FR21, FR24, C9, C14, C16, AC15). `tool_mode`
  // mirrors the schema `ToolRetrievalMode` (`full_set_passthrough` floor distinct from the
  // agent `catalog_lexical`); `surface` is the enablement KIND (native/mcp/code_mode),
  // NEVER an MCP server name or a tool id. Both are closed enums collapsing an
  // out-of-budget value to `other`, so cardinality stays bounded and content-free.
  tool_mode: ["full_semantic", "lexical_only", "full_set_passthrough", "fail_closed"] as const,
  surface: ["native", "mcp", "code_mode"] as const,
} as const

// --- Metric instruments -----------------------------------------------------
// Effect metrics; the Feature 001 OTLP exporter snapshots the registry on its
// export interval (C22). Names namespaced under `semantic.*`. Content-free: only
// latency/candidate/rank/freshness buckets and bounded-enum counts.

// Retrieval latency buckets (Observability). Values are milliseconds, never content.
export const retrieveLatencyMs = Metric.histogram("semantic.retrieve.latency_ms", {
  description: "End-to-end retrieval latency in milliseconds",
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
})

// Candidate-count buckets before (recalled) and after (selected) the pipeline (NFR3).
export const candidatesRecalled = Metric.histogram("semantic.candidates.recalled", {
  description: "Number of candidates recalled by hybrid recall before rerank",
  boundaries: [0, 1, 2, 3, 5, 8, 13, 21, 34, 55],
})
export const candidatesSelected = Metric.histogram("semantic.candidates.selected", {
  description: "Number of candidates surviving rerank and revalidation",
  boundaries: [0, 1, 2, 3, 5, 8, 13, 21],
})

// Rerank-delta and selected-rank buckets (Observability). Deltas/ranks, never content.
export const rerankDelta = Metric.histogram("semantic.rerank.delta", {
  description: "Rank movement induced by rerank versus dense recall order",
  boundaries: [0, 1, 2, 3, 5, 8, 13, 21],
})
export const selectedRank = Metric.histogram("semantic.selected.rank", {
  description: "Final semantic rank of the selected candidate",
  boundaries: [0, 1, 2, 3, 5, 8, 13, 21],
})

// Index freshness buckets (Observability). Age in milliseconds, never content.
export const indexFreshnessMs = Metric.histogram("semantic.index.freshness_ms", {
  description: "Projection staleness age at retrieval time, in milliseconds",
  boundaries: [100, 500, 1000, 5000, 30000, 60000, 300000, 900000],
})

// Cache hit/miss counters (Observability): once-per-Task embedding reuse (AC16).
export const cacheHit = Metric.counter("semantic.cache.hit", {
  description: "Count of query-embedding cache hits reused across passes",
  incremental: true,
})
export const cacheMiss = Metric.counter("semantic.cache.miss", {
  description: "Count of query-embedding cache misses (one embed per fingerprint)",
  incremental: true,
})

// Fallback / stale / failure counters (Observability): degradation-ladder signals,
// labelled by the bounded mode/gap enums only, never content (FR24, C20, C22).
export const fallbackCount = Metric.counter("semantic.fallback.count", {
  description: "Count of drops to the catalog_lexical/fail_closed degradation floor",
  incremental: true,
})
export const staleCount = Metric.counter("semantic.stale.count", {
  description: "Count of stale-confidence candidates degraded out of semantic scoring",
  incremental: true,
})
export const failureCount = Metric.counter("semantic.failures", {
  description: "Count of retrieval/index failures classified by bounded gap/outcome",
  incremental: true,
})

// Index-maintenance counters (Observability): content-hash upsert/tombstone/reconcile.
export const indexUpsert = Metric.counter("semantic.index.upsert", {
  description: "Count of content-hash upserts into the current generation",
  incremental: true,
})
export const indexTombstone = Metric.counter("semantic.index.tombstone", {
  description: "Count of tombstones removing entities absent from live core",
  incremental: true,
})
export const indexReconcile = Metric.counter("semantic.index.reconcile", {
  description: "Count of scheduled reconcile passes over the pinned binding",
  incremental: true,
})

// Feature 009 / T013 (S12) — tool-search telemetry REUSES the content-free
// instruments above verbatim (FR23, FR24, C16, AC15). A tool pass records the same
// `retrieveLatencyMs`, `candidatesRecalled` / `candidatesSelected` before/after
// buckets, `cacheHit` / `cacheMiss` (the shared query embedding), `fallbackCount` /
// `staleCount`, `rerankDelta`, `selectedRank` (the selected TOOL rank as a bounded
// bucket, NEVER the tool id), and `indexUpsert` / `indexTombstone` / `indexReconcile`
// counters, distinguished ONLY by the bounded `collection: "tools"`, `tool_mode`, and
// `surface` labels — never a tool id, MCP server name, session id, query, vector, or
// path. Feature 009 adds no new metric instrument and no new exporter.
export const TOOL_METRICS = Object.freeze([
  retrieveLatencyMs,
  candidatesRecalled,
  candidatesSelected,
  cacheHit,
  cacheMiss,
  fallbackCount,
  staleCount,
  rerankDelta,
  selectedRank,
  indexUpsert,
  indexTombstone,
  indexReconcile,
])
