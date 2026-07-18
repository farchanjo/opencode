/**
 * T012 — telemetry privacy redaction defaults. Pure, deterministic, no I/O.
 */
import { describe, expect, test } from "bun:test"
import {
  redactAttributes,
  redactPersonalPaths,
  redactionPolicyFromConfig,
  signalEnabled,
  DEFAULT_REDACTION_POLICY,
  DEFAULT_TELEMETRY_CONFIG,
  REDACTED,
} from "../../src/routing/application/telemetry-service"

describe("telemetry redaction defaults", () => {
  test("strips prompts, secrets, file content and tool payloads by default", () => {
    const out = redactAttributes({
      prompt: "write me a poem about secrets",
      messages: [{ role: "user", content: "raw file body" }],
      apiKey: "sk-live-should-never-leave",
      result: { rows: 42, blob: "tool output" },
      arguments: { path: "x" },
      "routing.task_class": "small",
      count: 7,
    })

    expect(out.prompt).toBe(REDACTED)
    expect(out.messages).toBe(REDACTED)
    expect(out.apiKey).toBe(REDACTED)
    expect(out.result).toBe(REDACTED)
    expect(out.arguments).toBe(REDACTED)
    // Non-sensitive bounded labels and scalars survive.
    expect(out["routing.task_class"]).toBe("small")
    expect(out.count).toBe(7)
  })

  test("redacts personal home paths inside surviving string values", () => {
    expect(redactPersonalPaths("/Users/farchanjo/dev/opencode/x.ts")).toBe("[redacted-path]/dev/opencode/x.ts")
    expect(redactPersonalPaths("/home/alice/secret")).toBe("[redacted-path]/secret")
    expect(redactPersonalPaths("C:\\Users\\bob\\file")).toBe("[redacted-path]\\file")
    expect(redactPersonalPaths("/opt/app/log")).toBe("/opt/app/log")
  })

  test("redacts exact SecretRef objects nested in attributes", () => {
    const out = redactAttributes({
      export: { token: { backend: "keychain", name: "otlp", version: 1 } },
    })
    const nested = out.export as Record<string, unknown>
    expect(nested.token).toBe(REDACTED)
  })

  test("per-flag policy leaves disabled categories untouched", () => {
    const out = redactAttributes(
      { prompt: "keep me", apiKey: "sk-live" },
      { prompts: false, secrets: true, filePaths: true, fileContent: true, toolPayloads: true },
    )
    expect(out.prompt).toBe("keep me")
    expect(out.apiKey).toBe(REDACTED)
  })

  test("file content is gated by the dedicated fileContent flag", () => {
    const redacted = redactAttributes(
      { diff: "@@ -1 +1 @@", arguments: { path: "x" } },
      { prompts: true, secrets: true, filePaths: true, fileContent: true, toolPayloads: false },
    )
    // fileContent on redacts the diff; toolPayloads off keeps the arguments.
    expect(redacted.diff).toBe(REDACTED)
    expect(redacted.arguments).toEqual({ path: "x" })

    const kept = redactAttributes(
      { diff: "@@ -1 +1 @@" },
      { prompts: true, secrets: true, filePaths: true, fileContent: false, toolPayloads: true },
    )
    expect(kept.diff).toBe("@@ -1 +1 @@")
  })

  test("fileContent falls back to tool_payloads when the config flag is absent", () => {
    const custom = redactionPolicyFromConfig({
      ...DEFAULT_TELEMETRY_CONFIG,
      redact: { prompts: false, secrets: true, file_paths: false, tool_payloads: true },
    })
    expect(custom.fileContent).toBe(true)
  })

  test("never mutates the input and is depth-bounded", () => {
    const input: Record<string, unknown> = { a: { b: { c: "/Users/x/y" } } }
    const out = redactAttributes(input)
    expect((input.a as any).b.c).toBe("/Users/x/y")
    expect(((out.a as any).b as any).c).toBe("[redacted-path]/y")
  })

  test("policy maps from TelemetryConfig.redact flags", () => {
    expect(redactionPolicyFromConfig(DEFAULT_TELEMETRY_CONFIG)).toEqual(DEFAULT_REDACTION_POLICY)
    const custom = redactionPolicyFromConfig({
      ...DEFAULT_TELEMETRY_CONFIG,
      redact: { prompts: false, secrets: true, file_paths: false, file_content: false, tool_payloads: true },
    })
    expect(custom).toEqual({ prompts: false, secrets: true, filePaths: false, fileContent: false, toolPayloads: true })
  })

  test("signalEnabled gates on master enablement and per-signal flag", () => {
    const enabled = { ...DEFAULT_TELEMETRY_CONFIG, enabled: true }
    expect(signalEnabled(enabled, "metrics")).toBe(true)
    expect(signalEnabled(enabled, "profiling")).toBe(false)
    expect(signalEnabled(DEFAULT_TELEMETRY_CONFIG, "metrics")).toBe(false)
  })
})
