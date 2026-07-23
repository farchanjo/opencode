import { createMemo, createResource, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { errorMessage } from "../util/error"

type ChatOutputCfg = {
  max_words?: number
  max_tokens?: number
}

/**
 * Real-time TUI control for `chat_output` (primary-agent console budget).
 * Patches global config so the next LLM turn reloads the cap.
 * Does not limit tool-call / file-write payloads.
 */
export function DialogChatOutput() {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  dialog.setSize("medium")

  const [error, setError] = createSignal<unknown>()
  const [busy, setBusy] = createSignal(false)

  const [cfg, { refetch }] = createResource(async () => {
    const result = await sdk.client.global.config.get({ throwOnError: true }).catch((e) => {
      setError(e)
      return undefined
    })
    return result?.data
  })

  const current = createMemo(() => {
    const raw = (cfg() as { chat_output?: ChatOutputCfg } | undefined)?.chat_output
    const words = raw?.max_words && raw.max_words > 0 ? raw.max_words : undefined
    const tokens = raw?.max_tokens && raw.max_tokens > 0 ? raw.max_tokens : undefined
    return { max_words: words, max_tokens: tokens } satisfies ChatOutputCfg
  })

  const label = createMemo(() => {
    const cur = current()
    if (!cur.max_words && !cur.max_tokens) return "OFF (unlimited console chat)"
    const parts: string[] = []
    if (cur.max_words) parts.push(`${cur.max_words} words`)
    if (cur.max_tokens) parts.push(`${cur.max_tokens} tokens`)
    return parts.join(" · ")
  })

  async function patchChatOutput(next: ChatOutputCfg) {
    setBusy(true)
    setError(undefined)
    try {
      // Use 0 = unlimited so deep-merge can clear a side without wiping the other.
      const chat_output = {
        max_words: next.max_words && next.max_words > 0 ? next.max_words : 0,
        max_tokens: next.max_tokens && next.max_tokens > 0 ? next.max_tokens : 0,
      }
      await sdk.client.global.config.update(
        {
          config: {
            chat_output,
          } as never,
        },
        { throwOnError: true },
      )
      await refetch()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const cur = current()
    const wordChoices = [50, 100, 150, 200, 300, 500, 800, 1200]
    const tokenChoices = [128, 256, 400, 512, 800, 1024, 2048]

    const opts: DialogSelectOption<string>[] = []

    opts.push({
      title: `Current: ${label()}`,
      description: "Main console: model self-sizes reply (no hard filter). Tools/writes exempt.",
      value: "status",
      category: "Status",
      disabled: true,
    })

    opts.push({
      title: `OFF (unlimited)${!cur.max_words && !cur.max_tokens ? "  ✓" : ""}`,
      description: "No console word/token budget",
      value: "off",
      category: "Mode",
      onSelect: () => {
        void patchChatOutput({ max_words: 0, max_tokens: 0 })
      },
    })

    for (const n of wordChoices) {
      opts.push({
        title: `Max words: ${n}${cur.max_words === n ? "  ✓" : ""}`,
        description: cur.max_words === n ? "Active" : `Ask model to fit console chat in ${n} words`,
        value: `words:${n}`,
        category: "Words",
        onSelect: () => {
          void patchChatOutput({ max_words: n, max_tokens: cur.max_tokens ?? 0 })
        },
      })
    }

    opts.push({
      title: `Clear word limit${!cur.max_words ? "  ✓" : ""}`,
      description: "Keep token limit if set; remove word cap",
      value: "words:clear",
      category: "Words",
      onSelect: () => {
        void patchChatOutput({ max_words: 0, max_tokens: cur.max_tokens ?? 0 })
      },
    })

    for (const n of tokenChoices) {
      opts.push({
        title: `Max tokens: ${n}${cur.max_tokens === n ? "  ✓" : ""}`,
        description: cur.max_tokens === n ? "Active" : `Ask model to fit console chat in ~${n} tokens`,
        value: `tokens:${n}`,
        category: "Tokens",
        onSelect: () => {
          void patchChatOutput({ max_words: cur.max_words ?? 0, max_tokens: n })
        },
      })
    }

    opts.push({
      title: `Clear token limit${!cur.max_tokens ? "  ✓" : ""}`,
      description: "Keep word limit if set; remove token cap",
      value: "tokens:clear",
      category: "Tokens",
      onSelect: () => {
        void patchChatOutput({ max_words: cur.max_words ?? 0, max_tokens: 0 })
      },
    })

    opts.push({
      title: "Done",
      description: busy() ? "Saving…" : "Close (applies on next model turn)",
      value: "done",
      category: "Close",
      onSelect: () => dialog.clear(),
    })

    return opts
  })

  return (
    <DialogSelect
      title="Chat output budget"
      placeholder="Set words / tokens…"
      options={options()}
      emptyView={
        error() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Config error
            </text>
            <text fg={theme.textMuted}>{errorMessage(error())}</text>
          </box>
        ) : undefined
      }
    />
  )
}
