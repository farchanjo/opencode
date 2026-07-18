/**
 * Feature 005 — OutputSpool schema barrel (T012).
 *
 * Re-exports every `packages/schema/src/outputspool/*` module under its own
 * namespace, one line per module, mirroring each module's own
 * `export * as X from "./x"` self-export. Consumers may import either the
 * per-module subpath directly (`@opencode-ai/schema/outputspool/<name>`, via this
 * package's `exports["./*"]`) or this barrel (`@opencode-ai/schema/outputspool`)
 * when several namespaces are needed together; both resolve to the same modules.
 * This file defines no schemas of its own (C1, C18, C20).
 */

export * as Admin from "./admin"
export * as Channel from "./channel"
export * as Correlation from "./correlation"
export * as Cursor from "./cursor"
export * as Enums from "./enums"
export * as EnumsEvent from "./enums-event"
export * as Envelope from "./envelope"
export * as EventDefinitions from "./event-definitions"
export * as Events from "./events"
export * as EventsLive from "./events-live"
export * as EventsSettlement from "./events-settlement"
export * as EventTypes from "./event-types"
export * as Group from "./group"
export * as Ids from "./ids"
export * as Page from "./page"
export * as Preview from "./preview"
export * as Quota from "./quota"
export * as Retention from "./retention"
export * as Stat from "./stat"
export * as TextValues from "./text-values"
export * as Values from "./values"
