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
import { createEffect, createMemo, createSignal, For, on, onMount, Show, type JSX } from "solid-js"
import {
  buildOperatorGroupList,
  buildOperatorDomainPanel,
  buildOperatorScreenControls,
  listOperatorSettingsEntries,
  OPERATOR_TOP_TITLE,
  OPERATOR_TOP_SUBTITLE,
  type OperatorPaletteEntry,
  type OperatorVerbItem,
  type OperatorToggleControl,
  type OperatorTriStateControl,
} from "@opencode-ai/core/operator"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useProject } from "../context/project"
import { useToast } from "../ui/toast"
import { useOperatorSlash } from "../context/operator-slash"
import { useRoute } from "../context/route"
import { executeOperatorCommand } from "./execute"
import { plainStatusReadId, toStatusNodes } from "./status"
import {
  toggleBadge,
  toggleStateFrom,
  toggleTargetId,
  triStateBadge,
  triStateModeFrom,
  triStateOptionLabel,
  type ToggleState,
  type TriStateMode,
} from "./controls"
import { openOperatorForm, resolveOperatorFormField } from "./form"
import { openOperatorEditModal } from "./form/edit-modal"
import { openOperatorViewModal } from "./form/view-modal"
import { entityConsumedConfigureIds, listOperatorEntityKinds, resolveOperatorEntityScreen, type OperatorEntityKind } from "./entity"
import { openOperatorEntityList } from "./entity-screens"
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

/** Outcomes that committed a mutation — the only ones that trigger a status refetch (FR6). */
const SUCCESS_OUTCOMES = new Set(["success", "idempotent_replay"])

/** Result of a silent status/detail read: the effective payload plus its load/availability state. */
type StatusRead = { readonly value: unknown; readonly loaded: boolean; readonly available: boolean }

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
 * Generic key/value renderer for a plain domain's inline status (Feature 015 T004,
 * FR4). Projects the effective payload through the total `toStatusNodes` projection
 * and renders bounded rows; a still-loading, unavailable, or empty read degrades to
 * honest text, never a fabricated value or a toast.
 */
function StatusKeyValue(props: { status: () => StatusRead }) {
  const { theme } = useTheme()
  const nodes = createMemo(() => toStatusNodes(props.status().value))
  return (
    <Show when={props.status().loaded} fallback={<text fg={theme.textMuted}>Loading status…</text>}>
      <Show when={props.status().available} fallback={<text fg={theme.textMuted}>Status unavailable</text>}>
        <Show when={nodes().length > 0} fallback={<text fg={theme.textMuted}>No status reported</text>}>
          <box flexDirection="column">
            <For each={nodes()}>
              {(node) => (
                <text fg={theme.textMuted} wrapMode="none">
                  {node.key}: <span style={{ fg: theme.text }}>{node.value}</span>
                </text>
              )}
            </For>
          </box>
        </Show>
      </Show>
    </Show>
  )
}

/**
 * Inline StatusSection rendered at the top of every domain screen (Feature 015
 * T004/T005, FR4, FR5, FR18). A pure renderer over the panel-owned status signal
 * (fetched silently on open and refetched after every on-screen mutation, FR6): it
 * renders the rich panel for `jobs`/`output`/`langlock`/`semantic`/`mcp` or the
 * generic key/value projection for the plain domains. A failed read degrades
 * honestly to inline text, never a toast.
 */
function OperatorStatusSection(props: { rich: ReadPanelSpec | undefined; status: () => StatusRead }) {
  const { theme } = useTheme()
  return (
    <box paddingLeft={4} paddingRight={4} flexShrink={0}>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
        Status
      </text>
      {props.rich ? props.rich.render(() => props.status().value) : <StatusKeyValue status={props.status} />}
    </box>
  )
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
  const controls = createMemo(() => buildOperatorScreenControls(props.domain))
  const entityKinds = createMemo(() => listOperatorEntityKinds(props.domain))
  const entriesById = createMemo(
    () => new Map(listOperatorSettingsEntries(props.domain).map((entry) => [entry.id, entry])),
  )
  // Configure verbs absorbed by a control OR owned by an entity screen are dropped
  // from the plain settings list so a verb never renders twice (FR7, FR8, FR12).
  const consumedIds = createMemo(() => {
    const set = new Set(controls().consumedIds)
    for (const id of entityConsumedConfigureIds(props.domain)) set.add(id)
    return set
  })
  const settings = createMemo(() => panel().configure.filter((item) => !consumedIds().has(item.id)))
  const [busy, setBusy] = createSignal(false)
  // Bumped after every committed on-screen mutation to refetch the StatusSection + controls (FR6).
  const [statusVersion, setStatusVersion] = createSignal(0)
  const rich = READ_PANEL_BY_DOMAIN[props.domain]
  const [status, setStatus] = createSignal<StatusRead>({ value: undefined, loaded: false, available: true })

  const sessionId = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  /** Silent domain status read backing both the inline section and the control badges (FR4, FR7, FR8). */
  async function loadStatus() {
    const readId = rich ? rich.read : plainStatusReadId(props.domain)
    const entry = entriesById().get(readId)
    if (!entry) {
      setStatus({ value: undefined, loaded: true, available: false })
      return
    }
    const result = await executeOperatorCommand({
      entry,
      port: operator.port,
      projectId: project.project(),
      sessionId: sessionId(),
      dialog,
      toast,
      // Silent status read (FR4/FR18): honesty is the inline empty/unavailable text, never a toast.
      silent: true,
    })
    setStatus({ value: result.result?.effective, loaded: true, available: result.outcome !== "unavailable" })
  }

  onMount(() => void loadStatus())
  // Refetch after every committed on-screen mutation (FR6); initial load is onMount, so defer.
  createEffect(on(statusVersion, () => void loadStatus(), { defer: true }))

  async function run(entry: OperatorPaletteEntry) {
    if (busy()) return
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
      // Refetch status only on a committed mutation; a version_conflict/typed gap
      // keeps the prior state (no refetch) and surfaces the typed reason (FR6, FR15).
      if (result.outcome && SUCCESS_OUTCOMES.has(result.outcome)) setStatusVersion((v) => v + 1)
    } finally {
      setBusy(false)
    }
  }

  /** Toggle row action: dispatch the OPPOSITE verb of the current state (FR7); an unavailable control still rides the same loopback and surfaces the typed envelope (FR15). */
  function onToggle(control: OperatorToggleControl, state: ToggleState) {
    const entry = entriesById().get(toggleTargetId(control, state))
    if (entry) void run(entry)
  }

  /** Tri-state row action: open a three-option picker pre-selected to the current mode; the selection dispatches that mode's verb (FR8). */
  function openTriStatePicker(control: OperatorTriStateControl, mode: TriStateMode) {
    dialog.push(() => (
      <DialogSelect
        title={`Operator · ${panel().label} · ${control.label}`}
        current={mode === "unknown" ? undefined : mode}
        options={control.modes.map((option) => ({
          title: triStateOptionLabel(option.state),
          category: control.label,
          value: option.state,
          onSelect: () => {
            const entry = entriesById().get(option.id)
            if (entry) void run(entry).then(() => dialog.pop())
          },
        }))}
        footerHints={[
          { title: "esc", label: "back", side: "right" },
          { title: "enter", label: "set", side: "right" },
        ]}
      />
    ))
  }

  /** A detail (View) verb renders inside the interface (FR5): rich domains push the read panel, plain domains open the structural view modal (FR11) — never a toast. */
  function onSelectView(entry: OperatorPaletteEntry) {
    if (rich) {
      dialog.push(() => <DialogOperatorReadPanel domain={props.domain} label={panel().label} />)
      return
    }
    dialog.push(openOperatorViewModal({ entry, label: panel().label }))
  }

  /** A settings (Configure) verb opens its edit modal / entity form, or dispatches directly when it collects no payload (FR9, FR12). */
  function onSelectSetting(entry: OperatorPaletteEntry) {
    const field = resolveOperatorFormField(entry)
    if (!field) {
      void run(entry)
      return
    }
    const context = {
      entry,
      field,
      port: operator.port,
      projectId: project.project(),
      sessionId: sessionId(),
      dialog,
      toast,
    }
    // An editable setting (text input, or a static value picker like langlock.set)
    // opens the pre-filled edit modal (FR9/FR10/FR12). A dynamic entity picker
    // (jobs/process/task) keeps the existing Configure form until the collection
    // CRUD screens land (T014–T016).
    if (field.mode === "text_input" || !field.source) {
      dialog.push(openOperatorEditModal(context))
      return
    }
    dialog.push(openOperatorForm(context))
  }

  function toggleOption(control: OperatorToggleControl): DialogSelectOption<string> {
    const state = toggleStateFrom(control, status().value)
    return {
      title: control.label,
      description: `${control.enableId} · ${control.disableId}`,
      category: "Controls",
      value: `toggle:${control.base}`,
      footer: toggleBadge(state),
      onSelect: () => onToggle(control, state),
    }
  }

  function triStateOption(control: OperatorTriStateControl): DialogSelectOption<string> {
    const mode = triStateModeFrom(control, status().value)
    return {
      title: control.label,
      description: control.modes.map((option) => option.id).join(" · "),
      category: "Controls",
      value: `tristate:${control.base}`,
      footer: triStateBadge(mode),
      onSelect: () => openTriStatePicker(control, mode),
    }
  }

  /** A collection domain's entity list entry: opens the list → item CRUD screen (FR12-FR14). */
  function entityKindOption(kind: OperatorEntityKind): DialogSelectOption<string> {
    const screen = resolveOperatorEntityScreen(kind)
    return {
      title: `Manage ${screen.title}`,
      description: `${screen.title} list → item CRUD · ${screen.listRead}`,
      category: "Entities",
      value: `entity:${kind}`,
      footer: "manage",
      onSelect: () => dialog.push(openOperatorEntityList({ kind })),
    }
  }

  function verbOption(item: OperatorVerbItem): DialogSelectOption<string> {
    const entry = entriesById().get(item.id)
    return {
      // Domain screen = domain-implicit surface: the row title is the action-only
      // verb label ("Status", "Endpoint"), never the domain-qualified entry.title
      // ("Telemetry status") which is reserved for domain-explicit surfaces (FR3).
      title: item.label,
      description: item.subtitle,
      category: item.section === "view" ? "View" : "Settings",
      value: item.id,
      footer: verbFooter(item),
      onSelect: () => {
        if (!entry) return
        if (item.section === "view") onSelectView(entry)
        else onSelectSetting(entry)
      },
    }
  }

  // Controls (toggles + tri-state) first, then plain settings, then the read-only
  // views. Depends on `status()` so every badge is live after a refetch (FR6).
  const options = createMemo<DialogSelectOption<string>[]>(() => [
    ...controls().toggles.map(toggleOption),
    ...controls().tristates.map(triStateOption),
    ...entityKinds().map(entityKindOption),
    ...settings().map(verbOption),
    ...panel().view.map(verbOption),
  ])

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      {/* Inline status section on top of every domain screen (FR4, FR5). */}
      <OperatorStatusSection rich={rich} status={status} />
      <DialogSelect
        title={`Operator · ${panel().label}`}
        options={options()}
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
    </box>
  )
}

export function openOperatorSettings(dialog: ReturnType<typeof useDialog>) {
  dialog.replace(() => <DialogOperatorSettingsHome />)
}
