// DDD role: Entity
// Package: mcp.prompts
// McpPromptDescriptor — one runtime prompt reachable through the canonical adapter under
// Permission (FR27, C24). Its identity is the prompt_name; prompts list/get/list_changed
// are runtime content under Permission, never admin setup and never Feature 007 management
// IDs (FR27, C25). Untrusted prompt content carries a provenance label so injection text is
// never treated as a trusted system instruction (FR27, C24). Sub-objects in
// prompt-parts.cue.

package mcp.prompts

import (
	"mcp/ids"
)

// McpPromptDescriptor is one runtime prompt; identity is its prompt name (FR27, C24).
#McpPromptDescriptor: {
	id: ids.#PromptName

	// The server exposing this prompt (FR27, C24).
	server_ref: ids.#ServerId

	// The bounded human title of the prompt (FR57).
	title: ids.#Title

	// The declared prompt arguments (FR27, C24).
	arguments: #PromptArgumentList

	// The untrusted-content provenance label at the context boundary (FR27, C24).
	provenance: ids.#ProvenanceLabel
}
