// Native MCP servers / capabilities / resource-admin / experimental panel —
// Feature 007 operator surface for Feature 008's MCP client tools and
// resources lifecycle (T039, FR48, FR57, C14, C24). Renders server cards,
// capability badges, connection/subscription state, SSE deprecation labels,
// resource-admin rows, experimental-flag rows, and direct-child tool/
// resource/task call cards (status, progress, total, message, bytes,
// elapsed, provider/server, expand via OutputRef offset/limit), as a thin
// adapter over the Feature 007 registry's `mcp.server.*`/`mcp.auth.*`/
// `mcp.resource.admin.*`/`mcp.experimental.*` commands (never a divergent
// hardcoded verb set, never a second command registry — the CLI coexistence
// note in `packages/opencode/src/cli/cmd/mcp.ts` applies identically here).
// Text states are always present alongside any color, never color-only
// (FR57), mirroring packages/tui/src/operator/semantic/index.tsx and
// packages/tui/src/operator/output/index.tsx conventions. Untrusted content
// is labeled from `ContentProvenance` alone; no secret, raw token, or
// filesystem path is ever part of this panel's signal (FR27, C15, C24, C26).
//
// Wiring point (deliberately not done here): render `<McpPanel signal=
// {...} onExpand={...} onFollow={...} />` from the Operator Settings surface
// (packages/tui/src/operator/dialog-settings.tsx) once a structured
// `mcp.server.list`/`mcp.resource.admin.list`/`mcp.experimental.status`
// query result — or a live `mcp.*` watch over the observation seam — is
// threaded through `OperatorSlashPort` (packages/tui/src/context/
// operator-slash.tsx). Today that port only returns an
// `OperatorSlashDisplay` (title/message/variant/outcome strings) from
// `tryHandle`, so there is no structured, redacted `McpPanelSignal` source
// reachable from the TUI yet. With `signal` omitted the component renders
// `EMPTY_MCP_PANEL_SIGNAL` (no servers, no calls) — a real, honest empty
// state, not a stub — exactly mirroring `EMPTY_OUTPUT_PANEL_SIGNAL`
// (../output/state.ts) and `EMPTY_SEMANTIC_PANEL_SIGNAL` (../semantic/
// state.ts).
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import {
  deriveDirectChildCalls,
  deriveServerBadges,
  deriveServerCapabilityBadges,
  deriveVisibleExperimentalFlagRows,
  deriveVisibleResourceRows,
  deriveVisibleServerCards,
  derivePanelPageView,
  EMPTY_MCP_PANEL_SIGNAL,
  resolveMcpExpandAction,
  type McpPanelSignal,
} from "./state"
import type { CallCardView, ExperimentalFlagRowView, ResourceRowView, ServerCardView } from "./card"
import type { McpCapabilityBadgeRowView, McpServerBadgeRowView } from "./badges"
import type { OutputPageView } from "../output/page"

export {
  deriveDirectChildCalls,
  deriveServerBadges,
  deriveServerCapabilityBadges,
  deriveVisibleExperimentalFlagRows,
  deriveVisibleResourceRows,
  deriveVisibleServerCards,
  derivePanelPageView,
  EMPTY_MCP_PANEL_SIGNAL,
  MAX_VISIBLE_CALLS,
  MAX_VISIBLE_RESOURCES,
  MAX_VISIBLE_SERVERS,
  resolveMcpExpandAction,
  type McpExpandAction,
  type McpPanelSignal,
} from "./state"
export {
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
export { deriveCapabilityBadgeRowView, deriveServerBadgeRowView, type McpCapabilityBadgeRowView, type McpServerBadgeRowView } from "./badges"

function ServerCard(props: { view: ServerCardView; badges: McpServerBadgeRowView; capabilities: McpCapabilityBadgeRowView }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text fg={theme.text}>
          <b>{props.view.nameText}</b>
        </text>
        <text fg={props.view.degradedText === "nominal" ? theme.textMuted : theme.warning}>{props.view.degradedText}</text>
      </box>
      <text fg={theme.textMuted} wrapMode="none">
        {"  "}{props.badges.connectionStateText} · {props.badges.transportKindText} · {props.badges.trustProfileText} ·{" "}
        {props.badges.scopeText} · {props.badges.enabledText}
      </text>
      <Show when={props.badges.sseDeprecationText}>
        <text fg={theme.warning} wrapMode="none">
          {"  "}{props.badges.sseDeprecationText}
        </text>
      </Show>
      <Show
        when={props.capabilities.capabilityBadgesText.length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no capabilities negotiated
          </text>
        }
      >
        <text fg={theme.textMuted} wrapMode="none">
          {"  "}[{props.capabilities.capabilityBadgesText.join(", ")}]
        </text>
      </Show>
    </box>
  )
}

function ResourceRow(props: { view: ResourceRowView }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.textMuted} wrapMode="none">
      {"  "}{props.view.uriText}
      {props.view.nameText ? ` · ${props.view.nameText}` : ""} · {props.view.subscribableText}
      {props.view.mimeTypeText ? ` · ${props.view.mimeTypeText}` : ""}
    </text>
  )
}

function ExperimentalFlagRow(props: { view: ExperimentalFlagRowView }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.textMuted} wrapMode="none">
      {"  "}{props.view.flagText} · {props.view.enabledText}
    </text>
  )
}

function PageDetail(props: { view: OutputPageView | null }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" paddingLeft={3}>
      <Show
        when={props.view}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            content not loaded — expand to load a bounded page
          </text>
        }
      >
        {(view) => (
          <box flexDirection="column">
            <text fg={theme.text}>{view().text.length > 0 ? view().text : "(empty page)"}</text>
            {view().truncated ? <text fg={theme.textMuted}>… truncated</text> : null}
            <text fg={theme.textMuted} wrapMode="none">
              next offset {view().nextOffsetText} · committed {view().committedBytesText} · {view().caughtUpText} ·{" "}
              {view().eofText}
            </text>
          </box>
        )}
      </Show>
    </box>
  )
}

function CallCard(props: { view: CallCardView; expanded: boolean; onOpen: () => void; page: OutputPageView | null }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box
        flexDirection="row"
        justifyContent="space-between"
        gap={1}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => (props.view.outputRefText ? props.onOpen() : undefined)}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.text}>
          <b>{props.view.toolNameText}</b> ({props.view.kindText})
        </text>
        <text fg={theme.textMuted}>{props.view.statusText}</text>
      </box>
      <text fg={theme.textMuted} wrapMode="none">
        {"  "}server: {props.view.serverIdText} · progress: {props.view.progressText}
        {props.view.totalText ? `/${props.view.totalText}` : ""} · elapsed {props.view.elapsedMsText}
        {props.view.bytesText ? ` · ${props.view.bytesText}` : ""}
      </text>
      <Show when={props.view.messageText}>
        <text fg={theme.textMuted} wrapMode="none">
          {"  "}{props.view.messageText}
        </text>
      </Show>
      <Show when={props.view.untrustedLabelText}>
        <text fg={theme.warning} wrapMode="none">
          {"  "}content provenance: {props.view.untrustedLabelText}
        </text>
      </Show>
      <Show when={props.view.outputRefText}>
        <text fg={theme.textMuted} wrapMode="none">
          {"  "}{props.expanded ? "expanded" : "collapsed"} · expand loads a bounded page via OutputRef
        </text>
        <Show when={props.expanded}>
          <PageDetail view={props.page} />
        </Show>
      </Show>
    </box>
  )
}

export function McpPanel(props: {
  /** Honest-empty-baseline until a live `mcp.*` registry source exists; see ./state.ts. */
  signal?: () => McpPanelSignal
  /** Fired when a call's OutputRef with no cached page is expanded; the caller performs a bounded `output.read` (FR33, FR34, C16, C17). */
  onExpand?: (outputRef: string) => void
  /** Fired when a cached, non-eof page is re-opened; the caller resumes `output.follow(cursor)` (C14, C18). */
  onFollow?: (outputRef: string, cursor: string) => void
}) {
  const { theme } = useTheme()
  const signal = createMemo<McpPanelSignal>(() => props.signal?.() ?? EMPTY_MCP_PANEL_SIGNAL)
  const [expandedRef, setExpandedRef] = createSignal<string | null>(null)

  const servers = createMemo(() => deriveVisibleServerCards(signal()))
  const resources = createMemo(() => deriveVisibleResourceRows(signal()))
  const experimentalFlags = createMemo(() => deriveVisibleExperimentalFlagRows(signal()))
  const calls = createMemo(() => deriveDirectChildCalls(signal()))
  const pageView = createMemo<OutputPageView | null>(() => {
    const ref = expandedRef()
    return ref === null ? null : derivePanelPageView(signal(), ref)
  })

  function open(outputRef: string) {
    const action = resolveMcpExpandAction(signal(), expandedRef(), outputRef)
    switch (action.kind) {
      case "already-expanded":
        setExpandedRef(null)
        return
      case "load":
        setExpandedRef(outputRef)
        props.onExpand?.(outputRef)
        return
      case "resume":
        setExpandedRef(outputRef)
        props.onFollow?.(outputRef, action.cursor)
        return
      case "loaded":
        setExpandedRef(outputRef)
        return
    }
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme.text} paddingLeft={1}>
        <b>servers</b>
      </text>
      <Show
        when={servers().length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no MCP servers configured
          </text>
        }
      >
        <box flexDirection="column" {...SplitBorder} border={["left"]} borderColor={theme.border}>
          <For each={servers()}>
            {(view) => (
              <ServerCard
                view={view}
                badges={deriveServerBadges(signal().servers.find((s) => s.id === view.id)!)}
                capabilities={deriveServerCapabilityBadges(signal(), view.id)}
              />
            )}
          </For>
        </box>
      </Show>

      <text fg={theme.text} paddingLeft={1}>
        <b>resources</b>
      </text>
      <Show
        when={resources().length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no resources
          </text>
        }
      >
        <For each={resources()}>{(view) => <ResourceRow view={view} />}</For>
      </Show>

      <text fg={theme.text} paddingLeft={1}>
        <b>experimental</b>
      </text>
      <Show
        when={experimentalFlags().length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no experimental flags
          </text>
        }
      >
        <For each={experimentalFlags()}>{(view) => <ExperimentalFlagRow view={view} />}</For>
      </Show>

      <text fg={theme.text} paddingLeft={1}>
        <b>calls</b>
      </text>
      <Show
        when={calls().length > 0}
        fallback={
          <text fg={theme.textMuted} wrapMode="none">
            {"  "}no direct-child calls
          </text>
        }
      >
        <box flexDirection="column" {...SplitBorder} border={["left"]} borderColor={theme.border}>
          <For each={calls()}>
            {(view) => (
              <CallCard
                view={view}
                expanded={expandedRef() === view.outputRefText}
                onOpen={() => (view.outputRefText ? open(view.outputRefText) : undefined)}
                page={pageView()}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
