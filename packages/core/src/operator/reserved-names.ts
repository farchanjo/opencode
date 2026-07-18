/**
 * Reserved-name collision classifier (T042–T043).
 * Reject plugin/MCP/custom/slash/palette names that collide with operator catalog.
 * Uses RESERVED_CATALOG_VERSION only — no hardcode.
 * Does not reserve bare domain tokens for built-in tool safety when source is builtin.
 */
import { isReservedCommandId, listReservedIds, RESERVED_CATALOG_VERSION } from "./catalog"
import { generateAliases } from "./reserved-aliases"
import { parseCommandId } from "./command-id"

export type RegistrationSource =
  | "plugin"
  | "mcp"
  | "custom"
  | "slash"
  | "palette"
  | "cli"
  | "legacy"
  | "builtin"

export type ReservedNameCheck =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: "reserved_name"
      readonly reason: string
      readonly catalogVersion: string
      readonly matched: string
      readonly source: RegistrationSource
    }

/**
 * Exact legacy admin-like names (one-release warn existing / reject new).
 * Narrow classifier — no bare substring "admin" false positives (e.g. "read-admin-notes").
 */
export const LEGACY_ADMIN_LIKE_NAMES = [
  "admin",
  "settings-admin",
  "op-admin",
  "operator",
  "control-plane",
  "mcp-admin",
  "semantic-admin",
  "operator-admin",
] as const

const LEGACY_SET = new Set<string>(LEGACY_ADMIN_LIKE_NAMES.map((n) => n.toLowerCase()))

/** Exact suffix patterns only (not substring mid-token). */
const LEGACY_SUFFIX_RE = /(?:^|[.-])admin$/i

/** Build reserved set including aliases and /op.* forms. Not bare domain-only (task/mcp tools). */
function reservedSurfaceSet(): ReadonlySet<string> {
  const set = new Set<string>()
  for (const id of listReservedIds()) {
    set.add(id.toLowerCase())
    set.add(`/op.${id}`.toLowerCase())
    set.add(`op ${id.replace(/\./g, " ")}`.toLowerCase())
    const aliases = generateAliases(id)
    set.add(aliases.slash.toLowerCase())
    set.add(aliases.palette.toLowerCase())
    set.add(aliases.cli.join(" ").toLowerCase())
  }
  // Prefix surface tokens only — not domain leaves (avoids breaking builtin task/mcp tools)
  set.add("op")
  set.add("/op")
  set.add("operator")
  return set
}

let cached: ReadonlySet<string> | undefined
let cachedVersion: string | undefined

function surfaces(): ReadonlySet<string> {
  if (!cached || cachedVersion !== RESERVED_CATALOG_VERSION) {
    cached = reservedSurfaceSet()
    cachedVersion = RESERVED_CATALOG_VERSION
  }
  return cached
}

/**
 * Normalize a candidate registration name for comparison.
 * Strips leading /, collapses spaces, lowercases.
 */
export function normalizeRegistrationName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "/")
    .replace(/\s+/g, " ")
}

function fail(
  rawName: string,
  reason: string,
  matched: string,
  source: RegistrationSource,
): ReservedNameCheck {
  return {
    ok: false,
    code: "reserved_name",
    reason,
    catalogVersion: RESERVED_CATALOG_VERSION,
    matched,
    source,
  }
}

/**
 * Fail-closed check for plugin/MCP/custom/slash registration.
 * No silent rename. Built-in authority may skip via source "builtin".
 */
export function checkReservedRegistrationName(
  rawName: string,
  source: RegistrationSource,
): ReservedNameCheck {
  // Built-in tools/commands (task, mcp client tools from native registry, init/review) skip
  if (source === "builtin") return { ok: true }

  const name = normalizeRegistrationName(rawName)
  if (!name) {
    return fail(rawName, "empty registration name", "", source)
  }

  // Exact catalog id
  if (isReservedCommandId(name) || isReservedCommandId(name.replace(/^\//, "").replace(/^op\./, ""))) {
    return fail(rawName, `name "${rawName}" collides with reserved operator command`, name, source)
  }

  // /op.* prefix always reserved
  if (name === "/op" || name.startsWith("/op.") || name.startsWith("op.") || name.startsWith("op ")) {
    return fail(rawName, `name "${rawName}" uses reserved /op.* operator surface`, name, source)
  }

  if (surfaces().has(name)) {
    return fail(rawName, `name "${rawName}" collides with reserved operator alias`, name, source)
  }

  // operator.* dotted form
  if (name.startsWith("operator.")) {
    return fail(rawName, `name "${rawName}" uses reserved operator.* namespace`, name, source)
  }

  // Valid dotted command id that parses as operator domain
  const withoutSlash = name.replace(/^\//, "")
  const parsed = parseCommandId(withoutSlash)
  if (parsed.ok && isReservedCommandId(parsed.value)) {
    return fail(rawName, `name "${rawName}" collides with reserved operator id`, parsed.value, source)
  }

  return { ok: true }
}

export type LegacyClassification =
  | { readonly kind: "clean" }
  | { readonly kind: "legacy_admin_like"; readonly name: string; readonly action: "warn_existing_reject_new" }
  | { readonly kind: "reserved_collision"; readonly name: string; readonly action: "reject" }

/**
 * Classify legacy custom/plugin names for migration (T043).
 * Existing: warn once. New registration: reject.
 * Narrow: exact LEGACY set or token-boundary -admin / .admin suffix only.
 */
export function classifyLegacyAdminName(rawName: string): LegacyClassification {
  const name = normalizeRegistrationName(rawName)
  const reserved = checkReservedRegistrationName(rawName, "legacy")
  if (!reserved.ok) {
    return { kind: "reserved_collision", name, action: "reject" }
  }
  if (LEGACY_SET.has(name) || LEGACY_SUFFIX_RE.test(name) || name === "control-plane") {
    return { kind: "legacy_admin_like", name, action: "warn_existing_reject_new" }
  }
  return { kind: "clean" }
}

/** Dry-run migration report (no rename/delete). Versioned with catalog. */
export function dryRunLegacyMigration(names: readonly string[]): {
  readonly catalogVersion: string
  readonly reject: readonly string[]
  readonly warn: readonly string[]
  readonly clean: readonly string[]
  readonly policy: "warn_existing_reject_new"
  readonly autoRename: false
  readonly autoDelete: false
} {
  const reject: string[] = []
  const warn: string[] = []
  const clean: string[] = []
  for (const n of names) {
    const c = classifyLegacyAdminName(n)
    if (c.kind === "reserved_collision") reject.push(n)
    else if (c.kind === "legacy_admin_like") warn.push(n)
    else clean.push(n)
  }
  return {
    catalogVersion: RESERVED_CATALOG_VERSION,
    reject,
    warn,
    clean,
    policy: "warn_existing_reject_new",
    autoRename: false,
    autoDelete: false,
  }
}

/** Structured error for registration/config load (deterministic, not generic). */
export class ReservedNameError extends Error {
  readonly code = "reserved_name" as const
  readonly catalogVersion: string
  readonly matched: string
  readonly source: RegistrationSource

  constructor(check: Extract<ReservedNameCheck, { ok: false }>) {
    super(check.reason)
    this.name = "ReservedNameError"
    this.catalogVersion = check.catalogVersion
    this.matched = check.matched
    this.source = check.source
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      catalogVersion: this.catalogVersion,
      matched: this.matched,
      source: this.source,
    }
  }
}

export function assertRegistrationNameAllowed(rawName: string, source: RegistrationSource): void {
  const check = checkReservedRegistrationName(rawName, source)
  if (!check.ok) throw new ReservedNameError(check)
}

export * as OperatorReservedNames from "./reserved-names"
