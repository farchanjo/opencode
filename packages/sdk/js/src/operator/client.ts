/**
 * Internal operator HTTP client (T027) — typed envelope + catalog parity.
 * Uses same reserved IDs as CLI/registry (imported from core when available).
 */
export type OperatorClientOptions = {
  readonly baseUrl: string
  /** Authorization header value, e.g. `Basic …` */
  readonly authorization?: string
  readonly sandboxToken?: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

export type OperatorCommandBody = {
  readonly id: string
  readonly scope?: { kind: string; ref: string | null }
  readonly version?: string
  readonly idempotencyKey?: string
  readonly confirm?: boolean
  readonly payload?: unknown
  /** Never used as authority — server binds principal from auth. */
  readonly principal?: unknown
}

export type OperatorClientResult = {
  readonly ok: boolean
  readonly id: string
  readonly outcome: string
  readonly version?: string
  readonly effective?: unknown
  readonly auditId?: string
  readonly kind?: string
  readonly error?: { code: string; message: string; retryable?: boolean }
  readonly httpStatus: number
}

export class OperatorClient {
  readonly #baseUrl: string
  readonly #authorization?: string
  readonly #sandboxToken?: string
  readonly #fetch: typeof globalThis.fetch
  readonly #timeoutMs: number

  constructor(options: OperatorClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "")
    this.#authorization = options.authorization
    this.#sandboxToken = options.sandboxToken
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#timeoutMs = options.timeoutMs ?? 30_000
  }

  async health(signal?: AbortSignal): Promise<{ ok: boolean; service?: string }> {
    const res = await this.#request("GET", "/operator/v1/health", undefined, signal)
    return (await res.json()) as { ok: boolean; service?: string }
  }

  async registry(signal?: AbortSignal): Promise<{
    ok: boolean
    catalogVersion?: string
    ids?: string[]
    commands?: unknown[]
  }> {
    const res = await this.#request("GET", "/operator/v1/registry", undefined, signal)
    return (await res.json()) as {
      ok: boolean
      catalogVersion?: string
      ids?: string[]
      commands?: unknown[]
    }
  }

  async command(body: OperatorCommandBody, signal?: AbortSignal): Promise<OperatorClientResult> {
    const res = await this.#request("POST", "/operator/v1/commands", body, signal)
    const json = (await res.json()) as Omit<OperatorClientResult, "httpStatus">
    return { ...json, httpStatus: res.status }
  }

  async #request(
    method: string,
    path: string,
    body: unknown | undefined,
    outer?: AbortSignal,
  ): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs)
    const onAbort = () => ctrl.abort()
    outer?.addEventListener("abort", onAbort)
    try {
      const headers: Record<string, string> = {
        accept: "application/json",
      }
      if (this.#authorization) headers.authorization = this.#authorization
      if (this.#sandboxToken) headers["x-opencode-operator-token"] = this.#sandboxToken
      if (body !== undefined) headers["content-type"] = "application/json"
      if (body && typeof body === "object" && body !== null && "idempotencyKey" in body) {
        const key = (body as { idempotencyKey?: string }).idempotencyKey
        if (key) headers["idempotency-key"] = key
      }
      return await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener("abort", onAbort)
    }
  }
}

export function createOperatorClient(options: OperatorClientOptions): OperatorClient {
  return new OperatorClient(options)
}

export * as OperatorSdkClient from "./client.js"
