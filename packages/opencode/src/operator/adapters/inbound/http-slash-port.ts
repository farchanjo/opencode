/**
 * Remote/attach TUI slash port via typed Operator SDK/HTTP (T029).
 * Server-derived auth only; never LLM/session.command.
 * When operator routes disabled → unavailable (no fallback).
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
import { createOperatorClient, type OperatorClient } from "@opencode-ai/sdk/operator"
import {
  createSlashConfirmStore,
  type SlashConfirmBinding,
  type SlashConfirmStore,
} from "./slash-confirm"
import { mapOperatorResultToDisplay, type OperatorSlashDisplay } from "./slash-display"
import type { TuiOperatorSlashPort } from "./tui-port"

export type HttpSlashPortOptions = {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
  readonly sandboxToken?: string
  readonly authorization?: string
  readonly confirmStore?: SlashConfirmStore
  readonly nowMs?: () => number
  readonly getProjectId?: () => string | null | undefined
  readonly getSessionId?: () => string | null | undefined
  readonly client?: OperatorClient
}

function authFromHeaders(headers?: HeadersInit): { authorization?: string } {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const authorization = headers.get("authorization") ?? undefined
    return { authorization }
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === "authorization")
    return { authorization: hit?.[1] }
  }
  const record = headers as Record<string, string>
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === "authorization") return { authorization: v }
  }
  return {}
}

function toCommandResult(raw: {
  ok: boolean
  id: string
  outcome: string
  version?: string
  effective?: unknown
  auditId?: string
  kind?: string
  error?: { code: string; message: string; retryable?: boolean }
}): CommandResult {
  if (raw.ok) {
    return {
      ok: true,
      id: raw.id,
      kind: "operator.admin_result",
      outcome: raw.outcome as Outcome,
      version: raw.version,
      effective: raw.effective,
      auditId: raw.auditId,
    }
  }
  return {
    ok: false,
    id: raw.id,
    kind: "operator.admin_result",
    outcome: (raw.outcome || raw.error?.code || "unavailable") as Outcome,
    error: {
      code: (raw.error?.code || "unavailable") as never,
      message: raw.error?.message || "operator request failed",
      retryable: raw.error?.retryable ?? false,
    },
  }
}

function unavailable(id: string, message: string): CommandResult {
  return failureResult({
    id,
    code: "unavailable",
    message,
    details: { source: "slash", transport: "http" },
  })
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

/**
 * Create TUI slash port over Operator HTTP/SDK.
 * Confirmation stays TUI-native; server auth binds principal.
 */
export function createHttpOperatorSlashPort(options: HttpSlashPortOptions): TuiOperatorSlashPort {
  const confirmStore = options.confirmStore ?? createSlashConfirmStore({ nowMs: options.nowMs })
  const fromHeaders = authFromHeaders(options.headers)
  const client =
    options.client ??
    createOperatorClient({
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      authorization: options.authorization ?? fromHeaders.authorization,
      sandboxToken: options.sandboxToken,
    })

  let operatorEnabled: boolean | undefined

  async function ensureEnabled(): Promise<boolean> {
    if (operatorEnabled !== undefined) return operatorEnabled
    try {
      const health = await client.health()
      operatorEnabled = health.ok === true
    } catch {
      operatorEnabled = false
    }
    return operatorEnabled
  }

  return {
    cancelConfirmation(token) {
      confirmStore.revoke(token)
    },
    async preflightMutation(input) {
      const scopeResult = resolveScopeForCommandId(input.commandId, {
        projectId: input.projectId ?? options.getProjectId?.(),
        sessionId: input.sessionId ?? options.getSessionId?.(),
        rootTreeRef: input.rootTreeRef,
      })
      if (!scopeResult.ok) {
        return { ok: false, code: scopeResult.code, message: scopeResult.message }
      }
      const enabled = await ensureEnabled()
      if (!enabled) {
        return { ok: false, code: "unavailable", message: "operator not enabled" }
      }
      try {
        const base = options.baseUrl.replace(/\/+$/, "")
        const res = await (options.fetch ?? globalThis.fetch)(`${base}/operator/v1/preflight`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.authorization
              ? { authorization: options.authorization }
              : fromHeaders.authorization
                ? { authorization: fromHeaders.authorization }
                : {}),
            ...(options.sandboxToken ? { "x-opencode-operator-token": options.sandboxToken } : {}),
          },
          body: JSON.stringify({ commandId: input.commandId }),
        })
        if (!res.ok) {
          return {
            ok: false,
            code: res.status === 503 ? "unavailable" : "unavailable",
            message: `preflight HTTP ${res.status}`,
          }
        }
        const json = (await res.json()) as {
          ok?: boolean
          currentVersion?: string | null
          configured?: boolean
          authority?: string
        }
        if (!json.ok) {
          return { ok: false, code: "unavailable", message: "preflight failed" }
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
          message: error instanceof Error ? error.message : "preflight transport error",
        }
      }
    },
    async tryHandle(input) {
      const parsed = parseOperatorSlash(input.text)
      if (parsed.kind !== "operator") return { handled: false }

      if (!parsed.commandId || !isReservedCommandId(parsed.commandId)) {
        const result = failureResult({
          id: parsed.commandId ?? "unknown",
          code: "invalid_argument",
          message: parsed.commandId
            ? `unknown operator command id: ${parsed.commandId}`
            : `invalid operator slash alias: ${parsed.alias}`,
          details: { source: "slash", reason: "unknown_reserved_alias" },
        })
        return displayHandled(result)
      }

      const enabled = await ensureEnabled()
      if (!enabled) {
        return displayHandled(
          unavailable(parsed.commandId, "Operator control plane is not enabled on this server"),
        )
      }

      const { payload, expectedVersion, idempotencyKey: payloadIdem } = parseStrictPayload(parsed.argsText)
      const version = input.version ?? expectedVersion
      const projectId = input.projectId ?? options.getProjectId?.() ?? null
      // Prefer per-call sessionId from TUI (DialogConfirm re-try must pass exact session).
      const sessionId = input.sessionId ?? options.getSessionId?.() ?? null
      const rootTreeRef = input.rootTreeRef ?? null
      const scopeResult = resolveScopeForCommandId(parsed.commandId, { projectId, sessionId, rootTreeRef })
      if (!scopeResult.ok) {
        return displayHandled(
          failureResult({
            id: parsed.commandId,
            code: scopeResult.code,
            message: scopeResult.message,
            details: { source: "slash", transport: "http", ...scopeResult.details },
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

      let raw
      try {
        raw = await client.command({
          id: parsed.commandId,
          scope,
          version,
          idempotencyKey,
          confirm,
          payload,
        })
      } catch (error) {
        return displayHandled(
          unavailable(
            parsed.commandId,
            error instanceof Error ? error.message : "operator transport error",
          ),
        )
      }

      // 404 / not mounted
      if (raw.httpStatus === 404) {
        operatorEnabled = false
        return displayHandled(
          unavailable(parsed.commandId, "Operator routes not mounted on this server"),
        )
      }

      const result = toCommandResult(raw)

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
        }
      }

      return displayHandled(result)
    },
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
    }
  }
}

export * as OperatorHttpSlashPort from "./http-slash-port"
