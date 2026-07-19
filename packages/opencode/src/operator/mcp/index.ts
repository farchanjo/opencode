/**
 * Feature 008 / T034 — operator mcp domain barrel (S22).
 *
 * Re-exports the typed `mcp.*` domain implementation (`mcp-port.ts`), the Feature
 * 007 `DomainInvoke` command adapter (`mcp-command-port.ts`), the live composition
 * wiring (`stack-wiring.ts`), and the honest live `McpAdminBackend` composition
 * (`backend-live.ts`). Feature 008 supplies only these typed domain query/command
 * implementations and their audit events; Feature 007 remains the sole
 * command-registration authority (C25). The reserved 30 `mcp.*` ids already live in
 * `packages/core/src/operator/catalog.ts` at `RESERVED_CATALOG_VERSION = 1.3.0` —
 * no catalog bump is performed.
 */

export * as McpOperatorPort from "./mcp-port"
export * as McpCommandPort from "./mcp-command-port"
export * as McpBackendLive from "./backend-live"
export * as McpStackWiring from "./stack-wiring"
