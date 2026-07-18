/**
 * Feature 006 / T037 — application/adapters semantic barrel (S13–S23).
 *
 * Re-exports every `packages/opencode/src/semantic/*` application module under its
 * own namespace, one line per module, mirroring the core/schema/protocol semantic
 * barrels and the outputspool/langlock application barrels. This file defines no
 * logic of its own.
 *
 * The application layer owns the real Milvus gRPC driver (chosen per the T025
 * gRPC-under-Bun finding), the OpenAI-compatible embedding/rerank transport, the
 * SSRF-safe URL/DNS guard, the content-hash index jobs and blue/green cutover
 * executor, the SecretRef-only credential resolution, the durable/live
 * `semantic.*` event projection, the offline golden eval harness, and the
 * retrieval facade with its documented Feature 001 seam — all behind injected
 * ports so an unreachable backend is an honest typed gap, never a hard failure
 * (FR7, C1, C20).
 */

export * as GrpcProbe from "./grpc-probe"
export * as MilvusAdapter from "./milvus-adapter"
export * as EmbeddingClient from "./embedding-client"
export * as RerankClient from "./rerank-client"
export * as UrlGuard from "./url-guard"
export * as IndexJobs from "./index-jobs"
export * as CutoverExecutor from "./cutover-executor"
export * as CredentialResolver from "./credential-resolver"
export * as DurableEvents from "./durable-events"
export * as EvalHarness from "./eval-harness"
export * as RetrievalFacade from "./retrieval-facade"
