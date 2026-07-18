/**
 * Feature 006 / T034 — operator semantic domain barrel (S22).
 *
 * Re-exports the typed `semantic.*` domain implementation (`semantic-port.ts`),
 * the Feature 007 `DomainInvoke` command adapter (`semantic-command-port.ts`),
 * the live composition wiring (`stack-wiring.ts`), and the honest live
 * `SemanticBackend` composition (`backend-live.ts`). Feature 006 supplies only
 * these typed domain query/command implementations and their audit events;
 * Feature 007 remains the sole command-registration authority (C15). The reserved
 * 30 `semantic.*` ids already live in `packages/core/src/operator/catalog.ts` at
 * `RESERVED_CATALOG_VERSION = 1.3.0` — no catalog bump is performed.
 */

export * as SemanticOperatorPort from "./semantic-port"
export * as SemanticCommandPort from "./semantic-command-port"
export * as SemanticBackendLive from "./backend-live"
export * as SemanticStackWiring from "./stack-wiring"
