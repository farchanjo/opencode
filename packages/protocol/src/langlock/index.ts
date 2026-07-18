/**
 * Feature 004 — Lang Lock protocol barrel (T015).
 *
 * Re-exports the shared identifiers, closed enums (sourced from
 * `@opencode-ai/schema/langlock/*`), the 15-member `langlock.*` event
 * vocabulary, request/response payloads and typed error unions from ./commands,
 * and the `LangLockPolicyPort`/`DetectionPort`/`AdvisoryPort` interfaces from
 * ./ports, mirroring
 * doc/arch/sdd/004-add-lang-lock-to-enforce-a-configurable-artifact-language/contracts/ports.ts.
 */

export * from "./commands"
export type { AdvisoryPort, DetectionPort, LangLockPolicyPort } from "./ports"
