/**
 * Domain stubs (T038–T040) — return typed HandlerResult (B2).
 * T045: semantic provider add/test validate URLs via SSRF before stub/network.
 */
import { listReservedIds, validateOperatorUrl, type DnsResolver } from "@opencode-ai/core/operator"
import type { HandlerContext, HandlerResult, OperatorCommandHandler } from "../../application/handler"
import type { ConfigPort } from "../../application/ports/config-port"
import type { DomainPorts, DomainPortName } from "../../application/ports/domain-ports"
import { DOMAIN_PORT_NAMES } from "../../application/ports/domain-ports"
import { configStatusHandlersFromPort } from "./config-status"

const CUTOVER_LEAVES = new Set(["cutover", "rollback"])

export type DomainStubOptions = {
  readonly dnsResolver?: DnsResolver
  readonly ssrfProfile?: "remote" | "local"
}

function stubInvoke(domain: DomainPortName) {
  return (ctx: HandlerContext): HandlerResult => {
    const id = String(ctx.descriptor.id)
    const leaf = id.split(".").pop() ?? id

    if (leaf === "test" || leaf === "connect" || leaf === "discover" || leaf === "validate") {
      return {
        kind: "failure",
        code: "unavailable",
        message: `${domain} backend unavailable (stub)`,
        details: { domain, stub: true },
      }
    }

    if (CUTOVER_LEAVES.has(leaf)) {
      return {
        kind: "failure",
        code: "not_implemented",
        message: `${id} not implemented; stub refuses fake cutover/rollback success`,
        details: { domain, stub: true },
      }
    }

    return {
      kind: "failure",
      code: "not_implemented",
      message: `domain handler for ${id} is not implemented`,
      details: { domain, stub: true },
    }
  }
}

function payloadUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const rec = payload as Record<string, unknown>
  for (const key of ["url", "endpoint", "baseUrl", "base_url", "providerUrl"]) {
    if (typeof rec[key] === "string" && rec[key]) return rec[key] as string
  }
  return undefined
}

/** Semantic domain: SSRF gate on provider add/test/update before any network/stub success path. */
function createSemanticInvoke(options: DomainStubOptions): (ctx: HandlerContext) => Promise<HandlerResult> | HandlerResult {
  const base = stubInvoke("semantic")
  return async (ctx) => {
    const id = String(ctx.descriptor.id)
    const needsUrl =
      id === "semantic.provider.add" ||
      id === "semantic.provider.test" ||
      id === "semantic.provider.update" ||
      id === "mcp.server.add" ||
      id === "mcp.server.test" ||
      id === "mcp.server.update"

    if (needsUrl) {
      const url = payloadUrl(ctx.request.payload)
      if (!url) {
        return {
          kind: "failure",
          code: "invalid_argument",
          message: `${id} requires payload.url for SSRF validation`,
          details: { ssrf: true },
        }
      }
      const decision = await validateOperatorUrl(url, {
        profile: options.ssrfProfile ?? "remote",
        resolver: options.dnsResolver,
      })
      if (!decision.ok) {
        return {
          kind: "failure",
          code: "invalid_argument",
          message: decision.reason,
          details: { code: decision.code, ssrf: true },
        }
      }
    }

    return base(ctx)
  }
}

export function createDomainStubs(options: DomainStubOptions = {}): DomainPorts {
  return {
    telemetry: { invoke: stubInvoke("telemetry") },
    smart: { invoke: stubInvoke("smart") },
    routing: { invoke: stubInvoke("routing") },
    budget: { invoke: stubInvoke("budget") },
    pools: { invoke: stubInvoke("pools") },
    process: { invoke: stubInvoke("process") },
    task: { invoke: stubInvoke("task") },
    jobs: { invoke: stubInvoke("jobs") },
    langlock: { invoke: stubInvoke("langlock") },
    output: { invoke: stubInvoke("output") },
    semantic: { invoke: createSemanticInvoke(options) },
    mcp: { invoke: createSemanticInvoke(options) },
  }
}

export function domainHandlerFor(ports: DomainPorts): OperatorCommandHandler {
  return (ctx) => {
    const domain = ctx.descriptor.domain as DomainPortName
    if (!(DOMAIN_PORT_NAMES as readonly string[]).includes(domain)) {
      return {
        kind: "failure",
        code: "not_implemented",
        message: `unknown domain ${domain}`,
      }
    }
    return ports[domain].invoke(ctx)
  }
}

export function handlersFromDomainPorts(
  ports: DomainPorts,
  options?: { readonly config?: ConfigPort },
): Map<string, OperatorCommandHandler> {
  const defaultHandler = domainHandlerFor(ports)
  const map = new Map<string, OperatorCommandHandler>()
  for (const id of listReservedIds()) {
    map.set(id, defaultHandler)
  }
  // T040 honesty: Config-backed status/show where safe (version + configured only)
  if (options?.config) {
    for (const [id, handler] of configStatusHandlersFromPort(options.config)) {
      map.set(id, handler)
    }
  }
  return map
}

export function wireDomainPorts(overrides?: Partial<DomainPorts>, options?: DomainStubOptions): DomainPorts {
  return { ...createDomainStubs(options), ...overrides }
}

export * as DomainStubAdapters from "./domain-stubs"
