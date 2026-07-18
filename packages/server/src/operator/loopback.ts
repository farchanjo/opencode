/**
 * Re-export operator bind policy for packages/server consumers (T028).
 * Single implementation lives in opencode operator/http/loopback — this package
 * keeps a minimal independent copy to avoid reverse dependency on opencode.
 * Keep in sync with packages/opencode/src/operator/http/loopback.ts isLoopbackHost.
 */
export function isOperatorLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h === "[::1]" ||
    h.startsWith("127.") ||
    h === "::ffff:127.0.0.1"
  )
}

export function assertOperatorV1Bind(hostname: string): { ok: true } | { ok: false; reason: string } {
  if (!isOperatorLoopbackHost(hostname)) {
    return { ok: false, reason: `operator V1 forbids non-loopback bind: ${hostname}` }
  }
  return { ok: true }
}

export * as ServerOperatorLoopback from "./loopback"
