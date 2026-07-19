/**
 * Parent-TUI slash port over trusted worker RPC operatorFetch (T029).
 * Never creates live/test stack in the parent process.
 * Principal/project/session come from RPC payload (worker-trusted), not body principal.
 */
import {
  failureResult,
  getReservedEntry,
  isReservedCommandId,
  parseOperatorSlash,
  resolveScopeForCommandId,
  type CommandResult,
  type Outcome,
} from "@opencode-ai/core/operator"
import type { WorkerOperatorFetchInput, WorkerOperatorFetchResult } from "../../worker-adapter"
import {
  createSlashConfirmStore,
  type SlashConfirmBinding,
  type SlashConfirmStore,
} from "./slash-confirm"
import { mapOperatorResultToDisplay, type OperatorSlashDisplay } from "./slash-display"
import type { TuiOperatorSlashPort } from "./tui-port"

export type RpcOperatorSlashPortOptions = {
  readonly directory: string
  readonly call: (input: WorkerOperatorFetchInput) => Promise<WorkerOperatorFetchResult>
  readonly confirmStore?: SlashConfirmStore
  readonly nowMs?: () => number
}

function parseStrictPayload(argsText: string): {
  payload: Record<string, unknown>
  expectedVersion?: string
  idempotencyKey?: string
} {
  const trimmed = argsText.trim()
  if (!trimmed) return { payload: {} }
  if (!trimmed.startsWith("{")) return { payload: { args: trimmed } }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { payload: { args: trimmed } }
    }
    const record = { ...(parsed as Record<string, unknown>) }
    delete record.principal
    delete record.confirm
    delete record.source
    delete record.scope
    const expectedVersion =
      typeof record.expectedVersion === "string"
        ? record.expectedVersion
        : typeof record.version === "string"
          ? record.version
          : undefined
    const idempotencyKey = typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined
    delete record.expectedVersion
    delete record.version
    delete record.idempotencyKey
    return { payload: record, expectedVersion, idempotencyKey }
  } catch {
    return { payload: { args: trimmed } }
  }
}

function toCommandResult(raw: {
  ok?: boolean
  id?: string
  outcome?: string
  version?: string
  effective?: unknown
  auditId?: string
  error?: { code?: string; message?: string; retryable?: boolean }
}): CommandResult {
  const id = raw.id ?? "operator.rpc"
  if (raw.ok) {
    return {
      ok: true,
      id,
      kind: "operator.admin_result",
      outcome: (raw.outcome ?? "success") as Outcome,
      version: raw.version,
      effective: raw.effective,
      auditId: raw.auditId,
    }
  }
  return {
    ok: false,
    id,
    kind: "operator.admin_result",
    outcome: (raw.outcome || raw.error?.code || "unavailable") as Outcome,
    error: {
      code: (raw.error?.code || "unavailable") as never,
      message: raw.error?.message || "operator request failed",
      retryable: raw.error?.retryable ?? false,
    },
  }
}

/**
 * Structured half of the handled result (Feature 012 FR1), mirroring
 * `tui-port.ts`: typed `outcome`, optional `effective` (only when defined), and
 * `version ?? null` from the already-parsed `CommandResult`. Absence of
 * `effective` is representable (FR2); display fields stay byte-identical.
 */
function structuredResult(result: CommandResult) {
  return {
    outcome: result.outcome,
    ...(result.effective !== undefined ? { effective: result.effective } : {}),
    version: result.version ?? null,
  }
}

function displayHandled(result: CommandResult) {
  const display: OperatorSlashDisplay = mapOperatorResultToDisplay(result)
  return {
    handled: true as const,
    display: {
      title: display.title,
      message: display.message,
      variant: display.variant,
      outcome: display.outcome,
      auditPending: display.auditPending,
      injectTranscript: false as const,
    },
    result: structuredResult(result),
  }
}

/**
 * Parent-side slash port: parse/confirm in TUI process; dispatch via worker RPC.
 */
export function createWorkerRpcSlashPort(options: RpcOperatorSlashPortOptions): TuiOperatorSlashPort {
  const confirmStore = options.confirmStore ?? createSlashConfirmStore({ nowMs: options.nowMs })

  async function rpc(path: string, init?: { method?: string; body?: string; projectId?: string | null; sessionId?: string | null }) {
    return options.call({
      directory: options.directory,
      projectId: init?.projectId ?? null,
      sessionId: init?.sessionId,
      url: `http://127.0.0.1${path}`,
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body,
    })
  }

  return {
    cancelConfirmation(token) {
      confirmStore.revoke(token)
    },
    async preflightMutation(input) {
      const scopeResult = resolveScopeForCommandId(input.commandId, {
        projectId: input.projectId,
        sessionId: input.sessionId,
        rootTreeRef: input.rootTreeRef,
      })
      if (!scopeResult.ok) {
        return { ok: false, code: scopeResult.code, message: scopeResult.message }
      }
      try {
        const raw = await rpc("/operator/v1/preflight", {
          method: "POST",
          body: JSON.stringify({ commandId: input.commandId }),
          projectId: input.projectId,
          sessionId: input.sessionId,
        })
        if (raw.status === 404 || raw.status === 503) {
          return {
            ok: false,
            code: "unavailable",
            message: "preflight not available on worker",
          }
        }
        const json = JSON.parse(raw.body) as {
          ok?: boolean
          currentVersion?: string | null
          configured?: boolean
          authority?: string
          code?: string
          message?: string
        }
        if (!json.ok) {
          return {
            ok: false,
            code: json.code ?? "unavailable",
            message: json.message ?? "preflight failed",
          }
        }
        return {
          ok: true,
          currentVersion: json.currentVersion ?? null,
          configured: json.configured === true,
          scopeKind: scopeResult.scope.kind,
          scopeRef: scopeResult.scope.ref ?? null,
          authority: json.authority ?? input.commandId.split(".")[0] ?? input.commandId,
        }
      } catch (error) {
        return {
          ok: false,
          code: "unavailable",
          message: error instanceof Error ? error.message : "preflight RPC failed",
        }
      }
    },
    async tryHandle(input) {
      const parsed = parseOperatorSlash(input.text)
      if (parsed.kind !== "operator") return { handled: false }

      if (!parsed.commandId || !isReservedCommandId(parsed.commandId)) {
        return displayHandled(
          failureResult({
            id: parsed.commandId ?? "unknown",
            code: "invalid_argument",
            message: parsed.commandId
              ? `unknown operator command id: ${parsed.commandId}`
              : `invalid operator slash alias: ${parsed.alias}`,
            details: { source: "slash", reason: "unknown_reserved_alias" },
          }),
        )
      }

      // Health via trusted worker path
      let healthOk = false
      try {
        const health = await rpc("/operator/v1/health", {
          projectId: input.projectId,
          sessionId: input.sessionId,
        })
        healthOk = health.status === 200
      } catch {
        healthOk = false
      }
      if (!healthOk) {
        return displayHandled(
          failureResult({
            id: parsed.commandId,
            code: "unavailable",
            message: "Operator control plane unavailable on worker",
            details: { source: "slash", transport: "worker-rpc" },
          }),
        )
      }

      const { payload, expectedVersion, idempotencyKey: payloadIdem } = parseStrictPayload(parsed.argsText)
      // Honor explicit tryHandle version/idempotencyKey over payload
      const version = input.version ?? expectedVersion
      const projectId = input.projectId ?? null
      const sessionId = input.sessionId ?? null
      const rootTreeRef = input.rootTreeRef ?? null
      const scopeResult = resolveScopeForCommandId(parsed.commandId, { projectId, sessionId, rootTreeRef })
      if (!scopeResult.ok) {
        return displayHandled(
          failureResult({
            id: parsed.commandId,
            code: scopeResult.code,
            message: scopeResult.message,
            details: { source: "slash", transport: "worker-rpc", ...scopeResult.details },
          }),
        )
      }
      const scope = scopeResult.scope

      const binding: SlashConfirmBinding = {
        commandId: parsed.commandId,
        scopeKind: scope.kind,
        scopeRef: scope.ref,
        version,
      }

      let confirm = false
      if (input.confirmToken) {
        const ok = confirmStore.consume(input.confirmToken, binding)
        if (!ok) {
          return displayHandled(
            failureResult({
              id: parsed.commandId,
              code: "confirmation_required",
              message: "confirmation token invalid, expired, or bound to a different command/scope/version",
              details: { source: "slash", reason: "confirm_token_invalid" },
            }),
          )
        }
        confirm = true
      }

      const mutates = getReservedEntry(parsed.commandId)?.mutates === true
      const idempotencyKey =
        input.idempotencyKey ??
        payloadIdem ??
        (mutates
          ? `slash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
          : undefined)

      const body = JSON.stringify({
        id: parsed.commandId,
        scope,
        ...(version !== undefined ? { version } : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        confirm,
        payload,
      })

      let raw: WorkerOperatorFetchResult
      try {
        raw = await rpc("/operator/v1/commands", {
          method: "POST",
          body,
          projectId,
          sessionId,
        })
      } catch (error) {
        return displayHandled(
          failureResult({
            id: parsed.commandId,
            code: "unavailable",
            message: error instanceof Error ? error.message : "operator worker RPC failed",
            details: { source: "slash", transport: "worker-rpc" },
          }),
        )
      }

      if (raw.status === 404) {
        return displayHandled(
          failureResult({
            id: parsed.commandId,
            code: "unavailable",
            message: "Operator routes not available on worker",
            details: { source: "slash", transport: "worker-rpc" },
          }),
        )
      }

      let json: Record<string, unknown>
      try {
        json = JSON.parse(raw.body) as Record<string, unknown>
      } catch {
        return displayHandled(
          failureResult({
            id: parsed.commandId,
            code: "transport_error",
            message: "invalid operator response from worker",
          }),
        )
      }

      const result = toCommandResult({
        ok: json.ok === true,
        id: typeof json.id === "string" ? json.id : parsed.commandId,
        outcome: typeof json.outcome === "string" ? json.outcome : undefined,
        version: typeof json.version === "string" ? json.version : undefined,
        effective: json.effective,
        auditId: typeof json.auditId === "string" ? json.auditId : undefined,
        error:
          json.error && typeof json.error === "object"
            ? (json.error as { code?: string; message?: string; retryable?: boolean })
            : undefined,
      })

      if (result.outcome === "confirmation_required" && !confirm) {
        const minted = confirmStore.mint(binding)
        const display = mapOperatorResultToDisplay(result)
        return {
          handled: true,
          display: {
            title: display.title,
            message: display.message,
            variant: display.variant,
            outcome: display.outcome,
            auditPending: display.auditPending,
            injectTranscript: false,
          },
          needsConfirmation: {
            token: minted.token,
            commandId: parsed.commandId,
            message: `Confirm operator command ${parsed.commandId}?`,
          },
          result: structuredResult(result),
        }
      }

      return displayHandled(result)
    },
  }
}

export * as OperatorRpcSlashPort from "./rpc-slash-port"
