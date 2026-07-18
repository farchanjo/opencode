/**
 * Feature 005 / T037 (S24) — live `OutputSpoolBackend` composition for the
 * operator stack.
 *
 * Turns the committed Feature 005 application adapters into the un-audited
 * `OutputSpoolBackend` seam that `createOutputSpoolPort` (T037) consumes,
 * following the `createLiveJobsBackend`/`createLiveLangLockBackend` precedent. It
 * is HONEST about what the operator `AppRuntime` reaches:
 *
 *   - **Deny-by-default across projects (Privacy 3, FR44, C17).** `export` and
 *     `share` are cross-project deny-by-default: without an in-project operator
 *     grant resolved against a bound spool store they return
 *     `cross_project_denied` — never a fabricated success and never a raw path.
 *
 *   - **Honest capability gaps.** `stat`/`read`/`follow`/`release`/`delete`/
 *     `purge`/`retention.set`/`quota.set` require the live spool control store,
 *     page reader, and retention sweeper. Those are not reachable from the
 *     operator `AppRuntime` in this wave, so each returns the port's typed
 *     `unavailable`/gap rather than fabricated data (mirrors the Feature 003 jobs
 *     Residuals note and the Feature 004 fail-closed default). The composition
 *     root injects a real `override` implementation as the spool store is bound.
 *
 * Every method returns the port's typed error on failure, so a caller always sees
 * an honest capability gap and never a false success. Zero provider/model calls,
 * tokens, or cost (FR41, AC13).
 */
export * as OutputSpoolBackendLive from "./backend-live"

import { Effect } from "effect"
import type {
  AdminError,
  SpoolReaderError,
} from "@opencode-ai/protocol/outputspool/commands"
import type { OutputSpoolBackend } from "./outputspool-port"

export interface LiveOutputSpoolBackendDeps {
  /**
   * A real per-method implementation the composition root injects as the live
   * spool store is bound; any method left unset falls back to the honest gap
   * (reads) or deny-by-default (export/share). Never fabricated.
   */
  readonly override?: Partial<OutputSpoolBackend>
}

const readerUnavailable = (reason: string): SpoolReaderError => ({ type: "unavailable", reason })
const adminUnavailable = (reason: string): AdminError => ({ type: "unavailable", reason })
const CROSS_PROJECT_DENIED: AdminError = { type: "cross_project_denied" }

const NOT_BOUND = "outputspool control store is not bound to the operator runtime in this wave"

/**
 * The honest default backend: reads and non-share/export admin ops are typed
 * capability gaps; export and share are cross-project deny-by-default. Overridden
 * per method as the live spool store is bound (FR44, C17, AC13, AC15).
 */
const gapBackend: OutputSpoolBackend = {
  stat: () => Effect.fail(readerUnavailable(NOT_BOUND)),
  read: () => Effect.fail(readerUnavailable(NOT_BOUND)),
  follow: () => Effect.fail(readerUnavailable(NOT_BOUND)),
  export: () => Effect.fail(CROSS_PROJECT_DENIED),
  share: () => Effect.fail(CROSS_PROJECT_DENIED),
  release: () => Effect.fail(adminUnavailable(NOT_BOUND)),
  delete: () => Effect.fail(adminUnavailable(NOT_BOUND)),
  purge: () => Effect.fail(adminUnavailable(NOT_BOUND)),
  setRetention: () => Effect.fail(adminUnavailable(NOT_BOUND)),
  setQuota: () => Effect.fail(adminUnavailable(NOT_BOUND)),
}

/** Build the live backend: the honest default overlaid with any injected real methods. */
export const createLiveOutputSpoolBackend = (deps: LiveOutputSpoolBackendDeps = {}): OutputSpoolBackend => ({
  ...gapBackend,
  ...deps.override,
})
