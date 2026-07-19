/**
 * Feature 009 / T006 (S4) — the sanitized ToolDoc projection.
 *
 * Projects one canonical `ToolDoc` from the boundary already exposed by the
 * sources of truth — native `registry.ts` `tools()` (`tool.description` +
 * `tool.jsonSchema`) and `mcp/catalog.ts` `convertTool` (`description` +
 * `inputSchema`). The Milvus `tools` collection is a DERIVED projection; this
 * module never grants availability, never overrides Permission/Policy, and never
 * decides execution (FR1, C15). A content hash over the SANITIZED projection
 * drives incremental upsert/tombstone: a change to a kept field (name/type/
 * description) re-embeds, a change to a stripped field never does (FR8, AC10).
 *
 * The parameter-schema projection enforces a strict names/types/descriptions
 * allowlist: it keeps parameter `name`, maps the JSON-Schema `type` onto the
 * closed `JsonSchemaType`, and keeps `description`; it STRIPS `default` /
 * `example` / `examples` / `const` / `enum` / `format` / `pattern` / `$ref` and
 * every other keyword, so a malicious description-default or a secret-looking
 * value never reaches the index (FR5, FR6, FR7, C6, AC18). A size cap bounds the
 * parameter count and cumulative description length; overflow sets `truncated`
 * and `sanitizedFieldsDropped` lists dropped keyword NAMES only, never values.
 */
export * as ToolProjection from "./tool-projection"

import type {
  ToolProjectionInput,
  ToolProjectionOutput,
} from "@opencode-ai/protocol/semantic/commands"
import type { JsonSchemaType, ToolSource } from "@opencode-ai/schema/semantic/enums-state"
import type { ToolDoc } from "@opencode-ai/schema/semantic/tool-doc"
import { createHash } from "node:crypto"

/** The closed set of JSON-Schema `type` values kept in the sanitized projection (C6, AC18). */
const JSON_SCHEMA_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
])

/** The only two per-parameter keywords the allowlist keeps; everything else is stripped (FR7, C6, AC18). */
const KEPT_PARAM_KEYWORDS: ReadonlySet<string> = new Set(["type", "description"])

/** The provisional size cap: a bounded parameter count and cumulative description length (FR7, C6, AC18). */
export const PARAM_SCHEMA_SIZE_CAP = Object.freeze({ maxParameters: 64, maxDescriptionChars: 4096 })

/** One sanitized parameter surviving the allowlist — name, closed type, optional description (C6, AC18). */
interface SanitizedParameter {
  readonly name: string
  readonly type: JsonSchemaType
  readonly description: string
}

interface SanitizedParameters {
  readonly parameters: readonly SanitizedParameter[]
  readonly truncated: boolean
  readonly dropped: readonly string[]
}

/** Map an arbitrary JSON-Schema `type` onto the closed `JsonSchemaType`; unknown/compound → `object` (C6). */
const toJsonSchemaType = (raw: unknown): JsonSchemaType => {
  if (typeof raw === "string" && JSON_SCHEMA_TYPES.has(raw)) return raw as JsonSchemaType
  if (Array.isArray(raw)) {
    const first = raw.find((t): t is string => typeof t === "string" && JSON_SCHEMA_TYPES.has(t))
    if (first) return first as JsonSchemaType
  }
  return "object"
}

/** Whether a raw parameter definition is a keyed object (never `true`/`false`/null JSON-Schema forms). */
const isParamObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Sanitize the raw JSON Schema to the names/types/descriptions allowlist, bounded
 * by the size cap. Records the dropped keyword NAMES (never values) across all
 * properties for the content-free `sanitizedFieldsDropped` audit (FR7, C6, AC18).
 */
const sanitizeParameters = (rawSchema: unknown): SanitizedParameters => {
  const properties = isParamObject(rawSchema) && isParamObject(rawSchema.properties) ? rawSchema.properties : {}
  const names = Object.keys(properties).sort((a, b) => a.localeCompare(b))
  const dropped = new Set<string>()
  const parameters: SanitizedParameter[] = []
  let truncated = false
  let descriptionChars = 0

  for (const name of names) {
    const def = properties[name]
    const keywords = isParamObject(def) ? def : {}
    for (const keyword of Object.keys(keywords)) {
      if (!KEPT_PARAM_KEYWORDS.has(keyword)) dropped.add(keyword)
    }
    if (parameters.length >= PARAM_SCHEMA_SIZE_CAP.maxParameters) {
      truncated = true
      continue
    }
    const rawDescription = typeof keywords.description === "string" ? keywords.description : ""
    const remaining = PARAM_SCHEMA_SIZE_CAP.maxDescriptionChars - descriptionChars
    const description = rawDescription.length > remaining ? rawDescription.slice(0, Math.max(0, remaining)) : rawDescription
    if (description.length < rawDescription.length) truncated = true
    descriptionChars += description.length
    parameters.push({ name, type: toJsonSchemaType(keywords.type), description })
  }

  return { parameters, truncated, dropped: [...dropped].sort((a, b) => a.localeCompare(b)) }
}

/**
 * Deterministic content hash over the SANITIZED projection only — descriptor,
 * sanitized parameters, scope, and language tag — so a stripped-field change never
 * re-embeds and a kept-field change always does (FR8, AC10). Stable-key JSON keeps
 * the hash reproducible across identical inputs.
 */
const contentHash = (parts: {
  readonly descriptor: ToolDoc["descriptor"]
  readonly parameters: readonly SanitizedParameter[]
  readonly scope: ToolProjectionInput["scope"]
  readonly language: string
}): string => {
  const stable = JSON.stringify([
    parts.descriptor.name,
    parts.descriptor.source,
    parts.descriptor.server_ref,
    parts.descriptor.description,
    parts.parameters.map((p) => [p.name, p.type, p.description]),
    [parts.scope.project_id, parts.scope.scope, parts.scope.visibility, parts.scope.permission_ref],
    parts.language,
  ])
  return createHash("sha256").update(stable).digest("hex")
}

/**
 * Project one boundary tool record into a sanitized, content-hashed `ToolDoc`. Pure
 * and deterministic: no I/O, no secret, no raw schema, and no filesystem path is
 * ever stored — only names, closed types, sanitized descriptions, the scalar
 * `DocScope`, and the Feature 004 language tag survive (FR6, FR7, FR10, C6, AC18).
 */
export const project = (input: ToolProjectionInput): ToolProjectionOutput => {
  const sanitized = sanitizeParameters(input.rawParameterSchema)
  const descriptor: ToolDoc["descriptor"] = {
    name: input.displayName,
    source: input.source as ToolSource,
    server_ref: (input.mcpServerRef ?? null) as ToolDoc["descriptor"]["server_ref"],
    description: input.rawDescription,
  }
  const hash = contentHash({
    descriptor,
    parameters: sanitized.parameters,
    scope: input.scope,
    language: input.languageTag,
  })
  const doc: ToolDoc = {
    id: input.toolId as ToolDoc["id"],
    identity: { version: 1, content_hash: hash, source: input.source },
    descriptor,
    parameters: { parameters: sanitized.parameters, truncated: sanitized.truncated },
    scope: input.scope,
    language: input.languageTag,
    availability: { enabled: true, available: true },
  }
  return { doc, sanitizedFieldsDropped: sanitized.dropped }
}
