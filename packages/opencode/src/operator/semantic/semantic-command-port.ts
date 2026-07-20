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
import type { FailureHandlerResult, HandlerContext, HandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { SemanticAuditEvent, SemanticAuditSink, SemanticPort } from "./semantic-port"
import type { SemanticRegistryBackend } from "./registry-backend"

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
  // Feature 019 (FR3) — honest reranker/embedding activation gates carry a typed, secret-free reason.
  if (type === "not_validated" || type === "no_archived_prior" || type === "no_candidate_staged") return { outcome: "rejected", failure: fail("invalid_argument", type) }
  if (type === "not_implemented") return { outcome: "rejected", failure: fail("not_implemented", "operation is not implemented") }
  if (type.endsWith("unavailable")) return { outcome: "unavailable", failure: fail("unavailable", type) }
  return { outcome: "rejected", failure: fail("invalid_argument", type) }
}

const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

/**
 * Bind the audit-and-shape helpers for one dispatch. `run` shapes a read/probe port
 * effect (query on success); `plan` shapes a config-backed mutation into the
 * `mutation_plan` the dispatcher commits via `mutateAuthority` — a successful plan
 * is audited by the commit, only a rejection is audited here, so no write is ever
 * persisted while the caller is told it failed (FR5, FR14).
 */
function runner(deps: SemanticCommandDeps, commandId: string, principalId: string, target: string) {
  const auditFailure = (error: { readonly type: string }): Effect.Effect<HandlerResult> => {
    const mapped = mapError(error)
    return deps.audit.record({ commandId, principalId, target, outcome: mapped.outcome }).pipe(Effect.as(mapped.failure))
  }
  const run = <A>(effect: Effect.Effect<A, { readonly type: string }>, onSuccess: (value: A) => HandlerResult): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: auditFailure,
        }),
      ),
    )
  const plan = (effect: Effect.Effect<OperatorMutationPlan, { readonly type: string }>): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> => Effect.succeed({ kind: "mutation_plan", ...value }),
          onFailure: auditFailure,
        }),
      ),
    )
  return { run, plan }
}

interface Ctx {
  readonly id: string
  readonly payload: Record<string, unknown>
  readonly principal: OperatorPrincipal
  readonly scope: Scope
  readonly scopeId: string
  /** The config-backed registry half when bound; unset routes every verb to the port (honest gap). */
  readonly registry?: SemanticRegistryBackend
  readonly io: ReturnType<typeof runner>
}

function providerInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const p = port.provider
  const reg = c.registry
  const id = str(c.payload, ["id"]) ?? ""
  const version = num(c.payload, ["expectedVersion", "expected_version", "version"]) ?? 0
  const addInput = {
    scope: c.scope, scopeId: c.scopeId, name: str(c.payload, ["name"]) ?? "", baseUrl: str(c.payload, ["baseUrl", "base_url"]) ?? "",
    transportPolicy: { tlsRequired: c.payload.tlsRequired !== false, allowInsecureLocalProfile: bool(c.payload, "allowInsecureLocalProfile") },
    secretRef: str(c.payload, ["secretRef", "secret_ref"]), residency: (str(c.payload, ["residency"]) ?? "remote") as never, principal: c.principal,
  }
  switch (c.id) {
    // Reads + config-backed mutations ride the registry round-trip when bound; provider.test stays the gated live probe.
    case "semantic.provider.list": return reg ? c.io.run(reg.listProviders({ scope: c.scope, scopeId: c.scopeId }), query) : c.io.run(p.list({ scope: c.scope, scopeId: c.scopeId }), query)
    case "semantic.provider.add": return reg ? c.io.plan(reg.planAddProvider(addInput)) : c.io.run(p.add(addInput), query)
    case "semantic.provider.update": {
      const upd = { id: id as never, expectedVersion: version, patch: asRecord(c.payload.patch) as never, principal: c.principal }
      return reg ? c.io.plan(reg.planUpdateProvider(upd)) : c.io.run(p.update(upd), query)
    }
    case "semantic.provider.test": return c.io.run(p.test({ id: id as never, principal: c.principal }), query)
    case "semantic.provider.disable": {
      const dis = { id: id as never, expectedVersion: version, principal: c.principal }
      return reg ? c.io.plan(reg.planDisableProvider(dis)) : c.io.run(p.disable(dis), query)
    }
    case "semantic.provider.delete": {
      const del = { id: id as never, expectedVersion: version, confirmed: bool(c.payload, "confirmed"), principal: c.principal }
      return reg ? c.io.plan(reg.planDeleteProvider(del)) : c.io.run(p.delete(del), query)
    }
    case "semantic.provider.rotate-secret": {
      const rot = { id: id as never, expectedVersion: version, newSecretRef: (str(c.payload, ["newSecretRef", "new_secret_ref"]) ?? "") as never, principal: c.principal }
      return reg ? c.io.plan(reg.planRotateSecret(rot)) : c.io.run(p.rotateSecret(rot), query)
    }
    default: return null
  }
}

function modelInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const m = port.model
  const reg = c.registry
  const id = str(c.payload, ["id"]) ?? ""
  const provider = str(c.payload, ["providerProfileId", "provider_profile_id"]) ?? ""
  const registerInput = {
    providerProfileId: provider as never, modelRef: str(c.payload, ["modelRef", "model_ref"]) ?? "", displayName: str(c.payload, ["displayName", "display_name"]) ?? "",
    endpointMode: (str(c.payload, ["endpointMode", "endpoint_mode"]) ?? "embeddings") as EndpointMode,
    declaredCapabilityKinds: ((c.payload.declaredCapabilityKinds ?? []) as readonly CapabilityKind[]), principal: c.principal,
  }
  switch (c.id) {
    // list/register/disable ride the registry round-trip; discover/validate stay the gated live probes.
    case "semantic.model.list": {
      const listInput = { scope: c.scope, scopeId: c.scopeId, providerProfileId: str(c.payload, ["providerProfileId", "provider_profile_id"]) as never }
      return reg ? c.io.run(reg.listModels(listInput), query) : c.io.run(m.list(listInput), query)
    }
    case "semantic.model.discover": return c.io.run(m.discover({ providerProfileId: provider as never, principal: c.principal }), query)
    case "semantic.model.register": return reg ? c.io.plan(reg.planRegisterModel(registerInput)) : c.io.run(m.register(registerInput), query)
    case "semantic.model.validate": return c.io.run(m.validate({ id: id as never, principal: c.principal }), query)
    case "semantic.model.disable": {
      const dis = { id: id as never, expectedVersion: num(c.payload, ["expectedVersion", "version"]) ?? 0, principal: c.principal }
      return reg ? c.io.plan(reg.planDisableModel(dis)) : c.io.run(m.disable(dis), query)
    }
    default: return null
  }
}

function embeddingInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const b = port.binding
  const reg = c.registry
  const id = str(c.payload, ["id"]) ?? ""
  const cas = str(c.payload, ["casToken", "cas_token"]) ?? ""
  const select = { slot: "embedding" as const, modelDescriptorId: (str(c.payload, ["modelDescriptorId", "model_descriptor_id"]) ?? "") as never, compatibilityMode: "embedding" as const, principal: c.principal }
  switch (c.id) {
    // show/select/reindex/cutover/rollback ride the config-backed registry over the live Milvus port
    // (FR5, effectful mutation plans that build+validate before the alias swap); validate stays the gated
    // Milvus probe. When Milvus is unconfigured the registry plans return the exact `milvus_unavailable`
    // floor — never a config-only alias flip.
    case "semantic.embedding.show": return reg ? c.io.run(reg.showEmbedding({ scope: c.scope, scopeId: c.scopeId }), query) : c.io.run(b.showEmbedding({ scope: c.scope, scopeId: c.scopeId }), query)
    case "semantic.embedding.select": return reg ? c.io.plan(reg.planSelectEmbedding(select)) : c.io.run(b.selectEmbedding(select), query)
    case "semantic.embedding.validate": return c.io.run(b.validateEmbedding({ id: id as never, principal: c.principal }), query)
    case "semantic.embedding.reindex":
      return reg
        ? c.io.plan(reg.planReindexEmbedding({ principal: c.principal }))
        : c.io.run(b.reindexEmbedding({ id: id as never, principal: c.principal }), query)
    case "semantic.embedding.cutover":
      return reg
        ? c.io.plan(reg.planCutoverEmbedding({ generationId: str(c.payload, ["generationId", "generation_id"]), confirmed: bool(c.payload, "confirmed"), principal: c.principal }))
        : c.io.run(b.cutoverEmbedding({ id: id as never, generationId: (str(c.payload, ["generationId", "generation_id"]) ?? "") as never, casToken: cas as never, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), query)
    case "semantic.embedding.rollback":
      return reg
        ? c.io.plan(reg.planRollbackEmbedding({ targetBindingVersion: num(c.payload, ["targetBindingVersion", "target_binding_version"]), confirmed: bool(c.payload, "confirmed"), principal: c.principal }))
        : c.io.run(b.rollbackEmbedding({ slot: "embedding", targetBindingVersion: num(c.payload, ["targetBindingVersion", "target_binding_version"]) ?? 0, casToken: cas as never, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), query)
    default: return null
  }
}

function rerankerInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const b = port.binding
  const reg = c.registry
  const id = str(c.payload, ["id"]) ?? ""
  const cas = str(c.payload, ["casToken", "cas_token"]) ?? ""
  const select = { slot: "reranker" as const, modelDescriptorId: (str(c.payload, ["modelDescriptorId", "model_descriptor_id"]) ?? "") as never, compatibilityMode: (str(c.payload, ["compatibilityMode", "compatibility_mode"]) ?? "native-rerank") as RerankProfile, principal: c.principal }
  switch (c.id) {
    // show/select/cutover/rollback ride the config-backed registry (no Milvus, FR1); validate stays the gated Milvus probe.
    case "semantic.reranker.show": return reg ? c.io.run(reg.showReranker({ scope: c.scope, scopeId: c.scopeId }), query) : c.io.run(b.showReranker({ scope: c.scope, scopeId: c.scopeId }), query)
    case "semantic.reranker.select": return reg ? c.io.plan(reg.planSelectReranker(select)) : c.io.run(b.selectReranker(select), query)
    case "semantic.reranker.validate": return c.io.run(b.validateReranker({ id: id as never, principal: c.principal }), query)
    case "semantic.reranker.cutover":
      return reg
        ? c.io.plan(reg.planCutoverReranker({ confirmed: bool(c.payload, "confirmed"), principal: c.principal }))
        : c.io.run(b.cutoverReranker({ id: id as never, casToken: cas as never, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), query)
    case "semantic.reranker.rollback":
      return reg
        ? c.io.plan(reg.planRollbackReranker({ targetBindingVersion: num(c.payload, ["targetBindingVersion", "target_binding_version"]), confirmed: bool(c.payload, "confirmed"), principal: c.principal }))
        : c.io.run(b.rollbackReranker({ slot: "reranker", targetBindingVersion: num(c.payload, ["targetBindingVersion", "target_binding_version"]) ?? 0, casToken: cas as never, confirmed: bool(c.payload, "confirmed"), principal: c.principal }), query)
    default: return null
  }
}

function bindingIndexInvoke(port: SemanticPort, c: Ctx): Promise<HandlerResult> | null {
  const reg = c.registry
  const collection = (str(c.payload, ["collection"]) ?? "agents") as CollectionKind
  switch (c.id) {
    // binding.status/history ride the registry read; every index.* op stays the gated Milvus capability gap.
    case "semantic.binding.status": return reg ? c.io.run(reg.bindingStatus({ scope: c.scope, scopeId: c.scopeId }), query) : c.io.run(port.binding.status({ scope: c.scope, scopeId: c.scopeId }), query)
    case "semantic.binding.history": {
      const hist = { slot: (str(c.payload, ["slot"]) ?? "embedding") as never, scope: c.scope, scopeId: c.scopeId, limit: num(c.payload, ["limit"]) ?? 20 }
      return reg ? c.io.run(reg.bindingHistory(hist), query) : c.io.run(port.binding.history(hist), query)
    }
    case "semantic.index.status": return c.io.run(port.index.status({ collection, scope: c.scope, scopeId: c.scopeId }), query)
    case "semantic.index.test": return c.io.run(port.index.test({ principal: c.principal }), query)
    case "semantic.index.reindex": return c.io.run(port.index.reindex({ collection, principal: c.principal }), query)
    case "semantic.index.reconcile": return c.io.run(port.index.reconcile({ collection, scheduledOccurrenceId: str(c.payload, ["scheduledOccurrenceId", "scheduled_occurrence_id"]) }), query)
    case "semantic.index.show-collections": return c.io.run(port.index.showCollections({ scope: c.scope, scopeId: c.scopeId }), query)
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
    const c: Ctx = {
      id,
      payload,
      principal,
      scope,
      scopeId,
      registry: deps.port.registry,
      io: runner(deps, id, principal.id, str(payload, ["id", "collection", "scopeId"]) ?? scopeId),
    }
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
