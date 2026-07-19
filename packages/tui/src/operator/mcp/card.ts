// Pure text-first card projections for one MCP server and one tool/resource/
// task call (Feature 008 / T039, FR29, FR48, FR57, C14, C24). No I/O, no
// solid-js — mirrors packages/tui/src/operator/semantic/card.ts and
// packages/tui/src/operator/output/card.ts.
//
// Source of truth for the row shape: the committed `@opencode-ai/protocol/
// mcp/commands` `McpServerProfile` / `DegradationGap` / `McpContentEnvelope`
// / `McpProgressEvent` — the redacted, bounded, versioned Feature 007
// operator-surface projection (never the durable SSOT record, never a
// filesystem path, C16, C25, C26). Untrusted content is labeled from
// `ContentProvenance` alone; this module never resolves, widens, or renders
// the underlying content itself (FR27, C24).

import type {
  DegradationGap,
  ExperimentalFlagState,
  McpCallId,
  McpContentEnvelope,
  McpProgressEvent,
  McpResourceDescriptor,
  McpServerProfile,
  ServerId,
} from "@opencode-ai/protocol/mcp/commands"

export interface ServerCardView {
  readonly id: ServerId
  readonly nameText: string
  readonly connectionStateText: string
  readonly transportKindText: string
  /** URL for remote, command for stdio; never a raw credential (C15, per McpServerProfile). */
  readonly endpointText: string
  readonly trustProfileText: string
  readonly sseDeprecationText: string | null
  readonly degradedText: string
  readonly enabledText: string
}

/** Derive the bounded, redacted server card view; `degradationGap` renders as an honest gap label, never a false "nominal" (FR7, C1, C2). */
export function deriveServerCardView(server: McpServerProfile, degradationGap?: DegradationGap): ServerCardView {
  return {
    id: server.id,
    nameText: server.name,
    connectionStateText: server.connectionState,
    transportKindText: server.transportKind,
    endpointText: server.endpoint,
    trustProfileText: server.trustProfile,
    sseDeprecationText: server.sseDeprecationLabel ? "legacy SSE fallback (deprecated)" : null,
    degradedText: degradationGap ? `degraded (${degradationGap.code})` : "nominal",
    enabledText: server.enabled ? "enabled" : "disabled",
  }
}

export interface ResourceRowView {
  readonly uriText: string
  readonly nameText: string | null
  readonly mimeTypeText: string | null
  readonly subscribableText: string
}

/** Derive the bounded resource-admin row view; `subscribable` mirrors the negotiated `resources.subscribe` capability (C10). */
export function deriveResourceRowView(resource: McpResourceDescriptor): ResourceRowView {
  return {
    uriText: resource.uri,
    nameText: resource.name ?? null,
    mimeTypeText: resource.mimeType ?? null,
    subscribableText: resource.subscribable ? "subscribable" : "not subscribable",
  }
}

export interface ExperimentalFlagRowView {
  readonly flagText: string
  readonly enabledText: string
}

/** Derive the bounded experimental-flag row view (FR41, FR45, C18: off by default). */
export function deriveExperimentalFlagRowView(flag: ExperimentalFlagState): ExperimentalFlagRowView {
  return { flagText: flag.flag, enabledText: flag.enabled ? "enabled" : "disabled" }
}

/** One tool/resource/task call the panel tracks; a caller assembles this from the runtime data-plane read models (see ./state.ts). */
export interface McpCallEntry {
  readonly mcpCallId: McpCallId
  readonly serverId: ServerId
  readonly toolNameText: string
  readonly kind: "tool" | "resource" | "task"
  readonly parentSessionId: string
  /** A `CallOutcome`/`TaskStatus` member, or `"running"` while settlement is pending. */
  readonly statusText: string
  readonly progress?: McpProgressEvent
  readonly envelope?: McpContentEnvelope
  readonly startedAtMs: number
  readonly updatedAtMs: number
}

export interface CallCardView {
  readonly mcpCallId: string
  readonly serverIdText: string
  readonly toolNameText: string
  readonly kindText: "tool" | "resource" | "task"
  readonly statusText: string
  readonly progressText: string
  readonly totalText: string | null
  readonly messageText: string | null
  readonly bytesText: string | null
  readonly elapsedMsText: string
  /** Present only once a bounded preview + OutputRef exists; expand always goes through OutputRef offset/limit (FR33, FR34, C16). */
  readonly outputRefText: string | null
  /** Non-null only when content provenance is not `trusted` (FR27, C24). */
  readonly untrustedLabelText: string | null
}

/** Derive the bounded call card view; `nowMs` is caller-injected so this stays pure (no `Date.now()` inside). */
export function deriveCallCardView(entry: McpCallEntry, nowMs: number): CallCardView {
  const elapsedMs = Math.max(0, (entry.updatedAtMs || nowMs) - entry.startedAtMs)
  const untrustedLabelText =
    entry.envelope !== undefined && entry.envelope.provenance !== "trusted" ? entry.envelope.provenance : null
  return {
    mcpCallId: entry.mcpCallId,
    serverIdText: entry.serverId,
    toolNameText: entry.toolNameText,
    kindText: entry.kind,
    statusText: entry.statusText,
    progressText: entry.progress ? String(entry.progress.progress) : "-",
    totalText: entry.progress?.total !== undefined ? String(entry.progress.total) : null,
    messageText: entry.progress?.message ?? null,
    bytesText: entry.envelope ? `${entry.envelope.previewBytes} B` : null,
    elapsedMsText: `${elapsedMs}ms`,
    outputRefText: entry.envelope?.outputRef ?? null,
    untrustedLabelText,
  }
}

export * as McpCard from "./card"
