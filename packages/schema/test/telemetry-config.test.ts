import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "../src/telemetry/config"

const valid = {
  enabled: true,
  export: {
    endpoint: "https://otel.example.com:4318",
    transport: "http/protobuf",
    headers: { authorization: "secret-ref-1" },
    tls: { enabled: true, cert: "secret-ref-2" },
  },
  signals: { metrics: true, logs: true, traces: false, profiling: false },
  queue: {
    capacity: 1000,
    batch_size: 50,
    enqueue_timeout_ms: 100,
    export_timeout_ms: 5000,
    retry_budget: 3,
    drop_policy: "drop",
  },
  redact: { prompts: true, secrets: true, file_paths: false, tool_payloads: true },
  resource_attributes: { "service.name": "opencode" },
  sampling: 0.5,
} as const

describe("Telemetry.TelemetryConfig", () => {
  test("decodes a valid config", () => {
    const decoded = Schema.decodeUnknownSync(Config.TelemetryConfig)(valid)
    expect(decoded).toEqual(valid)
  })

  test("rejects an invalid endpoint", () => {
    const invalid = { ...valid, export: { ...valid.export, endpoint: "ftp://bad" } }
    expect(() => Schema.decodeUnknownSync(Config.TelemetryConfig)(invalid)).toThrow()
  })

  test("rejects a non-positive queue capacity", () => {
    const invalid = { ...valid, queue: { ...valid.queue, capacity: 0 } }
    expect(() => Schema.decodeUnknownSync(Config.TelemetryConfig)(invalid)).toThrow()
  })

  test("rejects sampling out of [0,1]", () => {
    const invalid = { ...valid, sampling: 1.5 }
    expect(() => Schema.decodeUnknownSync(Config.TelemetryConfig)(invalid)).toThrow()
  })

  test("Transport enum is closed", () => {
    const invalid = { ...valid, export: { ...valid.export, transport: "websocket" } }
    expect(() => Schema.decodeUnknownSync(Config.TelemetryConfig)(invalid)).toThrow()
    expect(Schema.decodeUnknownSync(Config.Transport)("grpc")).toBe("grpc")
  })

  test("DropPolicy enum is closed", () => {
    expect(Schema.decodeUnknownSync(Config.DropPolicy)("backpressure")).toBe("backpressure")
    expect(() => Schema.decodeUnknownSync(Config.DropPolicy)("ignore")).toThrow()
  })
})
