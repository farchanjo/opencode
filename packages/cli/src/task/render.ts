import { ProcessRender } from "../process/render"

/**
 * Feature 002 / T035 — human renderers for the `opencode task` command
 * surface. A logical Task resolves to its current `process_id`/attempt/
 * generation through the Feature 007 registry; the response shape is the
 * same redacted `ProcessRow`/`ProcessTreeOutput`/`ProcessCancelOutput`
 * family used by `opencode process`, so the row/tree/cancel renderers are
 * reused verbatim (no duplicated formatting logic).
 */

export const renderStatus = ProcessRender.renderRow
export const renderWatchFrame = ProcessRender.renderRow
export const renderTree = ProcessRender.renderTree
export const renderCancel = ProcessRender.renderCancel

export * as TaskRender from "./render"
