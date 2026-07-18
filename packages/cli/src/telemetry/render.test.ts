import { describe, expect, test } from "bun:test"
import { renderConfigure, renderShow, renderStatus, renderTest } from "./render"

const config = {
  endpoint: "https://otlp.example:4317",
  transport: "grpc",
  signals: { metrics: true, logs: false, traces: true, profiling: false },
  redact: { prompts: true, secrets: true, file_paths: true, tool_payloads: false },
}

describe("telemetry renderers", () => {
  test("status renders enablement, config and export health", () => {
    const out = renderStatus({
      enabled: true,
      config,
      exportHealth: "ok",
      queueDepth: 3,
      queueCapacity: 1000,
      dropCount: 0,
      exportErrorCount: 2,
      offline: false,
    })
    expect(out).toContain("telemetry: enabled")
    expect(out).toContain("endpoint: https://otlp.example:4317")
    expect(out).toContain("signals: metrics=on logs=off traces=on profiling=off")
    expect(out).toContain("export: ok (queue 3/1000, drops 0, errors 2)")
    expect(out).toContain("offline: no")
  })

  test("show renders origin and redaction settings", () => {
    const out = renderShow({ config, origin: "project" })
    expect(out).toContain("origin: project")
    expect(out).toContain("redact: prompts=on secrets=on file_paths=on tool_payloads=off")
  })

  test("test states no user content was exported", () => {
    const out = renderTest({
      mode: "signal",
      outcome: "ok",
      reason: null,
      testSignalEmitted: true,
      noUserContentExported: true,
    })
    expect(out).toContain("test (signal): ok")
    expect(out).toContain("signal emitted: yes")
    expect(out).toContain("no user content exported: yes")
  })

  test("renderers fall back to JSON for an unexpected payload", () => {
    expect(renderStatus(42)).toBe("42")
  })

  test("configure explains the settings flow", () => {
    expect(renderConfigure()).toContain("no raw secrets")
  })
})
