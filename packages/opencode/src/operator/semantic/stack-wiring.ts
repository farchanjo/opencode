/**
 * Feature 006 / T034 (S22) — live runtime composition for the semantic domain
 * port.
 *
 * The composition-root wiring that turns the Feature 006 application seams into
 * the typed `semantic` operator `DomainInvoke` override the Feature 007
 * dispatcher consumes (C15). It mirrors how Feature 004 langlock and Feature 005
 * outputspool are wired, adding NO command ids (Feature 007 stays the sole
 * registration authority; the reserved 30 `semantic.*` ids already live in the
 * catalog at `RESERVED_CATALOG_VERSION = 1.3.0`).
 *
 * The backend is injected because the real domain effects live behind the Milvus
 * adapter / provider clients the composition root resolves against the same
 * `AppRuntime`. This module never returns a secret, a raw endpoint, or a path
 * (C19, C22). The bounded, secret-free operator access-audit sink defaults to a
 * debug log; the composition root may replace it with the Feature 007 operator
 * audit projector feed. No async resolution happens here.
 */
export * as SemanticStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { SemanticOperatorPort } from "./semantic-port"
import { SemanticCommandPort } from "./semantic-command-port"
import type { SemanticAuditSink, SemanticBackend, SemanticPort } from "./semantic-port"

export interface SemanticDomainWiringDeps {
  /** The un-audited domain surface the Feature 006 application adapters provide. */
  readonly backend: SemanticBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: SemanticAuditSink
}

export interface SemanticDomainWiring {
  readonly ports: SemanticCommandPort.SemanticDomainPorts
  /** The typed `semantic.*` operator port (also usable directly by the CLI/TUI). */
  readonly port: SemanticPort
  /** Symmetry with the langlock/outputspool wiring; nothing background to tear down. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a query/secret/endpoint/path). */
const defaultAuditSink: SemanticAuditSink = {
  record: (event) => Effect.logDebug("semantic.operator.audit", event),
}

/**
 * Compose the live semantic domain port over the injected application backend.
 * Returns the `semantic` `DomainInvoke` override plus the typed port for direct
 * CLI/TUI use.
 */
export const createSemanticDomainWiring = (deps: SemanticDomainWiringDeps): SemanticDomainWiring => {
  const audit = deps.audit ?? defaultAuditSink
  const port = SemanticOperatorPort.createSemanticPort({ backend: deps.backend })
  const ports = SemanticCommandPort.createSemanticDomainPorts({ port, audit })
  return { ports, port, dispose: () => {} }
}
