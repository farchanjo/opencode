/**
 * Feature 013 / T008 — live runtime composition for the pools domain port.
 *
 * The composition-root wiring that turns the reused routing Config.Service authority
 * into the typed `pools` operator `DomainInvoke` override the Feature 007 dispatcher
 * consumes (FR5, FR9). It mirrors `operator/langlock/stack-wiring.ts`, adding NO
 * command ids (Feature 007 stays the sole registration authority; the reserved
 * `pools.status|show|set|reset|validate` ids already live in the catalog).
 *
 * The backend is injected because the real domain effects live behind the committed
 * `store.config` seam the rest of the live stack resolves against the same
 * `AppRuntime` services. This module never carries secrets/payloads/paths. The
 * bounded, secret-free operator access-audit sink defaults to a debug log; the
 * composition root may replace it with the Feature 007 operator audit projector
 * feed. No async resolution happens here — the port and command adapter are
 * assembled synchronously over the injected backend.
 */
export * as PoolsStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { PoolsCommandPort } from "./pools-command-port"
import type { PoolsAuditSink, PoolsBackend } from "./pools-port"

export interface PoolsDomainWiringDeps {
  /** The un-audited domain surface over the routing config (`createLivePoolsBackend`). */
  readonly backend: PoolsBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: PoolsAuditSink
}

export interface PoolsDomainWiring {
  readonly ports: PoolsCommandPort.PoolsDomainPorts
  /** The un-audited pools backend seam (read + validated mutation plans). */
  readonly port: PoolsBackend
  /** Symmetry with the langlock wiring; nothing background to tear down here. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a role-pool model id or payload). */
const defaultAuditSink: PoolsAuditSink = {
  record: (event) => Effect.logDebug("pools.operator.audit", event),
}

/**
 * Compose the live pools domain port over the injected routing-config backend.
 * Returns the `pools` `DomainInvoke` override plus the typed port for direct
 * CLI/TUI use.
 */
export function createPoolsDomainWiring(deps: PoolsDomainWiringDeps): PoolsDomainWiring {
  const audit = deps.audit ?? defaultAuditSink
  const ports = PoolsCommandPort.createPoolsDomainPorts({ backend: deps.backend, audit })
  return {
    ports,
    port: deps.backend,
    dispose: () => {},
  }
}
