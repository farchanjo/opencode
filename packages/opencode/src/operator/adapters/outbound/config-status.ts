/**
 * Control-plane-owned Config-backed status handlers (T036 / T040 honesty).
 * Returns version + configured/unavailable metadata only — no raw secrets/config dump.
 */
import type { HandlerContext, HandlerResult, OperatorCommandHandler } from "../../application/handler"
import type { ConfigPort } from "../../application/ports/config-port"
import { createHandlerMap, type HandlerMap } from "../../application/handler"
import { staticAuthorityForCommandId } from "../../application/command-authority"
import { AUTHORITY as SMART_AUTHORITY } from "../../smart/backend-live"
import { createConfigAdapter } from "@/routing/adapters/outbound/config-adapter"

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

/** The shape a `routing.status` read projects for one resolved scope (redacted activation only). */
interface RoutingStatusProjection {
  readonly authority: string
  readonly version: string | undefined
  readonly configured: boolean
  readonly activation: { readonly enabled: boolean; readonly mode: string } | null
}

/** Build the `routing.status` query result for a resolved-scope projection (shared shape). */
function routingStatusResult(ctx: HandlerContext, projection: RoutingStatusProjection): HandlerResult {
  return {
    kind: "query",
    version: projection.version,
    effective: {
      id: ctx.descriptor.id,
      authority: projection.authority,
      configured: projection.configured,
      available: true,
      status: projection.configured ? "configured" : "unconfigured",
      // Redacted activation projection (enabled + mode) — never the raw payload.
      activation: projection.activation,
      hasPayload: projection.configured,
      offlineCapable: ctx.descriptor.offlineCapable,
      source: ctx.request.source,
    },
  }
}

/**
 * Feature 040 — the `routing.status` READ prefills the operator Configure modal, so it must
 * report the EFFECTIVE (document-shadowed) activation the `op` CLI status surfaces report —
 * reaching parity with `smart.status`. Feature 036 made this handler scope-aware but kept a
 * SINGLE `config.get`, so a project/bare read reported `configured:false` under a global-only
 * config (its accepted residual). Option A (ADR-0040) resolves the layered effective config
 * (`resolveEffective`: project > global > default — the SAME read `smart.status` consumes)
 * for a project/bare scope, so a persisted `global:routing` activation shadows in; an EXPLICIT
 * `global` scope still reads `global:routing` directly (Feature 036, unchanged). The write-
 * target authority (`routing` at project scope) and the redacted activation projection agree
 * with `smart.status`. Read-only: no write, schema, or catalog change. This deliberately
 * SUPERSEDES the Feature 036 project/bare `configured:false` residual (recorded in ADR-0040
 * and the ADR-0036 residual note).
 */
export function createRoutingStatusHandler(config: ConfigPort): OperatorCommandHandler {
  const routing = createConfigAdapter({ config })
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    // Explicit global scope reads the `global:routing` document directly (Feature 036).
    if (ctx.request.scope.kind === "global") {
      const entry = await config.get(SMART_AUTHORITY.global)
      return routingStatusResult(ctx, {
        authority: SMART_AUTHORITY.global,
        version: entry?.version,
        configured: entry !== null,
        activation: readActivation(entry?.payload),
      })
    }
    // Project / bare / session / root-tree: the shadowed effective read (project > global >
    // default). The reported `authority` is the project write target — agreeing with
    // `smart.status`; the CAS-relevant version follows that write-target authority.
    const effective = await routing.resolveEffective()
    const project = await routing.get("project")
    const shadowed = effective.origin !== "default"
    return routingStatusResult(ctx, {
      authority: SMART_AUTHORITY.project,
      version: project.version ?? undefined,
      configured: shadowed,
      activation: shadowed
        ? { enabled: effective.config.activation.enabled, mode: effective.config.activation.mode }
        : null,
    })
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
