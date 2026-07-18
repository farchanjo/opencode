import { describe, expect, test } from "bun:test"
import type { OperatorClientResult } from "@opencode-ai/sdk/operator"
import { fallback, formatEnvelopeError, isRecord, onOff, render, yesNo } from "./output"

const ok: OperatorClientResult = {
  ok: true,
  id: "telemetry.status",
  outcome: "ok",
  effective: { enabled: true },
  httpStatus: 200,
}
const failed: OperatorClientResult = {
  ok: false,
  id: "telemetry.on",
  outcome: "unauthorized",
  error: { code: "unauthorized", message: "operator authentication required" },
  httpStatus: 401,
}

describe("operator output rendering", () => {
  test("json mode emits the pretty-printed envelope and exit 0 on ok", () => {
    const out = render(ok, true, () => "unused")
    expect(out.exitCode).toBe(0)
    expect(out.stderr).toBe("")
    expect(JSON.parse(out.stdout)).toEqual(ok as unknown as Record<string, unknown>)
  })

  test("json mode sets a non-zero exit when the envelope failed", () => {
    const out = render(failed, true, () => "unused")
    expect(out.exitCode).toBe(1)
    expect(JSON.parse(out.stdout).ok).toBe(false)
  })

  test("human mode routes the effective payload through the renderer", () => {
    const out = render(ok, false, (effective) => `enabled=${(effective as { enabled: boolean }).enabled}`)
    expect(out.stdout.trim()).toBe("enabled=true")
    expect(out.exitCode).toBe(0)
  })

  test("human mode writes the error to stderr and never runs the renderer", () => {
    let ran = false
    const out = render(failed, false, () => {
      ran = true
      return "should not render"
    })
    expect(ran).toBe(false)
    expect(out.stdout).toBe("")
    expect(out.stderr).toContain("error: unauthorized: operator authentication required")
    expect(out.exitCode).toBe(1)
  })

  test("formatEnvelopeError falls back to the outcome when no error is present", () => {
    expect(formatEnvelopeError({ ok: false, id: "x", outcome: "forbidden_scope", httpStatus: 403 })).toBe(
      "error: forbidden_scope: operator command failed",
    )
  })

  test("value formatters", () => {
    expect(onOff(true)).toBe("on")
    expect(onOff(false)).toBe("off")
    expect(yesNo(true)).toBe("yes")
    expect(yesNo(undefined)).toBe("no")
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(fallback(undefined)).toBe("ok")
    expect(fallback({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2))
  })
})
