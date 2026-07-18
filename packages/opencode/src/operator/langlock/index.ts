/**
 * Feature 004 / T033 — operator langlock domain barrel (S16).
 *
 * Re-exports the typed `langlock.*` domain implementation (`langlock-port.ts`),
 * the Feature 007 `DomainInvoke` command adapter (`langlock-command-port.ts`),
 * the live composition wiring (`stack-wiring.ts`), and the live `LangLockBackend`
 * composition over the durable Config.Service persistence (`backend-live.ts`).
 * Feature 004 supplies only these typed domain query/command implementations and
 * their audit events; Feature 007 remains the sole command-registration authority
 * (C3). The reserved `langlock.status|show|set|reset` ids already live in
 * `packages/core/src/operator/catalog.ts` at `RESERVED_CATALOG_VERSION` — no
 * catalog bump is performed.
 */

export * as LangLockOperatorPort from "./langlock-port"
export * as LangLockCommandPort from "./langlock-command-port"
export * as LangLockBackendLive from "./backend-live"
export * as LangLockStackWiring from "./stack-wiring"
