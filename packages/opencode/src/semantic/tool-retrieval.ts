/**
 * Feature 009 / T010 (S9–S10) + T012 (S8) — the per-surface flag gate, the
 * ranked-subset application, and the read-only tool-search config projection.
 *
 * The ranked subset is applied ONLY over the already-permission-visible set and
 * NEVER widens it: `narrow`/`narrowRecord` keep the intersection of the visible
 * set and the ranked ids, ordered by rank, and add nothing the caller did not
 * already pass (FR3, C4, C10, C15). The V1 default is the full-set passthrough
 * floor: a disabled surface, or an absent ranking, is an IDENTITY passthrough that
 * renders the full permission-visible set unchanged — the live LLM tool list is
 * not narrowed until an operator opts a surface in (FR1, FR18, C9, C15). The
 * `FEATURE_009_TOOL_SELECTION_SEAM` (`retrieval-facade.ts`) is the honest wiring
 * point that a flag-on route would call to obtain the ranked ids; this module owns
 * only the pure gate and the config projection.
 */
export * as ToolRetrieval from "./tool-retrieval"

import type {
  ToolSearchSurface,
  ToolSearchSurfaceConfig,
} from "@opencode-ai/protocol/semantic/commands"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"
import type { ToolConfig } from "@opencode-ai/schema/semantic/tool-config"

/** The gate that decides whether — and to which ranked ids — a surface narrows its visible set. */
export interface RankedGate {
  /** The per-surface enable flag; default off = full-set passthrough (C9, C15). */
  readonly enabled: boolean
  /** The ranked, revalidated tool ids from the tool pass; absent when the seam was not invoked (C15). */
  readonly ranked?: readonly string[]
}

/** The identity passthrough gate — the V1 default for every surface (full-set floor, C9, C15). */
export const PASSTHROUGH: RankedGate = Object.freeze({ enabled: false })

/**
 * Apply the ranked subset to a permission-visible tool LIST after visibility. A
 * disabled gate or an absent ranking returns the visible list unchanged (the
 * full-set floor); otherwise it keeps only the visible items whose id is in the
 * ranked set, ordered by rank — never widening the visible set (FR3, C10, C15).
 * Pure and deterministic.
 */
export const narrow = <T>(visible: readonly T[], idOf: (item: T) => string, gate: RankedGate): readonly T[] => {
  if (!gate.enabled || !gate.ranked) return visible
  const order = new Map(gate.ranked.map((id, index) => [id, index] as const))
  return visible.filter((item) => order.has(idOf(item))).sort((a, b) => order.get(idOf(a))! - order.get(idOf(b))!)
}

/**
 * Apply the ranked subset to a permission-visible tool RECORD keyed by tool id. A
 * disabled gate or an absent ranking returns the record unchanged (the full-set
 * floor); otherwise it emits only the ranked ids present in the visible record, in
 * rank order — never adding a key the caller did not pass (FR3, C10, C15). Pure.
 */
export const narrowRecord = <T>(visible: Record<string, T>, gate: RankedGate): Record<string, T> => {
  if (!gate.enabled || !gate.ranked) return visible
  const out: Record<string, T> = {}
  for (const id of gate.ranked) {
    if (Object.prototype.hasOwnProperty.call(visible, id)) out[id] = visible[id]!
  }
  return out
}

/**
 * Read-only projection of one surface's tool-search config (T012, C9, C12).
 * Delegates the default resolution to the core `resolveToolSurfaceConfig` so the
 * full-set passthrough floor (`enabled=false`, `failClosed=false`) and the reused
 * `Values.TopK` bounds have exactly one owner. Config MUTATION is not a new port —
 * it flows through the existing Config.Service write surface (FR22). Pure.
 */
export const projectSurfaceConfig = (
  config: ToolConfig.ToolSearchConfig | undefined,
  surface: ToolSearchSurface,
): ToolSearchSurfaceConfig => {
  const resolved = ConfigExperimental.resolveToolSurfaceConfig(config, surface)
  return {
    surface: resolved.surface,
    enabled: resolved.enabled,
    failClosed: resolved.failClosed,
    retrievalTopK: resolved.retrievalTopK,
    rerankTopK: resolved.rerankTopK,
    resultBound: resolved.resultBound,
    latencyBudgetMs: resolved.latencyBudgetMs,
    cacheTtlMs: resolved.cacheTtlMs,
  }
}

/** Whether a surface is opted into ranked consumption; the C9/C15 gate the live seams honor. */
export const surfaceEnabled = (
  config: ToolConfig.ToolSearchConfig | undefined,
  surface: ToolSearchSurface,
): boolean => ConfigExperimental.resolveToolSurfaceConfig(config, surface).enabled
