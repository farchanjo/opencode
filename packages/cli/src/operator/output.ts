import { EOL } from "node:os"
import type { OperatorClientResult } from "@opencode-ai/sdk/operator"

/**
 * Feature 001 / T032–T033 — CLI operator output conventions.
 *
 * Mirrors `opencode op`: human-readable default on stdout, `--json` emits the
 * typed operator envelope only, and the process exit code follows the envelope
 * `ok` flag. Secret material never reaches these renderers — the operator
 * services return already-redacted views.
 */

export type HumanRenderer = (effective: unknown, result: OperatorClientResult) => string

export interface Rendered {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** Human-readable one-line error from the operator envelope. */
export function formatEnvelopeError(result: OperatorClientResult): string {
  const code = result.error?.code ?? result.outcome
  const message = result.error?.message ?? "operator command failed"
  return `error: ${code}: ${message}`
}

/** Pure renderer: turn an envelope + human formatter into stdout/stderr/exit. */
export function render(result: OperatorClientResult, json: boolean, human: HumanRenderer): Rendered {
  if (json) {
    return { stdout: JSON.stringify(result, null, 2) + EOL, stderr: "", exitCode: result.ok ? 0 : 1 }
  }
  if (!result.ok) {
    return { stdout: "", stderr: formatEnvelopeError(result) + EOL, exitCode: 1 }
  }
  const text = human(result.effective, result)
  return { stdout: text.endsWith(EOL) ? text : text + EOL, stderr: "", exitCode: 0 }
}

/** Write a rendered envelope to the process streams and set the exit code. */
export function emit(result: OperatorClientResult, json: boolean, human: HumanRenderer): void {
  const out = render(result, json, human)
  if (out.stdout) process.stdout.write(out.stdout)
  if (out.stderr) process.stderr.write(out.stderr)
  process.exitCode = out.exitCode
}

// -- shared value formatters -------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function onOff(value: unknown): string {
  return value === true ? "on" : "off"
}

export function yesNo(value: unknown): string {
  return value === true ? "yes" : "no"
}

/** Fallback for an unexpected/absent effective payload. */
export function fallback(effective: unknown): string {
  return effective === undefined ? "ok" : JSON.stringify(effective, null, 2)
}

export * as Output from "./output"
