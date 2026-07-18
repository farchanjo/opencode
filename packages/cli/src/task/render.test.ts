import { describe, expect, test } from "bun:test"
import { ProcessRender } from "../process/render"
import { renderCancel, renderStatus, renderTree, renderWatchFrame } from "./render"

describe("task renderers", () => {
  test("reuse the process row/tree/cancel renderers verbatim (no duplicated formatting)", () => {
    expect(renderStatus).toBe(ProcessRender.renderRow)
    expect(renderWatchFrame).toBe(ProcessRender.renderRow)
    expect(renderTree).toBe(ProcessRender.renderTree)
    expect(renderCancel).toBe(ProcessRender.renderCancel)
  })
})
