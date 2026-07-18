// Pure Esc-vs-Ctrl+C decision contract for the process panel (Feature 002 /
// T036, FR59, FR60, AC29, AC31). No I/O, no solid-js, no network call — this
// module only classifies *intent*; the actual native root-tree cancel
// dispatch is `packages/opencode/src/lifecycle/cancel.ts` (T029, not yet
// implemented). Wiring this into the live `useOpencodeKeymap` command
// dispatcher (packages/tui/src/keymap.tsx) is the caller's responsibility
// once T029 exists — see
// doc/arch/sdd/002-build-an-event-driven-asynchronous-task-lifecycle-engine/plan.md
// slice S11 ("Handoff + cancel").

export type PanelFocus = "detail" | "modal" | "navigation" | "input" | "root"

export interface PanelKeyContext {
  readonly focus: PanelFocus
  /** Whether the current root process tree has active (queued/waiting/running) work. */
  readonly rootExecutionActive: boolean
}

export type PanelKeyAction =
  | { readonly kind: "dismiss" }
  | { readonly kind: "back" }
  | { readonly kind: "navigate" }
  | { readonly kind: "noop" }
  | { readonly kind: "request_root_cancel" }

/**
 * Esc MUST remain dismiss/back/close-modal/navigation behavior and MUST NEVER
 * cancel the current root process tree (FR59, AC31).
 */
export function deriveEscAction(context: PanelKeyContext): PanelKeyAction {
  switch (context.focus) {
    case "detail":
    case "modal":
      return { kind: "dismiss" }
    case "navigation":
      return { kind: "back" }
    case "input":
      return { kind: "noop" }
    case "root":
      return { kind: "noop" }
  }
}

/**
 * Ctrl+C requests native cancellation of the current root process tree only
 * while execution is active in that root; otherwise it is a no-op here (idle
 * root Ctrl+C is not a panel concern) (FR60, AC29).
 */
export function deriveCtrlCAction(context: PanelKeyContext): PanelKeyAction {
  return context.rootExecutionActive ? { kind: "request_root_cancel" } : { kind: "noop" }
}

export * as ProcessPanelKeymap from "./keymap"
