/**
 * Feature 013 — Budget protocol barrel (T003).
 *
 * Re-exports the shared identifiers, closed enums, the `budget.*` verb surface,
 * request/response payloads and the typed `BudgetError` union from ./commands,
 * and the `BudgetPort` interface from ./ports, mirroring
 * doc/arch/schemas/operator-config-domains/{budget,enums,shared,persistence}.cue.
 */

export * from "./commands"
export type { BudgetPort } from "./ports"
