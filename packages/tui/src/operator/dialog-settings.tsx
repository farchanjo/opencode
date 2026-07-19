/**
 * Grouped Operator navigation (Feature 011 T007–T009).
 * Home lists all 12 reserved domains with an availability badge (FR2); a domain
 * panel splits its verbs into a View section (read-only) and a Configure section
 * (mutations) with confirm/secret/unavailable markers (FR3, FR4). Every leaf
 * dispatches the SAME canonical command id through the SAME executeOperatorCommand
 * path as slash/CLI — no new dispatch path (FR8). Copy is centralised in
 * palette.ts; this file only renders the projection.
 */
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, type Component } from "solid-js"
import {
  buildOperatorGroupList,
  buildOperatorDomainPanel,
  listOperatorSettingsEntries,
  OPERATOR_TOP_TITLE,
  OPERATOR_TOP_SUBTITLE,
  type OperatorPaletteEntry,
  type OperatorVerbItem,
} from "@opencode-ai/core/operator"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useProject } from "../context/project"
import { useToast } from "../ui/toast"
import { useOperatorSlash } from "../context/operator-slash"
import { useRoute } from "../context/route"
import { executeOperatorCommand } from "./execute"
import { openOperatorForm, resolveOperatorFormField } from "./form"
import { JobsPanel } from "./jobs"
import { OutputPanel } from "./output"
import { LangLockPanel } from "./langlock"
import { SemanticPanel } from "./semantic"
import { McpPanel } from "./mcp"

export function DialogOperatorSettingsHome() {
  const { theme } = useTheme()
  const groups = createMemo(() => buildOperatorGroupList())

  return (
    <DialogSelect
      title={OPERATOR_TOP_TITLE}
      titleView={
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            {OPERATOR_TOP_SUBTITLE}
          </text>
        </box>
      }
      options={groups().map((group) => ({
        title: group.label,
        description: group.subtitle,
        category: "Operator",
        value: group.domain,
        onSelect: (ctx) => {
          ctx.replace(() => <DialogOperatorDomainPanel domain={group.domain} />)
        },
      }))}
      emptyView={<text>Operator settings unavailable</text>}
    />
  )
}

/** Short row footer marker derived from the verb's availability/section (FR3). */
function verbFooter(item: OperatorVerbItem): string {
  if (item.availability === "unavailable") return "unavailable"
  if (item.secretRelated) return "secret"
  if (item.section === "view") return "view"
  return item.confirmRequired ? "confirm" : "configure"
}

/**
 * The five built read-side panels, keyed by domain (T013, FR6). A View verb in a
 * panel-bearing domain opens the panel fed by the operator result signal; every
 * other domain's View verb dispatches its query result toast.
 */
const PANEL_BY_DOMAIN: Readonly<Record<string, Component>> = {
  jobs: JobsPanel,
  output: OutputPanel,
  langlock: LangLockPanel,
  semantic: SemanticPanel,
  mcp: McpPanel,
}

/**
 * Domain panel View surface (T013, FR6). Renders the domain's read panel fed by
 * the operator result signal where available; today no structured signal is
 * reachable through `OperatorSlashPort` (it returns only display strings), so the
 * panel renders its honest `EMPTY_*_SIGNAL` baseline — a real empty state, not a
 * stub — per each panel's header contract. A view selection dispatches no
 * mutation.
 */
function DialogOperatorReadPanel(props: { domain: string; label: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const Panel = PANEL_BY_DOMAIN[props.domain]
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {`Operator · ${props.label} · View`}
        </text>
        <text
          fg={theme.textMuted}
          onMouseUp={() => dialog.replace(() => <DialogOperatorDomainPanel domain={props.domain} />)}
        >
          back
        </text>
      </box>
      {Panel ? <Panel /> : <text fg={theme.textMuted}>No read panel for this domain</text>}
    </box>
  )
}

export function DialogOperatorDomainPanel(props: { domain: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const toast = useToast()
  const operator = useOperatorSlash()
  const route = useRoute()
  const panel = createMemo(() => buildOperatorDomainPanel(props.domain))
  const entriesById = createMemo(
    () => new Map(listOperatorSettingsEntries(props.domain).map((entry) => [entry.id, entry])),
  )
  const rows = createMemo(() => [...panel().view, ...panel().configure])
  const [busy, setBusy] = createSignal(false)

  const sessionId = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  async function run(entry: OperatorPaletteEntry) {
    if (busy()) return
    setBusy(true)
    try {
      await executeOperatorCommand({
        entry,
        port: operator.port,
        projectId: project.project(),
        sessionId: sessionId(),
        dialog,
        toast,
      })
    } finally {
      setBusy(false)
    }
  }

  function onSelectVerb(item: OperatorVerbItem) {
    const entry = entriesById().get(item.id)
    if (!entry) return
    if (item.section === "view") {
      // View verb: open the domain read panel (T013) or, for domains without a
      // panel, dispatch the query result toast. Never a mutation.
      if (PANEL_BY_DOMAIN[props.domain]) {
        dialog.replace(() => <DialogOperatorReadPanel domain={props.domain} label={panel().label} />)
        return
      }
      void run(entry)
      return
    }
    // Configure verb: open the typed form when it collects a payload (T011);
    // otherwise dispatch directly (T012). executeOperatorCommand gates
    // confirm-required verbs via DialogConfirm and surfaces the honest
    // unavailable envelope for not-yet-implemented backends (FR7) — the UI never
    // synthesizes success.
    const field = resolveOperatorFormField(entry)
    if (field) {
      dialog.replace(
        openOperatorForm({
          entry,
          field,
          port: operator.port,
          projectId: project.project(),
          sessionId: sessionId(),
          dialog,
          toast,
          back: () => dialog.replace(() => <DialogOperatorDomainPanel domain={props.domain} />),
        }),
      )
      return
    }
    void run(entry)
  }

  return (
    <DialogSelect
      title={`Operator · ${panel().label}`}
      options={rows().map((item) => {
        const entry = entriesById().get(item.id)
        return {
          title: entry?.title ?? item.label,
          description: item.subtitle,
          category: item.section === "view" ? "View" : "Configure",
          value: item.id,
          footer: verbFooter(item),
          onSelect: () => onSelectVerb(item),
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
