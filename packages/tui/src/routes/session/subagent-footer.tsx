import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "../../util/locale"
import { useTerminalDimensions } from "@opentui/solid"
import { useCommandShortcut, useOpencodeKeymap } from "../../keymap"
import { deriveAssistantTokenUsage, tokensPerSecondFrom } from "./subagent-usage"

export function SubagentFooter() {
  const route = useRouteData("session")
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const session = createMemo(() => sync.session.get(route.sessionID))

  const subagentInfo = createMemo(() => {
    const s = session()
    if (!s) return { label: "Subagent", index: 0, total: 0 }
    const agentMatch = s.title.match(/@(\w+) subagent/)
    const last = messages().findLast((item): item is AssistantMessage => item.role === "assistant")
    const fromAgent = last?.agent ? Locale.titlecase(last.agent) : undefined
    const label = agentMatch ? Locale.titlecase(agentMatch[1]) : (fromAgent ?? "Subagent")

    if (!s.parentID) return { label, index: 0, total: 0 }

    const siblings = sync.data.session
      .filter((x) => x.parentID === s.parentID)
      .toSorted((a, b) => a.time.created - b.time.created)
    const index = siblings.findIndex((x) => x.id === s.id)

    return { label, index: index + 1, total: siblings.length }
  })

  const isRunning = createMemo(() => {
    const status = sync.data.session_status[route.sessionID]
    return status !== undefined && status.type !== "idle"
  })

  // Live wall-clock so out tok/s updates while the child session is active.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!isRunning()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    onCleanup(() => clearInterval(timer))
  })

  const usage = createMemo(() => {
    const msg = messages()
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant")
    if (!last) return

    const derived = deriveAssistantTokenUsage(msg)
    // Context window fill: last turn's full token footprint (includes cache).
    const contextTokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (contextTokens <= 0 && !derived.output && !last.providerID) return

    const modelInfo = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = modelInfo?.limit.context ? `${Math.round((contextTokens / modelInfo.limit.context) * 100)}%` : undefined
    const cost = session()?.cost ?? 0

    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    })

    const firstUser = msg.find((item) => item.role === "user")?.time.created
    const end = last.time.completed ?? (isRunning() ? now() : last.time.created)
    const elapsedMs = firstUser ? Math.max(0, end - firstUser) : 0
    const generated = (derived.output ?? 0) + (derived.reasoning ?? 0)
    const rate = tokensPerSecondFrom(generated, elapsedMs)

    const effort =
      last.variant && last.variant !== "default" ? last.variant : undefined
    const modelLabel =
      last.providerID && last.modelID
        ? effort
          ? `${last.providerID}/${last.modelID} (${effort})`
          : `${last.providerID}/${last.modelID}`
        : undefined

    return {
      model: modelLabel,
      context:
        contextTokens > 0
          ? pct
            ? `${Locale.number(contextTokens)} (${pct})`
            : Locale.number(contextTokens)
          : undefined,
      rate: rate !== undefined ? `${rate.toFixed(1)} out tok/s` : undefined,
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  const { theme } = useTheme()
  const keymap = useOpencodeKeymap()
  const parentShortcut = useCommandShortcut("session.parent")
  const previousShortcut = useCommandShortcut("session.child.previous")
  const nextShortcut = useCommandShortcut("session.child.next")
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  useTerminalDimensions()

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>
              <b>{subagentInfo().label}</b>
            </text>
            <Show when={subagentInfo().total > 0}>
              <text style={{ fg: theme.textMuted }}>
                ({subagentInfo().index} of {subagentInfo().total})
              </text>
            </Show>
            <Show when={usage()}>
              {(item) => (
                <text fg={theme.textMuted} wrapMode="none">
                  {[item().model, item().context, item().rate, item().cost].filter(Boolean).join(" · ")}
                </text>
              )}
            </Show>
          </box>
          <box flexDirection="row" gap={2}>
            <box
              onMouseOver={() => setHover("parent")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.parent")}
              backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
            >
              <text fg={theme.text}>
                Parent <span style={{ fg: theme.textMuted }}>{parentShortcut()}</span>
              </text>
            </box>
            <box
              onMouseOver={() => setHover("prev")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.child.previous")}
              backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
            >
              <text fg={theme.text}>
                Prev <span style={{ fg: theme.textMuted }}>{previousShortcut()}</span>
              </text>
            </box>
            <box
              onMouseOver={() => setHover("next")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.child.next")}
              backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
            >
              <text fg={theme.text}>
                Next <span style={{ fg: theme.textMuted }}>{nextShortcut()}</span>
              </text>
            </box>
          </box>
        </box>
      </box>
    </box>
  )
}
