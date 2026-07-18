// Pure breadcrumb navigation model for Architect → Manager → Worker Session
// views (Feature 002 / T036, FR58a, AC23d, C22). No I/O, no solid-js.
//
// Back/breadcrumb navigation preserves Session view state and selection
// across levels (AC23d) — pushing a level never discards the parent level's
// selection, and popping restores it verbatim rather than resetting it.

export interface BreadcrumbEntry {
  readonly sessionId: string
  /** Rendered label; text-first, independent of color (AC34). */
  readonly label: string
  /** Selected card's processId at this level, if any; restored on back-navigation. */
  readonly selectedProcessId: string | null
}

export interface BreadcrumbState {
  readonly stack: readonly BreadcrumbEntry[]
}

export const ROOT_BREADCRUMB: BreadcrumbState = { stack: [] }

/** Enter a child Session view (Architect → Manager, Manager → Worker, ...). */
export function pushBreadcrumb(state: BreadcrumbState, entry: BreadcrumbEntry): BreadcrumbState {
  return { stack: [...state.stack, entry] }
}

/** Back-navigate one level, preserving every remaining level's prior selection. */
export function popBreadcrumb(state: BreadcrumbState): BreadcrumbState {
  if (state.stack.length === 0) return state
  return { stack: state.stack.slice(0, -1) }
}

/** Update the selection recorded at the current (deepest) level without discarding ancestors. */
export function withSelection(state: BreadcrumbState, processId: string | null): BreadcrumbState {
  if (state.stack.length === 0) return state
  const stack = state.stack.slice()
  const last = stack[stack.length - 1]!
  stack[stack.length - 1] = { ...last, selectedProcessId: processId }
  return { stack }
}

/** The Session id currently in view: the deepest breadcrumb entry, or the root when empty. */
export function currentSessionId(state: BreadcrumbState, rootSessionId: string): string {
  return state.stack.length === 0 ? rootSessionId : state.stack[state.stack.length - 1]!.sessionId
}

/** Human-readable "Architect > Manager > Worker" trail; empty at the root. */
export function breadcrumbPath(state: BreadcrumbState): string {
  return state.stack.map((entry) => entry.label).join(" > ")
}

export * as ProcessPanelBreadcrumb from "./breadcrumb"
