/**
 * Feature 002 / T031 — the `process.*`/`task.*` operator domain implementations
 * (C19, FR49–FR51). Each command emits one bounded audit event, makes zero model
 * calls, returns the redacted operator view, and adds no output to any
 * Message/Part/context. The command adapter maps reserved ids to the port
 * through the Feature 007 `DomainInvoke` seam. In-process fixtures over the real
 * core Process Table.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { createProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import type { ObservationPort } from "@opencode-ai/protocol/lifecycle/ports"
import type { LifecycleEmitInput, LifecycleEmitOutput } from "@opencode-ai/protocol/lifecycle/commands"
import { createEventV2Adapter } from "@/lifecycle/eventv2-adapter"
import type { Cancel } from "@/lifecycle/cancel"
import type { Handoff } from "@/lifecycle/handoff"
import {
  createLifecycleProcessPort,
  type LifecycleAuditEvent,
  type LifecycleAuditSink,
  type LifecycleProcessPortDeps,
  type LifecycleSteerEmitter,
} from "@/operator/lifecycle/process-port"
import { createLifecycleDomainPorts } from "@/operator/lifecycle/lifecycle-command-port"
import type { HandlerContext } from "@/operator/application/handler"
import { emitEnvelope, fakeBridge } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

const OPERATOR = { kind: "operator", id: "op_1" } as const

async function seedTable(rows: ReadonlyArray<{ sessionId: string; processId: string; parentProcessId?: string; taskId?: string }>) {
  const table = createProcessTable()
  const { bridge } = fakeBridge()
  let n = 0
  const adapter = createEventV2Adapter({ bridge, table, newEventId: () => `evt_${n++}` })
  for (const r of rows) {
    await run(
      adapter.emit({
        envelope: emitEnvelope({ eventType: "lifecycle.process_created", sessionId: r.sessionId, processId: r.processId }),
        eventType: "lifecycle.process_created",
        data: {},
      }),
    )
  }
  return table
}

function fakes() {
  const audits: LifecycleAuditEvent[] = []
  const audit: LifecycleAuditSink = { record: (e) => Effect.sync(() => void audits.push(e)) }

  const steerCalls: LifecycleEmitInput[] = []
  const steer: LifecycleSteerEmitter = {
    emit: (input) => {
      steerCalls.push(input)
      return Effect.succeed({ eventId: "evt_steer", durable: null } as unknown as LifecycleEmitOutput)
    },
  }

  const cancelCalls: Cancel.RootCancelInput[] = []
  const cancel: Cancel.CancelService = {
    requestRootCancel: (input) => {
      cancelCalls.push(input)
      return Effect.succeed({ outcome: "requested", escalated: false, requestedCount: input.targets.length, auditReason: "x" })
    },
  }

  const handoffCalls: Handoff.HandoffCommand[] = []
  const handoff: Handoff.HandoffCoordinator = {
    handoff: (command) => {
      handoffCalls.push(command)
      return Effect.succeed({ eventId: "evt_handoff", durable: { aggregateID: "proc_root", seq: 2, version: 1 } } as unknown as LifecycleEmitOutput)
    },
  }

  const observation: ObservationPort = {
    observeSession: () => Effect.succeed(Stream.empty),
    observeProcess: () => Effect.succeed(Stream.empty),
    observeTree: () => Effect.succeed(Stream.empty),
    observeGlobal: () => Effect.succeed(Stream.empty),
  }

  return { audits, audit, steerCalls, steer, cancelCalls, cancel, handoffCalls, handoff, observation }
}

function makePort(table: ReturnType<typeof createProcessTable>, f = fakes()) {
  const deps: LifecycleProcessPortDeps = {
    rows: {
      get: (id) => table.get(id),
      rootProcesses: (id) => table.rootProcesses(id),
      sessionProcesses: (id) => table.sessionProcesses(id),
    },
    observation: f.observation,
    cancel: f.cancel,
    handoff: f.handoff,
    steer: f.steer,
    audit: f.audit,
    resolveCancelTargets: () => ({ rootKey: "root_key", targets: [{ envelope: emitEnvelope({ eventType: "lifecycle.cancel_requested" }), visible: true }] }),
    buildSteerEnvelope: () => emitEnvelope({ eventType: "lifecycle.steer_requested" }),
  }
  return { port: createLifecycleProcessPort(deps), f }
}

describe("T031 process port — reads", () => {
  test("process.status returns the bounded redacted view and emits an audit event", async () => {
    const table = await seedTable([{ sessionId: "ses_1", processId: "proc_1" }])
    const { port, f } = makePort(table)
    const out = await run(port.status({ processId: "proc_1" as never, principal: OPERATOR }))
    expect(out.view.processId as string).toBe("proc_1")
    expect(out.view.state).toBe("created")
    // Redacted view carries no prompts/results/paths/secrets by construction.
    expect(Object.keys(out.view)).not.toContain("prompt")
    expect(f.audits).toHaveLength(1)
    expect(f.audits[0]).toMatchObject({ commandId: "process.status", outcome: "ok", target: "proc_1" })
  })

  test("process.status on an unknown process fails not_found and audits it", async () => {
    const table = await seedTable([])
    const { port, f } = makePort(table)
    const exit = await Effect.runPromiseExit(port.status({ processId: "nope" as never, principal: OPERATOR }))
    expect(exit._tag).toBe("Failure")
    expect(f.audits[0]).toMatchObject({ commandId: "process.status", outcome: "not_found" })
  })

  test("process.tree builds direct-child-only nodes", async () => {
    const table = await seedTable([
      { sessionId: "ses_1", processId: "proc_root" },
      { sessionId: "ses_1", processId: "proc_1" },
    ])
    const { port } = makePort(table)
    const out = await run(port.tree({ rootProcessId: "proc_root" as never, principal: OPERATOR }))
    expect(out.nodes.length).toBeGreaterThanOrEqual(1)
    expect(out.nodes.every((node) => Array.isArray(node.childProcessIds))).toBe(true)
  })
})

describe("T031 process port — native control", () => {
  test("process.cancel drives the native root cancel and audits the outcome", async () => {
    const table = await seedTable([{ sessionId: "ses_1", processId: "proc_1" }])
    const { port, f } = makePort(table)
    const out = await run(port.cancel({ processId: "proc_1" as never, reason: null, principal: OPERATOR }))
    expect(out.outcome).toBe("requested")
    expect(f.cancelCalls).toHaveLength(1)
    expect(f.cancelCalls[0]?.rootKey).toBe("root_key")
    expect(f.audits.some((a) => a.commandId === "process.cancel" && a.outcome === "ok")).toBe(true)
  })

  test("process.steer publishes one steer_requested intent and audits", async () => {
    const table = await seedTable([{ sessionId: "ses_1", processId: "proc_1" }])
    const { port, f } = makePort(table)
    const out = await run(port.steer({ processId: "proc_1" as never, reason: null, principal: OPERATOR }))
    expect(out.eventId).toBe("evt_steer")
    expect(f.steerCalls).toHaveLength(1)
    expect(f.steerCalls[0]?.eventType).toBe("lifecycle.steer_requested")
    expect(f.audits.some((a) => a.commandId === "process.steer")).toBe(true)
  })

  test("process.handoff delegates to the single-owner coordinator", async () => {
    const table = await seedTable([{ sessionId: "ses_src", processId: "proc_src" }])
    const { port, f } = makePort(table)
    const out = await run(
      port.handoff({
        sourceProcessId: "proc_src" as never,
        target: { sessionId: "ses_dst" as never, processId: "proc_dst" as never },
        reason: "delegation" as never,
        generation: 1 as never,
        principal: OPERATOR,
      }),
    )
    expect(out.eventId).toBe("evt_handoff")
    expect(f.handoffCalls).toHaveLength(1)
    expect(f.handoffCalls[0]?.target.sessionId as string).toBe("ses_dst")
  })
})

describe("T031 task port — logical task resolution", () => {
  test("task.status resolves a Task to its process set", async () => {
    const table = await seedTable([{ sessionId: "ses_1", processId: "proc_1" }])
    const { port } = makePort(table)
    const out = await run(port.taskStatus({ taskId: "task_1" as never, rootProcessId: "proc_root" as never, principal: OPERATOR }))
    expect(out.views.length).toBe(1)
    expect(out.views[0]?.taskId as string).toBe("task_1")
  })
})

describe("T031 command adapter — Feature 007 DomainInvoke seam", () => {
  const corePrincipal: OperatorPrincipalCore = { kind: "operator", subject: "op_1", projectBinding: null }

  function ctx(id: string, payload: Record<string, unknown>): HandlerContext {
    return {
      request: { principal: corePrincipal, payload, scope: { kind: "session", ref: "ses_1" } } as unknown as HandlerContext["request"],
      descriptor: { id, domain: id.split(".")[0] } as unknown as HandlerContext["descriptor"],
    }
  }

  test("process.status id resolves through the process invoke and returns a query result", async () => {
    const table = await seedTable([{ sessionId: "ses_1", processId: "proc_1" }])
    const { port } = makePort(table)
    const ports = createLifecycleDomainPorts(port)
    const result = await ports.process.invoke(ctx("process.status", { processId: "proc_1" }))
    expect(result.kind).toBe("query")
  })

  test("process.status without a processId is an invalid_argument failure", async () => {
    const table = await seedTable([])
    const { port } = makePort(table)
    const ports = createLifecycleDomainPorts(port)
    const result = await ports.process.invoke(ctx("process.status", {}))
    expect(result.kind).toBe("failure")
  })

  test("task.status id resolves through the task invoke", async () => {
    const table = await seedTable([{ sessionId: "ses_1", processId: "proc_1" }])
    const { port } = makePort(table)
    const ports = createLifecycleDomainPorts(port)
    const result = await ports.task.invoke(ctx("task.status", { taskId: "task_1", rootProcessId: "proc_root" }))
    expect(result.kind).toBe("query")
  })
})
