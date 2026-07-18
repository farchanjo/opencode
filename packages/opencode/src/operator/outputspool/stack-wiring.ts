/**
 * Feature 005 / T037 (S24) — live runtime composition for the outputspool domain
 * port.
 *
 * The composition-root wiring that turns the Feature 005 application seams
 * (`packages/opencode/src/outputspool/**`: control store, page reader, retention
 * sweeper, authorization) into the typed `output` operator `DomainInvoke`
 * override the Feature 007 dispatcher consumes (C19, FR41-FR44). It mirrors how
 * Feature 003 jobs and Feature 004 langlock are wired, adding NO command ids
 * (Feature 007 stays the sole registration authority; the reserved
 * `output.stat|read|follow|export|share|release|delete|purge|retention.set|
 * quota.set` ids already live in the catalog at `RESERVED_CATALOG_VERSION =
 * 1.3.0`).
 *
 * The backend is injected because the real domain effects live behind the spool
 * control store / page reader the composition root resolves against the same
 * `AppRuntime`. This module never returns a filesystem path and never carries
 * content or secrets (FR12, C18, C22). The bounded, secret-free operator
 * access-audit sink defaults to a debug log; the composition root may replace it
 * with the Feature 007 operator audit projector feed. No async resolution happens
 * here — the port and command adapter are assembled synchronously.
 */
export * as OutputSpoolStackWiring from "./stack-wiring"

import { Effect } from "effect"
import { OutputSpoolOperatorPort } from "./outputspool-port"
import { OutputSpoolCommandPort } from "./outputspool-command-port"
import type { OutputSpoolAuditSink, OutputSpoolBackend, OutputSpoolPort } from "./outputspool-port"

export interface OutputSpoolDomainWiringDeps {
  /** The un-audited domain surface the Feature 005 application adapters provide. */
  readonly backend: OutputSpoolBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: OutputSpoolAuditSink
}

export interface OutputSpoolDomainWiring {
  readonly ports: OutputSpoolCommandPort.OutputSpoolDomainPorts
  /** The typed `output.*` operator port (also usable directly by the CLI/TUI). */
  readonly port: OutputSpoolPort
  /** Symmetry with the jobs/langlock wiring; nothing background to tear down here. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a prompt/payload/path). */
const defaultAuditSink: OutputSpoolAuditSink = {
  record: (event) => Effect.logDebug("output.operator.audit", event),
}

/**
 * Compose the live outputspool domain port over the injected application backend.
 * Returns the `output` `DomainInvoke` override plus the typed port for direct
 * CLI/TUI use.
 */
export const createOutputSpoolDomainWiring = (deps: OutputSpoolDomainWiringDeps): OutputSpoolDomainWiring => {
  const audit = deps.audit ?? defaultAuditSink
  const port = OutputSpoolOperatorPort.createOutputSpoolPort({ backend: deps.backend })
  const ports = OutputSpoolCommandPort.createOutputSpoolDomainPorts({ port, audit })
  return {
    ports,
    port,
    dispose: () => {},
  }
}
