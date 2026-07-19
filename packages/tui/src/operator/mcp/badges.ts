// Pure text-first badge projections for MCP server connection/capability state
// (Feature 008 / T039, FR29, FR48, FR57, C14). No I/O, no solid-js — mirrors
// packages/tui/src/operator/semantic/badges.ts's text-derivation style.
//
// Source of truth for the row shape: the committed `@opencode-ai/protocol/
// mcp/commands` `McpServerProfile` / `NegotiatedCapabilitySet` — the
// redacted, bounded, versioned Feature 007 operator-surface projection. This
// module never surfaces a secret (`secretRef` stays opaque), a raw token, or
// a filesystem path (C15, C25, C26). Every text field stands on its own —
// screen-reader text is never color-only (FR57).

import type { McpServerProfile, NegotiatedCapabilitySet } from "@opencode-ai/protocol/mcp/commands"

export interface McpServerBadgeRowView {
  readonly connectionStateText: string
  readonly transportKindText: string
  readonly trustProfileText: string
  /** Non-null only when this connection fell back to legacy SSE (C14). */
  readonly sseDeprecationText: string | null
  readonly scopeText: string
  readonly enabledText: string
}

/** Derive the bounded, redacted connection/transport badge row for one server (FR29, C14, C25). */
export function deriveServerBadgeRowView(server: McpServerProfile): McpServerBadgeRowView {
  return {
    connectionStateText: server.connectionState,
    transportKindText: server.transportKind,
    trustProfileText: server.trustProfile,
    sseDeprecationText: server.sseDeprecationLabel ? "legacy SSE fallback (deprecated)" : null,
    scopeText: server.scope,
    enabledText: server.enabled ? "enabled" : "disabled",
  }
}

export interface McpCapabilityBadgeRowView {
  /** Capability badges rendered verbatim; an unadvertised capability never appears here (FR7, FR8, C2). */
  readonly capabilityBadgesText: readonly string[]
  readonly protocolVersionText: string | null
}

/** Derive the bounded capability-badge row; the honest empty baseline when nothing is negotiated yet. */
export function deriveCapabilityBadgeRowView(capabilities?: NegotiatedCapabilitySet): McpCapabilityBadgeRowView {
  if (capabilities === undefined) return { capabilityBadgesText: [], protocolVersionText: null }
  const badges: string[] = []
  if (capabilities.tools) badges.push("tools")
  if (capabilities.toolsListChanged) badges.push("tools.list_changed")
  if (capabilities.resources) badges.push("resources")
  if (capabilities.resourcesSubscribe) badges.push("resources.subscribe")
  if (capabilities.resourcesListChanged) badges.push("resources.list_changed")
  if (capabilities.prompts) badges.push("prompts")
  if (capabilities.promptsListChanged) badges.push("prompts.list_changed")
  if (capabilities.logging) badges.push("logging")
  if (capabilities.roots) badges.push("roots")
  if (capabilities.experimentalTasks) badges.push("experimental.tasks")
  if (capabilities.experimentalContentStream) badges.push("experimental.content_stream")
  return { capabilityBadgesText: badges, protocolVersionText: capabilities.protocolVersion }
}

export * as McpBadges from "./badges"
