/**
 * Feature 046 — the SINGLE enforcement-leaf registry shared by BOTH operator
 * surfaces (the `op` CLI backend and the TUI forms), so the two can never drift
 * out of parity (FR4). Each leaf names one `RoutingConfig.Enforcement`
 * budget/hierarchy/capability field: its operator-facing camelCase key, its path
 * within the enforcement document, its display label, and its typed constraint
 * (numeric bounds, enum members, boolean). The opencode backend validates and
 * applies writes through this registry; the TUI generates its edit fields from
 * the SAME registry. No leaf carries a secret — every value is a bounded
 * numeric, a small enum, a boolean, or the escalation-signal name.
 *
 * The registry is pure metadata plus pure get/set/validate helpers over a plain
 * `EnforcementView` (the snake_case effective enforcement shape); it opens no I/O
 * and imports no runtime. Consumers map it onto the effective config they already
 * read.
 */
export * as EnforcementLeaves from "./leaves"

/** The three operator-tunable enforcement blocks this feature exposes end-to-end (FR1-FR3). */
export const ENFORCEMENT_DOMAINS = ["budget", "hierarchy", "capability"] as const
export type EnforcementDomain = (typeof ENFORCEMENT_DOMAINS)[number]

/** The typed constraint a leaf value is validated against at the write boundary (FR9). */
export type LeafType =
  | { readonly kind: "int"; readonly min: number; readonly max?: number }
  | { readonly kind: "float"; readonly min: number; readonly max?: number }
  | { readonly kind: "bool" }
  | { readonly kind: "enum"; readonly members: readonly string[] }
  | { readonly kind: "text" }

/** One bounded value an operator may view and set (FR1-FR4). */
export interface EnforcementLeaf {
  readonly domain: EnforcementDomain
  /** Operator-facing camelCase key (e.g. `maxDepth`); the payload/field key. */
  readonly key: string
  /** Path within the `RoutingConfig.Enforcement` document (snake_case). */
  readonly path: readonly string[]
  readonly label: string
  readonly type: LeafType
}

/** A plain view of the snake_case `RoutingConfig.Enforcement` document. */
export type EnforcementView = Record<string, unknown>

/** A validated leaf value (int/float → number, bool → boolean, enum/text → string). */
export type LeafValue = number | boolean | string

// =============================================================================
// The registry — every budget/hierarchy/capability leaf, in a stable order
// =============================================================================

const BUDGET_LEAVES: readonly EnforcementLeaf[] = [
  { domain: "budget", key: "maxTurns", path: ["budget", "limits", "max_turns"], label: "Max turns", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "maxContextTokens", path: ["budget", "limits", "max_context_tokens"], label: "Max context tokens", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "maxContextBytes", path: ["budget", "limits", "max_context_bytes"], label: "Max context bytes", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "maxOutputTokens", path: ["budget", "limits", "max_output_tokens"], label: "Max output tokens", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "maxOutputBytes", path: ["budget", "limits", "max_output_bytes"], label: "Max output bytes", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "maxWorkers", path: ["budget", "concurrency", "max_workers"], label: "Max workers", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "maxDelegationDepth", path: ["budget", "concurrency", "max_delegation_depth"], label: "Max delegation depth", type: { kind: "int", min: 0, max: 2 } },
  { domain: "budget", key: "retrievalTopK", path: ["budget", "retrieval", "retrieval_top_k"], label: "Retrieval top-k", type: { kind: "int", min: 0 } },
  { domain: "budget", key: "rerankTopK", path: ["budget", "retrieval", "rerank_top_k"], label: "Rerank top-k", type: { kind: "int", min: 0 } },
  { domain: "budget", key: "maxSkillChunks", path: ["budget", "retrieval", "max_skill_chunks"], label: "Max skill chunks", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "maxSkillTokens", path: ["budget", "retrieval", "max_skill_tokens"], label: "Max skill tokens", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "timeBudgetMs", path: ["budget", "cost", "time_budget_ms"], label: "Time budget (ms)", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "costBudgetUsd", path: ["budget", "cost", "cost_budget_usd"], label: "Cost budget (USD)", type: { kind: "float", min: 0 } },
  { domain: "budget", key: "tokenBudget", path: ["budget", "cost", "token_budget"], label: "Token budget", type: { kind: "int", min: 1 } },
  { domain: "budget", key: "retryDepth", path: ["budget", "resilience", "retry_depth"], label: "Retry depth", type: { kind: "int", min: 0 } },
  { domain: "budget", key: "validationDepth", path: ["budget", "resilience", "validation_depth"], label: "Validation depth", type: { kind: "int", min: 0 } },
  { domain: "budget", key: "escalationThreshold", path: ["budget", "resilience", "escalation_threshold"], label: "Escalation threshold", type: { kind: "text" } },
]

const HIERARCHY_LEAVES: readonly EnforcementLeaf[] = [
  { domain: "hierarchy", key: "maxDepth", path: ["hierarchy", "max_depth"], label: "Max depth", type: { kind: "int", min: 1, max: 1 } },
  { domain: "hierarchy", key: "orchestrationOnly", path: ["hierarchy", "orchestration_only"], label: "Orchestration only", type: { kind: "bool" } },
  // Feature 056 — both values resolve to main→Worker only (force_manager is inert).
  { domain: "hierarchy", key: "orchestrationMode", path: ["hierarchy", "orchestration_mode"], label: "Orchestration mode", type: { kind: "enum", members: ["heuristic", "force_manager"] } },
  // Feature 053 — optional role-to-agent bindings (FR1). Each names an agent in the
  // live registry; an absent leaf is byte-identical to Feature 048's shipped behavior.
  { domain: "hierarchy", key: "managerAgent", path: ["hierarchy", "manager_agent"], label: "Manager agent", type: { kind: "text" } },
  { domain: "hierarchy", key: "dataAgent", path: ["hierarchy", "data_agent"], label: "Data agent", type: { kind: "text" } },
  { domain: "hierarchy", key: "composerAgent", path: ["hierarchy", "composer_agent"], label: "Composer agent", type: { kind: "text" } },
]

const CAPABILITY_LEAVES: readonly EnforcementLeaf[] = [
  { domain: "capability", key: "metadataSource", path: ["capability", "metadata_source"], label: "Metadata source", type: { kind: "enum", members: ["catalog", "override", "observed"] } },
  { domain: "capability", key: "unknownPolicy", path: ["capability", "unknown_policy"], label: "Unknown policy", type: { kind: "enum", members: ["deny", "allow"] } },
  { domain: "capability", key: "probingEnabled", path: ["capability", "probing_enabled"], label: "Probing enabled", type: { kind: "bool" } },
]

/** The full registry — every exposed budget/hierarchy/capability leaf (FR1-FR3). */
export const ENFORCEMENT_LEAVES: readonly EnforcementLeaf[] = [...BUDGET_LEAVES, ...HIERARCHY_LEAVES, ...CAPABILITY_LEAVES]

/** The leaves of one enforcement domain, in registry order. */
export function leavesForDomain(domain: EnforcementDomain): readonly EnforcementLeaf[] {
  return ENFORCEMENT_LEAVES.filter((leaf) => leaf.domain === domain)
}

/** Resolve a leaf by its operator key within a domain, or `undefined` when unknown (FR9). */
export function leafFor(domain: EnforcementDomain, key: string): EnforcementLeaf | undefined {
  return ENFORCEMENT_LEAVES.find((leaf) => leaf.domain === domain && leaf.key === key)
}

// =============================================================================
// Validation + get/set helpers (pure)
// =============================================================================

export type LeafParse = { readonly ok: true; readonly value: LeafValue } | { readonly ok: false; readonly reason: string }

function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseBool(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw
  if (raw === "true") return true
  if (raw === "false") return false
  return null
}

function checkBounds(leaf: EnforcementLeaf, value: number, min: number, max: number | undefined): LeafParse {
  if (value < min) return { ok: false, reason: `${leaf.key} must be >= ${min}` }
  if (max !== undefined && value > max) return { ok: false, reason: `${leaf.key} must be <= ${max}` }
  return { ok: true, value }
}

/**
 * Validate one raw operator value against a leaf's typed constraint (FR9). Accepts
 * the wire value from either surface (a JSON number/bool/string from the CLI, a
 * field string from the TUI). Rejects with a bounded, secret-free reason naming
 * the offending constraint — never a silent accept.
 */
export function parseLeafValue(leaf: EnforcementLeaf, raw: unknown): LeafParse {
  switch (leaf.type.kind) {
    case "int": {
      const value = parseNumber(raw)
      if (value === null || !Number.isInteger(value)) return { ok: false, reason: `${leaf.key} must be an integer` }
      return checkBounds(leaf, value, leaf.type.min, leaf.type.max)
    }
    case "float": {
      const value = parseNumber(raw)
      if (value === null) return { ok: false, reason: `${leaf.key} must be a number` }
      return checkBounds(leaf, value, leaf.type.min, leaf.type.max)
    }
    case "bool": {
      const value = parseBool(raw)
      if (value === null) return { ok: false, reason: `${leaf.key} must be a boolean` }
      return { ok: true, value }
    }
    case "enum": {
      if (typeof raw !== "string" || !leaf.type.members.includes(raw))
        return { ok: false, reason: `${leaf.key} must be one of ${leaf.type.members.join(", ")}` }
      return { ok: true, value: raw }
    }
    case "text": {
      if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, reason: `${leaf.key} must be a non-empty string` }
      return { ok: true, value: raw }
    }
  }
}

/** Read a leaf's current value from an enforcement view, or `undefined` when absent. */
export function readLeaf(enforcement: EnforcementView, leaf: EnforcementLeaf): LeafValue | undefined {
  let node: unknown = enforcement
  for (const segment of leaf.path) {
    if (typeof node !== "object" || node === null) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  if (typeof node === "number" || typeof node === "boolean" || typeof node === "string") return node
  return undefined
}

/** Project every leaf of a domain from an enforcement view into a bounded operator map (FR5). */
export function projectDomainLeaves(enforcement: EnforcementView, domain: EnforcementDomain): Record<string, LeafValue> {
  const out: Record<string, LeafValue> = {}
  for (const leaf of leavesForDomain(domain)) {
    const value = readLeaf(enforcement, leaf)
    if (value !== undefined) out[leaf.key] = value
  }
  return out
}

/** Immutably set a leaf's value in an enforcement view, cloning only the touched path. */
export function setLeaf(enforcement: EnforcementView, leaf: EnforcementLeaf, value: LeafValue): EnforcementView {
  const clone: EnforcementView = { ...enforcement }
  let cursor: Record<string, unknown> = clone
  for (let i = 0; i < leaf.path.length - 1; i++) {
    const segment = leaf.path[i]
    const child = cursor[segment]
    const nextChild: Record<string, unknown> = typeof child === "object" && child !== null ? { ...(child as Record<string, unknown>) } : {}
    cursor[segment] = nextChild
    cursor = nextChild
  }
  cursor[leaf.path[leaf.path.length - 1]] = value
  return clone
}

export type ConfigureParse =
  | { readonly ok: true; readonly values: Readonly<Record<string, LeafValue>> }
  | { readonly ok: false; readonly key: string; readonly reason: string }

/**
 * Validate a `{ <leafKey>: rawValue }` operator payload for a domain (FR7, FR9):
 * every key MUST be a known leaf of the domain and every value MUST pass its
 * typed constraint. Returns only the validated leaves the operator actually set
 * — the caller persists exactly these onto the fresh on-disk config, never a
 * wholesale snapshot (F035). The first unknown key or invalid value is rejected.
 */
export function parseConfigureValues(domain: EnforcementDomain, raw: Readonly<Record<string, unknown>>): ConfigureParse {
  const values: Record<string, LeafValue> = {}
  for (const key of Object.keys(raw)) {
    const leaf = leafFor(domain, key)
    if (leaf === undefined) return { ok: false, key, reason: `${key} is not a ${domain} leaf` }
    const parsed = parseLeafValue(leaf, raw[key])
    if (!parsed.ok) return { ok: false, key, reason: parsed.reason }
    values[key] = parsed.value
  }
  return { ok: true, values }
}
