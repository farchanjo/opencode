/**
 * Structural view modal (Feature 015 T013, FR11, FR16, FR18). A detail /
 * visualization verb (show / explain / capabilities / history / a plain domain's
 * status) opens this read-only modal, which silently reads the verb through the
 * SAME executeOperatorCommand loopback (no new dispatch path, FR17) and renders its
 * effective payload as a structural key/value tree. It is built over the existing
 * Dialog push/back-stack — NOT a new dialog primitive — so Esc pops it back to the
 * screen. It never dispatches a mutation and never emits a toast; an absent
 * effective renders the honest empty tree, never a synthesized value.
 */
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js"
import type { OperatorPaletteEntry } from "@opencode-ai/core/operator"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { useProject } from "../../context/project"
import { useToast } from "../../ui/toast"
import { useOperatorSlash } from "../../context/operator-slash"
import { useRoute } from "../../context/route"
import { executeOperatorCommand } from "../execute"
import { toStatusNodes } from "../status"

export type OperatorViewModalProps = {
  readonly entry: OperatorPaletteEntry
  readonly label: string
}

/** Load state of the silent detail read backing the tree. */
type ViewRead = { readonly value: unknown; readonly loaded: boolean; readonly available: boolean }

/** The read-only structural view modal for one detail verb (FR11). */
export function OperatorViewModal(props: OperatorViewModalProps): JSX.Element {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const toast = useToast()
  const operator = useOperatorSlash()
  const route = useRoute()
  const [read, setRead] = createSignal<ViewRead>({ value: undefined, loaded: false, available: true })
  const nodes = createMemo(() => toStatusNodes(read().value))

  onMount(() => {
    const sessionId = route.data.type === "session" ? route.data.sessionID : undefined
    void executeOperatorCommand({
      entry: props.entry,
      port: operator.port,
      projectId: project.project(),
      sessionId,
      dialog,
      toast,
      // Read-only detail read (FR11/FR18): the modal's honesty is its empty tree,
      // never a toast flash on open.
      silent: true,
    }).then((result) =>
      setRead({ value: result.result?.effective, loaded: true, available: result.outcome !== "unavailable" }),
    )
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {`Operator · ${props.label} · ${props.entry.verbLabel}`}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.pop()}>
          esc
        </text>
      </box>
      <Show when={read().loaded} fallback={<text fg={theme.textMuted}>Loading…</text>}>
        <Show when={read().available} fallback={<text fg={theme.textMuted}>Detail unavailable</text>}>
          <Show when={nodes().length > 0} fallback={<text fg={theme.textMuted}>No detail reported</text>}>
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
    </box>
  )
}

/** Factory for `dialog.push` that mounts the structural view modal (T013). */
export function openOperatorViewModal(props: OperatorViewModalProps): () => JSX.Element {
  return () => <OperatorViewModal {...props} />
}
