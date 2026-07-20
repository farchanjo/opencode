/**
 * Control-plane-owned Config-backed status handlers (T036 / T040 honesty).
 * Returns version + configured/unavailable metadata only — no raw secrets/config dump.
 */
import type { HandlerContext, HandlerResult, OperatorCommandHandler } from "../../application/handler"
import type { ConfigPort } from "../../application/ports/config-port"
import { createHandlerMap, type HandlerMap } from "../../application/handler"
import { staticAuthorityForCommandId } from "../../application/command-authority"
import { AUTHORITY as SMART_AUTHORITY } from "../../smart/backend-live"

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The routing config authority a `routing.status` read must resolve for a request scope.
 * Reuses the single `SMART_AUTHORITY` SSOT (`smart`/`budget`/`pools`/`routing.configure`
 * all commit through it — Features 024/025/033): global scope → `global:routing`, every
 * other kind → the project `routing` document. A no-scope / project / session request stays
 * `routing`, so a bare `routing.status` reads exactly the authority it did pre-036.
 */
function routingStatusAuthority(scopeKind: string): string {
  return SMART_AUTHORITY[scopeKind === "global" ? "global" : "project"]
}

/**
 * Project the REDACTED activation (`enabled` + `mode`) from a routing config payload, or
 * `null` when the scoped authority holds no document. Activation flags are non-secret (the
 * `smart.status` summary already exposes `enabled`/`auto` publicly); no other payload field
 * is surfaced, so the read stays a status projection, never a config dump.
 */
function readActivation(payload: unknown): { readonly enabled: boolean; readonly mode: string } | null {
  if (!isRecord(payload) || !isRecord(payload.activation)) return null
  const activation = payload.activation
  return {
    enabled: activation.enabled === true,
    mode: typeof activation.mode === "string" ? activation.mode : "never",
  }
}

/**
 * Feature 036 — the `routing.status` READ honors the request scope. The generic
 * `createConfigStatusHandler` keyed a SCOPE-BLIND authority (`authorityKeyForCommandId`
 * always resolved the project `routing` document), so `routing.status --scope global`
 * reported `configured:false` even when a `global:routing` document was set and
 * `smart.status --scope global` correctly reported `configured:true` from that same
 * document. This handler resolves the authority from `ctx.request.scope.kind` via the shared
 * `SMART_AUTHORITY` mapping — exactly as `smart.status`/`routing.configure`/`routing.test`
 * thread the request scope — and projects the redacted activation so a scoped status agrees
 * with `smart.status` on `enabled`/`mode`. It is read-only: no write, schema, or catalog
 * change, and a bare (no-scope) request still reads the project `routing` authority.
 */
export function createRoutingStatusHandler(config: ConfigPort): OperatorCommandHandler {
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    const authority = routingStatusAuthority(ctx.request.scope.kind)
    const entry = await config.get(authority)
    return {
      kind: "query",
      version: entry?.version,
      effective: {
        id: ctx.descriptor.id,
        authority,
        configured: entry !== null,
        available: true,
        status: entry ? "configured" : "unconfigured",
        // Redacted activation projection (enabled + mode) — never the raw payload.
        activation: readActivation(entry?.payload),
        hasPayload: entry !== null,
        offlineCapable: ctx.descriptor.offlineCapable,
        source: ctx.request.source,
      },
    }
  }
}

// The config-backed status ids served by the GENERIC scope-blind handler. `routing.status`
// is deliberately NOT here — it is served by the scope-aware `createRoutingStatusHandler`
// (Feature 036). langlock/telemetry/smart/budget/pools status/show route through their real
// Feature 004/013 domain ports (port.resolve); the semantic.* entries stay config-backed.
const STATUS_SHOW_IDS = [
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
  const pairs: [string, OperatorCommandHandler][] = [
    // Feature 036 — scope-aware routing.status (global:routing under global scope).
    ["routing.status", createRoutingStatusHandler(config)],
  ]
  for (const id of STATUS_SHOW_IDS) {
    pairs.push([id, status])
  }
  // Also map any *.status / *.show under representative domains if present later
  return createHandlerMap(pairs)
}

export * as ConfigStatusHandlers from "./config-status"
