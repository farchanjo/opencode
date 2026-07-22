/**
 * Feature 004 / T032 (S11–S14) — Lang Lock application/enforcement barrel.
 *
 * Re-exports every `packages/opencode/src/langlock/*` application seam under its
 * own namespace, one line per module, mirroring `packages/opencode/src/jobs/
 * index.ts`. This file defines no logic of its own.
 *
 * The seams are: Config.Service policy persistence (`persistence.ts`, T025), the
 * immutable system-prompt injection + post-transform reapply
 * (`injection-service.ts`, T026), the execution-envelope stamper
 * (`envelope-stamper.ts`, T027), the post-write advisory validator
 * (`advisory-validator.ts`, T028), the `langlock.override` authorization gate
 * (`authorization.ts`, T029), the content-free EventV2 audit/advisory projector
 * (`audit.ts`, T030), and the Feature 005 provenance seam (`provenance.ts`,
 * T031). The Feature 007 `langlock.*` operator domain implementations live under
 * `packages/opencode/src/operator/langlock/**` (T033), wired via `stack-live.ts`.
 */

export * as LangLockPersistence from "./persistence"
export * as LangLockSessionEffective from "./session-effective"
export * as LangLockInjection from "./injection-service"
export * as LangLockEnvelopeStamper from "./envelope-stamper"
export * as LangLockAdvisoryValidator from "./advisory-validator"
export * as LangLockAuthorization from "./authorization"
export * as LangLockAudit from "./audit"
export * as LangLockProvenance from "./provenance"
