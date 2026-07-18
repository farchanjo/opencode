/**
 * Feature 006 — Semantic retrieval protocol barrel (T014).
 *
 * Re-exports the shared identifiers, the reconciled closed enums (sourced from
 * `@opencode-ai/schema/semantic/*`), the 12-member `semantic.*` event vocabulary
 * (9 durable / 3 live), the provider/model/binding/index-generation/retrieval wire
 * read models, the retrieval + 30 `semantic.*` operator command payloads and typed
 * error unions from ./commands, and the `ProviderPort`/`ModelPort`/`BindingPort`/
 * `IndexPort`/`RetrievalPort`/`EvalPort` interfaces from ./ports, mirroring
 * doc/arch/sdd/006-add-milvus-backed-multilingual-semantic-retrieval-and/contracts/ports.ts
 * reconciled to the CUE authority.
 */

export * from "./commands"
export type { BindingPort, EvalPort, IndexPort, ModelPort, ProviderPort, RetrievalPort } from "./ports"
