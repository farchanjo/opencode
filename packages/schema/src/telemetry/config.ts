export * as Config from "./config"

import { Schema } from "effect"
import { PositiveInt, NonNegativeInt } from "../schema"

// SecretRef is an opaque reference resolved via Feature 007 SecretPort.
// Never store the actual secret value.
export const SecretRef = Schema.String.annotate({ identifier: "Telemetry.SecretRef" })
export type SecretRef = typeof SecretRef.Type

// Transport protocol for OTLP export.
export const Transport = Schema.Literals(["http/protobuf", "grpc"] as const).annotate({
  identifier: "Telemetry.Transport",
})
export type Transport = typeof Transport.Type

// Drop policy when bounded queue is full.
export const DropPolicy = Schema.Literals(["drop", "backpressure"] as const).annotate({
  identifier: "Telemetry.DropPolicy",
})
export type DropPolicy = typeof DropPolicy.Type

// Signal kinds that can be independently enabled/disabled.
export const SignalKind = Schema.Literals(["metrics", "logs", "traces", "profiling"] as const).annotate({
  identifier: "Telemetry.SignalKind",
})
export type SignalKind = typeof SignalKind.Type

// EndpointUrl — OTLP-compatible endpoint URL.
export const EndpointUrl = Schema.String.check(Schema.isPattern(/^https?:\/\//)).annotate({
  identifier: "Telemetry.EndpointUrl",
})
export type EndpointUrl = typeof EndpointUrl.Type

// ExportTarget — where and how signals are exported.
export interface ExportTarget extends Schema.Schema.Type<typeof ExportTarget> {}
export const ExportTarget = Schema.Struct({
  endpoint: EndpointUrl,
  transport: Transport,
  headers: Schema.Record(Schema.String, SecretRef),
  tls: Schema.Struct({
    enabled: Schema.Boolean,
    cert: SecretRef,
  }),
}).annotate({ identifier: "Telemetry.ExportTarget" })

export interface TelemetryConfig extends Schema.Schema.Type<typeof TelemetryConfig> {}
export const TelemetryConfig = Schema.Struct({
  enabled: Schema.Boolean,
  export: ExportTarget,
  signals: Schema.Struct({
    metrics: Schema.Boolean,
    logs: Schema.Boolean,
    traces: Schema.Boolean,
    profiling: Schema.Boolean,
  }),
  queue: Schema.Struct({
    capacity: PositiveInt,
    batch_size: PositiveInt,
    enqueue_timeout_ms: PositiveInt,
    export_timeout_ms: PositiveInt,
    retry_budget: NonNegativeInt,
    drop_policy: DropPolicy,
  }),
  redact: Schema.Struct({
    prompts: Schema.Boolean,
    secrets: Schema.Boolean,
    file_paths: Schema.Boolean,
    tool_payloads: Schema.Boolean,
  }),
  resource_attributes: Schema.Record(Schema.String, Schema.String),
  sampling: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
}).annotate({ identifier: "Telemetry.TelemetryConfig" })
