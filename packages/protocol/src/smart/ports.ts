/**
 * Feature 013 — Smart application port (T002).
 *
 * TypeScript mirror of the `SmartPort` inbound-port interface for the smart
 * operator domain (FR1, FR3), structured after
 * `packages/protocol/src/langlock/ports.ts`. This port is implemented by the
 * smart domain stack (`packages/opencode/src/operator/smart/**`) as a PROJECTION
 * over `RoutingConfig.Activation` and is consumed by Feature 007 operator
 * control-plane adapters. Feature 013 never registers a parallel command
 * registry, event bus, or config store — the reserved `smart.*` catalog ids and
 * the routing Config.Service authority are reused unchanged (FR9, FR11).
 *
 * Request/response payloads and the typed error union live in ./commands — this
 * file defines only the port method signatures.
 */

import type { Effect } from "effect"
import type { SmartError, SmartMutationInput, SmartMutationOutput, SmartResolveOutput } from "./commands"

/**
 * Backs the reserved `smart.status|on|off|auto` operator command surface
 * (registered via Feature 007; Feature 013 supplies only these typed domain
 * implementations). `on`/`off`/`auto` are optimistic CAS writes over the routing
 * authority that flip `Activation.enabled`/`mode` and return a Feature 007 audit
 * id; config I/O degrades to the typed `SmartError` union — never a fabricated
 * success (FR3, FR7, FR8).
 */
export interface SmartPort {
  /** Backs `smart.status`; redacted, content-free projection read of `Activation` (FR3). */
  readonly resolve: () => Effect.Effect<SmartResolveOutput, SmartError>

  /** Backs `smart.on`; CAS/audit write setting `Activation.enabled` true (FR3, FR7). */
  readonly on: (input: SmartMutationInput) => Effect.Effect<SmartMutationOutput, SmartError>

  /** Backs `smart.off`; CAS/audit write setting `Activation.enabled` false (FR3, FR7). */
  readonly off: (input: SmartMutationInput) => Effect.Effect<SmartMutationOutput, SmartError>

  /** Backs `smart.auto`; CAS/audit write setting `Activation.mode` to `auto` (FR3, FR7). */
  readonly auto: (input: SmartMutationInput) => Effect.Effect<SmartMutationOutput, SmartError>
}
