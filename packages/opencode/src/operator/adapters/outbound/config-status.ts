/**
 * Control-plane-owned Config-backed status handlers (T036 / T040 honesty).
 * Returns version + configured/unavailable metadata only — no raw secrets/config dump.
 */
import type { HandlerContext, HandlerResult, OperatorCommandHandler } from "../../application/handler"
import type { ConfigPort } from "../../application/ports/config-port"
import { createHandlerMap, type HandlerMap } from "../../application/handler"
import { staticAuthorityForCommandId } from "../../application/command-authority"

/**
 * Map a command id → the Config authority it commits to, for a preflight path that
 * did NOT thread the full `createOperatorAuthorityResolver`. It consults the SAME
 * domain command→authority SSOT (`staticAuthorityForCommandId`) the wired resolver
 * uses, so a scope-independent static command resolves correctly by construction
 * (`pools.set → "routing"`, not the id prefix `"pools"` — the Feature 021 root
 * fix). A scope-dependent (`smart`/`budget`/`routing`/`langlock`, `output`
 * retention/quota) or unknown/non-mutating id keeps the prefix fallback (no
 * regression) — those are reached only through the wired resolver in production.
 */
export function authorityKeyForCommandId(commandId: string): string {
  return staticAuthorityForCommandId(commandId) ?? commandId.split(".")[0] ?? commandId
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
  // langlock.status/show and (Feature 013) telemetry.status/show, smart.status,
  // budget.status/show, pools.status/show are intentionally excluded: they dispatch
  // through their real Feature 004/013 domain ports (port.resolve) so they render the
  // effective redacted config and degrade to the typed unavailable envelope, matching
  // jobs/semantic parity. routing.status and the semantic.* entries stay config-backed.
  "routing.status",
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
