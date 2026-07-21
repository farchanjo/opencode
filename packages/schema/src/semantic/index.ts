/**
 * Feature 006 — Semantic Agent and Skill Retrieval schema barrel (T012).
 *
 * Re-exports every `packages/schema/src/semantic/*` module under its own
 * namespace, one line per module, mirroring each module's own
 * `export * as X from "./x"` self-export. Consumers may import either the
 * per-module subpath directly (`@opencode-ai/schema/semantic/<name>`, via this
 * package's `exports["./*"]`) or this barrel (`@opencode-ai/schema/semantic`)
 * when several namespaces are needed together; both resolve to the same modules.
 * This file defines no schemas of its own — the canonical wire shape is the CUE
 * corpus under doc/arch/schemas/semantic/*.cue (FR1, FR2, C21, C22).
 */

export * as Binding from "./binding"
export * as Collections from "./collections"
export * as Correlation from "./correlation"
export * as Documents from "./documents"
export * as Enums from "./enums"
export * as EnumsEvent from "./enums-event"
export * as EnumsState from "./enums-state"
export * as Envelope from "./envelope"
export * as EventDefinitions from "./event-definitions"
export * as Events from "./events"
export * as EventTypes from "./event-types"
export * as Ids from "./ids"
export * as IndexGeneration from "./index-generation"
export * as ModelDescriptor from "./model-descriptor"
export * as NarrowingConfig from "./narrowing-config"
export * as Profile from "./profile"
export * as ProviderProfile from "./provider-profile"
export * as Refs from "./refs"
export * as Retrieval from "./retrieval"
export * as TextValues from "./text-values"
export * as ToolConfig from "./tool-config"
export * as ToolDoc from "./tool-doc"
export * as Values from "./values"
