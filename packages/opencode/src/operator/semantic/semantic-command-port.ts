/**
 * Feature 006 / T034 (S22) — the `semantic.*` inbound command adapter.
 *
 * Bridges the 30 reserved Feature 007 `semantic.*` operator command ids to the
 * typed `SemanticPort` (T034) through the Feature 007 dispatcher's `DomainInvoke`
 * seam, exactly like `outputspool-command-port.ts` (Feature 005) and
 * `langlock-command-port.ts` (Feature 004). Feature 007 remains the SOLE
 * registration authority: this adapter registers NO command ids — it only
 * supplies the `semantic` domain `invoke`, replacing the `not_implemented` stub.
 * Reserved-id collisions (`semantic.*`) are rejected by the Feature 007
 * reserved-name guard; `RESERVED_SEMANTIC_IDS` mirrors the catalog so a
 * plugin/MCP/custom registration of these ids is refused with a structured
 * `reserved_name` error (C15).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission):
 * the payload never reaches a model, and ordinary status/show/select/config make
 * ZERO provider/model calls (FR28, AC14). Mutations carry an operator principal +
 * explicit scope + version/CAS + idempotency enforced by the backend and return a
 * redacted result; `cutover`/`rollback`/`delete`-or-`disable`-when-bound/
 * `rotate-secret` require the `confirmed` flag, and the backend returns
 * `confirmation_required` without it (C15). No LLM/router/agent/plugin/MCP may set
 * a binding — binding mutation happens only via `embedding.*`/`reranker.*`; the
 * `semantic.binding.*` pair is read-only. This adapter emits exactly one bounded,
 * secret-free audit event per dispatch (C22).
 */
export * as SemanticCommandPort from "./semantic-command-port"

import { Effect } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import type { CapabilityKind, CollectionKind, EndpointMode, OperatorPrincipal, RerankProfile, Scope } from "@opencode-ai/protocol/semantic/commands"
import type { FailureHandlerResult, HandlerContext, HandlerResult } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { SemanticAuditEvent, SemanticAuditSink, SemanticPort } from "./semantic-port"

/** The 30 reserved `semantic.*` operator ids (catalog 1.3.0); a plugin/MCP collision is rejected (C15). */
export const RESERVED_SEMANTIC_IDS: ReadonlySet<string> = new Set([
  "semantic.provider.list", "semantic.provider.add", "semantic.provider.update", "semantic.provider.test",
  "semantic.provider.disable", "semantic.provider.delete", "semantic.provider.rotate-secret",
  "semantic.model.list", "semantic.model.discover", "semantic.model.register", "semantic.model.validate", "semantic.model.disable",
  "semantic.embedding.show", "semantic.embedding.select", "semantic.embedding.validate", "semantic.embedding.reindex",
  "semantic.embedding.cutover", "semantic.embedding.rollback",
  "semantic.reranker.show", "semantic.reranker.select", "semantic.reranker.validate", "semantic.reranker.cutover", "semantic.reranker.rollback",
  "semantic.binding.status", "semantic.binding.history",
  "semantic.index.status", "semantic.index.test", "semantic.index.reindex", "semantic.index.reconcile", "semantic.index.show-collections",
])

/** True when `id` is a reserved semantic operator id; plugin/MCP registration must be refused (C15). */
export const isReservedSemanticId = (id: string): boolean => RESERVED_SEMANTIC_IDS.has(id)

export interface SemanticDomainPorts {
  readonly semantic: { readonly invoke: DomainInvoke }
}

export interface SemanticCommandDeps {
  readonly port: SemanticPort
  readonly audit: SemanticAuditSink
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function num(record: Record<string, unknown>, keys: ReadonlyArray<string>): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function bool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function fail(code: FailureHandlerResult["code"], message: string): FailureHandlerResult {
  return { kind: "failure", code, message }
}

/** Map the Feature 007 operator principal onto the semantic operator principal (C15). */
function toOperator(principal: OperatorPrincipalCore): OperatorPrincipal {
  const kind = principal.kind === "operator" || principal.kind === "manager-view" || principal.kind === "system" ? principal.kind : "system"
  return { kind, id: principal.subject }
}

/** Map any typed port error onto the operator audit outcome + failure envelope (content-free). */
function mapError(error: { readonly type: string }): { outcome: SemanticAuditEvent["outcome"]; failure: FailureHandlerResult } {
  const type = error.type
  if (type === "denied") return { outcome: "denied", failure: fail("unauthorized", "denied") }
  if (type === "confirmation_required") return { outcome: "rejected", failure: fail("invalid_argument", "interactive confirmation is required") }
  if (type === "version_conflict" || type === "cas_conflict") return { outcome: "conflict", failure: fail("invalid_argument", `conflict: ${type}`) }
  if (type === "not_implemented") return { outcome: "rejected", failure: fail("not_implemented", "operation is not implemented") }
  if (type.endsWith("unavailable")) return { outcome: "unavailable", failure: fail("unavailable", type) }
  return { outcome: "rejected", failure: fail("invalid_argument", type) }
}

const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

/** Run a port effect, emit exactly one audit event, and shape the result (mirrors outputspool). */
function runner(deps: SemanticCommandDeps, commandId: string, principalId: string, target: string) {
  return <A>(effect: Effect.Effect<A, { readonly type: string }>, onSuccess: (value: A) => HandlerResult): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: (error): Effect.Effect<HandlerResult> => {
            const mapped = mapError(error)
            return deps.audit.record({ commandId, principalId, target, outcome: mapped.outcome }).pipe(Effect.as(mapped.failure))
          },
        }),
      ),
    )
}

interface Ctx {
  readonly id: string
  readonly payload: Record<string, unknown>
  readonly principal: OperatorPrincipal
  readonly scope: Scope
  readonly scopeId: string
  readonly run: ReturnType<typeof runner>
}

function providerInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const p = port.provider
  const id = str(c.payload, ["id"]) ?? ""
  const version = num(c.payload, ["expectedVersion", "expected_version", "version"]) ?? 0
  switch (c.id) {
    case "semantic.provider.list": return c.run(p.list({ scope: c.scope, scopeId: c.scopeId }), (o) => query(o))
    case "semantic.provider.add": return c.run(p.add({
      scope: c.scope, scopeId: c.scopeId, name: str(c.payload, ["name"]) ?? "", baseUrl: str(c.payload, ["baseUrl", "base_url"]) ?? "",
      transportPolicy: { tlsRequired: c.payload.tlsRequired !== false, allowInsecureLocalProfile: bool(c.payload, "allowInsecureLocalProfile") },
      secretRef: str(c.payload, ["secretRef", "secret_ref"]), residency: (str(c.payload, ["residency"]) ?? "unrestricted") as never, principal: c.principal,
    }), (o) => query(o))
    case "semantic.provider.update": return c.run(p.update({ id, expectedVersion: version, patch: asRecord(c.payload.patch) as never, principal: c.principal }), (o) => query(o))
    case "semantic.provider.test": return c.run(p.test({ id, principal: c.principal }), (o) => query(o))
    case "semantic.provider.disable": return c.run(p.disable({ id, expectedVersion: version, principal: c.principal }), (o) => query(o))
    case "semantic.provider.delete": return c.run(p.delete({ id, expectedVersion: version, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), (o) => query(o))
    case "semantic.provider.rotate-secret": return c.run(p.rotateSecret({ id, expectedVersion: version, newSecretRef: str(c.payload, ["newSecretRef", "new_secret_ref"]) ?? "", principal: c.principal }), (o) => query(o))
    default: return null
  }
}

function modelInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const m = port.model
  const id = str(c.payload, ["id"]) ?? ""
  const provider = str(c.payload, ["providerProfileId", "provider_profile_id"]) ?? ""
  switch (c.id) {
    case "semantic.model.list": return c.run(m.list({ scope: c.scope, scopeId: c.scopeId, providerProfileId: str(c.payload, ["providerProfileId", "provider_profile_id"]) }), (o) => query(o))
    case "semantic.model.discover": return c.run(m.discover({ providerProfileId: provider, principal: c.principal }), (o) => query(o))
    case "semantic.model.register": return c.run(m.register({
      providerProfileId: provider, modelRef: str(c.payload, ["modelRef", "model_ref"]) ?? "", displayName: str(c.payload, ["displayName", "display_name"]) ?? "",
      endpointMode: (str(c.payload, ["endpointMode", "endpoint_mode"]) ?? "embeddings") as EndpointMode,
      declaredCapabilityKinds: ((c.payload.declaredCapabilityKinds ?? []) as readonly CapabilityKind[]), principal: c.principal,
    }), (o) => query(o))
    case "semantic.model.validate": return c.run(m.validate({ id, principal: c.principal }), (o) => query(o))
    case "semantic.model.disable": return c.run(m.disable({ id, expectedVersion: num(c.payload, ["expectedVersion", "version"]) ?? 0, principal: c.principal }), (o) => query(o))
    default: return null
  }
}

function embeddingInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const b = port.binding
  const id = str(c.payload, ["id"]) ?? ""
  const cas = str(c.payload, ["casToken", "cas_token"]) ?? ""
  switch (c.id) {
    case "semantic.embedding.show": return c.run(b.showEmbedding({ scope: c.scope, scopeId: c.scopeId }), (o) => query(o))
    case "semantic.embedding.select": return c.run(b.selectEmbedding({ slot: "embedding", modelDescriptorId: str(c.payload, ["modelDescriptorId", "model_descriptor_id"]) ?? "", compatibilityMode: "embedding", principal: c.principal }), (o) => query(o))
    case "semantic.embedding.validate": return c.run(b.validateEmbedding({ id, principal: c.principal }), (o) => query(o))
    case "semantic.embedding.reindex": return c.run(b.reindexEmbedding({ id, principal: c.principal }), (o) => query(o))
    case "semantic.embedding.cutover": return c.run(b.cutoverEmbedding({ id, generationId: str(c.payload, ["generationId", "generation_id"]) ?? "", casToken: cas, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), (o) => query(o))
    case "semantic.embedding.rollback": return c.run(b.rollbackEmbedding({ slot: "embedding", targetBindingVersion: num(c.payload, ["targetBindingVersion", "target_binding_version"]) ?? 0, casToken: cas, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), (o) => query(o))
    default: return null
  }
}

function rerankerInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const b = port.binding
  const id = str(c.payload, ["id"]) ?? ""
  const cas = str(c.payload, ["casToken", "cas_token"]) ?? ""
  switch (c.id) {
    case "semantic.reranker.show": return c.run(b.showReranker({ scope: c.scope, scopeId: c.scopeId }), (o) => query(o))
    case "semantic.reranker.select": return c.run(b.selectReranker({ slot: "reranker", modelDescriptorId: str(c.payload, ["modelDescriptorId", "model_descriptor_id"]) ?? "", compatibilityMode: (str(c.payload, ["compatibilityMode", "compatibility_mode"]) ?? "native-rerank") as RerankProfile, principal: c.principal }), (o) => query(o))
    case "semantic.reranker.validate": return c.run(b.validateReranker({ id, principal: c.principal }), (o) => query(o))
    case "semantic.reranker.cutover": return c.run(b.cutoverReranker({ id, casToken: cas, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), (o) => query(o))
    case "semantic.reranker.rollback": return c.run(b.rollbackReranker({ slot: "reranker", targetBindingVersion: num(c.payload, ["targetBindingVersion", "target_binding_version"]) ?? 0, casToken: cas, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), (o) => query(o))
    default: return null
  }
}

function bindingIndexInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const collection = (str(c.payload, ["collection"]) ?? "agents") as CollectionKind
  switch (c.id) {
    case "semantic.binding.status": return c.run(port.binding.status({ scope: c.scope, scopeId: c.scopeId }), (o) => query(o))
    case "semantic.binding.history": return c.run(port.binding.history({ slot: (str(c.payload, ["slot"]) ?? "embedding") as never, scope: c.scope, scopeId: c.scopeId, limit: num(c.payload, ["limit"]) ?? 20 }), (o) => query(o))
    case "semantic.index.status": return c.run(port.index.status({ collection, scope: c.scope, scopeId: c.scopeId }), (o) => query(o))
    case "semantic.index.test": return c.run(port.index.test({ principal: c.principal }), (o) => query(o))
    case "semantic.index.reindex": return c.run(port.index.reindex({ collection, principal: c.principal }), (o) => query(o))
    case "semantic.index.reconcile": return c.run(port.index.reconcile({ collection, scheduledOccurrenceId: str(c.payload, ["scheduledOccurrenceId", "scheduled_occurrence_id"]) }), (o) => query(o))
    case "semantic.index.show-collections": return c.run(port.index.showCollections({ scope: c.scope, scopeId: c.scopeId }), (o) => query(o))
    default: return null
  }
}

function semanticInvoke(deps: SemanticCommandDeps): DomainInvoke {
  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    if (!isReservedSemanticId(id)) return Promise.resolve(fail("not_implemented", `semantic command ${id} is not a reserved id`))
    const payload = asRecord(ctx.request.payload)
    const principal = toOperator(ctx.request.principal)
    const scope: Scope = ctx.request.scope.kind === "global" ? "global" : "project"
    const scopeId = ctx.request.scope.ref ?? ""
    const c: Ctx = { id, payload, principal, scope, scopeId, run: runner(deps, id, principal.id, str(payload, ["id", "collection", "scopeId"]) ?? scopeId) }
    return (
      providerInvoke(deps.port, c) ??
      modelInvoke(deps.port, c) ??
      embeddingInvoke(deps.port, c) ??
      rerankerInvoke(deps.port, c) ??
      bindingIndexInvoke(deps.port, c) ??
      Promise.resolve(fail("not_implemented", `semantic command ${id} is not implemented`))
    )
  }
}

/**
 * Build the `semantic` DomainPort override. Wire it into the Feature 007
 * dispatcher via `wireDomainPorts(createSemanticDomainPorts({ port, audit }))` at
 * the composition root — it replaces the `not_implemented` stub without touching
 * the registry (C15).
 */
export function createSemanticDomainPorts(deps: SemanticCommandDeps): SemanticDomainPorts {
  return { semantic: { invoke: semanticInvoke(deps) } }
}
