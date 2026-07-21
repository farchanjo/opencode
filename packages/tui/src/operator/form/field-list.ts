/**
 * Multi-field edit descriptor (Feature 017 T001/T003/T004/T005, FR19-FR22).
 *
 * Extends the Feature 015 single-field `edit-descriptor.ts` from ONE field to an
 * ORDERED field list per payload-carrying Configure verb. Pure metadata — no I/O,
 * no solid-js. Each field carries its payload-adjacent input `kind`, a per-field
 * `prefill` extraction from the read the modal already issues, and a per-field
 * `parse` that turns the raw string into its typed value. The descriptor's
 * `compose` maps the per-field parsed values into the BYTE-EXACT port payload —
 * the Feature 014 lesson: not a naive `{ [key]: rawText }` spread (mcp.server.add
 * takes `{name, transportKind, endpoint}`, not `{id, url, transport}`; budget nests
 * under `limits`; the update verbs nest under `patch`). The CAS `expectedVersion`
 * is NOT hand-composed — it rides the existing `executeOperatorCommand` preflight
 * flow, exactly as the Feature 015 single-field forms already do.
 *
 * A secret-bearing field (`secret: true`) is never pre-filled from a resolved value
 * and is only placed on the payload when the operator re-enters it (FR19, FR21).
 */
import { isRecord } from "../projection"
import { EnforcementLeaves, type EnforcementDomain, type EnforcementLeaf } from "@opencode-ai/protocol/enforcement/leaves"

/** The input kinds the multi-field modal renders per property (mirrors `#FieldInputKind`). */
export type EditFieldKind = "text" | "numeric" | "toggle" | "picker" | "bindings_list" | "advanced_json"

/** One bounded option of a `picker` field; `value` is the payload value, never a command id. */
export interface EditFieldOption {
  readonly title: string
  readonly value: string
  readonly description?: string
}

/** Result of parsing+validating a field's raw string into its typed payload value (FR20). */
export type FieldParse = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string }

/** One labeled field in the multi-field modal (mirrors `operator-capability-gaps` `#EditField`). */
export interface EditField {
  readonly key: string
  readonly label: string
  readonly kind: EditFieldKind
  readonly required: boolean
  /** A secret-bearing field is never pre-filled from a resolved value; it is re-entered (FR19, FR21). */
  readonly secret?: boolean
  readonly placeholder?: string
  /** Bounded options for a `picker` field. */
  readonly options?: readonly EditFieldOption[]
  /** Pre-fill the field's raw string from the verb's read effective; honest `undefined` on absence. */
  readonly prefill?: (effective: unknown) => string | undefined
  /** Parse+validate the raw string into its typed value; absent → the trimmed string as-is. */
  readonly parse?: (raw: string) => FieldParse
}

/** Maps a Configure verb to its ordered field list, its pre-fill read, and its byte-exact payload composer (FR19, FR20). */
export interface EditFieldListDescriptor {
  readonly commandId: string
  /** Silent read whose effective pre-fills the fields; absent → every field opens empty. */
  readonly readId?: string
  readonly fields: readonly EditField[]
  /** Compose the byte-exact port payload from the per-field parsed values (keyed by `field.key`). */
  readonly compose: (values: Readonly<Record<string, unknown>>) => Record<string, unknown>
}

/** One role→models row of the `pools.set` bindings-list editor (mirrors `PoolsSetInput.bindings[]`). */
export interface BindingRow {
  readonly role: string
  readonly models: readonly string[]
}

/** Structurally validate an opaque composed value into binding rows (drops malformed entries). */
function asBindingRows(value: unknown): BindingRow[] {
  if (!Array.isArray(value)) return []
  const rows: BindingRow[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.role !== "string") continue
    const models = Array.isArray(raw.models) ? raw.models.filter((m): m is string => typeof m === "string") : []
    rows.push({ role: raw.role, models })
  }
  return rows
}

/** Narrow an opaque composed value to a spreadable record (the advanced-JSON document), else `{}`. */
function asSpread(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

// ── per-field parse helpers (pure) ──────────────────────────────────────────

/** A required non-empty trimmed string; empty → an in-modal field error (FR20). */
function requiredText(label: string): (raw: string) => FieldParse {
  return (raw) => {
    const value = raw.trim()
    if (value.length === 0) return { ok: false, message: `${label} is required` }
    return { ok: true, value }
  }
}

/** A required http(s) URL; empty or non-http(s) → an in-modal field error (FR20, FR21). */
function requiredUrl(label: string): (raw: string) => FieldParse {
  return (raw) => {
    const value = raw.trim()
    if (value.length === 0) return { ok: false, message: `${label} is required` }
    if (!/^https?:\/\//.test(value)) return { ok: false, message: `${label} must start with http:// or https://` }
    return { ok: true, value }
  }
}

/** A required finite number; non-numeric → an in-modal field error (FR20). */
function requiredNumber(label: string): (raw: string) => FieldParse {
  return (raw) => {
    const value = raw.trim()
    if (value.length === 0) return { ok: false, message: `${label} is required` }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return { ok: false, message: `${label} must be a number` }
    return { ok: true, value: parsed }
  }
}

/** An optional JSON object (empty → `{}`); a non-object or malformed value → an in-modal error (FR20, FR21). */
function optionalJsonObject(label: string): (raw: string) => FieldParse {
  return (raw) => {
    const value = raw.trim()
    if (value.length === 0) return { ok: true, value: {} }
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      return { ok: false, message: `${label} must be valid JSON` }
    }
    if (!isRecord(parsed)) return { ok: false, message: `${label} must be a JSON object` }
    return { ok: true, value: parsed }
  }
}

// ── pre-fill helpers (pure, honest-absence) ─────────────────────────────────

/** Extract a top-level string field from the read effective, or `undefined` when absent. */
function prefillString(key: string): (effective: unknown) => string | undefined {
  return (effective) => {
    if (!isRecord(effective)) return undefined
    return typeof effective[key] === "string" ? effective[key] : undefined
  }
}

/** Extract a nested `<parent>.<key>` scalar from the read effective as its string form, or `undefined`. */
function prefillNestedScalar(parent: string, key: string): (effective: unknown) => string | undefined {
  return (effective) => {
    const parentValue = isRecord(effective) ? effective[parent] : undefined
    if (!isRecord(parentValue)) return undefined
    const raw = parentValue[key]
    if (typeof raw === "string") return raw
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
    return undefined
  }
}

/** Coerce a scalar (string/number/boolean) to its string form for a toggle/picker seed, else `undefined`. */
function scalarToString(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
  return undefined
}

/**
 * Feature 040 — extract the routing activation `enabled`/`mode` for the Configure modal from
 * the scope-resolved effective read. Feature 036 nests activation under
 * `effective.activation.{enabled,mode}` (the config-status projection this modal prefills
 * from); a back-compat fallback reads the top-level domain-port `StatusResponse` shape
 * (`effective.enabled`/`effective.mode`) for any stack that still serves it. Honest
 * `undefined` on genuine absence → the toggle/picker keeps its `[ ] off` / `— select —`
 * placeholder; a persisted `enabled:true` seeds `"true"` (→ `[x] on`) and a persisted `mode`
 * seeds the picker option.
 */
function prefillActivation(key: "enabled" | "mode"): (effective: unknown) => string | undefined {
  return (effective) => {
    if (!isRecord(effective)) return undefined
    const activation = effective.activation
    if (isRecord(activation)) {
      const nested = scalarToString(activation[key])
      if (nested !== undefined) return nested
    }
    return scalarToString(effective[key])
  }
}

// ── bindings-list editor (pools.set, FR22) ──────────────────────────────────

/** Project a `pools.show`/`status` effective into ordered `{role, models}` rows, or `[]` on honest absence (FR22). */
export function prefillBindings(effective: unknown): BindingRow[] {
  if (!isRecord(effective) || !Array.isArray(effective.bindings)) return []
  const rows: BindingRow[] = []
  for (const raw of effective.bindings) {
    if (!isRecord(raw) || typeof raw.role !== "string") continue
    const models = Array.isArray(raw.models) ? raw.models.filter((m): m is string => typeof m === "string") : []
    rows.push({ role: raw.role, models })
  }
  return rows
}

/**
 * Compose exactly `{bindings:[{role,models}]}` from the editor rows (FR22). A row
 * whose role is blank is dropped; each row's models are the trimmed non-empty
 * entries. The `expectedVersion` CAS token rides the dispatch preflight, not this
 * payload — the same shape `pools-command-port.ts parseBindings` requires.
 */
export function composeBindingsPayload(rows: readonly BindingRow[]): Record<string, unknown> {
  const bindings = rows
    .map((row) => ({ role: row.role.trim(), models: row.models.map((m) => m.trim()).filter((m) => m.length > 0) }))
    .filter((row) => row.role.length > 0)
  return { bindings }
}

/**
 * In-modal validation for the bindings editor (FR22): mirror the backend's
 * `pools/backend-live.ts` `describeBindingProblem` rules so an invalid pool is
 * caught IN-MODAL before a doomed dispatch — a role pool must have at least one
 * candidate model, and role names must be unique. Blank-role rows are ignored
 * (the composer drops them). Returns the first problem, or `undefined` when clean.
 */
export function validateBindings(rows: readonly BindingRow[]): string | undefined {
  const seen = new Set<string>()
  for (const row of rows) {
    const role = row.role.trim()
    if (role.length === 0) continue // dropped by composeBindingsPayload
    if (seen.has(role)) return `Duplicate role pool "${role}"`
    seen.add(role)
    const models = row.models.map((m) => m.trim()).filter((m) => m.length > 0)
    if (models.length === 0) return `Role pool "${role}" has no candidate models`
  }
  return undefined
}

// ── payload composition helpers ─────────────────────────────────────────────

/** Build a partial `patch` object from the parsed values present under the given keys (update verbs). */
function patchFrom(values: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of keys) if (values[key] !== undefined) patch[key] = values[key]
  return patch
}

/** Copy only the parsed values present under the given keys (create verbs; drops optional-absent fields). */
function pick(values: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) if (values[key] !== undefined) out[key] = values[key]
  return out
}

// ── enum option sets (verbatim port vocabularies) ───────────────────────────

const TELEMETRY_TRANSPORTS: readonly EditFieldOption[] = [
  { title: "HTTP/protobuf", value: "http/protobuf" },
  { title: "gRPC", value: "grpc" },
]

const ROUTING_MODES: readonly EditFieldOption[] = [
  { title: "Always", value: "always" },
  { title: "Auto", value: "auto" },
  { title: "Never", value: "never" },
]

const MCP_TRANSPORTS: readonly EditFieldOption[] = [
  { title: "stdio", value: "stdio" },
  { title: "Streamable HTTP", value: "streamable-http" },
  { title: "SSE", value: "sse" },
]

const QUOTA_SCOPES: readonly EditFieldOption[] = [
  { title: "Global", value: "global" },
  { title: "Root", value: "root" },
  { title: "Session", value: "session" },
  { title: "Process", value: "process" },
  { title: "Channel", value: "channel" },
]

const ACTION_TYPES: readonly EditFieldOption[] = [
  { title: "Native maintenance", value: "native_maintenance" },
  { title: "Operator notification", value: "operator_notification" },
  { title: "Wake or structured input", value: "wake_or_structured_input" },
  { title: "Smart routing dispatch", value: "smart_routing_dispatch" },
  { title: "Approved workflow", value: "approved_workflow" },
]

const OVERLAP_POLICIES: readonly EditFieldOption[] = [
  { title: "Allow", value: "allow" },
  { title: "Forbid", value: "forbid" },
  { title: "Queue", value: "queue" },
  { title: "Replace", value: "replace" },
]

const MISFIRE_POLICIES: readonly EditFieldOption[] = [
  { title: "Skip", value: "skip" },
  { title: "Fire once", value: "fire_once" },
  { title: "Bounded catch-up", value: "bounded_catch_up" },
  { title: "Coalesce", value: "coalesce" },
]

// ── Feature 046 — enforcement-leaf fields generated from the SHARED registry ──

/**
 * Build one TUI edit field for a budget/hierarchy/capability enforcement leaf,
 * driven ENTIRELY by the shared `@opencode-ai/protocol/enforcement/leaves`
 * registry the `op` CLI backend also validates against — so the two surfaces
 * cannot drift out of parity (FR4, FR10). Numeric/text fields parse+validate
 * through the SAME `parseLeafValue` the backend uses (bounds, enum membership);
 * a boolean leaf renders a toggle, an enum leaf a bounded picker. Every field is
 * OPTIONAL so an operator submits only the leaves they touched (partial write,
 * FR7); each prefills from the effective read's `leaves` map (FR10).
 */
function enforcementLeafField(leaf: EnforcementLeaf): EditField {
  const prefill = prefillNestedScalar("leaves", leaf.key)
  const parse = (raw: string): FieldParse => {
    const parsed = EnforcementLeaves.parseLeafValue(leaf, raw.trim())
    return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, message: parsed.reason }
  }
  switch (leaf.type.kind) {
    case "int":
    case "float":
      return { key: leaf.key, label: leaf.label, kind: "numeric", required: false, prefill, parse }
    case "text":
      return { key: leaf.key, label: leaf.label, kind: "text", required: false, prefill, parse }
    case "bool":
      return { key: leaf.key, label: leaf.label, kind: "toggle", required: false, prefill }
    case "enum":
      return {
        key: leaf.key,
        label: leaf.label,
        kind: "picker",
        required: false,
        prefill,
        options: leaf.type.members.map((member) => ({ title: member, value: member })),
      }
  }
}

/** Compose the `{ values: { … } }` enforcement payload — only the leaves the operator set (FR7). */
function enforcementDescriptor(commandId: string, readId: string, domain: EnforcementDomain): EditFieldListDescriptor {
  return {
    commandId,
    readId,
    fields: EnforcementLeaves.leavesForDomain(domain).map(enforcementLeafField),
    compose: (v) => ({ values: { ...v } }),
  }
}

// ── the per-verb multi-field registry ───────────────────────────────────────

const DESCRIPTORS: readonly EditFieldListDescriptor[] = [
  // Feature 046 — hierarchy/capability leaves + the full-leaf budget.configure,
  // all generated from the shared enforcement-leaf registry (FR1-FR4).
  enforcementDescriptor("hierarchy.set", "hierarchy.show", "hierarchy"),
  enforcementDescriptor("capability.set", "capability.show", "capability"),
  enforcementDescriptor("budget.configure", "budget.show", "budget"),
  {
    commandId: "telemetry.configure",
    readId: "telemetry.show",
    fields: [
      { key: "endpoint", label: "Endpoint", kind: "text", required: true, placeholder: "https://otlp.example:4318", prefill: prefillString("endpoint"), parse: requiredUrl("Endpoint") },
      { key: "transport", label: "Transport", kind: "picker", required: true, options: TELEMETRY_TRANSPORTS, prefill: prefillString("transport") },
    ],
    compose: (v) => ({ endpoint: v.endpoint, transport: v.transport }),
  },
  {
    commandId: "budget.set",
    readId: "budget.show",
    fields: [
      { key: "maxTurns", label: "Max turns", kind: "numeric", required: true, prefill: prefillNestedScalar("limits", "maxTurns"), parse: requiredNumber("Max turns") },
      { key: "maxContextTokens", label: "Max context tokens", kind: "numeric", required: true, prefill: prefillNestedScalar("limits", "maxContextTokens"), parse: requiredNumber("Max context tokens") },
      { key: "maxOutputTokens", label: "Max output tokens", kind: "numeric", required: true, prefill: prefillNestedScalar("limits", "maxOutputTokens"), parse: requiredNumber("Max output tokens") },
      { key: "maxWorkers", label: "Max workers", kind: "numeric", required: true, prefill: prefillNestedScalar("limits", "maxWorkers"), parse: requiredNumber("Max workers") },
      { key: "tokenBudget", label: "Token budget", kind: "numeric", required: true, prefill: prefillNestedScalar("limits", "tokenBudget"), parse: requiredNumber("Token budget") },
    ],
    compose: (v) => ({
      limits: {
        maxTurns: v.maxTurns,
        maxContextTokens: v.maxContextTokens,
        maxOutputTokens: v.maxOutputTokens,
        maxWorkers: v.maxWorkers,
        tokenBudget: v.tokenBudget,
      },
    }),
  },
  {
    commandId: "pools.set",
    readId: "pools.show",
    fields: [{ key: "bindings", label: "Role bindings", kind: "bindings_list", required: false }],
    compose: (v) => composeBindingsPayload(asBindingRows(v.bindings)),
  },
  {
    // Feature 029 — Mode is OPTIONAL. The backend `routing.configure` accepts an
    // enabled-only payload and partial-merges it, preserving the stored mode; but it
    // rejects a `mode: ""` placeholder with `invalid_argument`. So an unselected Mode
    // (the "— select —" placeholder) must be OMITTED from the payload, never sent as
    // an empty string — a Save that only flips Enabled succeeds and leaves Mode as-is.
    // The picker itself can only ever yield a real always/auto/never value, so the
    // placeholder is a display-only "leave unchanged" affordance, not a settable mode.
    commandId: "routing.configure",
    readId: "routing.status",
    fields: [
      { key: "enabled", label: "Enabled", kind: "toggle", required: false, prefill: prefillActivation("enabled") },
      { key: "mode", label: "Mode", kind: "picker", required: false, options: ROUTING_MODES, prefill: prefillActivation("mode") },
      { key: "advanced", label: "Advanced policy (JSON)", kind: "advanced_json", required: false, placeholder: '{"budgetPolicy":{…}}', parse: optionalJsonObject("Advanced policy") },
    ],
    // Omit an absent enabled/mode (composePayload drops an optional-blank field) so the
    // placeholder never rides the wire as `mode: ""` (the backend `invalid_argument`).
    compose: (v) => ({
      ...(v.enabled !== undefined ? { enabled: v.enabled } : {}),
      ...(v.mode !== undefined ? { mode: v.mode } : {}),
      ...asSpread(v.advanced),
    }),
  },
  {
    commandId: "mcp.server.add",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, parse: requiredText("Name") },
      { key: "transportKind", label: "Transport", kind: "picker", required: true, options: MCP_TRANSPORTS },
      { key: "endpoint", label: "Endpoint", kind: "text", required: true, placeholder: "https://… or command", parse: requiredText("Endpoint") },
      { key: "secretRef", label: "Secret reference", kind: "text", required: false, secret: true, placeholder: "keychain:… (optional)" },
    ],
    compose: (v) => ({ name: v.name, transportKind: v.transportKind, endpoint: v.endpoint, ...(v.secretRef ? { secretRef: v.secretRef } : {}) }),
  },
  {
    commandId: "mcp.server.update",
    fields: [
      { key: "name", label: "Name", kind: "text", required: false },
      { key: "endpoint", label: "Endpoint", kind: "text", required: false },
    ],
    compose: (v) => ({ patch: patchFrom(v, ["name", "endpoint"]) }),
  },
  {
    commandId: "output.retention.set",
    readId: "output.stat",
    fields: [
      { key: "ttlSeconds", label: "TTL seconds", kind: "numeric", required: true, prefill: prefillNestedScalar("retention", "ttlSeconds"), parse: requiredNumber("TTL seconds") },
      { key: "legalHold", label: "Legal hold", kind: "toggle", required: false, prefill: prefillNestedScalar("retention", "legalHold") },
    ],
    compose: (v) => ({ ttlSeconds: v.ttlSeconds, legalHold: v.legalHold === true }),
  },
  {
    commandId: "output.quota.set",
    readId: "output.stat",
    fields: [
      { key: "quotaScope", label: "Quota scope", kind: "picker", required: true, options: QUOTA_SCOPES, prefill: prefillNestedScalar("quota", "quotaScope") },
      { key: "maxBytes", label: "Max bytes", kind: "numeric", required: true, prefill: prefillNestedScalar("quota", "maxBytes"), parse: requiredNumber("Max bytes") },
    ],
    compose: (v) => ({ quotaScope: v.quotaScope, maxBytes: v.maxBytes }),
  },
  {
    commandId: "jobs.create",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, parse: requiredText("Name") },
      { key: "cronExpression", label: "Cron expression", kind: "text", required: true, placeholder: "0 * * * *", parse: requiredText("Cron expression") },
      { key: "ianaTimezone", label: "Timezone (IANA)", kind: "text", required: true, placeholder: "UTC", parse: requiredText("Timezone") },
      { key: "actionType", label: "Action type", kind: "picker", required: true, options: ACTION_TYPES },
      { key: "payloadRef", label: "Payload reference", kind: "text", required: true, parse: requiredText("Payload reference") },
      { key: "description", label: "Description", kind: "text", required: false },
      { key: "overlapPolicy", label: "Overlap policy", kind: "picker", required: false, options: OVERLAP_POLICIES },
      { key: "misfirePolicy", label: "Misfire policy", kind: "picker", required: false, options: MISFIRE_POLICIES },
    ],
    compose: (v) => pick(v, ["name", "cronExpression", "ianaTimezone", "actionType", "payloadRef", "description", "overlapPolicy", "misfirePolicy"]),
  },
  {
    commandId: "jobs.update",
    fields: [
      { key: "name", label: "Name", kind: "text", required: false },
      { key: "cronExpression", label: "Cron expression", kind: "text", required: false },
      { key: "ianaTimezone", label: "Timezone (IANA)", kind: "text", required: false },
      { key: "description", label: "Description", kind: "text", required: false },
    ],
    compose: (v) => ({ patch: patchFrom(v, ["name", "cronExpression", "ianaTimezone", "description"]) }),
  },
  {
    commandId: "semantic.provider.add",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true, parse: requiredText("Name") },
      { key: "baseUrl", label: "Base URL", kind: "text", required: true, placeholder: "https://…", parse: requiredUrl("Base URL") },
      { key: "secretRef", label: "Secret reference", kind: "text", required: false, secret: true, placeholder: "keychain:… (optional)" },
    ],
    compose: (v) => ({ name: v.name, baseUrl: v.baseUrl, ...(v.secretRef ? { secretRef: v.secretRef } : {}) }),
  },
  {
    commandId: "semantic.provider.update",
    fields: [
      { key: "name", label: "Name", kind: "text", required: false },
      { key: "baseUrl", label: "Base URL", kind: "text", required: false },
    ],
    compose: (v) => ({ patch: patchFrom(v, ["name", "baseUrl"]) }),
  },
]

// ── request-scope picker (Feature 034) ──────────────────────────────────────

/**
 * The authority-scope options a scope-flexible Configure verb may target (Feature
 * 034). This is the REQUEST authority scope (which config document the write lands on
 * — `global:routing` vs `routing`), NOT a payload field: the chosen kind rides
 * `executeOperatorCommand`'s `requestedScope` into the port's `resolveScopeForCommandId`,
 * never `compose`. `value` is the `ScopeKind` string the resolver understands.
 */
const REQUEST_SCOPE_OPTIONS: readonly EditFieldOption[] = [
  { title: "Project (this directory)", value: "project", description: "persist to the per-project config" },
  { title: "Global (all projects)", value: "global", description: "persist to the shared global config" },
  { title: "Session", value: "session", description: "persist to the current session" },
  { title: "Root tree", value: "root-tree", description: "persist to the workspace root tree" },
]

/**
 * True when a command is scope-FLEXIBLE — its `scopesAllowed` offers both `global` and
 * `project`, so the operator should pick which authority the write targets (Feature
 * 034). A single-scope command needs no picker (the scope is implied).
 */
export function isScopeFlexibleCommand(scopesAllowed: readonly string[]): boolean {
  return scopesAllowed.includes("global") && scopesAllowed.includes("project")
}

/**
 * The request-scope picker options for a command, limited to its `scopesAllowed` and in
 * a stable order with `project` first (the back-compat default selection). Returns `[]`
 * for a command that is not scope-flexible, so the caller renders NO picker (Feature 034).
 */
export function requestScopePickerOptions(scopesAllowed: readonly string[]): readonly EditFieldOption[] {
  if (!isScopeFlexibleCommand(scopesAllowed)) return []
  return REQUEST_SCOPE_OPTIONS.filter((option) => scopesAllowed.includes(option.value))
}

/** The default request-scope selection — `project`, preserving pre-Feature-034 behavior. */
export const DEFAULT_REQUEST_SCOPE = "project" as const

const DESCRIPTOR_BY_ID: ReadonlyMap<string, EditFieldListDescriptor> = new Map(DESCRIPTORS.map((d) => [d.commandId, d]))

/** Resolve the multi-field descriptor for a Configure verb, or `undefined` for a verb with no field list (FR19, FR21). */
export function resolveOperatorFieldList(id: string): EditFieldListDescriptor | undefined {
  return DESCRIPTOR_BY_ID.get(id)
}

/** Parse one field's raw string into its typed value; a field with no parser passes the trimmed string through. */
export function parseField(field: EditField, raw: string): FieldParse {
  if (field.parse) return field.parse(raw)
  return { ok: true, value: raw.trim() }
}

/**
 * Validate every field and compose the byte-exact payload from an ordered field
 * list and the operator's raw string entries (FR20). A required field that is
 * blank, or a field whose parse fails, returns the FIRST in-modal error (never a
 * global toast). An optional blank field is dropped so an update `patch` carries
 * only the changed keys. The `bindings` value (pools.set) is supplied pre-parsed.
 */
export function composePayload(
  descriptor: EditFieldListDescriptor,
  raw: Readonly<Record<string, string>>,
  extras: Readonly<Record<string, unknown>> = {},
): { readonly ok: true; readonly payload: Record<string, unknown> } | { readonly ok: false; readonly message: string } {
  const values: Record<string, unknown> = { ...extras }
  for (const field of descriptor.fields) {
    if (field.kind === "bindings_list") continue // supplied via `extras`
    const rawValue = raw[field.key] ?? ""
    if (field.kind === "toggle") {
      // A toggle is emitted ONLY when it carries a seeded/toggled state (`"true"`/
      // `"false"`); an unseeded toggle (blank raw — a prefill miss or a field the
      // operator never touched) is DROPPED, never force-emitted as `false`. This
      // keeps a boolean leaf partial-writable (persist-only-set, FR7), matching the
      // op CLI's partial payload. A required toggle with no state is still an error.
      if (rawValue.trim().length === 0) {
        if (field.required) return { ok: false, message: `${field.label} is required` }
        continue
      }
      values[field.key] = rawValue === "true"
      continue
    }
    if (rawValue.trim().length === 0) {
      if (field.required) return { ok: false, message: `${field.label} is required` }
      continue // optional blank → dropped from the payload
    }
    const parsed = parseField(field, rawValue)
    if (!parsed.ok) return { ok: false, message: parsed.message }
    values[field.key] = parsed.value
  }
  return { ok: true, payload: descriptor.compose(values) }
}
