/**
 * Feature 003 / T027 (S15) — live runtime composition for the jobs domain port.
 *
 * The composition root wiring that turns the Feature 003 application backend
 * seams (`packages/opencode/src/jobs/**`: persistence T022, trigger service
 * T023, notification service T024, authorization T025) into the typed `jobs`
 * operator `DomainInvoke` override the Feature 007 dispatcher consumes (C12,
 * FR30). It mirrors how Feature 002 lifecycle is wired in
 * `operator/lifecycle/stack-wiring.ts`, adding NO command ids (Feature 007
 * stays the sole registration authority).
 *
 * The backend is injected because the real domain effects live behind the
 * committed outbound seams the consolidator resolves against the same
 * `AppRuntime` services and the single EventV2 authority the rest of the live
 * stack uses (C8). This module never resolves Feature 005 output content and
 * never carries secrets/payloads/paths (FR32, C15).
 *
 * The bounded, secret-free operator access audit sink defaults to a debug log;
 * the composition root replaces it with the Feature 007 operator audit
 * projector feed. No async resolution happens here — the port and command
 * adapter are assembled synchronously over the injected backend.
 */
export * as JobsStackWiring from "./stack-wiring"

import { Effect } from "effect"
import type { JobsPort } from "@opencode-ai/protocol/jobs/ports"
import { JobsOperatorPort } from "./jobs-port"
import { JobsCommandPort } from "./jobs-command-port"
import type { JobsAuditSink, JobsBackend } from "./jobs-port"

export interface JobsDomainWiringDeps {
  /** The un-audited domain surface the Feature 003 application adapters provide. */
  readonly backend: JobsBackend
  /** Optional operator access-audit sink; defaults to a bounded debug log. */
  readonly audit?: JobsAuditSink
}

export interface JobsDomainWiring {
  readonly ports: JobsCommandPort.JobsDomainPorts
  /** The typed `jobs.*` operator port (also usable directly by the CLI/TUI). */
  readonly port: JobsPort
  /** Symmetry with the lifecycle wiring; nothing background to tear down here. */
  readonly dispose: () => void
}

/** Bounded, secret-free operator audit sink (never a prompt/payload/path). */
const defaultAuditSink: JobsAuditSink = {
  record: (event) => Effect.logDebug("jobs.operator.audit", event),
}

/**
 * Compose the live jobs domain port over the injected application backend and
 * the single EventV2/Config authorities the backend already binds. Returns the
 * `jobs` `DomainInvoke` override plus the typed port for direct CLI/TUI use.
 */
export function createJobsDomainWiring(deps: JobsDomainWiringDeps): JobsDomainWiring {
  const audit = deps.audit ?? defaultAuditSink
  const port = JobsOperatorPort.createJobsPort({ backend: deps.backend })
  const ports = JobsCommandPort.createJobsDomainPorts({ port, audit })
  return {
    ports,
    port,
    dispose: () => {},
  }
}
