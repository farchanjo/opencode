/**
 * Feature 018 / G5 — the narrow interrupt edge (FR9, FR10).
 *
 * The live `SessionRunCoordinator` (`run-coordinator.ts`) is exposed to the
 * operator runtime through the SMALLEST possible edge: a process-singleton
 * interrupt registry. The execution layer (`execution/local.ts`) registers the
 * active root run into it at run start (and deregisters on terminal), keyed by the
 * root run's `SessionRunCoordinator` interrupt key (the root session id string).
 * The operator lifecycle stack-wiring consults it for the second-press forced
 * abort — NOT a broad operator→`SessionExecution` dependency.
 *
 * This module is a plain process-scoped singleton (a module-level `Map`), shared
 * across the whole process regardless of the Effect runtime resolving it, so both
 * the core session layer (which registers) and the opencode operator layer (which
 * consults) reach the SAME instance without any layer coupling.
 *
 * Honesty (FR10): a root key absent from the registry — the run is not owned by
 * this process, or the execution layer never registered — degrades to a typed
 * `unconfirmed` disposition, never a fabricated stop and never a crash. The
 * disposition carries no prompt, transcript, spool page, secret, or config
 * fragment (Security).
 */
export * as SessionInterruptRegistry from "./interrupt-registry"

import { Effect } from "effect"

/** The second-press forced-abort disposition (schema `enums.#InterruptDisposition`). */
export type InterruptDisposition = "interrupted" | "unconfirmed"

/** The typed forced-abort result (schema `interrupt.#ForcedAbortOutcome`). */
export interface ForcedAbortOutcome {
  readonly rootKey: string
  readonly disposition: InterruptDisposition
  /** A bounded, secret-free explanation for the audit trail (never a payload). */
  readonly reason: string
}

/** The narrow interrupt handle a registered run exposes: drive the coordinator abort. */
export type InterruptHandle = () => Effect.Effect<void>

/**
 * One active root run the execution layer registered. `token` disambiguates a
 * re-registration of the same key so a stale deregister never removes a fresher
 * entry (defensive; the coordinator serializes per key so overlap is not expected).
 */
type Entry = {
  readonly token: object
  readonly interrupt: InterruptHandle
}

/** The process-singleton registry: root key → active run interrupt handle. */
const registry = new Map<string, Entry>()

/**
 * Register the active root run keyed by its coordinator interrupt key. Returns a
 * deregister function that removes the entry only if it still owns it (token
 * guard), so a terminal cleanup never evicts a newer run under the same key.
 */
export function register(rootKey: string, interrupt: InterruptHandle): () => void {
  const token = {}
  registry.set(rootKey, { token, interrupt })
  return () => {
    const current = registry.get(rootKey)
    if (current?.token === token) registry.delete(rootKey)
  }
}

/** Whether a live run is registered for the given root key (process-local). */
export function has(rootKey: string): boolean {
  return registry.has(rootKey)
}

/** The count of live registered runs (test/observability aid). */
export function size(): number {
  return registry.size
}

/** Drop every entry. Test-only reset; production never clears the whole registry. */
export function reset(): void {
  registry.clear()
}

/**
 * Drive the second-press forced abort for a root key. When a live run is
 * registered, its interrupt handle runs and the disposition is `interrupted`;
 * when no entry exists, the abort degrades to the honest `unconfirmed` disposition
 * without touching any fiber (FR10).
 */
export function interrupt(rootKey: string): Effect.Effect<ForcedAbortOutcome> {
  return Effect.suspend(() => {
    const entry = registry.get(rootKey)
    if (entry === undefined) {
      return Effect.succeed<ForcedAbortOutcome>({
        rootKey,
        disposition: "unconfirmed",
        reason: "no_active_run_registered",
      })
    }
    return entry.interrupt().pipe(
      Effect.as<ForcedAbortOutcome>({
        rootKey,
        disposition: "interrupted",
        reason: "forced_local_abort",
      }),
    )
  })
}

/**
 * Wrap a per-key run so its active execution is registered into the process
 * registry for the operator forced-abort edge, and deregistered on terminal
 * (success, failure, defect, or interruption). The execution layer
 * (`execution/local.ts`) composes its drain through this so the interrupt key it
 * exposes is exactly the coordinator key operator cancel targets.
 */
export function withRegisteredRun<A, E, R>(
  rootKey: string,
  interruptHandle: InterruptHandle,
  run: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const deregister = register(rootKey, interruptHandle)
    return run.pipe(Effect.ensuring(Effect.sync(deregister)))
  })
}
