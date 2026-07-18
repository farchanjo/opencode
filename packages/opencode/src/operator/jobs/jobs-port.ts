/**
 * Feature 003 / T027 (S15) — the typed `jobs.*` domain implementation backing
 * the Feature 007 operator control plane (C12, FR30–FR32).
 *
 * Feature 007 owns the command REGISTRY, authorization, CAS, idempotency, and
 * the reserved-name guard; Feature 003 supplies ONLY this typed `JobsPort`
 * domain implementation plus its audit events. This port registers NO command
 * ids and makes ZERO provider/model calls, tokens, or cost (FR31, AC14): reads
 * project the bounded, redacted `JobDefinitionSummary`/`Occurrence`/
 * `NotificationEnvelope` views the injected backend seams carry, and every
 * mutation carries an operator principal + explicit scope + version/CAS +
 * idempotency enforced by the backend, returning a Feature 007 audit-correlation
 * id. `run-now` creates a normal occurrence through admission/routing without
 * starting an LLM turn for administration (FR31, AC14); `disable`/`delete`
 * report `unconfirmed`/`unknown` rather than a false kill of mutating work
 * (C17, AC25).
 *
 * The backend seams (`JobsBackend`) are the un-audited domain surface the
 * Feature 003 application adapters (`packages/opencode/src/jobs/**`:
 * persistence T022, trigger service T023, notification service T024,
 * authorization T025) collectively provide; the composition root injects the
 * real implementations. This module never resolves Feature 005 output content
 * and never carries secrets/payloads/paths in a view (FR32, C15). The bounded,
 * secret-free operator access audit is emitted at the command-port seam, which
 * carries the Feature 007 principal for every command (`jobs-command-port.ts`).
 */
export * as JobsOperatorPort from "./jobs-port"

import { Effect } from "effect"
import type { Scope, Stream } from "effect"
import type {
  JobDefinitionSummary,
  JobsCreateInput,
  JobsDeleteInput,
  JobsDeleteOutput,
  JobsDisableInput,
  JobsDisableOutput,
  JobsEnableInput,
  JobsError,
  JobsHistoryInput,
  JobsHistoryOutput,
  JobsListInput,
  JobsListOutput,
  JobsRescheduleInput,
  JobsRunNowInput,
  JobsShowInput,
  JobsShowOutput,
  JobsStatusInput,
  JobsStatusOutput,
  JobsUpdateInput,
  JobsWatchEvent,
  JobsWatchInput,
  Occurrence,
} from "@opencode-ai/protocol/jobs/commands"
import type { JobsPort } from "@opencode-ai/protocol/jobs/ports"

// =============================================================================
// Audit sink (T027) — bounded, secret-free operator access audit
// =============================================================================

/** A bounded, secret-free operator audit event (never a prompt/payload/path). */
export interface JobsAuditEvent {
  readonly commandId: string
  readonly principalId: string
  readonly target: string
  readonly outcome: "ok" | "rejected" | "not_found" | "unauthorized" | "conflict"
}

/** Sink the composition root wires to the Feature 007 operator audit projector. */
export interface JobsAuditSink {
  readonly record: (event: JobsAuditEvent) => Effect.Effect<void>
}

// =============================================================================
// Backend seams — the un-audited domain surface (packages/opencode/src/jobs/**)
// =============================================================================

/** Disable resolves the active-occurrence outcome without a false kill (C17, AC25). */
export interface JobsDisableBackendOutput {
  readonly definition: JobDefinitionSummary
  readonly activeOccurrenceOutcome: JobsDisableOutput["activeOccurrenceOutcome"]
}

/**
 * The narrow domain seam the Feature 003 application adapters provide. Reads
 * return bounded redacted views; mutations return the settled definition (or
 * occurrence) WITHOUT the returned audit id — the operator port authors that.
 */
export interface JobsBackend {
  readonly list: (input: JobsListInput) => Effect.Effect<JobsListOutput, JobsError>
  readonly status: (input: JobsStatusInput) => Effect.Effect<JobsStatusOutput, JobsError>
  readonly show: (input: JobsShowInput) => Effect.Effect<JobsShowOutput, JobsError>
  readonly history: (input: JobsHistoryInput) => Effect.Effect<JobsHistoryOutput, JobsError>
  readonly watch: (
    input: JobsWatchInput,
  ) => Effect.Effect<Stream.Stream<JobsWatchEvent, never>, JobsError, Scope.Scope>
  readonly create: (input: JobsCreateInput) => Effect.Effect<JobDefinitionSummary, JobsError>
  readonly update: (input: JobsUpdateInput) => Effect.Effect<JobDefinitionSummary, JobsError>
  readonly enable: (input: JobsEnableInput) => Effect.Effect<JobDefinitionSummary, JobsError>
  readonly disable: (input: JobsDisableInput) => Effect.Effect<JobsDisableBackendOutput, JobsError>
  readonly delete: (input: JobsDeleteInput) => Effect.Effect<void, JobsError>
  readonly reschedule: (input: JobsRescheduleInput) => Effect.Effect<JobDefinitionSummary, JobsError>
  readonly runNow: (input: JobsRunNowInput) => Effect.Effect<Occurrence, JobsError>
}

export interface JobsPortDeps {
  readonly backend: JobsBackend
}

// =============================================================================
// Audit-correlation id
// =============================================================================

const AUDIT_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A fresh Feature 007 audit-correlation id returned by every mutation. */
function auditId(): string {
  let rand = ""
  for (let i = 0; i < 16; i++) rand += AUDIT_ID_ALPHABET[Math.floor(Math.random() * 32)]
  return `evt_jobsaudit_${rand}`
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Build the typed `JobsPort` over the injected domain backend. Reads pass
 * through the bounded redacted views; each mutation attaches a fresh audit id.
 * Zero provider/model calls (FR31, AC14).
 */
export function createJobsPort(deps: JobsPortDeps): JobsPort {
  const b = deps.backend
  return {
    list: (input) => b.list(input),
    status: (input) => b.status(input),
    show: (input) => b.show(input),
    history: (input) => b.history(input),
    watch: (input) => b.watch(input),
    create: (input) => b.create(input).pipe(Effect.map((definition) => ({ definition, auditId: auditId() }))),
    update: (input) => b.update(input).pipe(Effect.map((definition) => ({ definition, auditId: auditId() }))),
    enable: (input) => b.enable(input).pipe(Effect.map((definition) => ({ definition, auditId: auditId() }))),
    disable: (input) =>
      b.disable(input).pipe(
        Effect.map((out) => ({
          definition: out.definition,
          activeOccurrenceOutcome: out.activeOccurrenceOutcome,
          auditId: auditId(),
        })),
      ),
    delete: (input) => b.delete(input).pipe(Effect.map((): JobsDeleteOutput => ({ deleted: true, auditId: auditId() }))),
    reschedule: (input) => b.reschedule(input).pipe(Effect.map((definition) => ({ definition, auditId: auditId() }))),
    runNow: (input) => b.runNow(input).pipe(Effect.map((occurrence) => ({ occurrence, auditId: auditId() }))),
  }
}
