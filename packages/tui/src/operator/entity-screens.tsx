/**
 * Entity CRUD screens for the Feature 015 collection domains (FR12, FR13, FR14).
 * A collection domain (jobs, semantic providers/models, mcp servers) renders a
 * **list** screen — a silent list read projected into bounded rows plus a create
 * action — and each row drills into an **item** screen offering the per-entity
 * actions (edit/reschedule via the pre-filled edit modal, an enable/disable or
 * connect/disconnect toggle, delete behind the DialogConfirm gate, and the marked
 * typed gaps). Every leaf dispatches the SAME canonical command id through the SAME
 * executeOperatorCommand loopback as slash/CLI (no new dispatch path, FR17); an
 * unavailable action rides the same loopback and surfaces the typed envelope, never
 * a fabricated success (FR15). Built over the existing Dialog push/back-stack — NO
 * new dialog primitive (FR16).
 */
import { createEffect, createMemo, createSignal, on, onMount, type JSX } from "solid-js"
import { listOperatorPaletteEntries, type OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useProject } from "../context/project"
import { useToast } from "../ui/toast"
import { useOperatorSlash } from "../context/operator-slash"
import { useRoute } from "../context/route"
import { executeOperatorCommand } from "./execute"
import { resolveOperatorFormField } from "./form"
import { openOperatorEditModal } from "./form/edit-modal"
import { resolveOperatorFieldList } from "./form/field-list"
import { openMultiFieldModal } from "./form/multi-field-modal"
import {
  buildOperatorEntityActions,
  entityCreateAvailability,
  projectEntityRows,
  resolveOperatorEntityScreen,
  type OperatorEntityAction,
  type OperatorEntityKind,
  type OperatorEntityRow,
} from "./entity"

/** Outcomes that committed a mutation — the only ones that refetch a list (FR6). */
const SUCCESS_OUTCOMES = new Set(["success", "idempotent_replay"])

const ENTRY_BY_ID = new Map(listOperatorPaletteEntries().map((entry) => [entry.id, entry]))

/** Short footer marker for an entity action derived from its availability (FR15). */
function actionFooter(action: OperatorEntityAction): string {
  if (action.availability === "unavailable") return "unavailable"
  if (action.availability === "confirm_required") return "confirm"
  return action.interaction === "toggle" ? "toggle" : "run"
}

/** The shared runtime context every entity dispatch rides (the SAME loopback as slash/CLI, FR17). */
function useEntityDispatch() {
  const dialog = useDialog()
  const project = useProject()
  const toast = useToast()
  const operator = useOperatorSlash()
  const route = useRoute()
  const sessionId = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  const context = (entry: OperatorPaletteEntry) => ({
    entry,
    port: operator.port,
    projectId: project.project(),
    sessionId: sessionId(),
    dialog,
    toast,
  })
  async function dispatch(id: string, payload?: Record<string, unknown>): Promise<boolean> {
    const entry = ENTRY_BY_ID.get(id)
    if (!entry) return false
    const result = await executeOperatorCommand({ ...context(entry), ...(payload ? { payload } : {}) })
    return result.outcome !== undefined && SUCCESS_OUTCOMES.has(result.outcome)
  }
  return { dialog, dispatch, context }
}

/** One collection domain's entity list: silent list read → bounded rows + a create action (FR12-FR14). */
export function DialogOperatorEntityList(props: { kind: OperatorEntityKind }): JSX.Element {
  const { theme } = useTheme()
  const screen = resolveOperatorEntityScreen(props.kind)
  const { dialog, dispatch, context } = useEntityDispatch()
  const operator = useOperatorSlash()
  const project = useProject()
  const toast = useToast()
  const route = useRoute()
  const [rows, setRows] = createSignal<readonly OperatorEntityRow[]>([])
  const [refreshKey, setRefreshKey] = createSignal(0)
  const bump = () => setRefreshKey((v) => v + 1)
  const sessionId = () => (route.data.type === "session" ? route.data.sessionID : undefined)

  async function load() {
    const entry = ENTRY_BY_ID.get(screen.listRead)
    if (!entry) {
      setRows([])
      return
    }
    const result = await executeOperatorCommand({
      entry,
      port: operator.port,
      projectId: project.project(),
      sessionId: sessionId(),
      dialog,
      toast,
      // Silent list read (FR18): the list's honesty is its empty state, never a toast on open.
      silent: true,
    })
    setRows(projectEntityRows(props.kind, result.result?.effective))
  }

  onMount(() => void load())
  createEffect(on(refreshKey, () => void load(), { defer: true }))

  /** The create/add action: open the pre-filled modal when it collects a payload, else dispatch directly (FR12). */
  function onCreate() {
    const entry = screen.createId ? ENTRY_BY_ID.get(screen.createId) : undefined
    if (!entry) return
    const descriptor = resolveOperatorFieldList(entry.id)
    if (descriptor) {
      dialog.push(openMultiFieldModal({ ...context(entry), descriptor, onSaved: bump }))
      return
    }
    const field = resolveOperatorFormField(entry)
    if (field) dialog.push(openOperatorEditModal({ ...context(entry), field, onSaved: bump }))
    else void dispatch(entry.id).then((ok) => ok && bump())
  }

  function createOption(): DialogSelectOption<string> | undefined {
    if (!screen.createId) return undefined
    return {
      title: `Add ${screen.kind.replace("_", " ")}`,
      description: screen.createId,
      category: "Create",
      value: `create:${screen.kind}`,
      footer: entityCreateAvailability(props.kind) === "unavailable" ? "unavailable" : "new",
      onSelect: onCreate,
    }
  }

  function rowOption(row: OperatorEntityRow): DialogSelectOption<string> {
    return {
      title: row.label,
      description: row.entityId,
      category: screen.title,
      value: `entity:${row.entityId}`,
      footer: row.badge,
      onSelect: () => dialog.push(() => <DialogOperatorEntityItem kind={props.kind} row={row} onMutated={bump} />),
    }
  }

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const create = createOption()
    return [...(create ? [create] : []), ...rows().map(rowOption)]
  })

  return (
    <DialogSelect
      title={`Operator · ${screen.title}`}
      options={options()}
      emptyView={
        <box paddingLeft={2} paddingRight={2}>
          <text fg={theme.textMuted}>No {screen.title.toLowerCase()} to manage</text>
        </box>
      }
      footerHints={[
        { title: "esc", label: "back", side: "right" },
        { title: "enter", label: "open", side: "right" },
      ]}
    />
  )
}

/** One entity item: the per-entity actions (toggle / edit modal / confirm-delete / marked typed gap) (FR12-FR15). */
export function DialogOperatorEntityItem(props: {
  kind: OperatorEntityKind
  row: OperatorEntityRow
  onMutated: () => void
}): JSX.Element {
  const screen = resolveOperatorEntityScreen(props.kind)
  const { dialog, dispatch, context } = useEntityDispatch()
  const actions = createMemo(() => buildOperatorEntityActions(props.kind, props.row))
  const payload = () => ({ [screen.idKey]: props.row.entityId })

  /** Dispatch and, on a committed outcome, refetch the list and unwind back to it (FR6). */
  async function run(id: string) {
    if (await dispatch(id, payload())) {
      props.onMutated()
      dialog.pop()
    }
  }

  /** Delete behind the DialogConfirm gate (FR12); the confirm primitive closes the operator stack on resolve. */
  async function confirmDelete(action: OperatorEntityAction) {
    const ok = await DialogConfirm.show(dialog, `Delete ${props.row.label}?`, `${action.id} · ${props.row.entityId}`)
    if (ok === true) await dispatch(action.id, payload())
  }

  /** Edit/reschedule/rotate through the pre-filled edit modal, seeding the entity id (FR9, FR12). */
  function openEdit(action: OperatorEntityAction) {
    const entry = ENTRY_BY_ID.get(action.id)
    if (!entry) return
    const descriptor = resolveOperatorFieldList(entry.id)
    if (descriptor) {
      dialog.push(openMultiFieldModal({ ...context(entry), descriptor, basePayload: payload(), onSaved: props.onMutated }))
      return
    }
    const field = resolveOperatorFormField(entry)
    if (!field) {
      void run(action.id)
      return
    }
    dialog.push(openOperatorEditModal({ ...context(entry), field, basePayload: payload(), onSaved: props.onMutated }))
  }

  function invoke(action: OperatorEntityAction) {
    if (action.interaction === "confirm") {
      void confirmDelete(action)
    } else if (action.interaction === "modal") {
      openEdit(action)
    } else {
      void run(action.id)
    }
  }

  function actionOption(action: OperatorEntityAction): DialogSelectOption<string> {
    return {
      title: action.label,
      description: action.id,
      category: "Actions",
      value: `action:${action.verb}`,
      footer: actionFooter(action),
      onSelect: () => invoke(action),
    }
  }

  return (
    <DialogSelect
      title={`Operator · ${screen.title} · ${props.row.label}`}
      options={actions().map(actionOption)}
      footerHints={[
        { title: "esc", label: "back", side: "right" },
        { title: "enter", label: "run", side: "right" },
      ]}
    />
  )
}

/** Factory for `dialog.push` that mounts a collection domain's entity list (FR12-FR14). */
export function openOperatorEntityList(props: { kind: OperatorEntityKind }): () => JSX.Element {
  return () => <DialogOperatorEntityList kind={props.kind} />
}
