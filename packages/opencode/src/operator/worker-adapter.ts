/**
 * Trusted worker-internal operator transport (authority split).
 *
 * Local TUI (parent) talks to this process via RPC `operatorFetch` only —
 * never getOrCreateLiveOperatorStack in the parent launcher.
 * Principal/project/session injected from trusted RPC fields (worker closure), not body principal.
 */
import { getOrCreateLiveOperatorStack, type LiveOperatorStack } from "./stack-live"
import { createOperatorHttpHandler } from "./http/handler"
import type { OperatorPrincipal } from "@opencode-ai/core/operator"
import { createTuiOperatorSlashPort, type TuiOperatorSlashPort } from "./adapters/inbound/tui-port"
import { isOperatorDevSandbox } from "./dev-env"

export type TrustedWorkerOperatorContext = {
  readonly directory: string
  readonly projectId: string | null
  readonly sessionId?: string | null
  readonly subject?: string
}

/**
 * Build a fetch handler that always authenticates as local operator for this Instance.
 * Must only be invoked from worker RPC (trusted), never exposed as public HTTP without auth.
 */
export async function createTrustedWorkerOperatorFetch(
  ctx: TrustedWorkerOperatorContext,
): Promise<(request: Request) => Promise<Response>> {
  const stack = await getOrCreateLiveOperatorStack({
    directory: ctx.directory,
    sandboxKeychain: isOperatorDevSandbox(),
  })

  const principal: OperatorPrincipal = {
    kind: "operator",
    subject: ctx.subject ?? "local-worker",
    projectBinding: ctx.projectId,
  }

  return createOperatorHttpHandler({
    dispatcher: stack.dispatcher,
    registry: stack.registry,
    serverBind: "127.0.0.1",
    getClientIp: () => "127.0.0.1",
    getProjectId: () => ctx.projectId,
    injectProjectScopeWhenOmitted: true,
    config: stack.mutationPorts.config,
    resolveAuth: () => ({
      authenticated: true,
      subject: principal.subject,
      role: "operator",
      projectBinding: ctx.projectId,
    }),
  })
}

/**
 * In-worker slash port using live stack (same authority as trusted fetch).
 * For worker-process composition only — production TUI parent must use RPC slash port.
 */
export async function createWorkerLocalSlashPort(
  ctx: TrustedWorkerOperatorContext,
): Promise<{ readonly port: TuiOperatorSlashPort; readonly stack: LiveOperatorStack }> {
  const stack = await getOrCreateLiveOperatorStack({
    directory: ctx.directory,
    sandboxKeychain: isOperatorDevSandbox(),
  })
  return {
    stack,
    port: createTuiOperatorSlashPort(stack.interceptor, { config: stack.mutationPorts.config }),
  }
}

/**
 * Typed RPC payload for worker.operatorFetch — directory is trusted from TUI worker parent.
 */
export type WorkerOperatorFetchInput = {
  readonly directory: string
  readonly projectId?: string | null
  readonly sessionId?: string | null
  readonly url: string
  readonly method: string
  readonly headers?: Record<string, string>
  readonly body?: string
}

export type WorkerOperatorFetchResult = {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
}

/** Handle trusted worker operator HTTP-shaped request. */
export async function handleWorkerOperatorFetch(
  input: WorkerOperatorFetchInput,
): Promise<WorkerOperatorFetchResult> {
  const fetch = await createTrustedWorkerOperatorFetch({
    directory: input.directory,
    projectId: input.projectId ?? null,
    sessionId: input.sessionId,
  })
  // Force loopback URL so Host header cannot spoof non-loopback
  const path = new URL(input.url, "http://127.0.0.1").pathname + new URL(input.url, "http://127.0.0.1").search
  const request = new Request(`http://127.0.0.1${path}`, {
    method: input.method,
    headers: {
      ...(input.headers ?? {}),
      // Strip spoofable internal markers if present
      "x-forwarded-for": "",
      "x-real-ip": "",
    },
    body: input.body,
  })
  const response = await fetch(request)
  const body = await response.text()
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

export * as OperatorWorkerAdapter from "./worker-adapter"
