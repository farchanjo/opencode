import { describe, expect, test } from "bun:test"
import {
  breadcrumbPath,
  currentSessionId,
  popBreadcrumb,
  pushBreadcrumb,
  ROOT_BREADCRUMB,
  withSelection,
} from "./breadcrumb"

describe("process-panel breadcrumb (AC23a–AC23d)", () => {
  test("Architect -> Manager -> Worker navigation builds a readable path", () => {
    let state = pushBreadcrumb(ROOT_BREADCRUMB, { sessionId: "mgr_1", label: "Manager", selectedProcessId: null })
    state = pushBreadcrumb(state, { sessionId: "wrk_1", label: "Worker", selectedProcessId: null })
    expect(breadcrumbPath(state)).toBe("Manager > Worker")
    expect(currentSessionId(state, "root_sess")).toBe("wrk_1")
  })

  test("at the root the current session id is the root session (AC23a)", () => {
    expect(currentSessionId(ROOT_BREADCRUMB, "root_sess")).toBe("root_sess")
    expect(breadcrumbPath(ROOT_BREADCRUMB)).toBe("")
  })

  test("back navigation preserves the remaining levels' prior selection (AC23d)", () => {
    let state = pushBreadcrumb(ROOT_BREADCRUMB, { sessionId: "mgr_1", label: "Manager", selectedProcessId: null })
    state = withSelection(state, "proc_selected")
    state = pushBreadcrumb(state, { sessionId: "wrk_1", label: "Worker", selectedProcessId: null })

    const back = popBreadcrumb(state)
    expect(back.stack).toHaveLength(1)
    expect(back.stack[0]?.sessionId).toBe("mgr_1")
    expect(back.stack[0]?.selectedProcessId).toBe("proc_selected")
  })

  test("popping the root breadcrumb is a no-op", () => {
    expect(popBreadcrumb(ROOT_BREADCRUMB)).toBe(ROOT_BREADCRUMB)
  })

  test("withSelection at the root is a no-op (nothing to select into)", () => {
    expect(withSelection(ROOT_BREADCRUMB, "proc_1")).toBe(ROOT_BREADCRUMB)
  })
})
