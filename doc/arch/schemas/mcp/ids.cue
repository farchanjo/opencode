// DDD role: ValueObject
// Package: mcp.shared
// Shared identity ValueObjects for the Feature 008 MCP client lifecycle and content
// plane. Centralised to avoid primitive obsession and duplicated constraints. Name
// parity with lifecycle.shared / jobs.shared / outputspool.shared / semantic.shared is
// intentional; CUE packages are not cross-imported here, so the identifier concepts are
// re-declared locally (FR7, FR48, C2, C25). No identity axis is a filesystem path
// (FR34, C16).

package mcp.shared

// ServerId identifies one McpServerProfile aggregate — one configured MCP server (FR7, FR48, C2).
#ServerId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ConnectionId identifies one McpConnection aggregate — one live lifecycle attempt (FR7, C2).
#ConnectionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ToolName is the canonical tool token keying one McpToolCatalogEntry entity (FR10, C4).
#ToolName: string & =~"^[A-Za-z0-9_.:-]{1,160}$"

// PromptName is the canonical prompt token keying one McpPromptDescriptor entity (FR27, C24).
#PromptName: string & =~"^[A-Za-z0-9_.:-]{1,160}$"

// RequestId is the opaque JSON-RPC request id correlating a call to its settlement (FR2, FR17, C8).
#RequestId: string & !~"^$"

// TaskId identifies one McpTask entity in the experimental Tasks lifecycle (FR41, C18).
#TaskId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// ProgressToken is the opaque progress token supplied per call so servers emit progress (FR14, C7).
#ProgressToken: string & !~"^$"

// SubscriptionId identifies one ResourceSubscription entity granted by an operator (FR21, C10).
#SubscriptionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// EventId is the EventV2 evt_ identifier assigned per published mcp.* event (FR38, C3).
#EventId: string & =~"^evt_[A-Za-z0-9_-]{1,120}$"
