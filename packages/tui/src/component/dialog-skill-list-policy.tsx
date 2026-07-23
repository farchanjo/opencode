import { createMemo, createResource, createSignal } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import { errorMessage } from "../util/error"

type Format = "names" | "compact" | "verbose"

type SkillListCfg = {
  max_listed?: number
  format?: Format
  hard_cap?: boolean
  show_status?: boolean
}

/**
 * Dynamic TUI control for Feature 058 experimental.skill_list.
 * Patches global config (OPENCODE_CONFIG_DIR) so the next turn reloads the cap.
 */
export function DialogSkillListPolicy() {
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
    const exp = (cfg() as { experimental?: { skill_list?: SkillListCfg } } | undefined)?.experimental
    const sl = exp?.skill_list ?? {}
    return {
      max_listed: sl.max_listed ?? 24,
      format: (sl.format ?? "compact") as Format,
      hard_cap: sl.hard_cap ?? true,
      show_status: sl.show_status ?? true,
    }
  })

  async function patchSkillList(next: SkillListCfg) {
    setBusy(true)
    setError(undefined)
    try {
      // skill_list is Feature 058; SDK types lag until regenerate — structural patch.
      await sdk.client.global.config.update(
        {
          config: {
            experimental: {
              skill_list: next,
            } as Record<string, unknown>,
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
    const maxChoices = [8, 16, 24, 32, 48, 64]
    const formatChoices: Format[] = ["names", "compact", "verbose"]

    const opts: DialogSelectOption<string>[] = []

    opts.push({
      title: `Current: max=${cur.max_listed} format=${cur.format} hard_cap=${cur.hard_cap}`,
      description: "Tier-1 available_skills listing policy (Feature 058)",
      value: "status",
      category: "Status",
      disabled: true,
    })

    for (const n of maxChoices) {
      opts.push({
        title: `Max listed: ${n}${n === cur.max_listed ? "  ✓" : ""}`,
        description: n === cur.max_listed ? "Active" : `Cap catalog listing at ${n} skills per turn`,
        value: `max:${n}`,
        category: "Max listed",
        onSelect: () => {
          void patchSkillList({ ...cur, max_listed: n })
        },
      })
    }

    for (const f of formatChoices) {
      opts.push({
        title: `Format: ${f}${f === cur.format ? "  ✓" : ""}`,
        description:
          f === "names"
            ? "Names only (smallest)"
            : f === "compact"
              ? "Name + short description (recommended)"
              : "Full description + location (legacy, large)",
        value: `fmt:${f}`,
        category: "Format",
        onSelect: () => {
          void patchSkillList({ ...cur, format: f })
        },
      })
    }

    opts.push({
      title: `Hard cap: ${cur.hard_cap ? "ON" : "OFF"}`,
      description: "When ON, cap applies even if semantic ranking is passthrough (full catalog)",
      value: "hard",
      category: "Options",
      onSelect: () => {
        void patchSkillList({ ...cur, hard_cap: !cur.hard_cap })
      },
    })

    opts.push({
      title: `Show status line: ${cur.show_status ? "ON" : "OFF"}`,
      description: "Inject [skill_list: mode=… capped …] into system prompt",
      value: "statusline",
      category: "Options",
      onSelect: () => {
        void patchSkillList({ ...cur, show_status: !cur.show_status })
      },
    })

    opts.push({
      title: "Done",
      description: busy() ? "Saving…" : "Close (changes apply on next turn)",
      value: "done",
      category: "Close",
      onSelect: () => dialog.clear(),
    })

    return opts
  })

  return (
    <DialogSelect
      title="Skill list policy"
      placeholder="Adjust max / format…"
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
