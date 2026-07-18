/**
 * Native Operator Settings panels (T036).
 * Secret mutations: visible warning rows (selectable → T019 toast only, never port).
 * Safe queries like mcp.auth.status remain executable.
 */
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"
import {
  listAllOperatorSettingsDomains,
  listOperatorSettingsEntries,
  type OperatorPaletteEntry,
} from "@opencode-ai/core/operator"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useProject } from "../context/project"
import { useToast } from "../ui/toast"
import { useOperatorSlash } from "../context/operator-slash"
import { useRoute } from "../context/route"
import { executeOperatorCommand } from "./execute"

export function DialogOperatorSettingsHome() {
  const domains = createMemo(() => listAllOperatorSettingsDomains())
  const operator = useOperatorSlash()

  return (
    <DialogSelect
      title="Operator Settings"
      options={domains().map((d) => ({
        title: d.title,
        description: operator.port
          ? `${d.entryCount} commands · registry-driven · worker RPC`
          : `${d.entryCount} commands · operator unavailable`,
        category: "Operator",
        value: d.domain,
        onSelect: (ctx) => {
          ctx.replace(() => <DialogOperatorDomainPanel domain={d.domain} title={d.title} />)
        },
      }))}
      emptyView={<text>Operator settings unavailable</text>}
    />
  )
}

export function DialogOperatorDomainPanel(props: { domain: string; title: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const toast = useToast()
  const operator = useOperatorSlash()
  const route = useRoute()
  const entries = createMemo(() => listOperatorSettingsEntries(props.domain))
  const [busy, setBusy] = createSignal(false)
  const [statusLine, setStatusLine] = createSignal("scope: project · version: — · run a status query")

  const sessionId = createMemo(() =>
    route.data.type === "session" ? route.data.sessionID : undefined,
  )

  async function run(entry: OperatorPaletteEntry) {
    if (busy()) return
    // Secret mutations: visible, selectable only to show warning — never call port
    if (entry.secretRelated) {
      toast.show({
        title: "Secret action unavailable",
        message: `T019 keychain not enabled — ${entry.id} blocked (no plaintext)`,
        variant: "warning",
      })
      return
    }
    if (!operator.port) {
      toast.show({
        title: "Operator unavailable",
        message: "Operator control plane not injected",
        variant: "warning",
      })
      return
    }
    setBusy(true)
    try {
      const result = await executeOperatorCommand({
        entry,
        port: operator.port,
        projectId: project.project(),
        sessionId: sessionId(),
        dialog,
        toast,
      })
      if (
        entry.id.endsWith(".status") ||
        entry.id.endsWith(".show") ||
        entry.operation.includes("status")
      ) {
        setStatusLine(
          `last: ${entry.id} → ${result.outcome ?? "?"} · scope=${project.project() ?? "global"} · session=${sessionId() ?? "—"}`,
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogSelect
      title={`Operator · ${props.title}`}
      titleView={
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            {statusLine()}
          </text>
        </box>
      }
      options={entries().map((entry) => {
        const secret = entry.secretRelated
        const noPort = !operator.port
        // Secret rows stay selectable (not disabled) so DialogSelect keeps them visible
        return {
          title: secret ? `⚠ ${entry.title}` : entry.title,
          description: secret
            ? "Secret mutation blocked (T019) — select for warning only"
            : noPort
              ? "Operator control plane unavailable"
              : entry.description,
          category: secret ? "Secrets (T019 blocked)" : entry.mutates ? "Mutations" : "Queries",
          value: entry.id,
          disabled: noPort && !secret,
          footer: secret
            ? "T019"
            : entry.mutates
              ? entry.confirmRequired
                ? "confirm"
                : "mutate"
              : "query",
          onSelect: () => {
            void run(entry)
          },
        }
      })}
      emptyView={
        <box paddingLeft={2} paddingRight={2}>
          <text fg={theme.textMuted}>No operator commands for this domain</text>
        </box>
      }
      footerHints={[
        { title: "esc", label: "back", side: "right" },
        { title: "enter", label: "run", side: "right" },
      ]}
    />
  )
}

export function openOperatorSettings(dialog: ReturnType<typeof useDialog>) {
  dialog.replace(() => <DialogOperatorSettingsHome />)
}
