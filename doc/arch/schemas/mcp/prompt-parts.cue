// DDD role: ValueObject
// Package: mcp.prompts
// Cohesive sub-objects composed by the McpPromptDescriptor entity (FR27, C24). A prompt
// argument carries a bounded name, description and required flag; the argument list is a
// first-class collection. Prompts are runtime content under Permission, never Feature 007
// admin IDs, and untrusted prompt content carries a provenance label so injection text is
// never treated as a trusted system instruction (FR27, C24). No sub-object inlines a
// rendered prompt body or content (FR34, C16).

package mcp.prompts

import (
	"mcp/ids"
)

// PromptArgument carries a bounded argument name, description and required flag (FR27, C24).
#PromptArgument: {
	name:        ids.#Title
	description: ids.#Title
	required:    ids.#Enabled
}

// PromptArgumentList is the first-class collection of prompt arguments (FR27, C24).
#PromptArgumentList: [...#PromptArgument]
