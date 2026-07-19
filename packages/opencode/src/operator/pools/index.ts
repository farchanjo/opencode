/**
 * Feature 013 / T008 — operator pools domain barrel.
 *
 * Re-exports the typed `pools.*` domain implementation (`pools-port.ts`), the
 * Feature 007 `DomainInvoke` command adapter (`pools-command-port.ts`), the live
 * composition wiring (`stack-wiring.ts`), and the live `PoolsBackend` composition
 * over the reused routing Config.Service authority (`backend-live.ts`). Feature 013
 * supplies only these typed domain query/command implementations and their audit
 * events; Feature 007 remains the sole command-registration authority. The reserved
 * `pools.status|show|set|reset|validate` ids already live in the catalog — no
 * catalog bump is performed.
 */

export * as PoolsOperatorPort from "./pools-port"
export * as PoolsCommandPort from "./pools-command-port"
export * as PoolsBackendLive from "./backend-live"
export * as PoolsStackWiring from "./stack-wiring"
