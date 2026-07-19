// DDD role: Entity
// Package: semantic.documents
// ToolDoc — one canonical tool projected into the `tools` collection (FR5, FR6). It is
// an Entity: its id is the canonical composed tool id with stable identity across
// content-hash upserts (FR6, FR8). Descriptor and parameter projection are ranking signals
// only; the projection never grants availability, overrides permission visibility or
// decides execution (FR1, FR3, C15). Volatile availability is NEVER an authority field —
// every candidate is revalidated against live ToolRegistry/MCP/Permission before it reaches
// the model (FR3, C11). The language tag is the Feature 004 Lang Lock provenance of the
// English descriptions (FR16, FR17). No secret, path or schema value is stored (FR7, C6).
// Cohesive parts live in tool-doc-parts.cue.

package semantic.documents

import "semantic/ids"

// ToolDoc is the `tools` collection projection entity; id is the canonical composed tool id (FR6, C6).
#ToolDoc: {
	id:           ids.#ToolDocId
	identity:     #DocIdentity
	descriptor:   #ToolDescriptor
	parameters:   #ToolParameterProjection
	scope:        #DocScope
	language:     ids.#LanguageTag
	availability: #DocAvailability
}
