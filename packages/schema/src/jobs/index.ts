/**
 * Feature 003 — Jobs schema barrel (T011).
 *
 * Re-exports every `packages/schema/src/jobs/*` module under its own namespace,
 * one line per module, mirroring each module's own `export * as X from "./x"`
 * self-export. Consumers may import either the per-module subpath directly
 * (`@opencode-ai/schema/jobs/<name>`, via this package's `exports["./*"]`) or
 * this barrel (`@opencode-ai/schema/jobs`) when several namespaces are needed
 * together; both resolve to the same modules. This file defines no schemas of
 * its own (C8, C13).
 */

export * as Correlation from "./correlation"
export * as Definition from "./definition"
export * as Enums from "./enums"
export * as EnumsEvent from "./enums-event"
export * as EnumsNotification from "./enums-notification"
export * as Envelope from "./envelope"
export * as EventDefinitions from "./event-definitions"
export * as Events from "./events"
export * as EventsDurable from "./events-durable"
export * as EventsLive from "./events-live"
export * as EventTypes from "./event-types"
export * as Ids from "./ids"
export * as Notification from "./notification"
export * as Occurrence from "./occurrence"
export * as Reconciliation from "./reconciliation"
export * as Schedule from "./schedule"
export * as TextValues from "./text-values"
export * as Values from "./values"
