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
import { createMemo, createSignal, onMount, type JSX } from "solid-js"
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
import { projectJobsSignal } from "./jobs/state"
import { projectOutputSignal } from "./output/state"
import { projectLangLockSignal } from "./langlock/state"
import { projectSemanticSignal } from "./semantic/state"
import { projectMcpSignal } from "./mcp/state"

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
          // Push (not replace) so escape unwinds Home ← domain (Feature 012 T013, FR7).
          ctx.push(() => <DialogOperatorDomainPanel domain={group.domain} />)
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
 * The five built read-side panels, keyed by domain (Feature 012 T009, FR5). Each
 * spec pairs the domain's primary read query with a render closure that projects
 * the dispatch's structured `effective` payload through that domain's total
 * projection (T004–T008) and feeds the resulting `*PanelSignal` into the panel's
 * `signal` prop. An absent/unavailable/mismatched effective degrades to the
 * panel's honest `EMPTY_*_SIGNAL` baseline (FR8). `langlock`/`jobs` reads return
 * effective and populate today; `output`/`semantic`/`mcp` stay honest-unavailable
 * until their backends land.
 */
type ReadPanelSpec = {
  readonly read: string
  readonly render: (effective: () => unknown) => JSX.Element
}

const READ_PANEL_BY_DOMAIN: Readonly<Record<string, ReadPanelSpec>> = {
  jobs: { read: "jobs.list", render: (eff) => <JobsPanel signal={() => projectJobsSignal(eff()).signal} /> },
  output: { read: "output.stat", render: (eff) => <OutputPanel signal={() => projectOutputSignal(eff()).signal} /> },
  langlock: { read: "langlock.status", render: (eff) => <LangLockPanel signal={() => projectLangLockSignal(eff()).signal} /> },
  semantic: { read: "semantic.model.list", render: (eff) => <SemanticPanel signal={() => projectSemanticSignal(eff()).signal} /> },
  mcp: { read: "mcp.server.list", render: (eff) => <McpPanel signal={() => projectMcpSignal(eff()).signal} /> },
}

/**
 * Domain panel View surface (Feature 012 T009, FR5, FR8). Issues the domain's
 * primary read query on open through the SAME executeOperatorCommand path as
 * slash/CLI (no new dispatch path, FR9), projects the structured result, and feeds
 * the live `*PanelSignal` into the panel. An unavailable read or absent effective
 * leaves the honest `EMPTY_*_SIGNAL` baseline. A view selection dispatches no
 * mutation. Escape pops this pushed level back to the domain panel (T013).
 */
function DialogOperatorReadPanel(props: { domain: string; label: string }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const toast = useToast()
  const operator = useOperatorSlash()
  const route = useRoute()
  const spec = READ_PANEL_BY_DOMAIN[props.domain]
  const [effective, setEffective] = createSignal<{ readonly value: unknown }>({ value: undefined })

  onMount(() => {
    if (!spec) return
    const entry = listOperatorSettingsEntries(props.domain).find((item) => item.id === spec.read)
    if (!entry) return
    const sessionId = route.data.type === "session" ? route.data.sessionID : undefined
    void executeOperatorCommand({
      entry,
      port: operator.port,
      projectId: project.project(),
      sessionId,
      dialog,
      toast,
      // Auto-issued panel read (Feature 012 P1): no toast on open — the panel's
      // honesty is its empty state, not a toast flash.
      silent: true,
    }).then((result) => setEffective({ value: result.result?.effective }))
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {`Operator · ${props.label} · View`}
      </text>
      {spec ? spec.render(() => effective().value) : <text fg={theme.textMuted}>No read panel for this domain</text>}
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
      // View verb: push the domain read panel (T009/T013) or, for domains without
      // a panel, dispatch the query result toast. Never a mutation.
      if (READ_PANEL_BY_DOMAIN[props.domain]) {
        dialog.push(() => <DialogOperatorReadPanel domain={props.domain} label={panel().label} />)
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
      // Push the form so escape unwinds back to the domain panel; the manual back
      // affordance is retired (Feature 012 T013, FR7).
      dialog.push(
        openOperatorForm({
          entry,
          field,
          port: operator.port,
          projectId: project.project(),
          sessionId: sessionId(),
          dialog,
          toast,
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
