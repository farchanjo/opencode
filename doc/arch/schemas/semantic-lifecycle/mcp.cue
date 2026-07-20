// DDD role: ValueObject
// Package: semantic_lifecycle.mcp
// The MCP residual completions (Feature 019, Group C). The interactive OAuth flow is
// real (MCP.Service.startAuth returns {authorizationUrl, oauthState}; a loopback
// callback server + finishAuth complete the exchange), the resource-subscription SDK
// primitive + pure dual-authority state machine exist, and the operator AppRuntime
// resolves the SAME MCP.Service singleton the interactive session uses. Feature 019
// completes the delegation: auth.start/finish delegate for an interactive TUI while a
// headless surface keeps the typed gap, resource.admin.subscribe/unsubscribe drive the
// existing subscription machine over a subscribe-capable client, and the mcp status
// read carries the config-backed experimental/extension flag state so badges render
// truthfully. No secret material crosses an envelope (Security). CUE packages are not
// cross-resolved by the structural reader.

package semantic_lifecycle.mcp

import (
	"semantic-lifecycle/enums"
	"semantic-lifecycle/shared"
)

// McpAuthStart is the delegation outcome of auth.start: an interactive TUI receives the authorize URL and the callback listener starts, a headless surface receives the typed gap; the URL is not a secret, no token crosses the seam (Group C, Security).
#McpAuthStart: {
	serverId:          shared.#ScopeId
	delegation:        enums.#McpAuthDelegation
	authorizationUrl?: shared.#EndpointAddress
	reason?:           shared.#ReasonText
}

// McpSubscription is the resource-subscription the operator drives over the subscribe-capable client through the existing dual-authority machine; capability_absent is the fail-closed honest boundary (Group C).
#McpSubscription: {
	serverId:     shared.#ScopeId
	resourceUri:  shared.#EndpointAddress
	state:        enums.#McpSubscriptionState
	reason?:      shared.#ReasonText
}

// McpToggleBadgeState is the truthful control-row projection the completed mcp status read carries from the config-backed flag SSOT; a connected server never renders unknown (Group C).
#McpToggleBadgeState: {
	serverId:     shared.#ScopeId
	experimental: enums.#ToggleBadge
	extension:    enums.#ToggleBadge
}
