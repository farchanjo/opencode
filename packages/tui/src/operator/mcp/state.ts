// Pure signal-and-projection layer for the MCP servers / capabilities /
// resource-admin / experimental panel (Feature 008 / T039, FR48, FR57, C14,
// C24). No I/O, no solid-js — safe to recompute on every render, mirroring
// packages/tui/src/operator/semantic/state.ts and
// packages/tui/src/operator/output/state.ts.
//
// Direct-child-only call cards (FR38-style, mirroring the output panel's
// direct-child filter): Feature 002 owns the Session hierarchy; this panel
// never recurses into grandchildren. A call is a direct child of the current
// Session iff its `parentSessionId` equals `currentSessionId`.
//
// Content loads only on authorized expand (FR33, FR34, C16, C17): a call
// card's `outputRefText` is a reference only; the panel resolves it into
// bounded page text exclusively through the existing Feature 005 OutputSpool
// paged read/follow contract (`../output/page.ts`), never by inventing a
// second content-decoding path.

import type {
  DegradationGap,
  ExperimentalFlagState,
  McpResourceDescriptor,
  McpServerProfile,
  NegotiatedCapabilitySet,
  ServerId,
} from "@opencode-ai/protocol/mcp/commands"
import { deriveCapabilityBadgeRowView, deriveServerBadgeRowView, type McpCapabilityBadgeRowView, type McpServerBadgeRowView } from "./badges"
import {
  deriveCallCardView,
  deriveExperimentalFlagRowView,
  deriveResourceRowView,
  deriveServerCardView,
  type CallCardView,
  type ExperimentalFlagRowView,
  type McpCallEntry,
  type ResourceRowView,
  type ServerCardView,
} from "./card"
import { derivePageView, type LoadedOutputPage, type OutputPageView } from "../output/page"

/**
 * Raw MCP signal the caller assembles from the Feature 007 registry's
 * `mcp.server.*`/`mcp.resource.admin.*`/`mcp.experimental.*` reads plus the
 * runtime data-plane call read models. Every field here is already the
 * bounded, redacted, versioned operator-surface projection — this module
 * never widens or resolves anything further, and never fetches a page itself
 * (mirrors `../output/state.ts`'s `OutputPanelSignal` contract).
 */
export interface McpPanelSignal {
  readonly currentSessionId: string
  readonly servers: readonly McpServerProfile[]
  readonly capabilities: Readonly<Record<ServerId, NegotiatedCapabilitySet>>
  readonly degradation: Readonly<Record<ServerId, DegradationGap>>
  readonly resources: readonly McpResourceDescriptor[]
  readonly experimentalFlags: readonly ExperimentalFlagState[]
  readonly calls: readonly McpCallEntry[]
  /** Only pages a caller has ALREADY loaded via an authorized `output.read`/`output.follow` (see ./index.tsx). */
  readonly pages: Readonly<Record<string, LoadedOutputPage>>
  /** Caller-injected clock reading for elapsed-time projection; this module never calls `Date.now()` itself. */
  readonly nowMs: number
}

/**
 * Safe default: no servers, no capabilities, no calls. Used until a live
 * `mcp.*` operator-registry source is wired into this component; the panel
 * renders nothing rather than inventing a server or a call — a real, honest
 * empty state, not a stub — exactly mirroring `EMPTY_OUTPUT_PANEL_SIGNAL`
 * (../output/state.ts) and `EMPTY_SEMANTIC_PANEL_SIGNAL` (../semantic/
 * state.ts). See ./index.tsx for the identical TUI operator-slash-port
 * wiring-point precedent this mirrors.
 */
export const EMPTY_MCP_PANEL_SIGNAL: McpPanelSignal = {
  currentSessionId: "",
  servers: [],
  capabilities: {},
  degradation: {},
  resources: [],
  experimentalFlags: [],
  calls: [],
  pages: {},
  nowMs: 0,
}

/** Bounded row counts rendered per panel view (mirrors jobs'/semantic's/output's C22-style bound). */
export const MAX_VISIBLE_SERVERS = 50
export const MAX_VISIBLE_RESOURCES = 50
export const MAX_VISIBLE_CALLS = 50

/** Bounded, order-preserving server card list (FR29, FR48). */
export function deriveVisibleServerCards(signal: McpPanelSignal): readonly ServerCardView[] {
  return signal.servers
    .slice(0, MAX_VISIBLE_SERVERS)
    .map((server) => deriveServerCardView(server, signal.degradation[server.id]))
}

/** Connection/transport badge row for one server (FR29, C14). */
export function deriveServerBadges(server: McpServerProfile): McpServerBadgeRowView {
  return deriveServerBadgeRowView(server)
}

/** Capability badge row for one server; the honest empty baseline when nothing is negotiated yet (FR7, FR8, C2). */
export function deriveServerCapabilityBadges(signal: McpPanelSignal, serverId: ServerId): McpCapabilityBadgeRowView {
  return deriveCapabilityBadgeRowView(signal.capabilities[serverId])
}

/** Bounded, order-preserving resource-admin row list (FR19-FR26, C9, C10). */
export function deriveVisibleResourceRows(signal: McpPanelSignal): readonly ResourceRowView[] {
  return signal.resources.slice(0, MAX_VISIBLE_RESOURCES).map(deriveResourceRowView)
}

/** Bounded, order-preserving experimental-flag row list, one row per known `(serverId, flag)` pair (FR41, FR45, C18). */
export function deriveVisibleExperimentalFlagRows(signal: McpPanelSignal): readonly ExperimentalFlagRowView[] {
  return signal.experimentalFlags.slice(0, MAX_VISIBLE_SERVERS).map(deriveExperimentalFlagRowView)
}

/** Direct-child-only, bounded, order-preserving call card list (mirrors the output panel's FR38-style direct-child filter). */
export function deriveDirectChildCalls(signal: McpPanelSignal): readonly CallCardView[] {
  if (!signal.currentSessionId) return []
  return signal.calls
    .filter((call) => call.parentSessionId === signal.currentSessionId)
    .slice(0, MAX_VISIBLE_CALLS)
    .map((call) => deriveCallCardView(call, signal.nowMs))
}

/** The loaded page view for one OutputRef, or null when not yet loaded (honest "not loaded" baseline). */
export function derivePanelPageView(signal: McpPanelSignal, outputRef: string): OutputPageView | null {
  const loaded = signal.pages[outputRef]
  return loaded === undefined ? null : derivePageView(loaded)
}

/**
 * The action an expand/click on one call's OutputRef should take (FR33,
 * FR34, C14, C16, C17) — identical decision shape to `../output/state.ts`'s
 * `resolveExpandAction`, applied to this panel's own `pages` record so a call
 * card's content loads only via bounded `output.read`/`output.follow`
 * offset/limit, never eagerly and never a second decoding path.
 */
export type McpExpandAction =
  | { readonly kind: "already-expanded" }
  | { readonly kind: "load" }
  | { readonly kind: "resume"; readonly cursor: string }
  | { readonly kind: "loaded" }

/** Pure decision function backing the panel's expand/click handler (see ./index.tsx). */
export function resolveMcpExpandAction(signal: McpPanelSignal, expandedRef: string | null, outputRef: string): McpExpandAction {
  if (expandedRef === outputRef) return { kind: "already-expanded" }
  const loaded = signal.pages[outputRef]
  if (loaded === undefined) return { kind: "load" }
  if (!loaded.page.eof && loaded.cursor) return { kind: "resume", cursor: loaded.cursor }
  return { kind: "loaded" }
}

export * as McpPanelState from "./state"
