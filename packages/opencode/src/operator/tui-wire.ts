/**
 * TUI launcher wiring for operator slash (T029–T031).
 *
 * - local: trusted worker RPC `operatorFetch` only (same worker as session SDK)
 * - remote/attach: Operator SDK/HTTP with server auth
 * - test: explicit createTestOperatorStack (never used by production launchers)
 *
 * Production parent process MUST NOT call getOrCreateLiveOperatorStack / createWorkerLocalSlashPort.
 */
import { createHttpOperatorSlashPort } from "./adapters/inbound/http-slash-port"
import { createWorkerRpcSlashPort } from "./adapters/inbound/rpc-slash-port"
import type { TuiOperatorSlashPort } from "./adapters/inbound/tui-port"
import { createLocalTuiOperatorSlashPort, createTestOperatorStack, type OperatorStack } from "./stack-test"
import type { WorkerOperatorFetchInput, WorkerOperatorFetchResult } from "./worker-adapter"

export type WireLocalOperatorSlashInput = {
  /** Project directory trusted by worker Instance load. */
  readonly directory: string
  /**
   * Trusted RPC: parent → worker.operatorFetch.
   * Required for production local TUI (no parent live stack).
   */
  readonly operatorFetch: (input: WorkerOperatorFetchInput) => Promise<WorkerOperatorFetchResult>
}

/**
 * Local TUI (parent process): slash via worker RPC only.
 * Live stack / Config.Service run inside the worker, not the launcher.
 */
export function wireLocalOperatorSlashPort(input: WireLocalOperatorSlashInput): TuiOperatorSlashPort {
  return createWorkerRpcSlashPort({
    directory: input.directory,
    call: input.operatorFetch,
  })
}

/** TEST-ONLY: in-process memory stack slash port. Never import from production launchers. */
export function wireTestOperatorSlashPort(stack?: OperatorStack): TuiOperatorSlashPort {
  return createLocalTuiOperatorSlashPort(stack ?? createTestOperatorStack())
}

export type WireRemoteOperatorSlashInput = {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
  readonly password?: string
  readonly username?: string
  readonly sandboxToken?: string
  readonly getProjectId?: () => string | null | undefined
  readonly getSessionId?: () => string | null | undefined
}

/** Attach/remote TUI: HTTP/SDK only — never session.command / LLM. */
export function wireRemoteOperatorSlashPort(input: WireRemoteOperatorSlashInput): TuiOperatorSlashPort {
  let authorization = undefined as string | undefined
  if (input.password) {
    const user = input.username ?? "opencode"
    authorization = `Basic ${btoa(`${user}:${input.password}`)}`
  }
  return createHttpOperatorSlashPort({
    baseUrl: input.baseUrl,
    fetch: input.fetch,
    headers: input.headers,
    authorization,
    sandboxToken: input.sandboxToken ?? process.env["OPENCODE_OPERATOR_SANDBOX_TOKEN"],
    getProjectId: input.getProjectId,
    getSessionId: input.getSessionId,
  })
}

export type WireOperatorSlashForTuiInput =
  | {
      readonly mode: "local"
      readonly directory: string
      readonly operatorFetch: (input: WorkerOperatorFetchInput) => Promise<WorkerOperatorFetchResult>
    }
  | {
      readonly mode: "remote"
      readonly baseUrl?: string
      readonly fetch?: typeof globalThis.fetch
      readonly headers?: HeadersInit
      readonly password?: string
      readonly username?: string
      readonly getProjectId?: () => string | null | undefined
      readonly getSessionId?: () => string | null | undefined
    }
  | {
      readonly mode: "test"
      readonly stack?: OperatorStack
    }

/**
 * Choose port for TUI launcher.
 * - local: requires worker operatorFetch RPC (throws if missing)
 * - remote: HTTP/SDK
 * - test: memory stack (tests only)
 */
export function wireOperatorSlashForTui(input: WireOperatorSlashForTuiInput): TuiOperatorSlashPort {
  if (input.mode === "remote") {
    return wireRemoteOperatorSlashPort({
      baseUrl: input.baseUrl ?? "http://127.0.0.1",
      fetch: input.fetch,
      headers: input.headers,
      password: input.password,
      username: input.username,
      getProjectId: input.getProjectId,
      getSessionId: input.getSessionId,
    })
  }
  if (input.mode === "test") {
    return wireTestOperatorSlashPort(input.stack)
  }
  if (!input.operatorFetch) {
    throw new Error("wireOperatorSlashForTui(local): operatorFetch RPC is required (no parent live stack)")
  }
  if (!input.directory) {
    throw new Error("wireOperatorSlashForTui(local): directory is required")
  }
  return wireLocalOperatorSlashPort({
    directory: input.directory,
    operatorFetch: input.operatorFetch,
  })
}

export * as OperatorTuiWire from "./tui-wire"
