/**
 * Feature 006 / T034 (S22) — the typed `semantic.*` domain implementation
 * backing the Feature 007 operator control plane (C15, C19, FR28-FR35).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and the
 * reserved-name guard; Feature 006 supplies ONLY these typed
 * `ProviderPort`/`ModelPort`/`BindingPort`/`IndexPort` domain implementations plus
 * their audit events. The 30 reserved `semantic.*` ids (`semantic.provider.*` 7,
 * `semantic.model.*` 5, `semantic.embedding.*` 6, `semantic.reranker.*` 5,
 * `semantic.binding.*` 2, `semantic.index.*` 5) already live in
 * `packages/core/src/operator/catalog.ts` at `RESERVED_CATALOG_VERSION = "1.3.0"`
 * — NO catalog bump is performed and no id is added here (C15). Ordinary
 * status/show/select/config make ZERO provider/model calls; only explicit
 * validate/test call the candidate endpoint via a fixed native probe with
 * cost/data disclosure. No LLM/router/agent/plugin/MCP may set/update/delete a
 * binding; binding mutation happens only via `embedding.select`/`cutover` and
 * `reranker.select`/`cutover` (the `semantic.binding.*` pair is read-only).
 *
 * The backend seam (`SemanticBackend`) is the un-audited domain surface the
 * Feature 006 application adapters collectively provide; the composition root
 * injects the real implementations, or an honest capability gap when the live
 * Milvus/provider stack is not reachable (see backend-live.ts). This module never
 * returns a secret, a raw endpoint, or a filesystem path in a view (C19, C22).
 */
export * as SemanticOperatorPort from "./semantic-port"

import type { BindingPort, IndexPort, ModelPort, ProviderPort } from "@opencode-ai/protocol/semantic/ports"
import type { Effect } from "effect"
import type { SemanticRegistryBackend } from "./registry-backend"

/** A bounded, secret-free operator audit event (never a query/secret/endpoint/path, C22). */
export interface SemanticAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "unauthorized" | "conflict" | "denied" | "unavailable"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface SemanticAuditSink {
  readonly record: (event: SemanticAuditEvent) => Effect.Effect<void>
}

/**
 * The narrow domain seam the Feature 006 application adapters provide, one
 * namespaced port per reserved group. The four ports carry the 30 reserved ids;
 * `semantic.binding.*` reads project from the same `BindingPort` (C15).
 */
export interface SemanticBackend {
  readonly provider: ProviderPort
  readonly model: ModelPort
  readonly binding: BindingPort
  readonly index: IndexPort
  /**
   * The config-backed registry half (Feature 014 T009). When bound, the command
   * adapter routes the config-backed reads + mutations (`provider.*` except `test`,
   * `model.list|register|disable`, `binding.status|history`, `embedding|reranker`
   * `show|select`) through it as CAS round-trip plans; the Milvus/provider-probe
   * ops stay the typed capability gap on the four ports above (FR8). Unset falls
   * back to the honest gap on the ports (backward-compatible).
   */
  readonly registry?: SemanticRegistryBackend
}

/** The typed operator port; a thin pass-through over the injected backend (mirrors outputspool-port). */
export type SemanticPort = SemanticBackend

export interface SemanticPortDeps {
  readonly backend: SemanticBackend
}

/**
 * Build the typed `semantic.*` operator port over the injected domain backend.
 * The backend authors the audit-correlation ids and the operator-only mutation
 * guard; this port is the stable surface the command adapter and the CLI/TUI
 * consume (FR28, C15).
 */
export const createSemanticPort = (deps: SemanticPortDeps): SemanticPort => deps.backend
