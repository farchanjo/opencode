/**
 * Feature 003 / T027 — operator jobs domain barrel (S15).
 *
 * Re-exports the typed `jobs.*` domain implementation (`jobs-port.ts`), the
 * Feature 007 `DomainInvoke` command adapter (`jobs-command-port.ts`), and the
 * live composition wiring (`stack-wiring.ts`). Feature 003 supplies only these
 * typed domain query/command implementations and their audit events; Feature
 * 007 remains the sole command-registration authority (C12).
 */

export * as JobsOperatorPort from "./jobs-port"
export * as JobsCommandPort from "./jobs-command-port"
export * as JobsStackWiring from "./stack-wiring"
