/**
 * Feature 013 — Smart protocol barrel (T002).
 *
 * Re-exports the shared identifiers, the reused routing Activation slice, the
 * projection read model, the `on`/`off`/`auto` payloads and the typed error union
 * from ./commands, and the `SmartPort` interface from ./ports, mirroring
 * `packages/protocol/src/langlock/index.ts`. smart is a projection of
 * `RoutingConfig.Activation` (doc/arch/schemas/operator-config-domains/smart.cue).
 */

export * from "./commands"
export type { SmartPort } from "./ports"
