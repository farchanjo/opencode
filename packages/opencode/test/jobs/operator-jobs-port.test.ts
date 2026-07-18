/**
 * Feature 003 / T033 — `jobs.*` operator command-port round-trips (AC14, AC17).
 *
 * Every reserved Feature 007 `jobs.*` id dispatches LOCALLY through the typed
 * `JobsPort` (T027) over the Feature 007 `DomainInvoke` seam: reads project the
 * bounded redacted view, mutations carry operator principal + CAS + audit,
 * `run-now` yields a normal occurrence with zero model calls (AC14),
 * `disable`/`delete` never report a false kill (C17, AC25), and a reserved-name
 * collision surfaces a structured failure (C13, AC17). One bounded audit event
 * per dispatch. Mirrors `test/lifecycle/operator-process-port.test.ts` style.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import { JobsOperatorPort } from "@/operator/jobs/jobs-port"
import { JobsCommandPort } from "@/operator/jobs/jobs-command-port"
import type { JobsAuditEvent, JobsAuditSink, JobsBackend, JobsDisableBackendOutput } from "@/operator/jobs/jobs-port"
import type { HandlerContext, HandlerResult } from "@/operator/application/handler"
import type { JobDefinitionSummary, JobsError, Occurrence } from "@opencode-ai/protocol/jobs/commands"
import { makeOccurrence, makeSummary } from "./fixtures"

const CORE_OPERATOR: OperatorPrincipalCore = { kind: "operator", subject: "op_1", projectBinding: null }

interface BackendOverrides {
  readonly createError?: JobsError
  readonly disableOutcome?: JobsDisableBackendOutput["activeOccurrenceOutcome"]
  readonly runNow?: Occurrence
}

function fakeBackend(over: BackendOverrides = {}): JobsBackend {
  const summary = makeSummary()
  const okDef = (d: JobDefinitionSummary = summary) => Effect.succeed(d)
  return {
    list: () => Effect.succeed({ definitions: [summary], cursor: null }),
    status: () => Effect.succeed({ definition: summary }),
    show: () => Effect.succeed({ definition: summary, occurrences: [] }),
    history: () => Effect.succeed({ occurrences: [], notifications: [], cursor: null }),
    watch: () => Effect.succeed(Stream.empty),
    create: () => (over.createError !== undefined ? Effect.fail(over.createError) : okDef()),
    update: () => okDef(makeSummary({ version: 2 })),
    enable: () => okDef(makeSummary({ enabled: true })),
    disable: () =>
      Effect.succeed({
        definition: makeSummary({ enabled: false }),
        activeOccurrenceOutcome: over.disableOutcome ?? "none_active",
      }),
    delete: () => Effect.void,
    reschedule: () => okDef(),
    runNow: () => Effect.succeed(over.runNow ?? makeOccurrence({ state: "due" })),
  }
}

function makeInvoke(over: BackendOverrides = {}) {
  const audits: JobsAuditEvent[] = []
  const audit: JobsAuditSink = { record: (e) => Effect.sync(() => void audits.push(e)) }
  const port = JobsOperatorPort.createJobsPort({ backend: fakeBackend(over) })
  const ports = JobsCommandPort.createJobsDomainPorts({ port, audit })
  return { invoke: ports.jobs.invoke, audits }
}

function ctx(id: string, payload: Record<string, unknown> = {}, version?: string): HandlerContext {
  return {
    request: {
      principal: CORE_OPERATOR,
      payload,
      scope: { kind: "project", ref: "proj_1" },
      version,
    } as unknown as HandlerContext["request"],
    descriptor: { id, domain: "jobs" } as unknown as HandlerContext["descriptor"],
  }
}

const effective = (r: HandlerResult): unknown => (r.kind === "query" ? r.effective : undefined)

describe("T033 jobs command port — reads", () => {
  test("jobs.list projects the redacted definition view and audits ok", async () => {
    const { invoke, audits } = makeInvoke()
    const result = await invoke(ctx("jobs.list", { scope: "project", scopeId: "proj_1", limit: 50 }))
    expect(result.kind).toBe("query")
    expect((effective(result) as { definitions: unknown[] }).definitions).toHaveLength(1)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ commandId: "jobs.list", outcome: "ok" })
  })

  test("jobs.status without a jobDefinitionId is a local invalid_argument (no backend call)", async () => {
    const { invoke } = makeInvoke()
    const result = await invoke(ctx("jobs.status", {}))
    expect(result.kind).toBe("failure")
  })

  test("jobs.show returns the definition plus occurrence history frame", async () => {
    const { invoke } = makeInvoke()
    const result = await invoke(ctx("jobs.show", { jobDefinitionId: "job_test_1", occurrenceLimit: 10 }))
    expect(result.kind).toBe("query")
    expect((effective(result) as { definition: unknown }).definition).toBeDefined()
  })
})

describe("T033 jobs command port — mutations carry CAS + audit", () => {
  test("jobs.create returns the settled definition with a Feature 007 audit id", async () => {
    const { invoke, audits } = makeInvoke()
    const result = await invoke(
      ctx("jobs.create", {
        name: "nightly",
        schedule: { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
        actionType: "native_maintenance",
        payloadRef: "payload_ref_1",
      }),
    )
    expect(result.kind).toBe("query")
    expect((effective(result) as { auditId: string }).auditId).toContain("evt_jobsaudit_")
    expect(audits[0]).toMatchObject({ commandId: "jobs.create", outcome: "ok" })
  })

  test("jobs.update requires an expectedVersion before touching the backend", async () => {
    const { invoke } = makeInvoke()
    const result = await invoke(ctx("jobs.update", { jobDefinitionId: "job_test_1", patch: { name: "renamed" } }))
    expect(result.kind).toBe("failure")
  })

  test("jobs.update with a CAS version from the envelope succeeds", async () => {
    const { invoke } = makeInvoke()
    const result = await invoke(ctx("jobs.update", { jobDefinitionId: "job_test_1", name: "renamed" }, "5"))
    expect(result.kind).toBe("query")
    expect((effective(result) as { definition: { version: number } }).definition.version).toBe(2)
  })

  test("jobs.enable audits and returns an audit id", async () => {
    const { invoke, audits } = makeInvoke()
    const result = await invoke(ctx("jobs.enable", { jobDefinitionId: "job_test_1", expectedVersion: 1 }))
    expect(result.kind).toBe("query")
    expect(audits[0]).toMatchObject({ commandId: "jobs.enable", outcome: "ok" })
  })
})

describe("T033 jobs command port — no false kill on disable/delete (C17, AC25)", () => {
  test("jobs.disable reports unconfirmed rather than a false kill of mutating work", async () => {
    const { invoke } = makeInvoke({ disableOutcome: "unconfirmed" })
    const result = await invoke(ctx("jobs.disable", { jobDefinitionId: "job_test_1", expectedVersion: 1 }))
    expect(result.kind).toBe("query")
    expect((effective(result) as { activeOccurrenceOutcome: string }).activeOccurrenceOutcome).toBe("unconfirmed")
  })

  test("jobs.delete returns deleted with an audit id", async () => {
    const { invoke, audits } = makeInvoke()
    const result = await invoke(ctx("jobs.delete", { jobDefinitionId: "job_test_1", expectedVersion: 1 }))
    expect(result.kind).toBe("query")
    expect((effective(result) as { deleted: boolean }).deleted).toBe(true)
    expect(audits[0]).toMatchObject({ commandId: "jobs.delete", outcome: "ok" })
  })
})

describe("T033 jobs command port — run-now is a normal occurrence, zero model (AC14)", () => {
  test("jobs.run-now creates an occurrence through the port without an LLM turn", async () => {
    const { invoke, audits } = makeInvoke({ runNow: makeOccurrence({ occurrenceId: "occ_now", state: "due" }) })
    const result = await invoke(ctx("jobs.run-now", { jobDefinitionId: "job_test_1" }))
    expect(result.kind).toBe("query")
    const out = effective(result) as { occurrence: Occurrence; auditId: string }
    expect(out.occurrence.occurrenceId).toBe("occ_now")
    expect(out.occurrence.state).toBe("due")
    expect(audits[0]).toMatchObject({ commandId: "jobs.run-now", outcome: "ok" })
  })
})

describe("T033 jobs command port — reserved-name collision (C13, AC17)", () => {
  test("a reserved_name backend rejection surfaces a structured failure and audits rejected", async () => {
    const { invoke, audits } = makeInvoke({ createError: { type: "reserved_name", id: "jobs.create" } })
    const result = await invoke(
      ctx("jobs.create", {
        name: "collides",
        schedule: { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
        actionType: "native_maintenance",
        payloadRef: "payload_ref_1",
      }),
    )
    expect(result.kind).toBe("failure")
    expect(audits[0]).toMatchObject({ commandId: "jobs.create", outcome: "rejected" })
  })

  test("an unimplemented jobs command id is a clean not_implemented failure", async () => {
    const { invoke } = makeInvoke()
    const result = await invoke(ctx("jobs.unknown", { jobDefinitionId: "job_test_1" }))
    expect(result.kind).toBe("failure")
  })
})
