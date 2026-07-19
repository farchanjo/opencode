/**
 * Feature 008 / T029 (S19) — the runtime resource adapter (canonical data plane).
 *
 * Exposes runtime `list`/`templates`/`read` under `mcp:<server>:*` Permission (the
 * existing `list_mcp_resources`/`list_mcp_resource_templates`/`read_mcp_resource`
 * tool shapes preserved), wires subscribe/unsubscribe to the Feature 008 core
 * `SubscriptionMachine` under the server capability + operator grant, enforces the
 * URI allowlist (SSRF-safe: `https` + roots-scoped, `file` confined to authorized
 * roots, every other scheme deny-by-default), keeps `resource_link` LAZY (auto-fetch
 * only under policy/Permission/budget, routed through the spool bridge), and FAILS
 * CLOSED on any unauthorized subscribe/read/delivery. The LLM never subscribes
 * (subscription is operator-authority only, C10). Pure over injected permission +
 * subscription authority; the SDK read itself is performed by the host (FR19, FR21,
 * FR22, FR25, FR26, C10, C11, C12).
 */
export * as McpResourceAdapter from "./resource-adapter"

import { SubscriptionMachine } from "@opencode-ai/core/mcp/subscription-machine"
import type { SubscriptionState } from "@opencode-ai/core/mcp/subscription-machine"

/** The URI allowlist posture: `https` + declared roots always allowed; `file` only within roots (C12). */
export interface UriAllowlistConfig {
  /** Allowed non-file schemes (default `https`); loopback `http` may be added by config (FR25, C12). */
  readonly schemes: ReadonlySet<string>
  /** Authorized project/session roots for `file` URIs; a `file` outside these fails closed (C12). */
  readonly roots: ReadonlyArray<string>
  /** When set, loopback hosts (127.0.0.0/8, ::1) are permitted for an allowlisted scheme (OAuth callback; FR25, C12). */
  readonly allowLoopback?: boolean
}

export type UriDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "scheme_denied" | "cross_root_denied" | "ssrf_blocked" | "malformed" }

/** An IP-literal host classification for the SSRF guard (FR25, C12). */
interface HostClass {
  readonly blocked: boolean
  readonly loopback: boolean
}

/**
 * Classify a URL hostname as an SSRF-sensitive IP literal. Loopback (127.0.0.0/8,
 * ::1), link-local incl. the cloud metadata endpoint (169.254.0.0/16, fe80::/10),
 * private (10/8, 172.16/12, 192.168/16), unique-local (fc00::/7) and the unspecified
 * address are blocked; a DNS name is not an IP literal and passes (resolution-time
 * SSRF is out of scope for this pure gate). Pure.
 */
function classifyHost(hostname: string): HostClass {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase()
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127) return { blocked: true, loopback: true }
    const priv = a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
    return { blocked: priv, loopback: false }
  }
  if (host === "::1") return { blocked: true, loopback: true }
  if (host === "::" || /^fe[89ab]/.test(host) || /^f[cd]/.test(host)) return { blocked: true, loopback: false }
  return { blocked: false, loopback: false }
}

/**
 * Decide whether a resource URI may be fetched. `https` (and any configured scheme)
 * is allowed; `file` is allowed only when confined to an authorized root; every
 * other scheme is deny-by-default; and an allowlisted scheme pointing at an
 * SSRF-sensitive IP literal (loopback/link-local/metadata/private) is blocked unless
 * `allowLoopback` explicitly permits a loopback host. Prevents sibling-session,
 * cross-project, and SSRF/metadata-endpoint leakage (FR25, FR36, C12). Pure.
 */
export function checkUriAllowed(uri: string, config: UriAllowlistConfig): UriDecision {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return { allowed: false, reason: "malformed" }
  }
  const scheme = parsed.protocol.replace(/:$/, "")
  if (scheme === "file") {
    const path = decodeURIComponent(parsed.pathname)
    const withinRoot = config.roots.some((root) => path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`))
    return withinRoot ? { allowed: true } : { allowed: false, reason: "cross_root_denied" }
  }
  if (!config.schemes.has(scheme)) return { allowed: false, reason: "scheme_denied" }
  const host = classifyHost(parsed.hostname)
  if (host.blocked && !(host.loopback && config.allowLoopback === true)) return { allowed: false, reason: "ssrf_blocked" }
  return { allowed: true }
}

export interface ResourceAuthority {
  readonly serverCapable: boolean
  readonly operatorGranted: boolean
}

/** Subscribe outcome mirroring the core machine; the LLM can never satisfy the authority (C10). */
export type SubscribeOutcome =
  | { readonly kind: "subscribing"; readonly state: SubscriptionState }
  | { readonly kind: "fail_closed"; readonly reason: SubscriptionMachine.FailClosedReason }

/**
 * Begin a subscription from `unsubscribed` under the dual authority (server
 * capability AND operator grant). Delegates to the core machine so the LLM never
 * subscribes; a missing capability or grant fails closed (FR21, C10).
 */
export function beginSubscribe(authority: ResourceAuthority): SubscribeOutcome {
  const result = SubscriptionMachine.apply("unsubscribed", "subscribe", authority)
  if (result.kind === "transition") return { kind: "subscribing", state: result.to }
  if (result.kind === "fail_closed") return { kind: "fail_closed", reason: result.reason }
  return { kind: "fail_closed", reason: "unauthorized" }
}

/** Whether a runtime read/delivery is authorized for the current subscription state (C10). */
export const deliveryAuthorized = (state: SubscriptionState): boolean => SubscriptionMachine.deliveryAuthorized(state)

/** Whether a `resource_link` should auto-fetch now: only under an explicit policy/Permission/budget gate (C11). */
export function shouldAutoFetchLink(input: {
  readonly policyOptIn: boolean
  readonly permitted: boolean
  readonly withinBudget: boolean
}): boolean {
  return input.policyOptIn && input.permitted && input.withinBudget
}
