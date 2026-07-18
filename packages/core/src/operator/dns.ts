/**
 * Production DNS resolver for operator SSRF (T045 residual).
 * Uses node:dns/promises.lookup with all+verbatim; fail-closed on error.
 * Tests inject mock resolvers — no real DNS required in unit suites.
 */
import type { DnsResolver } from "./ssrf"

export type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<readonly { address: string; family: number }[]>

/**
 * Safe production resolver. Inject `lookup` in tests to avoid real DNS.
 */
export function createProductionDnsResolver(options?: {
  readonly lookup?: LookupFn
}): DnsResolver {
  return async (hostname: string) => {
    try {
      const lookup =
        options?.lookup ??
        (async (host: string, opts: { all: true; verbatim: true }) => {
          const dns = await import("node:dns/promises")
          return dns.lookup(host, opts)
        })
      const results = await lookup(hostname, { all: true, verbatim: true })
      if (!results.length) return []
      return results.map((r) => r.address)
    } catch {
      // Fail closed — SSRF treats empty/error as deny
      return []
    }
  }
}

export * as OperatorDns from "./dns"
