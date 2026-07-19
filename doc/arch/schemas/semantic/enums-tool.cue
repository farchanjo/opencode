// DDD role: ValueObject
// Package: semantic.enums
// Feature 009 tool-search enums extending the Feature 006 semantic stack — tool source
// provenance, the sanitized JSON-Schema type projection, the tool degradation ladder
// rung, the per-surface enablement axis and the reindex trigger origin (FR6, FR8, FR18,
// FR21, C6, C9, C11, C14). The degradation ladder never auto-substitutes a model; the
// full_set_passthrough floor keeps tool exposure no worse than today (FR19, C14). The
// per-surface axis gates live consumption and defaults off (C9, C12, C15). Every enum is
// a ValueObject (calisthenics).

package semantic.enums

// ToolSource is the provenance of a projected tool document (FR6, C6).
#ToolSource: "native" | "mcp" | "custom" | "plugin"

// JsonSchemaType is the sanitized parameter type kept in the bounded projection; no values or formats (FR7, C6, AC18).
#JsonSchemaType: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null"

// ToolRetrievalMode is the tool degradation ladder rung; full_set_passthrough is the absolute floor (FR18, C14).
#ToolRetrievalMode: "full_semantic" | "lexical_only" | "full_set_passthrough" | "fail_closed"

// ToolSurface is the per-surface enablement axis gating live consumption; default off (FR21, C9, C12, C15).
#ToolSurface: "native" | "mcp" | "code_mode"

// ToolTriggerSource is the origin of an incremental tool reindex, coalesced per scope (FR8, C11).
#ToolTriggerSource: "registry_change" | "mcp_tools_changed" | "config_change"
