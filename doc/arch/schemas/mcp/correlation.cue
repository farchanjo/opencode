// DDD role: ValueObject
// Package: mcp.shared
// Scope and correlation ValueObjects. Project and session ids scope every resource URI
// and root so no sibling session or cross-project delivery is possible (FR25, Privacy
// 3, C12). Correlation and causation ids carry opaque trace linkage only; they live in
// traces and logs, never as metric labels (FR56, C26). No axis carries content or a
// filesystem path (FR34, C16, C26).

package mcp.shared

// ProjectId is the project scope every resource URI and root is confined to (FR25, C12).
#ProjectId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// SessionId is the producing session scope; no sibling-session delivery is permitted (FR25, Privacy 3).
#SessionId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CorrelationId is the per-aggregate correlation key for durable mcp.* ordering (FR38, C3).
#CorrelationId: string & =~"^[A-Za-z0-9_-]{1,128}$"

// CausationId links an mcp.* event to the event that caused it; trace linkage only (FR56, C26).
#CausationId: string & =~"^[A-Za-z0-9_-]{1,128}$"
