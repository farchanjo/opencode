/**
 * Feature 002 / T031 (S13) — the `process.*`/`task.*` inbound command adapter.
 *
 * Bridges the reserved Feature 007 `process.*`/`task.*` operator command ids to
 * the typed `LifecycleProcessPort` (T031) through the Feature 007 dispatcher's
 * `DomainInvoke` seam, exactly like `routing-command-port.ts` (Feature 001,
 * T028). Feature 007 remains the SOLE registration authority: this adapter
 * registers NO command ids — it only supplies the `process`/`task` domain
 * `invoke`, replacing the `not_implemented` stub in `createDomainStubs`. Wire it
 * with `wireDomainPorts(createLifecycleDomainPorts(port))` at the composition
 * root. Reserved ids are never registered by plugin/MCP/custom registries — that
 * guard is `checkReservedRegistrationName` in `packages/core/src/operator/
 * reserved-names.ts`, unchanged here (FR49–FR51, C19, AC18).
 *
 * Every command is parsed and dispatched LOCALLY (before any prompt admission):
 * the payload never reaches a model, and every port call is model-independent
 * and zero-cost. Reads return the bounded, redacted operator view; native
 * control (cancel/steer/handoff) publishes lifecycle + audit events only and
 * adds NO output to any Message/Part/context (FR51).
 */
export * as LifecycleCommandPort from "./lifecycle-command-port"

import { Effect } from "effect"
import type { Ids } from "@opencode-ai/schema/lifecycle/ids"
import type { Values } from "@opencode-ai/schema/lifecycle/values"
import type { OperatorPrincipal as OperatorPrincipalCore } from "@opencode-ai/core/operator"
import type {
  ProcessError,
  OperatorPrincipal as LifecycleOperatorPrincipal,
} from "@opencode-ai/protocol/lifecycle/commands"
import type { HandlerContext, HandlerResult, FailureHandlerResult } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { LifecycleProcessPort } from "./process-port"

export interface LifecycleDomainPorts {
  readonly process: { readonly invoke: DomainInvoke }
  readonly task: { readonly invoke: DomainInvoke }
}

// =============================================================================
// Payload helpers
// =============================================================================

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function firstString(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function firstNumber(record: Record<string, unknown>, keys: ReadonlyArray<string>): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function fail(code: FailureHandlerResult["code"], message: string, details?: FailureHandlerResult["details"]): FailureHandlerResult {
  return { kind: "failure", code, message, details }
}

/** Map the closed `ProcessError` union onto operator failure codes + envelope. */
function processErrorToFailure(error: ProcessError): FailureHandlerResult {
  switch (error.type) {
    case "not_found":
      return fail("invalid_argument", `process ${error.processId} not found`, { field: "processId" })
    case "unauthorized":
      return fail("unauthorized", error.reason)
    case "cancel_rejected":
      return fail("unavailable", error.reason, { processId: error.processId })
    case "invalid_argument":
      return fail("invalid_argument", error.reason, { field: error.field })
    case "unavailable":
      return fail("unavailable", error.reason)
    case "not_implemented":
      return fail("not_implemented", "operation is not implemented")
  }
}

/** Map the Feature 007 operator principal onto the lifecycle operator principal (C19). */
function toLifecycleOperator(principal: OperatorPrincipalCore): LifecycleOperatorPrincipal {
  // `system` carries full operator authority; `manager-view` stays read-only.
  const kind = principal.kind === "manager-view" ? "manager-view" : "operator"
  return { kind, id: principal.subject }
}

function runQuery<A>(effect: Effect.Effect<A, ProcessError>): Promise<HandlerResult> {
  return Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value): HandlerResult => ({ kind: "query", effective: value }),
        onFailure: (error): HandlerResult => processErrorToFailure(error),
      }),
    ),
  )
}

// =============================================================================
// process.* domain invoke
// =============================================================================

function processInvoke(port: LifecycleProcessPort): DomainInvoke {
  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toLifecycleOperator(ctx.request.principal)
    const processId = firstString(payload, ["processId", "process_id", "id"]) as Ids.ProcessId | undefined
    const reason = (firstString(payload, ["reason"]) ?? null) as Values.Reason | null

    switch (id) {
      case "process.status":
        if (processId === undefined) return Promise.resolve(fail("invalid_argument", "process.status requires a processId", { field: "processId" }))
        return runQuery(port.status({ processId, principal }))

      case "process.tree": {
        const rootProcessId = firstString(payload, ["rootProcessId", "root_process_id"]) as Ids.RootProcessId | undefined
        const sessionId = firstString(payload, ["sessionId", "session_id"]) as Ids.SessionId | undefined
        if (rootProcessId === undefined) return Promise.resolve(fail("invalid_argument", "process.tree requires a rootProcessId", { field: "rootProcessId" }))
        return runQuery(port.tree({ rootProcessId, sessionId, principal }))
      }

      case "process.watch": {
        // The operator dispatcher is a request/response surface; the live stream
        // is attached by the CLI/TUI via ObservationPort. Return the bounded
        // current frame here so watch is honest and zero-model.
        if (processId === undefined) return Promise.resolve(fail("invalid_argument", "process.watch requires a processId", { field: "processId" }))
        return Effect.runPromise(
          port.status({ processId, principal }).pipe(
            Effect.match({
              onSuccess: (out): HandlerResult => ({ kind: "query", effective: { frame: out.view, streaming: "observation-surface" } }),
              onFailure: (error): HandlerResult => processErrorToFailure(error),
            }),
          ),
        )
      }

      case "process.cancel":
        if (processId === undefined) return Promise.resolve(fail("invalid_argument", "process.cancel requires a processId", { field: "processId" }))
        return runQuery(port.cancel({ processId, reason, principal }))

      case "process.steer":
        if (processId === undefined) return Promise.resolve(fail("invalid_argument", "process.steer requires a processId", { field: "processId" }))
        return runQuery(port.steer({ processId, reason, principal }))

      case "process.handoff": {
        const sourceProcessId = firstString(payload, ["sourceProcessId", "source_process_id", "processId"]) as Ids.ProcessId | undefined
        const targetSessionId = firstString(payload, ["targetSessionId", "target_session_id"]) as Ids.SessionId | undefined
        const targetProcessId = firstString(payload, ["targetProcessId", "target_process_id"]) as Ids.ProcessId | undefined
        const generation = firstNumber(payload, ["generation"]) as Values.Generation | undefined
        if (sourceProcessId === undefined || targetSessionId === undefined || targetProcessId === undefined || generation === undefined) {
          return Promise.resolve(
            fail("invalid_argument", "process.handoff requires sourceProcessId, targetSessionId, targetProcessId, generation", {
              field: "target",
            }),
          )
        }
        return runQuery(
          port.handoff({
            sourceProcessId,
            target: { sessionId: targetSessionId, processId: targetProcessId },
            reason: (reason ?? "operator_handoff") as Values.Reason,
            generation,
            principal,
          }),
        )
      }

      default:
        return Promise.resolve(fail("not_implemented", `process command ${id} is not implemented`))
    }
  }
}

// =============================================================================
// task.* domain invoke
// =============================================================================

function taskInvoke(port: LifecycleProcessPort): DomainInvoke {
  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toLifecycleOperator(ctx.request.principal)
    const taskId = firstString(payload, ["taskId", "task_id", "id"]) as Ids.TaskId | undefined
    const rootProcessId = firstString(payload, ["rootProcessId", "root_process_id"]) as Ids.RootProcessId | undefined
    const reason = (firstString(payload, ["reason"]) ?? null) as Values.Reason | null

    switch (id) {
      case "task.status":
        if (taskId === undefined || rootProcessId === undefined) return Promise.resolve(fail("invalid_argument", "task.status requires taskId and rootProcessId", { field: "taskId" }))
        return runQuery(port.taskStatus({ taskId, rootProcessId, principal }))

      case "task.tree": {
        const sessionId = firstString(payload, ["sessionId", "session_id"]) as Ids.SessionId | undefined
        if (rootProcessId === undefined) return Promise.resolve(fail("invalid_argument", "task.tree requires a rootProcessId", { field: "rootProcessId" }))
        return runQuery(port.taskTree({ rootProcessId, sessionId, principal }))
      }

      case "task.watch": {
        // Resolve the task's current frames; the CLI/TUI attach the live stream.
        if (taskId === undefined || rootProcessId === undefined) return Promise.resolve(fail("invalid_argument", "task.watch requires taskId and rootProcessId", { field: "taskId" }))
        return Effect.runPromise(
          port.taskStatus({ taskId, rootProcessId, principal }).pipe(
            Effect.match({
              onSuccess: (out): HandlerResult => ({ kind: "query", effective: { frames: out.views, streaming: "observation-surface" } }),
              onFailure: (error): HandlerResult => processErrorToFailure(error),
            }),
          ),
        )
      }

      case "task.cancel": {
        // Cancelling a Task cancels its root tree through the native cancel path;
        // resolve the task's first process as the cancel target (C17, T029).
        const processId = firstString(payload, ["processId", "process_id"]) as Ids.ProcessId | undefined
        if (processId === undefined) return Promise.resolve(fail("invalid_argument", "task.cancel requires a processId", { field: "processId" }))
        return runQuery(port.taskCancel({ processId, reason, principal }))
      }

      default:
        return Promise.resolve(fail("not_implemented", `task command ${id} is not implemented`))
    }
  }
}

/**
 * Build the `process`/`task` DomainPort overrides. Wire them into the Feature
 * 007 dispatcher via `wireDomainPorts(createLifecycleDomainPorts(port))` at the
 * composition root — they replace the `not_implemented` stubs without touching
 * the registry.
 */
export function createLifecycleDomainPorts(port: LifecycleProcessPort): LifecycleDomainPorts {
  return {
    process: { invoke: processInvoke(port) },
    task: { invoke: taskInvoke(port) },
  }
}
