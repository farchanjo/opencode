/**
 * Feature 001 — Telemetry protocol payloads.
 *
 * Mirrors TelemetryPort from
 * doc/arch/sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/contracts/ports.ts
 * (status/enable/disable/show/configure/test/flush). One request/response
 * pair per operation, composed from the domain schemas under
 * @opencode-ai/schema/telemetry/* wherever the port contract reuses a
 * domain shape. TelemetryShowOutput.config is a redacted view of the
 * persisted TelemetryConfig (no headers, no tls cert/secret refs) — modeled
 * locally as EffectiveConfig rather than reusing Config.TelemetryConfig.
 */

import { Schema } from "effect"
import { Config } from "@opencode-ai/schema/telemetry/config"
import { PositiveInt } from "@opencode-ai/schema/schema"

// Scope shared by enable/disable/configure.
export const TelemetryScope = Schema.Literals(["global", "project"] as const).annotate({
  identifier: "TelemetryProtocol.TelemetryScope",
})
export type TelemetryScope = typeof TelemetryScope.Type

export const ConfigOrigin = Schema.Literals(["global", "project", "default"] as const).annotate({
  identifier: "TelemetryProtocol.ConfigOrigin",
})
export type ConfigOrigin = typeof ConfigOrigin.Type

export const ExportHealth = Schema.Literals(["ok", "degraded", "unavailable"] as const).annotate({
  identifier: "TelemetryProtocol.ExportHealth",
})
export type ExportHealth = typeof ExportHealth.Type

// EffectiveConfig — the redacted, effective view of TelemetryConfig returned
// by show/status (headers and tls cert/secret refs are never exposed).
export interface EffectiveConfig extends Schema.Schema.Type<typeof EffectiveConfig> {}
export const EffectiveConfig = Schema.Struct({
  endpoint: Config.EndpointUrl,
  transport: Config.Transport,
  signals: Schema.Struct({
    metrics: Schema.Boolean,
    logs: Schema.Boolean,
    traces: Schema.Boolean,
    profiling: Schema.Boolean,
  }),
  queue: Schema.Struct({
    capacity: PositiveInt,
    batch_size: PositiveInt,
    drop_policy: Config.DropPolicy,
  }),
  redact: Schema.Struct({
    prompts: Schema.Boolean,
    secrets: Schema.Boolean,
    file_paths: Schema.Boolean,
    tool_payloads: Schema.Boolean,
  }),
}).annotate({ identifier: "TelemetryProtocol.EffectiveConfig" })

// =============================================================================
// status
// =============================================================================

export interface StatusRequest extends Schema.Schema.Type<typeof StatusRequest> {}
export const StatusRequest = Schema.Struct({}).annotate({ identifier: "TelemetryProtocol.StatusRequest" })

export interface StatusResponse extends Schema.Schema.Type<typeof StatusResponse> {}
export const StatusResponse = Schema.Struct({
  enabled: Schema.Boolean,
  config: EffectiveConfig,
  exportHealth: ExportHealth,
  queueDepth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  queueCapacity: PositiveInt,
  dropCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  exportErrorCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  offline: Schema.Boolean,
}).annotate({ identifier: "TelemetryProtocol.StatusResponse" })

// =============================================================================
// enable / disable
// =============================================================================

export interface EnableRequest extends Schema.Schema.Type<typeof EnableRequest> {}
export const EnableRequest = Schema.Struct({
  scope: TelemetryScope,
}).annotate({ identifier: "TelemetryProtocol.EnableRequest" })

export const EnableResponse = StatusResponse.annotate({ identifier: "TelemetryProtocol.EnableResponse" })
export type EnableResponse = typeof EnableResponse.Type

export interface DisableRequest extends Schema.Schema.Type<typeof DisableRequest> {}
export const DisableRequest = Schema.Struct({
  scope: TelemetryScope,
}).annotate({ identifier: "TelemetryProtocol.DisableRequest" })

export const DisableResponse = StatusResponse.annotate({ identifier: "TelemetryProtocol.DisableResponse" })
export type DisableResponse = typeof DisableResponse.Type

// =============================================================================
// show
// =============================================================================

export interface ShowRequest extends Schema.Schema.Type<typeof ShowRequest> {}
export const ShowRequest = Schema.Struct({}).annotate({ identifier: "TelemetryProtocol.ShowRequest" })

export interface ShowResponse extends Schema.Schema.Type<typeof ShowResponse> {}
export const ShowResponse = Schema.Struct({
  config: EffectiveConfig,
  origin: ConfigOrigin,
}).annotate({ identifier: "TelemetryProtocol.ShowResponse" })

// =============================================================================
// configure — opens a persistent Settings flow; no raw secrets accepted.
// =============================================================================

export interface ConfigureRequest extends Schema.Schema.Type<typeof ConfigureRequest> {}
export const ConfigureRequest = Schema.Struct({
  scope: TelemetryScope,
}).annotate({ identifier: "TelemetryProtocol.ConfigureRequest" })

export const ConfigureResponse = Schema.Void.annotate({ identifier: "TelemetryProtocol.ConfigureResponse" })
export type ConfigureResponse = typeof ConfigureResponse.Type

// =============================================================================
// test
// =============================================================================

export const TelemetryTestMode = Schema.Literals(["signal", "connectivity"] as const).annotate({
  identifier: "TelemetryProtocol.TelemetryTestMode",
})
export type TelemetryTestMode = typeof TelemetryTestMode.Type

export const TelemetryTestOutcome = Schema.Literals(["ok", "unavailable", "error"] as const).annotate({
  identifier: "TelemetryProtocol.TelemetryTestOutcome",
})
export type TelemetryTestOutcome = typeof TelemetryTestOutcome.Type

export interface TestRequest extends Schema.Schema.Type<typeof TestRequest> {}
export const TestRequest = Schema.Struct({
  mode: TelemetryTestMode,
}).annotate({ identifier: "TelemetryProtocol.TestRequest" })

export interface TestResponse extends Schema.Schema.Type<typeof TestResponse> {}
export const TestResponse = Schema.Struct({
  mode: TelemetryTestMode,
  outcome: TelemetryTestOutcome,
  reason: Schema.NullOr(Schema.String),
  testSignalEmitted: Schema.Boolean,
  noUserContentExported: Schema.Literal(true),
}).annotate({ identifier: "TelemetryProtocol.TestResponse" })

// =============================================================================
// flush
// =============================================================================

export interface FlushRequest extends Schema.Schema.Type<typeof FlushRequest> {}
export const FlushRequest = Schema.Struct({}).annotate({ identifier: "TelemetryProtocol.FlushRequest" })

export interface FlushResponse extends Schema.Schema.Type<typeof FlushResponse> {}
export const FlushResponse = Schema.Struct({
  flushedRecords: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  discardedRecords: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  durationMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "TelemetryProtocol.FlushResponse" })

// =============================================================================
// TelemetryError — tagged union mirroring TelemetryPort's TelemetryError.
// =============================================================================

export const TelemetryError = Schema.Union([
  Schema.Struct({ type: Schema.Literal("validation_failed"), fields: Schema.Record(Schema.String, Schema.String) }),
  Schema.Struct({ type: Schema.Literal("connection_failed"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("unavailable"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("not_implemented") }),
]).annotate({ identifier: "TelemetryProtocol.TelemetryError" })
export type TelemetryError = typeof TelemetryError.Type

// =============================================================================
// Feature 013 — Telemetry operator-domain command module (T001).
//
// Re-exports the telemetry operator-surface payloads / typed error union from
// ./commands and the `TelemetryDomainPort` interface from ./ports, mirroring
// protocol/src/langlock/index.ts. These are the operator control-plane
// projection consumed by the Feature 013 domain stack + Feature 007 adapter,
// distinct from the Feature 001 `TelemetryPort` request/response pairs above.
// The names are disjoint (the operator error union is `TelemetryDomainError`,
// never the Feature 001 `TelemetryError`), so no barrel identifier collides.
// =============================================================================

export * from "./commands"
export type { TelemetryDomainPort } from "./ports"
