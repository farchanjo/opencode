/**
 * Catalog outbound adapter (Feature 001 — T027).
 *
 * Resolves routing candidates EXCLUSIVELY from the canonical
 * Catalog.Service / ModelsDev candidate resolution (packages/core/src/catalog.ts,
 * packages/core/src/models-dev.ts) — never a hardcoded model or provider ID.
 * A configured role pool (`RoutingConfig.Models.role_pools[poolId]`,
 * `RoutingConfig.ModelId[]`) is only ever a list of catalog LOOKUP KEYS; this
 * adapter turns those keys into live health/status facts, it never invents
 * candidates that are not already present in the catalog.
 *
 * `CatalogCandidateService` is the minimal duck-typed read boundary this
 * adapter needs from `Catalog.Service` (packages/core/src/catalog.ts). The
 * live constructor (`createCatalogCandidateServiceFromUse`) bridges the real
 * Effect `Catalog.Service` the same way `event-v2-live.ts` bridges `EventV2`
 * — a `useCatalog` runner supplied by the composition root — so the adapter
 * itself stays framework-light and directly testable with a fake service.
 */
export * as CatalogAdapter from "./catalog-adapter"

import type { Effect } from "effect"
import type { Capability } from "@opencode-ai/schema/routing/capability"
import type { Decision } from "@opencode-ai/schema/routing/decision"
import type { Enums } from "@opencode-ai/schema/routing/enums"
import type { RoutingConfig } from "@opencode-ai/schema/routing/config"
import type { CandidateResolution, CandidateSource } from "@/routing/application/ports"
import type { EvaluationCandidate } from "@/routing/domain/routing-evaluator"
import { contentHash } from "@/operator/adapters/outbound/config-service"

// =============================================================================
// Catalog read boundary
// =============================================================================

export type CatalogModelStatus = "alpha" | "beta" | "deprecated" | "active"

// One resolved (providerID, modelID) pair as reported by Catalog.Service —
// the full set the adapter is allowed to select candidates from.
export interface CatalogModelSnapshot {
  readonly modelId: string
  readonly providerId: string
  readonly status: CatalogModelStatus
  readonly enabled: boolean
  readonly tools: boolean
}

// Minimal read surface consumed from Catalog.Service.model.available().
export interface CatalogCandidateService {
  readonly listModels: () => Promise<ReadonlyArray<CatalogModelSnapshot>>
}

// =============================================================================
// Resolved candidates
// =============================================================================

export type UnresolvedReason = "not_found_in_catalog" | "disabled" | "deprecated"

export interface ResolvedCandidate {
  readonly modelId: string
  readonly providerId: string | null
  readonly status: CatalogModelStatus | null
  /** True only when the model is present, enabled, and not deprecated. */
  readonly healthy: boolean
  readonly reason: UnresolvedReason | null
  /** Catalog-declared tool-call support (`ModelV2.Info.capabilities.tools`); false when unresolved. */
  readonly tools: boolean
}

export interface CatalogSnapshot {
  /** Deterministic content hash of the FULL resolved catalog set at read time
   * (packages/schema/src/routing/ids.ts CatalogVersion) — pinned on the
   * RoutingDecision for catalog-mismatch detection on replay. */
  readonly catalogVersion: string
  readonly candidates: ReadonlyArray<ResolvedCandidate>
}

export interface CatalogPort {
  /** Resolve the given, operator-configured model IDs against the live catalog. */
  readonly resolveCandidates: (modelIds: ReadonlyArray<string>) => Promise<CatalogSnapshot>
  /** The FULL live catalog, classified — used for unscoped capability inspection. */
  readonly listAll: () => Promise<CatalogSnapshot>
  /** Content hash of the full live catalog — independent of any requested subset. */
  readonly catalogVersion: () => Promise<string>
}

function classify(model: CatalogModelSnapshot | undefined): Omit<ResolvedCandidate, "modelId"> {
  if (!model) return { providerId: null, status: null, healthy: false, reason: "not_found_in_catalog", tools: false }
  if (!model.enabled) {
    return { providerId: model.providerId, status: model.status, healthy: false, reason: "disabled", tools: model.tools }
  }
  if (model.status === "deprecated") {
    return { providerId: model.providerId, status: model.status, healthy: false, reason: "deprecated", tools: model.tools }
  }
  return { providerId: model.providerId, status: model.status, healthy: true, reason: null, tools: model.tools }
}

// Stable content hash over the FULL live catalog set, sorted so the hash
// depends only on the (providerId, modelId, status, enabled, tools) content —
// never on iteration order.
function hashCatalog(models: ReadonlyArray<CatalogModelSnapshot>): string {
  const sorted = [...models].sort((a, b) => `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`))
  return contentHash(sorted.map((m) => ({ p: m.providerId, m: m.modelId, s: m.status, e: m.enabled, t: m.tools })))
}

export function createCatalogAdapter(deps: { readonly catalog: CatalogCandidateService }): CatalogPort {
  return {
    async resolveCandidates(modelIds) {
      const models = await deps.catalog.listModels()
      const byId = new Map(models.map((m) => [m.modelId, m]))
      const candidates = modelIds.map((modelId) => ({ modelId, ...classify(byId.get(modelId)) }))
      return { catalogVersion: hashCatalog(models), candidates }
    },
    async listAll() {
      const models = await deps.catalog.listModels()
      const candidates = models.map((m) => ({ modelId: m.modelId, ...classify(m) }))
      return { catalogVersion: hashCatalog(models), candidates }
    },
    async catalogVersion() {
      return hashCatalog(await deps.catalog.listModels())
    },
  }
}

// =============================================================================
// Live bridge — Catalog.Service (Effect Context.Service) -> CatalogCandidateService
// =============================================================================

// Duck-typed slice of Catalog.Service.Interface["model"] this adapter needs.
export interface CatalogServiceModelLike {
  readonly available: () => Effect.Effect<
    ReadonlyArray<{
      readonly id: string
      readonly providerID: string
      readonly status: CatalogModelStatus
      readonly enabled: boolean
      readonly capabilities: { readonly tools: boolean }
    }>
  >
}

export interface CatalogServiceLike {
  readonly model: CatalogServiceModelLike
}

/**
 * Preferred composition: each call resolves Catalog.Service via `useCatalog`
 * (mirrors `event-v2-live.ts`'s `useEvents` bridge) so the adapter never holds
 * a long-lived reference into the Effect service graph.
 */
export function createCatalogCandidateServiceFromUse(input: {
  readonly useCatalog: <A>(fn: (svc: CatalogServiceLike) => Effect.Effect<A>) => Promise<A>
}): CatalogCandidateService {
  return {
    async listModels() {
      const models = await input.useCatalog((catalog) => catalog.model.available())
      return models.map((m) => ({
        modelId: m.id,
        providerId: m.providerID,
        status: m.status,
        enabled: m.enabled,
        tools: m.capabilities.tools,
      }))
    },
  }
}

// =============================================================================
// CandidateSource composition (application/ports.ts, consumed by routing-service.ts)
// =============================================================================
//
// `CandidateSource` (ports.ts) needs (specialist agent x executor model) pairs,
// not bare models. This adapter owns the MODEL side exclusively (CatalogPort
// above); specialist-agent resolution is AgentV2's job (T031,
// packages/opencode/src/agent/agent.ts) and is therefore an INJECTED seam
// here (`AgentResolver`), never hardcoded — the composition root wires the
// real AgentV2-backed resolver once T031 lands. `createCandidateSource`
// cross-products the injected agent pool with the healthy catalog-resolved
// model pool to produce the `EvaluationCandidate`s routing-evaluator.ts ranks.

const CAPABILITY_CATALOG_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — structurally never freshness-gated (resolveCapabilityRecord never filters the catalog layer); a finite placeholder only to satisfy the schema.

/**
 * The catalog layer of a `Capability.Record` for one resolved model. Only
 * `tool_call_present` is knowable from catalog/ModelsDev metadata
 * (`ModelV2.Info.capabilities.tools`); the other six dimensions stay `null`
 * (unknown) — capability-resolver.ts's conservative unknown policy is exactly
 * the mechanism designed to gate on that, so this is correct, not incomplete.
 */
export function toCapabilityCatalogRecord(
  candidate: Pick<ResolvedCandidate, "modelId" | "providerId" | "tools">,
  nowIso: string,
): Capability.Record {
  return {
    identity: {
      provider: candidate.providerId ?? "unknown",
      model: candidate.modelId,
      variant: "default",
      api: "native",
    },
    assessment: {
      dimensions: {
        tool_call_present: candidate.tools,
        max_calls_per_turn: null,
        same_turn_multiple_calls: null,
        serial_runner_execution: null,
        parallel_calls: null,
        continuation_after_tool_result: null,
        multi_turn_cycles: null,
      },
      source: "catalog",
      confidence: 1,
    },
    freshness: { timestamp: nowIso, ttl_ms: CAPABILITY_CATALOG_TTL_MS, scope: "global" },
  }
}

export interface AgentPoolEntry {
  readonly agentId: string
  readonly skills: ReadonlyArray<string>
  readonly effort: Enums.TaskEffort
  readonly reasoningEffort: Enums.ReasoningEffort
}

/** Injected specialist-agent resolution seam (AgentV2, T031) — never hardcoded here. */
export interface AgentResolver {
  readonly resolveAgents: (
    routingProfile: Enums.RoutingProfile,
    taskClass: Enums.TaskClass,
  ) => Promise<ReadonlyArray<AgentPoolEntry>>
}

// Which role-pool ids feed a hierarchy role — mirrors plan.md's role-pool
// naming convention ("architect", "manager", "worker-fast-large",
// "worker-fast-small"): the role name itself, or any `${role}-*` pool.
function poolIdsForRole(role: Enums.HierarchyRole, rolePools: Readonly<Record<string, ReadonlyArray<RoutingConfig.ModelId>>>): string[] {
  return Object.keys(rolePools).filter((id) => id === role || id.startsWith(`${role}-`))
}

function roleForProfile(routingProfile: Enums.RoutingProfile): Enums.HierarchyRole {
  return routingProfile === "manager" ? "manager" : "worker"
}

// Deduped, pool-order flatten of role-pool ids into concrete model ids — same
// shape as routing-service.ts's `resolveDecisionModelPool`, duplicated
// locally (six lines) rather than importing across the adapters ->
// application layering boundary.
function flattenModelPool(
  poolIds: ReadonlyArray<string>,
  rolePools: Readonly<Record<string, ReadonlyArray<RoutingConfig.ModelId>>>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const roleId of poolIds) {
    for (const modelId of rolePools[roleId] ?? []) {
      if (!seen.has(modelId)) {
        seen.add(modelId)
        out.push(modelId)
      }
    }
  }
  return out
}

export function createCandidateSource(deps: {
  readonly catalog: CatalogPort
  readonly agents: AgentResolver
  readonly now?: () => string
}): CandidateSource {
  const nowIso = deps.now ?? (() => new Date().toISOString())

  return {
    async resolve(query) {
      const role = roleForProfile(query.routingProfile)
      const poolIds = poolIdsForRole(role, query.config.models.role_pools)
      const modelIds = flattenModelPool(poolIds, query.config.models.role_pools)
      const snapshot = await deps.catalog.resolveCandidates(modelIds)
      const healthy = snapshot.candidates.filter((c) => c.healthy)
      const agentPool = await deps.agents.resolveAgents(query.routingProfile, query.taskClass)
      const now = nowIso()

      const candidates: EvaluationCandidate[] = []
      for (const agent of agentPool) {
        for (const model of healthy) {
          candidates.push({
            identity: { agent_id: agent.agentId, model_id: model.modelId },
            profile: { skills: agent.skills as Decision.SkillList, effort: agent.effort, reasoning_effort: agent.reasoningEffort },
            capability: { catalog: toCapabilityCatalogRecord(model, now), overlays: [] },
            healthy: true,
          })
        }
      }

      const resolution: CandidateResolution = {
        candidates,
        decisionPoolModelIds: flattenModelPool(query.config.models.decision_model.pool, query.config.models.role_pools),
        catalogVersion: snapshot.catalogVersion,
      }
      return resolution
    },

    async inspect(modelId) {
      const snapshot = modelId ? await deps.catalog.resolveCandidates([modelId]) : await deps.catalog.listAll()
      const now = nowIso()
      return snapshot.candidates.filter((c) => c.providerId !== null).map((c) => toCapabilityCatalogRecord(c, now))
    },

    async status() {
      try {
        const catalogVersion = await deps.catalog.catalogVersion()
        return { catalogVersion, health: "ok", offline: false, reason: null, recommendedAction: null }
      } catch (error) {
        return {
          catalogVersion: "unknown",
          health: "unavailable" as const,
          offline: true,
          reason: error instanceof Error ? error.message : "catalog unavailable",
          recommendedAction: "check ModelsDev/Catalog.Service connectivity",
        }
      }
    },
  }
}
