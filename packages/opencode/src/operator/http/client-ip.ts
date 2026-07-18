/**
 * Operator client socket IP resolution (R2).
 *
 * Production Node path: Server.listen installs a request-scoped intercept that
 * reads `IncomingMessage.socket.remoteAddress` and runs the operator handler
 * under AsyncLocalStorage — no global stale resolver required.
 *
 * Optional Bun `server.requestIP` adapter remains for Bun.serve hosts.
 * Never invents 127.0.0.1 — missing IP fails closed at the access gate.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import type { IncomingMessage, ServerResponse } from "node:http"

export type RequestIpResolver = (request: Request) => string | null

const requestScopedIp = new AsyncLocalStorage<string | null>()

/** Optional process-local fallback (tests). Prefer request-scoped ALS / getClientIp. */
let fallbackResolver: RequestIpResolver | null = null

/** @deprecated Prefer request-scoped ALS via runWithOperatorClientIp; tests may set a fallback. */
export function setOperatorRequestIpResolver(next: RequestIpResolver | null) {
  fallbackResolver = next
}

/**
 * Run operator handling with a request-scoped client IP (Node listen intercept).
 */
export function runWithOperatorClientIp<T>(ip: string | null, fn: () => T): T {
  return requestScopedIp.run(ip, fn)
}

/**
 * Resolve client IP for operator access control.
 * Order: request-scoped ALS → optional fallback resolver → null (fail-closed).
 */
export function resolveOperatorClientIp(_request?: Request): string | null {
  const scoped = requestScopedIp.getStore()
  if (scoped !== undefined) return scoped
  if (fallbackResolver && _request) return fallbackResolver(_request)
  return null
}

/**
 * Normalize Node `socket.remoteAddress` (strips IPv6-mapped IPv4 prefix).
 */
export function normalizeNodeRemoteAddress(address: string | undefined | null): string | null {
  if (!address || address.length === 0) return null
  if (address.startsWith("::ffff:")) return address.slice("::ffff:".length)
  return address
}

/**
 * Build a Bun-compatible requestIP adapter when hosting on Bun.serve.
 */
export function bunRequestIpResolver(server: {
  requestIP?: (request: Request) => { address: string } | null | undefined
}): RequestIpResolver {
  return (request) => {
    if (typeof server.requestIP !== "function") return null
    const info = server.requestIP(request)
    if (!info || typeof info.address !== "string" || info.address.length === 0) return null
    return normalizeNodeRemoteAddress(info.address)
  }
}

/** Convert Node IncomingMessage → Fetch Request (body buffered). */
export async function nodeIncomingToRequest(req: IncomingMessage): Promise<Request> {
  const host = typeof req.headers.host === "string" && req.headers.host.length > 0 ? req.headers.host : "127.0.0.1"
  const url = `http://${host}${req.url ?? "/"}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  const method = (req.method ?? "GET").toUpperCase()
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers })
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  const body = Buffer.concat(chunks)
  return new Request(url, { method, headers, body: body.byteLength > 0 ? body : undefined })
}

/** Write a Fetch Response onto a Node ServerResponse. */
export async function writeNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const buf = Buffer.from(await response.arrayBuffer())
  res.end(buf)
}

/**
 * Serve one operator request from a Node IncomingMessage with real socket IP.
 * Request-scoped IP is applied for the duration of the handler.
 */
export async function serveOperatorFromNode(
  req: IncomingMessage,
  res: ServerResponse,
  fetch: (request: Request) => Promise<Response>,
): Promise<void> {
  const ip = normalizeNodeRemoteAddress(req.socket.remoteAddress)
  try {
    const request = await nodeIncomingToRequest(req)
    const response = await runWithOperatorClientIp(ip, () => fetch(request))
    await writeNodeResponse(res, response)
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader("content-type", "application/json")
      res.end(
        JSON.stringify({
          ok: false,
          error: {
            code: "unavailable",
            message: error instanceof Error ? error.message : "operator handler failed",
          },
        }),
      )
    }
  }
}

/**
 * Install emit intercept so /operator/v1 never reaches Effect HttpRouter,
 * and always sees the real Node socket remoteAddress.
 * Lifecycle: call clear by replacing emit only while server is alive (server GC).
 */
export function installOperatorNodeHttpIntercept(
  server: { emit: (...args: any[]) => boolean },
  fetch: (request: Request) => Promise<Response>,
): () => void {
  const rawEmit = server.emit.bind(server)
  server.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (event === "request") {
      const req = args[0] as IncomingMessage
      const pathOnly = (req.url ?? "").split("?")[0] ?? ""
      if (pathOnly.startsWith("/operator/v1")) {
        const res = args[1] as ServerResponse
        void serveOperatorFromNode(req, res, fetch)
        return true
      }
    }
    return rawEmit(event, ...args)
  }) as typeof server.emit

  return () => {
    server.emit = rawEmit
  }
}

export * as OperatorClientIp from "./client-ip"
