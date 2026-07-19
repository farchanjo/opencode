/**
 * Feature 004 / T033 (S16) — live runtime composition for the langlock domain port.
 *
 * The composition-root wiring that turns the Feature 004 application seams
 * (`packages/opencode/src/langlock/**`: persistence T025, authorization T029,
 * audit T030) into the typed `langlock` operator `DomainInvoke` override the
 * Feature 007 dispatcher consumes (C3, FR31–FR35). It mirrors how Feature 003
 * jobs is wired in `operator/jobs/stack-wiring.ts`, adding NO command ids
 * (Feature 007 stays the sole registration authority; the reserved
 * `langlock.status|show|set|reset` ids already live in the catalog).
 *
 * The backend is injected because the real domain effects live behind the
 * committed Config.Service outbound seam the consolidator resolves against the
 * same `AppRuntime` services the rest of the live stack uses. This module never
 * resolves Feature 005 output content and never carries secrets/payloads/paths
 * (Security 5). The bounded, secret-free operator access-audit sink defaults to a
 * debug log; the composition root may replace it with the Feature 007 operator
 * audit projector feed. No async resolution happens here — the port and command
 * adapter are assembled synchronously over the injected backend.
 */
export * as LangLockStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { LangLockCommandPort } from "./langlock-command-port"
import type { LangLockAuditSink, LangLockBackend } from "./langlock-port"

export interface LangLockDomainWiringDeps {
  /** The un-audited domain surface the Feature 004 application adapters provide. */
  readonly backend: LangLockBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: LangLockAuditSink
}

export interface LangLockDomainWiring {
  readonly ports: LangLockCommandPort.LangLockDomainPorts
  /** The un-audited langlock backend seam (reads + validated mutation plans). */
  readonly port: LangLockBackend
  /** Symmetry with the jobs wiring; nothing background to tear down here. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a prompt/payload/path). */
const defaultAuditSink: LangLockAuditSink = {
  record: (event) => Effect.logDebug("langlock.operator.audit", event),
}

/**
 * Compose the live langlock domain port over the injected application backend.
 * Returns the `langlock` `DomainInvoke` override plus the typed port for direct
 * CLI/TUI use.
 */
export function createLangLockDomainWiring(deps: LangLockDomainWiringDeps): LangLockDomainWiring {
  const audit = deps.audit ?? defaultAuditSink
  const ports = LangLockCommandPort.createLangLockDomainPorts({ backend: deps.backend, audit })
  return {
    ports,
    port: deps.backend,
    dispose: () => {},
  }
}
