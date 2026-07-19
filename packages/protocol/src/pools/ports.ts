/**
 * Feature 013 — Pools application port (T004).
 *
 * TypeScript mirror of the `PoolsPort` inbound-port interface for the pools
 * operator domain (FR1, FR5), structured after
 * `packages/protocol/src/langlock/ports.ts`. This port is implemented by the
 * pools domain stack (`packages/opencode/src/operator/pools/**`) as a PROJECTION
 * over `RoutingConfig.Models.role_pools` and is consumed by Feature 007 operator
 * control-plane adapters. Feature 013 never registers a parallel command
 * registry, event bus, or config store — the reserved `pools.*` catalog ids and
 * the routing Config.Service authority are reused unchanged (FR9, FR11).
 *
 * Request/response payloads and the typed error union live in ./commands — this
 * file defines only the port method signatures.
 */

import type { Effect } from "effect"
import type {
  PoolsError,
  PoolsResetInput,
  PoolsResetOutput,
  PoolsResolveOutput,
  PoolsSetInput,
  PoolsSetOutput,
  PoolsValidateOutput,
} from "./commands"

/**
 * Backs the reserved `pools.status|show|set|reset|validate` operator command
 * surface (registered via Feature 007; Feature 013 supplies only these typed
 * domain implementations). `set`/`reset` are optimistic CAS writes over the
 * routing authority that persist the whole role-pool map and return a Feature 007
 * audit id; config I/O degrades to the typed `PoolsError` union — never a
 * fabricated success (FR5, FR7, FR8). `validate` reports validity without
 * mutating.
 */
export interface PoolsPort {
  /** Backs `pools.status` and `pools.show`; redacted, content-free projection read (FR5). */
  readonly resolve: () => Effect.Effect<PoolsResolveOutput, PoolsError>

  /** Backs `pools.set`; CAS/audit write of the role-pool map on the routing authority (FR5, FR7). */
  readonly set: (input: PoolsSetInput) => Effect.Effect<PoolsSetOutput, PoolsError>

  /** Backs `pools.reset`; reverts the map to the routing default; CAS/audit (FR5, FR7). */
  readonly reset: (input: PoolsResetInput) => Effect.Effect<PoolsResetOutput, PoolsError>

  /** Backs `pools.validate`; reports validity of the effective bindings without mutating (FR5, FR8). */
  readonly validate: () => Effect.Effect<PoolsValidateOutput, PoolsError>
}
