/**
 * Loopback / bind / origin policy (T025/T028) — no Host/header trust for authority.
 *
 * Authority sources:
 * - configured server listen hostname (must be loopback to mount operator)
 * - actual client socket IP from server runtime (requestIP / remoteAddress)
 *
 * Host header, X-Forwarded-For, X-Real-IP, x-opencode-socket-host are NEVER authority.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]", "0:0:0:0:0:0:0:1"])

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.trim().toLowerCase().split("%")[0]!
  const bare = h.startsWith("[")
    ? h.slice(1, h.indexOf("]"))
    : h.includes(":") && !h.startsWith("::")
      ? h.slice(0, h.lastIndexOf(":"))
      : h
  if (LOOPBACK.has(bare) || LOOPBACK.has(h)) return true
  if (bare === "127.0.0.1" || bare.startsWith("127.")) return true
  if (bare === "::ffff:127.0.0.1" || h.endsWith("127.0.0.1")) return true
  return false
}

export type PolicyOk = { ok: true }
export type PolicyFail = { ok: false; reason: string }
export type PolicyResult = PolicyOk | PolicyFail

/**
 * Server may only serve operator routes when the configured bind is loopback.
 * Non-loopback bind (0.0.0.0, LAN IP) → do not mount / return 404 at gate.
 */
export function assertOperatorBind(hostname: string): PolicyResult {
  if (!isLoopbackHost(hostname)) {
    return { ok: false, reason: `operator V1 forbids non-loopback bind: ${hostname}` }
  }
  return { ok: true }
}

/**
 * Request gate: server bind must be loopback AND client socket IP must be loopback.
 * Does not consult Host, X-Forwarded-For, or any client-supplied socket header.
 */
export function assertOperatorRequestAccess(input: {
  /** Configured listen hostname (from Server.listen opts). */
  serverBind: string
  /** Actual remote socket address from server runtime; null if unknown. */
  clientIp: string | null
}): PolicyResult {
  const bind = assertOperatorBind(input.serverBind)
  if (!bind.ok) return bind
  if (input.clientIp === null) {
    // Unknown client IP on a loopback bind: allow only when tests inject loopback explicitly.
    // Production Bun/Node should always provide requestIP.
    return { ok: false, reason: "operator request missing client socket IP" }
  }
  if (!isLoopbackHost(input.clientIp)) {
    return { ok: false, reason: `operator V1 requires loopback client socket (got ${input.clientIp})` }
  }
  return { ok: true }
}

/**
 * Origin for POST: omit Origin is allowed on loopback-only mounts (curl).
 * Non-loopback Origin rejected. No CORS wildcard.
 * Only meaningful when operator is mounted on loopback bind.
 */
export function assertOriginPolicy(input: {
  method: string
  origin: string | null
}): PolicyResult {
  if (input.method === "GET" || input.method === "HEAD" || input.method === "OPTIONS") {
    return { ok: true }
  }
  if (!input.origin || input.origin === "null") {
    // Documented: missing Origin allowed only because mount is loopback-only (T028).
    return { ok: true }
  }
  try {
    const u = new URL(input.origin)
    if (!isLoopbackHost(u.hostname)) {
      return { ok: false, reason: `Origin ${input.origin} is not loopback (V1)` }
    }
  } catch {
    return { ok: false, reason: "invalid Origin header" }
  }
  return { ok: true }
}

/** @deprecated use assertOperatorRequestAccess — kept name for tests that only check IP shape. */
export function assertLoopbackRequest(input: {
  serverBind: string
  clientIp: string | null
}): PolicyResult {
  return assertOperatorRequestAccess(input)
}

export * as OperatorLoopback from "./loopback"
