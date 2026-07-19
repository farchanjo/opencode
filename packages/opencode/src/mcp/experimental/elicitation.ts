/**
 * Feature 008 / T033 (S21) — the elicitation and content-stream adapters.
 *
 * Behind the per-server `mcp.elicitation` and content-stream flags (OFF by
 * default): every elicitation request and every Tasks
 * `notifications/tasks/status: input_required` surfaces to the OPERATOR UI as a
 * lifecycle prompt (never partial content), the model NEVER silently auto-answers,
 * sensitive-mode blocks model-mediated answers outright, and the nonstandard
 * content-stream extension advertises ONLY under the reserved
 * `experimental/opencode.contentStream` capability string with a final-result
 * fallback when absent (FR45, FR47, C18, C20). Pure over the injected flag/mode.
 */
export * as McpElicitation from "./elicitation"

import type { McpElicitationRequest } from "@opencode-ai/protocol/mcp/commands"

/** The reserved namespaced capability string for the content-stream extension (C18). */
export const CONTENT_STREAM_CAPABILITY = "experimental/opencode.contentStream" as const

export interface ElicitationConfig {
  /** The per-server `mcp.elicitation` experimental flag; off by default (C20). */
  readonly enabled: boolean
}

/**
 * How an elicitation / `input_required` is handled. It ALWAYS surfaces to the
 * operator — the model never auto-answers; sensitive mode blocks model-mediated
 * answers outright (FR47, C20). There is no "model answers" branch by construction.
 */
export type ElicitationRouting =
  | { readonly route: "operator_surface" }
  | { readonly route: "blocked_sensitive" }

/**
 * Route an elicitation request. When off it is still surfaced to the operator (a
 * lifecycle prompt is never silently dropped or model-answered); sensitive mode
 * blocks model-mediated answers outright (C20). Pure.
 */
export function routeElicitation(config: ElicitationConfig, request: McpElicitationRequest): ElicitationRouting {
  void config
  if (request.sensitiveMode) return { route: "blocked_sensitive" }
  return { route: "operator_surface" }
}

/** The model may NEVER auto-answer an elicitation; this is a constant invariant (FR47, C20). */
export const modelMayAutoAnswer = (): false => false

export type ContentStreamMode =
  | { readonly mode: "content_stream"; readonly capability: typeof CONTENT_STREAM_CAPABILITY }
  | { readonly mode: "final_result_fallback" }

/**
 * Decide the content-stream mode: the nonstandard stream is used ONLY when the
 * server negotiated the reserved namespaced capability string; otherwise fall back
 * to a final `CallToolResult` + progress metadata (FR6, FR45, C18). Pure.
 */
export function contentStreamMode(negotiatedCapabilities: ReadonlyArray<string>): ContentStreamMode {
  return negotiatedCapabilities.includes(CONTENT_STREAM_CAPABILITY)
    ? { mode: "content_stream", capability: CONTENT_STREAM_CAPABILITY }
    : { mode: "final_result_fallback" }
}
