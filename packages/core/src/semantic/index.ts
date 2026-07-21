/**
 * Feature 006 — Semantic Retrieval domain engine barrel (T024).
 *
 * Re-exports every framework-free `packages/core/src/semantic/*` domain module
 * under its own namespace, one line per module, mirroring
 * `packages/core/src/jobs/index.ts`, `packages/core/src/lifecycle/index.ts`,
 * `packages/core/src/langlock/index.ts`, and `packages/core/src/outputspool/index.ts`,
 * and each module's own `export * as X from "./x"` self-export. This file defines
 * no domain logic of its own.
 *
 * The domain engine is pure and deterministic over injected embedding / recall /
 * rerank / core-state / clock ports (C2): the immutable nine-stage pipeline, the
 * deterministic tie-break and hybrid fusion, the binding and index-generation
 * state machines, the typed degradation ladder, the once-per-Task query-embedding
 * cache, the freshness/revalidation gate, the projection/sanitization engine, and
 * the content-free telemetry instruments. The real Milvus gRPC client, the
 * OpenAI-compatible HTTP calls, the SSRF URL guard, and the durable-event
 * projection live in the `packages/opencode/src/semantic/**` application layer.
 */

export * as AgentDocBuilder from "./agent-doc"
export * as BindingLifecycle from "./binding-lifecycle"
export * as Degradation from "./degradation"
export * as FreshnessGate from "./freshness-gate"
export * as HybridFusion from "./hybrid-fusion"
export * as IndexGeneration from "./index-generation"
export * as Pipeline from "./pipeline"
export * as Projection from "./projection"
export * as QueryCache from "./query-cache"
export * as SemanticInstruments from "./semantic-instruments"
export * as SkillChunker from "./skill-chunk"
export * as SkillDocBuilder from "./skill-doc"
export * as TieBreak from "./tie-break"
export * as ToolPass from "./tool-pass"
