/**
 * Feature 005 / T037 — operator outputspool domain barrel (S24).
 *
 * Re-exports the typed `output.*` domain implementation (`outputspool-port.ts`),
 * the Feature 007 `DomainInvoke` command adapter (`outputspool-command-port.ts`),
 * the live composition wiring (`stack-wiring.ts`), and the honest live
 * `OutputSpoolBackend` composition (`backend-live.ts`). Feature 005 supplies only
 * these typed domain query/command implementations and their audit events;
 * Feature 007 remains the sole command-registration authority (C19). The reserved
 * `output.stat|read|follow|export|share|release|delete|purge|retention.set|
 * quota.set` ids already live in `packages/core/src/operator/catalog.ts` at
 * `RESERVED_CATALOG_VERSION = 1.3.0` — no catalog bump is performed.
 */

export * as OutputSpoolOperatorPort from "./outputspool-port"
export * as OutputSpoolCommandPort from "./outputspool-command-port"
export * as OutputSpoolBackendLive from "./backend-live"
export * as OutputSpoolStackWiring from "./stack-wiring"
