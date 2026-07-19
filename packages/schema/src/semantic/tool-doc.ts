import { Schema } from "effect"
import { DocAvailability, DocIdentity, DocScope } from "./documents"
import { JsonSchemaType, ToolSource } from "./enums-state"
import { McpServerRef, ToolDocId } from "./ids"
import { Description, DisplayName, LanguageTag, Name, Truncated } from "./text-values"

// Mirrors doc/arch/schemas/semantic/tool-doc.cue and tool-doc-parts.cue (package
// semantic.documents) one-to-one for the Feature 009 `tools` collection projection
// (FR5, FR6, FR7, C6, C13, AC10, AC18). Kept out of the near-full documents.ts per the
// DDD-role split. ToolDoc is an Entity: its id is the canonical composed tool id with
// stable identity across content-hash upserts (FR6, FR8). Descriptor and parameter
// projection are ranking signals only — a malicious description never widens permission
// or execution authority (FR3, C15). Volatile availability is NEVER an authority field;
// every candidate is revalidated against live ToolRegistry/MCP/Permission before it
// reaches the model (FR3, C11). The parameter-schema projection keeps parameter names,
// JSON-Schema types and descriptions ONLY, stripping default/example/const/format,
// paths and any free-form secret, bounded by a size cap with a truncation flag (FR7, C6,
// AC18). No field is a secret, default value, path or raw prompt/reasoning (FR7, FR10,
// FR17, C6, C13).

// ToolDescriptor carries the sanitized display name, source, MCP server ref and description (FR6, C6).
export const ToolDescriptor = Schema.Struct({
  name: DisplayName,
  source: ToolSource,
  server_ref: Schema.NullOr(McpServerRef), // null on native/custom/plugin (FR6, C11)
  description: Description, // ranking signal only, never authority (FR15)
}).annotate({ identifier: "SemanticDocuments.ToolDescriptor" })
export type ToolDescriptor = Schema.Schema.Type<typeof ToolDescriptor>

// ToolParameter carries one sanitized parameter name, JSON-Schema type and description only (FR7, C6, AC18).
export const ToolParameter = Schema.Struct({
  name: Name,
  type: JsonSchemaType,
  description: Description,
}).annotate({ identifier: "SemanticDocuments.ToolParameter" })
export type ToolParameter = Schema.Schema.Type<typeof ToolParameter>

// ToolParameterSet is the first-class collection of sanitized parameter projections (FR7, C6).
export const ToolParameterSet = Schema.Array(ToolParameter)
export type ToolParameterSet = Schema.Schema.Type<typeof ToolParameterSet>

// ToolParameterProjection is the bounded parameter-schema projection with a size-cap truncation flag (FR7, C6, AC18).
export const ToolParameterProjection = Schema.Struct({
  parameters: ToolParameterSet,
  truncated: Truncated,
}).annotate({ identifier: "SemanticDocuments.ToolParameterProjection" })
export type ToolParameterProjection = Schema.Schema.Type<typeof ToolParameterProjection>

// ToolDoc is the `tools` collection projection entity; id is the canonical composed tool id (FR6, C6).
export const ToolDoc = Schema.Struct({
  id: ToolDocId, // entity identity — canonical composed tool id (FR6)
  identity: DocIdentity, // version + content_hash + source; drives upsert/tombstone (FR8, AC10)
  descriptor: ToolDescriptor,
  parameters: ToolParameterProjection,
  scope: DocScope, // scalar project_id/permission_ref filtered every search (FR10, C13)
  language: LanguageTag, // Feature 004 Lang Lock provenance of the English text (FR16, FR17)
  availability: DocAvailability, // mirrors live core; revalidated before injection (FR3, C11)
}).annotate({ identifier: "SemanticDocuments.ToolDoc" })
export type ToolDoc = Schema.Schema.Type<typeof ToolDoc>
