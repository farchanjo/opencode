/**
 * Feature 008 — Complete MCP Client Tools and Resources Lifecycle schema barrel
 * (T010).
 *
 * Re-exports every `packages/schema/src/mcp/*` module under its own namespace, one
 * line per module, mirroring each module's own `export * as X from "./x"` self-export.
 * Consumers may import either the per-module subpath directly
 * (`@opencode-ai/schema/mcp/<name>`, via this package's `exports["./*"]`) or this
 * barrel (`@opencode-ai/schema/mcp`) when several namespaces are needed together; both
 * resolve to the same modules. This file defines no schemas of its own — the canonical
 * wire shape is the CUE corpus under doc/arch/schemas/mcp/*.cue (FR38, C3).
 */

export * as Capability from "./capability"
export * as Collections from "./collections"
export * as Connection from "./connection"
export * as Enums from "./enums"
export * as EnumsEvent from "./enums-event"
export * as EnumsState from "./enums-state"
export * as Envelope from "./envelope"
export * as EventDefinitions from "./event-definitions"
export * as Events from "./events"
export * as EventsCall from "./events-call"
export * as EventsLive from "./events-live"
export * as EventsLog from "./events-log"
export * as EventsResource from "./events-resource"
export * as EventsServer from "./events-server"
export * as EventTypes from "./event-types"
export * as Experimental from "./experimental"
export * as Ids from "./ids"
export * as Policy from "./policy"
export * as Refs from "./refs"
export * as SpoolDescriptor from "./spool-descriptor"
export * as TextValues from "./text-values"
export * as Uri from "./uri"
export * as UriAllowlist from "./uri-allowlist"
export * as Values from "./values"
