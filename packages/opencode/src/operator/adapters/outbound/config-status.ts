/**
 * Control-plane-owned Config-backed status handlers (T036 / T040 honesty).
 * Returns version + configured/unavailable metadata only — no raw secrets/config dump.
 */
import type { HandlerContext, HandlerResult, OperatorCommandHandler } from "../../application/handler"
import type { ConfigPort } from "../../application/ports/config-port"
import { createHandlerMap, type HandlerMap } from "../../application/handler"

/** Map domain / command prefix → Config authority key. */
export function authorityKeyForCommandId(commandId: string): string {
  const domain = commandId.split(".")[0] ?? commandId
  // semantic uses "semantic" authority; others use domain name
  return domain
}

/**
 * Safe status/show query: ConfigPort.get only — never expands secret material.
 */
export function createConfigStatusHandler(config: ConfigPort, authority?: string): OperatorCommandHandler {
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    const key = authority ?? authorityKeyForCommandId(String(ctx.descriptor.id))
    const entry = await config.get(key)
    return {
      kind: "query",
      version: entry?.version,
      effective: {
        id: ctx.descriptor.id,
        authority: key,
        configured: entry !== null,
        available: true,
        status: entry ? "configured" : "unconfigured",
        // never dump payload / secrets
        hasPayload: entry !== null,
        offlineCapable: ctx.descriptor.offlineCapable,
        source: ctx.request.source,
      },
    }
  }
}

const STATUS_SHOW_IDS = [
  // langlock.status/langlock.show intentionally excluded: they dispatch through the
  // Feature 004 domain port (port.resolve) so they render the effective redacted policy
  // and degrade to the typed unavailable envelope, matching jobs/semantic parity.
  "telemetry.status",
  "telemetry.show",
  "smart.status",
  "routing.status",
  "budget.status",
  "budget.show",
  "pools.status",
  "pools.show",
  "semantic.embedding.show",
  "semantic.binding.status",
  "semantic.index.status",
] as const

/**
 * Wire Config-backed status handlers for representative query IDs.
 * Domain mutations remain stubs (not_implemented / unavailable).
 */
export function configStatusHandlersFromPort(config: ConfigPort): HandlerMap {
  const status = createConfigStatusHandler(config)
  const pairs: [string, OperatorCommandHandler][] = []
  for (const id of STATUS_SHOW_IDS) {
    pairs.push([id, status])
  }
  // Also map any *.status / *.show under representative domains if present later
  return createHandlerMap(pairs)
}

export * as ConfigStatusHandlers from "./config-status"
