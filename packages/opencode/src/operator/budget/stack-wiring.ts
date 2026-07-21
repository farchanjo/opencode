/**
 * Feature 013 / T007 — live runtime composition for the budget domain port.
 *
 * The composition-root wiring that turns the reused Feature 001 `RoutingConfigPort`
 * (over `store.config`) into the typed `budget` operator `DomainInvoke` override the
 * Feature 007 dispatcher consumes, mirroring `operator/langlock/stack-wiring.ts` and
 * adding NO command ids (Feature 007 stays the sole registration authority; the
 * reserved `budget.status|show|set|reset|validate` ids already live in the catalog).
 *
 * The backend is injected because the real config effects live behind the committed
 * Config.Service outbound seam. The bounded, secret-free operator access-audit sink
 * defaults to a debug log; the composition root may replace it with the Feature 007
 * operator audit projector feed. No async resolution happens here — the port and
 * command adapter are assembled synchronously over the injected backend.
 */
export * as BudgetStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { BudgetCommandPort } from "./budget-command-port"
import type { EnforcementLeafBackendApi } from "../enforcement/leaf-backend"
import type { BudgetAuditSink, BudgetBackend } from "./budget-port"

export interface BudgetDomainWiringDeps {
  /** The un-audited domain surface the live composition provides over `store.config`. */
  readonly backend: BudgetBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: BudgetAuditSink
  /** Feature 046 — shared enforcement backend enabling budget.configure + leaf-enriched budget.show. */
  readonly enforcement?: EnforcementLeafBackendApi
}

export interface BudgetDomainWiring {
  readonly ports: BudgetCommandPort.BudgetDomainPorts
  /** The un-audited budget backend seam (reads + validated mutation plans). */
  readonly port: BudgetBackend
  /** Symmetry with the langlock wiring; nothing background to tear down here. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a config payload/secret). */
const defaultAuditSink: BudgetAuditSink = {
  record: (event) => Effect.logDebug("budget.operator.audit", event),
}

/**
 * Compose the live budget domain port over the injected config backend. Returns the
 * `budget` `DomainInvoke` override plus the typed port for direct CLI/TUI use.
 */
export function createBudgetDomainWiring(deps: BudgetDomainWiringDeps): BudgetDomainWiring {
  const audit = deps.audit ?? defaultAuditSink
  const ports = BudgetCommandPort.createBudgetDomainPorts({ backend: deps.backend, audit, enforcement: deps.enforcement })
  return {
    ports,
    port: deps.backend,
    dispose: () => {},
  }
}
