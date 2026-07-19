/**
 * Feature 013 — Pools protocol barrel (T004).
 *
 * Re-exports the shared identifiers, the role-pool binding + projection read
 * models, the `set`/`reset`/`validate` payloads and the typed error union from
 * ./commands, and the `PoolsPort` interface from ./ports, mirroring
 * `packages/protocol/src/langlock/index.ts`. pools is a projection of
 * `RoutingConfig.Models.role_pools` (doc/arch/schemas/operator-config-domains/pools.cue).
 */

export * from "./commands"
export type { PoolsPort } from "./ports"
