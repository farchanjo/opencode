/**
 * Feature 013 / T007 — operator budget domain barrel.
 *
 * Re-exports the typed `budget.*` domain implementation (`budget-port.ts`), the
 * Feature 007 `DomainInvoke` command adapter (`budget-command-port.ts`), the live
 * composition wiring (`stack-wiring.ts`), and the live `BudgetBackend` composition
 * over the reused routing Config.Service authority (`backend-live.ts`). Feature 013
 * supplies only these typed domain query/command implementations and their audit
 * events; Feature 007 remains the sole command-registration authority. The reserved
 * `budget.status|show|set|reset|validate` ids already live in
 * `packages/core/src/operator/catalog.ts` at `RESERVED_CATALOG_VERSION` — no catalog
 * bump is performed.
 */

export * as BudgetOperatorPort from "./budget-port"
export * as BudgetCommandPort from "./budget-command-port"
export * as BudgetBackendLive from "./backend-live"
export * as BudgetStackWiring from "./stack-wiring"
