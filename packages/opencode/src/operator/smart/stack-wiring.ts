/**
 * Feature 013 / T006 — live runtime composition for the smart domain port.
 *
 * The composition-root wiring that turns the reused routing Config.Service
 * authority into the typed `smart` operator `DomainInvoke` override the Feature
 * 007 dispatcher consumes (FR3, FR9). It mirrors how Feature 004 langlock is wired
 * in `operator/langlock/stack-wiring.ts`, adding NO command ids (Feature 007 stays
 * the sole registration authority; the reserved `smart.status|on|off|auto` ids
 * already live in the catalog).
 *
 * The backend is injected because the real domain effects live behind the
 * committed Config.Service outbound seam the rest of the live stack uses. This
 * module never re-authors the routing schema and never carries secrets/payloads/
 * paths (FR8). The bounded, secret-free operator access-audit sink defaults to a
 * debug log; the composition root may replace it with the Feature 007 operator
 * audit projector feed. No async resolution happens here — the port and command
 * adapter are assembled synchronously over the injected backend.
 */
export * as SmartStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { SmartCommandPort } from "./smart-command-port"
import type { SmartAuditSink, SmartBackend } from "./smart-port"

export interface SmartDomainWiringDeps {
  /** The un-audited domain surface the live routing-config composition provides. */
  readonly backend: SmartBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: SmartAuditSink
}

export interface SmartDomainWiring {
  readonly ports: SmartCommandPort.SmartDomainPorts
  /** The un-audited smart backend seam (read + validated mutation plans). */
  readonly port: SmartBackend
  /** Symmetry with the langlock wiring; nothing background to tear down here. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a config payload/secret). */
const defaultAuditSink: SmartAuditSink = {
  record: (event) => Effect.logDebug("smart.operator.audit", event),
}

/**
 * Compose the live smart domain port over the injected routing-config backend.
 * Returns the `smart` `DomainInvoke` override plus the typed port for direct
 * CLI/TUI use.
 */
export function createSmartDomainWiring(deps: SmartDomainWiringDeps): SmartDomainWiring {
  const audit = deps.audit ?? defaultAuditSink
  const ports = SmartCommandPort.createSmartDomainPorts({ backend: deps.backend, audit })
  return {
    ports,
    port: deps.backend,
    dispose: () => {},
  }
}
