/**
 * Feature 013 / T006 — operator smart domain barrel.
 *
 * Re-exports the typed `smart.*` domain implementation (`smart-port.ts`), the
 * Feature 007 `DomainInvoke` command adapter (`smart-command-port.ts`), the live
 * composition wiring (`stack-wiring.ts`), and the live `SmartBackend` composition
 * over the reused routing Config.Service authority (`backend-live.ts`). Feature
 * 013 supplies only these typed domain query/command implementations and their
 * audit events; Feature 007 remains the sole command-registration authority. The
 * reserved `smart.status|on|off|auto` ids already live in
 * `packages/core/src/operator/catalog.ts` at `RESERVED_CATALOG_VERSION` — no
 * catalog bump is performed.
 */

export * as SmartOperatorPort from "./smart-port"
export * as SmartCommandPort from "./smart-command-port"
export * as SmartBackendLive from "./backend-live"
export * as SmartStackWiring from "./stack-wiring"
