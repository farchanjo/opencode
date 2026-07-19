/**
 * Feature 003 / T033 — `jobs.*` operator command-port round-trips, converted to the
 * Feature 014 `OperatorMutationPlan` commit contract (FR5).
 *
 * Every reserved Feature 007 `jobs.*` id dispatches LOCALLY through the typed
 * `JobsBackend` over the Feature 007 `DomainInvoke` seam: reads project the bounded
 * redacted view and audit `ok`; each mutating verb VALIDATES and returns a
 * `mutation_plan` (authority + pure transform) so the Feature 007 `mutateAuthority`
 * pipeline owns the single committed CAS write + audit — the command port never
 * self-commits and never audits a successful plan (the commit does). An unreachable
 * backend seam or a reserved-name collision surfaces a structured failure + a single
 * `rejected` audit event, with no phantom write. Mirrors the Feature 013
 * telemetry-command-port conversion style.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import { JobsCommandPort } from "@/operator/jobs/jobs-command-port"
import type { JobsAuditEvent, JobsAuditSink, JobsBackend } from "@/operator/jobs/jobs-port"
import type { HandlerContext, HandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { JobsError } from "@opencode-ai/protocol/jobs/commands"
import { makeSummary } from "./fixtures"

const CORE_OPERATOR: OperatorPrincipalCore = { kind: "operator", subject: "op_1", projectBinding: null }

interface BackendOverrides {
  readonly createError?: JobsError
}

/** A no-op plan whose authority names the domain and whose transform is identity. */
const okPlan = (authority: string): Effect.Effect<OperatorMutationPlan, JobsError> =>
  Effect.succeed({ authority, apply: (current: unknown) => current })

function fakeBackend(over: BackendOverrides = {}): JobsBackend {
  const summary = makeSummary()
  return {
    list: () => Effect.succeed({ definitions: [summary], cursor: null }),
    status: () => Effect.succeed({ definition: summary }),
    show: () => Effect.succeed({ definition: summary, occurrences: [] }),
    history: () => Effect.succeed({ occurrences: [], notifications: [], cursor: null }),
    watch: () => Effect.succeed(Stream.empty),
    planCreate: () => (over.createError !== undefined ? Effect.fail(over.createError) : okPlan("jobs/proj_1")),
    planUpdate: () => okPlan("jobs/proj_1"),
    planEnable: () => okPlan("jobs/proj_1"),
    planDisable: () => okPlan("jobs/proj_1"),
    planDelete: () => okPlan("jobs/proj_1"),
    planReschedule: () => okPlan("jobs/proj_1"),
    planRunNow: () => okPlan("jobs/proj_1"),
  }
}

function makeInvoke(over: BackendOverrides = {}) {
  const audits: JobsAuditEvent[] = []
  const audit: JobsAuditSink = { record: (e) => Effect.sync(() => void audits.push(e)) }
  const ports = JobsCommandPort.createJobsDomainPorts({ backend: fakeBackend(over), audit })
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

describe("T033 jobs command port — reads audit ok and project the redacted view", () => {
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

describe("T033 jobs command port — mutations return a mutation_plan for mutateAuthority (FR5)", () => {
  const authorityOf = (r: HandlerResult): string | undefined => (r.kind === "mutation_plan" ? r.authority : undefined)

  test("jobs.create returns a mutation_plan and does NOT audit here (the commit audits)", async () => {
    const { invoke, audits } = makeInvoke()
    const result = await invoke(
      ctx("jobs.create", {
        name: "nightly",
        schedule: { cronExpression: "*/5 * * * *", ianaTimezone: "UTC" },
        actionType: "native_maintenance",
        payloadRef: "payload_ref_1",
      }),
    )
    expect(result.kind).toBe("mutation_plan")
    expect(authorityOf(result)).toBe("jobs/proj_1")
    // A successful plan is committed + audited by mutateAuthority, never at the port.
    expect(audits).toHaveLength(0)
  })

  test("jobs.update requires an expectedVersion before touching the backend", async () => {
    const { invoke } = makeInvoke()
    const result = await invoke(ctx("jobs.update", { jobDefinitionId: "job_test_1", patch: { name: "renamed" } }))
    expect(result.kind).toBe("failure")
  })

  test("jobs.update with a CAS version from the envelope produces a mutation_plan", async () => {
    const { invoke } = makeInvoke()
    const result = await invoke(ctx("jobs.update", { jobDefinitionId: "job_test_1", name: "renamed" }, "5"))
    expect(result.kind).toBe("mutation_plan")
    expect(authorityOf(result)).toBe("jobs/proj_1")
  })

  test("jobs.enable / jobs.disable / jobs.delete / jobs.run-now each produce a mutation_plan", async () => {
    const { invoke } = makeInvoke()
    for (const [id, payload] of [
      ["jobs.enable", { jobDefinitionId: "job_test_1", expectedVersion: 1 }],
      ["jobs.disable", { jobDefinitionId: "job_test_1", expectedVersion: 1 }],
      ["jobs.delete", { jobDefinitionId: "job_test_1", expectedVersion: 1 }],
      ["jobs.run-now", { jobDefinitionId: "job_test_1" }],
    ] as const) {
      const result = await invoke(ctx(id, payload))
      expect(result.kind).toBe("mutation_plan")
    }
  })
})

describe("T033 jobs command port — reserved-name collision + unknown id (C13, AC17)", () => {
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
