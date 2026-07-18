/**
 * Feature 002 / T031 — operator lifecycle domain barrel (S13).
 *
 * Re-exports the typed `process.*`/`task.*` domain implementations
 * (`process-port.ts`) and the Feature 007 `DomainInvoke` command adapter
 * (`lifecycle-command-port.ts`). Feature 002 supplies only these typed domain
 * query/command implementations and their audit events; Feature 007 remains the
 * sole command-registration authority (C19).
 */

export * as LifecycleProcessPort from "./process-port"
export * as LifecycleCommandPort from "./lifecycle-command-port"
