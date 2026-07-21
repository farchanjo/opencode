/**
 * Feature 046 — live runtime composition for the hierarchy/capability domain
 * ports over the shared enforcement-leaf backend. Mirrors `budget/stack-wiring.ts`
 * and adds NO command ids (Feature 007 stays the sole registration authority; the
 * reserved `hierarchy.*`/`capability.*` ids live in the catalog).
 */
export * as EnforcementStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { EnforcementCommandPort, type EnforcementAuditSink } from "./leaf-command-port"
import type { EnforcementLeafBackendApi } from "./leaf-backend"

export interface EnforcementDomainWiringDeps {
  readonly backend: EnforcementLeafBackendApi
  readonly audit?: EnforcementAuditSink
}

export interface EnforcementDomainWiring {
  readonly ports: EnforcementCommandPort.EnforcementDomainPorts
  readonly port: EnforcementLeafBackendApi
  readonly dispose: () => void
}

const defaultAuditSink: EnforcementAuditSink = {
  record: (event) => Effect.logDebug("enforcement.operator.audit", event),
}

export function createEnforcementDomainWiring(deps: EnforcementDomainWiringDeps): EnforcementDomainWiring {
  const audit = deps.audit ?? defaultAuditSink
  const ports = EnforcementCommandPort.createEnforcementDomainPorts({ backend: deps.backend, audit })
  return { ports, port: deps.backend, dispose: () => {} }
}
