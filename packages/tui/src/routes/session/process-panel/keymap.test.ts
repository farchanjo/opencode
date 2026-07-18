import { describe, expect, test } from "bun:test"
import { deriveCtrlCAction, deriveEscAction } from "./keymap"

describe("process-panel Esc/Ctrl+C semantics (FR59, FR60, AC29, AC31)", () => {
  test("Esc always dismisses/backs/navigates and never cancels the root tree", () => {
    expect(deriveEscAction({ focus: "detail", rootExecutionActive: true })).toEqual({ kind: "dismiss" })
    expect(deriveEscAction({ focus: "modal", rootExecutionActive: true })).toEqual({ kind: "dismiss" })
    expect(deriveEscAction({ focus: "navigation", rootExecutionActive: true })).toEqual({ kind: "back" })
    expect(deriveEscAction({ focus: "input", rootExecutionActive: true })).toEqual({ kind: "noop" })
    expect(deriveEscAction({ focus: "root", rootExecutionActive: true })).toEqual({ kind: "noop" })
  })

  test("Ctrl+C requests a root cancel only while root execution is active", () => {
    expect(deriveCtrlCAction({ focus: "root", rootExecutionActive: true })).toEqual({ kind: "request_root_cancel" })
    expect(deriveCtrlCAction({ focus: "root", rootExecutionActive: false })).toEqual({ kind: "noop" })
  })
})
