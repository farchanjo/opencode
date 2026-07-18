/**
 * SSRF URL policy for operator network domains (T045).
 * Parse → resolve → revalidate. No real network; inject DNS resolver.
 * Port validated before address accept. IPv6-mapped IPv4 (dotted + hex) covered.
 */
export type SsrfProfile = "remote" | "local"

export type SsrfDecision =
  | { readonly ok: true; readonly url: URL; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly reason: string; readonly code: "ssrf_denied" }

export type DnsResolver = (hostname: string) => Promise<readonly string[]> | readonly string[]

const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata", "localhost.localdomain"])

/** Default deny ports outside 1–65535; 0 is denied. */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/** Extract effective port from URL (defaults by scheme). */
export function effectivePort(parsed: URL, scheme: string): number {
  if (parsed.port) return Number(parsed.port)
  if (scheme === "https") return 443
  if (scheme === "http") return 80
  return NaN
}

/** IPv4 private/link-local/unspecified/loopback checks. */
export function isBlockedIpv4(ip: string, profile: SsrfProfile): boolean {
  const parts = ip.split(".").map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // invalid treated as blocked
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return true
  if (a === 127) return profile !== "local"
  if (a === 169 && b === 254) return true
  if (a === 10) return profile !== "local"
  if (a === 172 && b >= 16 && b <= 31) return profile !== "local"
  if (a === 192 && b === 168) return profile !== "local"
  if (a === 100 && b >= 64 && b <= 127) return profile !== "local"
  if (a === 255) return true
  return false
}

/**
 * Expand IPv6-mapped IPv4 forms to dotted IPv4:
 * - ::ffff:127.0.0.1
 * - ::ffff:7f00:1  (hex pairs)
 * - 0:0:0:0:0:ffff:c0a8:0101
 * - ::ffff:a00:1
 */
export function expandIpv6MappedIpv4(ip: string): string | null {
  const n = ip.toLowerCase().replace(/^\[|\]$/g, "")
  // dotted form
  const dotted = n.match(/(?:^|:)(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (dotted?.[1] && n.includes("ffff")) {
    return dotted[1]
  }
  // ::ffff:xxxx:yyyy hex
  const hex = n.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) {
      return null
    }
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".")
  }
  // full form with ffff in 6th hextet: 0:0:0:0:0:ffff:c0a8:101
  const full = n.match(/^(?:0:)*ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (full?.[1] && full[2]) {
    const hi = parseInt(full[1], 16)
    const lo = parseInt(full[2], 16)
    if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null
    return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join(".")
  }
  return null
}

export function isBlockedIpv6(ip: string, profile: SsrfProfile): boolean {
  const n = ip.toLowerCase().replace(/^\[|\]$/g, "")
  if (n === "::" || n === "0:0:0:0:0:0:0:0") return true
  if (n === "::1" || n === "0:0:0:0:0:0:0:1") return profile !== "local"
  // zone id fe80::1%eth0
  const withoutZone = n.split("%")[0] ?? n
  if (withoutZone === "::1") return profile !== "local"
  // link-local fe80::/10
  if (
    withoutZone.startsWith("fe8") ||
    withoutZone.startsWith("fe9") ||
    withoutZone.startsWith("fea") ||
    withoutZone.startsWith("feb")
  ) {
    return true
  }
  // unique local fc00::/7
  if (withoutZone.startsWith("fc") || withoutZone.startsWith("fd")) return profile !== "local"
  // IPv4-mapped
  const mapped = expandIpv6MappedIpv4(withoutZone)
  if (mapped) return isBlockedIpv4(mapped, profile)
  // also dotted after ffff
  const dotted = withoutZone.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted?.[1]) return isBlockedIpv4(dotted[1], profile)
  return false
}

export function isBlockedAddress(addr: string, profile: SsrfProfile): boolean {
  const clean = addr.replace(/^\[|\]$/g, "").split("%")[0] ?? addr
  if (clean.includes(":")) return isBlockedIpv6(clean, profile)
  return isBlockedIpv4(clean, profile)
}

/**
 * Decode decimal/octal/hex IPv4 tricks (e.g. 2130706433 → 127.0.0.1).
 */
export function expandIpv4Tricks(hostname: string): string | null {
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname)
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")
  }
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){3}$/i.test(hostname)) {
    const segs = hostname.split(".").map((s) => {
      if (/^0x/i.test(s)) return parseInt(s, 16)
      if (/^0[0-7]+$/.test(s)) return parseInt(s, 8)
      return parseInt(s, 10)
    })
    if (segs.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    return segs.join(".")
  }
  return null
}

export type ValidateUrlOptions = {
  readonly profile?: SsrfProfile
  /** Allow http when profile=local only. */
  readonly allowInsecureHttp?: boolean
  readonly resolver?: DnsResolver
  /** Follow redirect target validation (caller supplies next URL). */
  readonly isRedirect?: boolean
  /** Max redirect hops when using validateRedirectChain. */
  readonly maxRedirects?: number
}

function deny(reason: string): SsrfDecision {
  return { ok: false, code: "ssrf_denied", reason }
}

/**
 * Strict URL validation for operator network domains.
 */
export async function validateOperatorUrl(
  raw: string,
  options: ValidateUrlOptions = {},
): Promise<SsrfDecision> {
  const profile = options.profile ?? "remote"
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return deny("invalid URL")
  }

  const scheme = parsed.protocol.replace(":", "").toLowerCase()
  if (scheme === "https") {
    // ok
  } else if (scheme === "http") {
    if (profile !== "local" || !options.allowInsecureHttp) {
      return deny("http only allowed for local profile with allowInsecureHttp")
    }
  } else {
    return deny(`scheme ${scheme} denied`)
  }

  // Port first — before literal/DNS branch
  const port = effectivePort(parsed, scheme)
  if (!isValidPort(port)) {
    return deny(`invalid or disallowed port: ${parsed.port || port}`)
  }

  // userinfo denied
  if (parsed.username || parsed.password) {
    return deny("URL userinfo denied")
  }

  let hostname = parsed.hostname.toLowerCase()
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1)
  }
  // strip zone id from hostname if present
  hostname = hostname.split("%")[0] ?? hostname

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return deny(`hostname ${hostname} denied`)
  }

  // Expand IPv4 tricks before DNS
  const trick = expandIpv4Tricks(hostname)
  if (trick) {
    if (isBlockedIpv4(trick, profile)) {
      return deny(`address ${trick} denied`)
    }
    return { ok: true, url: parsed, addresses: [trick] }
  }

  // Literal IP host (IPv4 or IPv6)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (isBlockedAddress(hostname, profile)) {
      return deny(`address ${hostname} denied`)
    }
    return { ok: true, url: parsed, addresses: [hostname] }
  }

  // DNS resolve then revalidate every address
  const resolver = options.resolver ?? (async () => [] as string[])
  let addresses: readonly string[]
  try {
    addresses = await resolver(hostname)
  } catch {
    return deny("DNS resolve failed")
  }
  if (!addresses.length) {
    return deny("DNS returned no addresses")
  }
  for (const addr of addresses) {
    if (isBlockedAddress(addr, profile)) {
      return deny(`resolved address ${addr} denied (possible rebinding)`)
    }
  }

  return { ok: true, url: parsed, addresses }
}

/** Validate redirect Location against same policy (re-resolve). */
export async function validateRedirectUrl(
  location: string,
  options: ValidateUrlOptions = {},
): Promise<SsrfDecision> {
  return validateOperatorUrl(location, { ...options, isRedirect: true })
}

/**
 * Validate a redirect chain; each hop revalidated; hop limit enforced.
 * No real network — caller supplies Location values.
 */
export async function validateRedirectChain(
  locations: readonly string[],
  options: ValidateUrlOptions = {},
): Promise<SsrfDecision> {
  const max = options.maxRedirects ?? 5
  if (locations.length > max) {
    return deny(`redirect hop limit exceeded (${locations.length} > ${max})`)
  }
  let last: SsrfDecision = deny("empty redirect chain")
  for (const loc of locations) {
    last = await validateRedirectUrl(loc, options)
    if (!last.ok) return last
  }
  return last
}

export * as OperatorSsrf from "./ssrf"
