/**
 * Feature 002 — Lifecycle schema barrel (T012).
 *
 * Re-exports every `packages/schema/src/lifecycle/*` module under its own
 * namespace, one line per module, mirroring each module's own
 * `export * as X from "./x"` self-export. Consumers may import either the
 * per-module subpath directly (`@opencode-ai/schema/lifecycle/<name>`, via
 * this package's `exports["./*"]`) or this barrel (`@opencode-ai/schema/lifecycle`)
 * when several namespaces are needed together; both resolve to the same
 * modules. This file defines no schemas of its own (C2, C3).
 */

export * as Admission from "./admission"
export * as Cancel from "./cancel"
export * as CorrelationIds from "./correlation-ids"
export * as Enums from "./enums"
export * as EnumsObservation from "./enums-observation"
export * as Envelope from "./envelope"
export * as Events from "./events"
export * as EventsDurable from "./events-durable"
export * as EventsLive from "./events-live"
export * as Ids from "./ids"
export * as Observation from "./observation"
export * as Row from "./process-row"
export * as RowParts from "./process-row-parts"
export * as TodoEvents from "./todo-events"
export * as Usage from "./usage"
export * as UsageValues from "./usage-values"
export * as Values from "./values"
export * as Watchdog from "./watchdog"
