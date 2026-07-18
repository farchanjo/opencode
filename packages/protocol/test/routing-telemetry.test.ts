import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import * as Routing from "../src/routing"
import * as Telemetry from "../src/telemetry"

describe("Routing protocol payloads", () => {
  test("StatusRequest round trips", () => {
    const input = {}
    const decoded = Schema.decodeUnknownSync(Routing.StatusRequest)(input)

    expect(Schema.encodeSync(Routing.StatusRequest)(decoded)).toEqual(input)
  })

  test("StatusResponse round trips", () => {
    const input = {
      enabled: true,
      mode: "auto" as const,
      strictGates: true,
      decisionModelPool: ["claude-sonnet-5"],
      rolePools: { architect: ["claude-opus-4"], worker: ["claude-sonnet-5"] },
      catalogVersion: "catalog-1",
      policyVersion: "policy-1",
      health: "ok" as const,
      reason: null,
      recommendedAction: null,
      offline: false,
    }
    const decoded = Schema.decodeUnknownSync(Routing.StatusResponse)(input)

    expect(decoded).toEqual(input)
    expect(Schema.encodeSync(Routing.StatusResponse)(decoded)).toEqual(input)
  })
})

describe("Telemetry protocol payloads", () => {
  test("StatusRequest round trips", () => {
    const input = {}
    const decoded = Schema.decodeUnknownSync(Telemetry.StatusRequest)(input)

    expect(Schema.encodeSync(Telemetry.StatusRequest)(decoded)).toEqual(input)
  })

  test("StatusResponse round trips", () => {
    const input = {
      enabled: true,
      config: {
        endpoint: "https://collector.example.com",
        transport: "http/protobuf" as const,
        signals: { metrics: true, logs: true, traces: false, profiling: false },
        queue: { capacity: 1000, batch_size: 50, drop_policy: "drop" as const },
        redact: { prompts: true, secrets: true, file_paths: false, tool_payloads: true },
      },
      exportHealth: "ok" as const,
      queueDepth: 0,
      queueCapacity: 1000,
      dropCount: 0,
      exportErrorCount: 0,
      offline: false,
    }
    const decoded = Schema.decodeUnknownSync(Telemetry.StatusResponse)(input)

    expect(decoded).toEqual(input)
    expect(Schema.encodeSync(Telemetry.StatusResponse)(decoded)).toEqual(input)
  })
})
