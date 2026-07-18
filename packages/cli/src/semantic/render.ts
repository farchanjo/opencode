import { fallback, isRecord, yesNo } from "../operator/output"

/**
 * Feature 006 / T038 (S24) — human renderers for the `opencode op semantic`
 * command surface (`provider|model|embedding|reranker|binding|index`). Pure
 * string builders over the redacted `protocol/semantic/commands` payloads —
 * no renderer touches process streams, and no renderer ever surfaces a
 * `secretRef`, a raw secret, or a filesystem path (FR35, C19, C22), mirroring
 * `langlock/render.ts` and `jobs/render.ts`.
 */

function providerLine(profile: unknown): string {
  if (!isRecord(profile)) return "none"
  return [
    `${String(profile.id ?? "-")}  ${String(profile.name ?? "-")}`,
    `base: ${String(profile.baseUrl ?? "-")}`,
    `residency: ${String(profile.residency ?? "-")}`,
    `enabled: ${yesNo(profile.enabled)}`,
    `v${String(profile.version ?? "-")}`,
  ].join("  ")
}

/** Render a `{ profiles }`-shaped `provider.list` result. */
export function renderProviderList(effective: unknown): string {
  if (!isRecord(effective) || !Array.isArray(effective.profiles)) return fallback(effective)
  if (effective.profiles.length === 0) return "no provider profiles"
  return effective.profiles.map(providerLine).join("\n")
}

/** Render a `{ profile, auditId }`-shaped provider mutation result. */
export function renderProvider(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [providerLine(effective.profile)]
  if (effective.auditId !== undefined) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

/** Render a `{ id, auditId }`-shaped `provider.delete` result. */
export function renderProviderDeleted(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`deleted: ${String(effective.id ?? "-")}`]
  if (effective.auditId !== undefined) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

/** Render a `{ reachable, latencyMs, probeState }`-shaped `provider.test` result. */
export function renderProviderTest(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  return `reachable: ${yesNo(effective.reachable)}  latency: ${String(effective.latencyMs ?? "-")}ms  probe: ${String(effective.probeState ?? "-")}`
}

function modelLine(descriptor: unknown): string {
  if (!isRecord(descriptor)) return "none"
  const caps = Array.isArray(descriptor.capabilityKinds) ? descriptor.capabilityKinds.join(",") : "-"
  return [
    `${String(descriptor.id ?? "-")}  ${String(descriptor.displayName ?? "-")}`,
    `caps=[${caps}]`,
    `probe=${String(descriptor.probeState ?? "-")}`,
    `dims=${String(descriptor.dimensions ?? "-")}`,
    `enabled=${yesNo(descriptor.enabled)}`,
  ].join("  ")
}

/** Render a `{ descriptors }` / `{ discovered }`-shaped model listing result. */
export function renderModelList(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const list = Array.isArray(effective.descriptors) ? effective.descriptors : Array.isArray(effective.discovered) ? effective.discovered : null
  if (list === null) return fallback(effective)
  if (list.length === 0) return "no model descriptors"
  return list.map(modelLine).join("\n")
}

/** Render a `{ descriptor, probeState?, auditId? }`-shaped model mutation result. */
export function renderModel(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [modelLine(effective.descriptor)]
  if (effective.probeState !== undefined) lines.push(`probe state: ${String(effective.probeState)}`)
  if (effective.auditId !== undefined) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

function bindingLine(binding: unknown): string {
  if (!isRecord(binding)) return "none"
  return [
    `${String(binding.slot ?? "-")}  v${String(binding.bindingVersion ?? "-")}`,
    `state=${String(binding.state ?? "-")}`,
    `mode=${String(binding.compatibilityMode ?? "-")}`,
    `model=${String(binding.modelDescriptorId ?? "-")}`,
    `selectedBy=${String(binding.selectedBy ?? "-")}`,
  ].join("  ")
}

/** Render a `{ binding? }`-shaped `embedding.show` / `reranker.show` result. */
export function renderBindingShow(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  return bindingLine(effective.binding)
}

/** Render a `{ binding, generation?, auditId? }`-shaped binding mutation result. */
export function renderBindingMutation(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [bindingLine(effective.binding)]
  if (isRecord(effective.generation)) {
    lines.push(`generation: ${String(effective.generation.generationId ?? "-")}  state=${String(effective.generation.state ?? "-")}`)
  }
  if (effective.auditId !== undefined) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

/** Render a `{ embedding?, reranker?, degradation }`-shaped `binding.status` result. */
export function renderBindingStatus(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`embedding: ${bindingLine(effective.embedding)}`, `reranker: ${bindingLine(effective.reranker)}`]
  if (isRecord(effective.degradation)) {
    const gap = effective.degradation.gapCode !== undefined ? `  gap=${String(effective.degradation.gapCode)}` : ""
    lines.push(`rung: ${String(effective.degradation.rung ?? "-")}${gap}`)
  }
  return lines.join("\n")
}

/** Render a `{ versions }`-shaped `binding.history` result. */
export function renderBindingHistory(effective: unknown): string {
  if (!isRecord(effective) || !Array.isArray(effective.versions)) return fallback(effective)
  if (effective.versions.length === 0) return "no binding history"
  return effective.versions.map(bindingLine).join("\n")
}

/** Render a `{ generation?, documentCount, freshnessBucket }`-shaped `index.status` result. */
export function renderIndexStatus(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`documents: ${String(effective.documentCount ?? "-")}  freshness: ${String(effective.freshnessBucket ?? "-")}`]
  if (isRecord(effective.generation)) {
    lines.push(`generation: ${String(effective.generation.generationId ?? "-")}  state=${String(effective.generation.state ?? "-")}`)
  }
  return lines.join("\n")
}

/** Render a `{ reachable, latencyMs }`-shaped `index.test` result. */
export function renderIndexTest(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  return `reachable: ${yesNo(effective.reachable)}  latency: ${String(effective.latencyMs ?? "-")}ms`
}

/** Render a `{ upsertedCount, tombstonedCount, outputRef }`-shaped index job result. */
export function renderIndexJob(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`upserted: ${String(effective.upsertedCount ?? "-")}  tombstoned: ${String(effective.tombstonedCount ?? "-")}`]
  if (effective.outputRef !== undefined) lines.push(`output ref: ${String(effective.outputRef)}`)
  return lines.join("\n")
}

/** Render a `{ collections }`-shaped `index.show-collections` result. */
export function renderCollections(effective: unknown): string {
  if (!isRecord(effective) || !Array.isArray(effective.collections)) return fallback(effective)
  if (effective.collections.length === 0) return "no collections"
  return effective.collections
    .map((entry) => (isRecord(entry) ? `${String(entry.collection ?? "-")}  alias=${String(entry.aliasId ?? "-")}  state=${String(entry.state ?? "-")}` : fallback(entry)))
    .join("\n")
}

export * as SemanticRender from "./render"
