/**
 * Feature 006 / T029 (S18) — SSRF-safe URL parsing and DNS-rebinding guard.
 *
 * Every provider/Milvus endpoint URL is parsed under a scheme/host/port policy;
 * its host is resolved and EVERY resolved address is revalidated, and the same
 * revalidation runs again after a redirect so a DNS-rebinding target that
 * resolves to a blocked address after the redirect is rejected (FR33, C17).
 * Metadata (169.254.169.254), link-local, loopback, and private ranges are
 * blocked unless an explicit local-profile allowance is set; remote endpoints
 * require TLS by default, and insecure HTTP is permitted only for an explicit
 * local profile with a visible warning. The DNS resolver is an injected port so
 * the rebinding matrix is provable without real DNS.
 */
export * as UrlGuard from "./url-guard"

/** Endpoint transport policy for one provider profile (FR33, C17). */
export interface UrlPolicy {
  /** A local profile may target private ranges over insecure HTTP with a warning. */
  readonly allowInsecureLocalProfile: boolean
}

export type UrlGuardReason =
  | { readonly type: "invalid_url"; readonly detail: string }
  | { readonly type: "scheme_not_allowed"; readonly scheme: string }
  | { readonly type: "tls_required" }
  | { readonly type: "ssrf_blocked"; readonly host: string; readonly address: string }

export type UrlGuardResult =
  | { readonly ok: true; readonly url: URL; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: UrlGuardReason }

/** The injected DNS resolver; returns every address the host resolves to (A/AAAA). */
export interface DnsResolver {
  readonly resolve: (host: string) => Promise<readonly string[]>
}

export interface GuardInput {
  readonly rawUrl: string
  readonly policy: UrlPolicy
}

/** Parse a URL, returning null on any malformed input (never throws). */
export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

const ALLOWED_SCHEMES = new Set(["https:", "http:"])

/** True for an IPv4/IPv6 address in a metadata/link-local/loopback/private range (blocked by default). */
export function isBlockedAddress(address: string): boolean {
  const host = address.trim().toLowerCase()
  if (host === "::1" || host === "::" || host === "0.0.0.0") return true
  if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) return true // IPv6 link-local + ULA
  const octets = host.split(".").map((part) => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = octets
  if (a === 127 || a === 0 || a === 10) return true
  if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function schemeChecked(url: URL): UrlGuardReason | undefined {
  if (!ALLOWED_SCHEMES.has(url.protocol)) return { type: "scheme_not_allowed", scheme: url.protocol }
  return undefined
}

function tlsChecked(url: URL, policy: UrlPolicy): UrlGuardReason | undefined {
  if (url.protocol === "http:" && !policy.allowInsecureLocalProfile) return { type: "tls_required" }
  return undefined
}

/** Revalidate every resolved address; a blocked address is rejected unless a local profile allows it. */
async function addressesChecked(
  resolver: DnsResolver,
  url: URL,
  policy: UrlPolicy,
): Promise<UrlGuardReason | undefined> {
  const addresses = await resolver.resolve(url.hostname)
  for (const address of addresses) {
    if (isBlockedAddress(address) && !policy.allowInsecureLocalProfile) {
      return { type: "ssrf_blocked", host: url.hostname, address }
    }
  }
  return undefined
}

function warningsFor(url: URL, policy: UrlPolicy): readonly string[] {
  if (url.protocol === "http:" && policy.allowInsecureLocalProfile) {
    return [`insecure http is allowed only for the explicit local profile: ${url.hostname}`]
  }
  return []
}

/**
 * Guard an endpoint URL: parse, scheme/TLS policy, then post-resolution DNS
 * revalidation of every resolved address. Returns a typed reason rather than
 * throwing (FR33, C17).
 */
export const guard = async (
  deps: { readonly resolver: DnsResolver },
  input: GuardInput,
): Promise<UrlGuardResult> => {
  const url = parseUrl(input.rawUrl)
  if (!url) return { ok: false, reason: { type: "invalid_url", detail: input.rawUrl.slice(0, 80) } }
  const scheme = schemeChecked(url)
  if (scheme) return { ok: false, reason: scheme }
  const tls = tlsChecked(url, input.policy)
  if (tls) return { ok: false, reason: tls }
  const address = await addressesChecked(deps.resolver, url, input.policy)
  if (address) return { ok: false, reason: address }
  return { ok: true, url, warnings: warningsFor(url, input.policy) }
}

/**
 * Revalidate a redirect target the SAME way as the original request (defends DNS
 * rebinding): a redirect Location that resolves to a blocked address after the
 * redirect is rejected even if the original host was allowed (FR33, C17, AC36).
 */
export const guardRedirect = async (
  deps: { readonly resolver: DnsResolver },
  input: { readonly redirectLocation: string; readonly policy: UrlPolicy },
): Promise<UrlGuardResult> => guard(deps, { rawUrl: input.redirectLocation, policy: input.policy })
