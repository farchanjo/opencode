/**
 * External TCP operator HTTP mount (T025 / T041 / R2 / R3).
 * - Mount only when configured bind is loopback (non-loopback never serves operator).
 * - Flag experimental.operator_control_plane is evaluated dynamically per request
 *   from real Config (no frozen featureEnabled; no remount required).
 * - Client IP from Bun requestIP (or injected resolver) — never invents 127.0.0.1.
 * - Production uses LIVE stack; tests may inject a test stack via `testStack`.
 */
import path from "path"
import { Global } from "@opencode-ai/core/global"
import {
  resolveOperatorControlPlaneFlag,
  type ResolveOperatorFlagInput,
} from "@opencode-ai/core/operator"
import { assertOperatorBind } from "./loopback"
import { createOperatorHttpHandler, resolveAuthFromHeaders } from "./handler"
import { getOrCreateLiveOperatorStack } from "../stack-live"
import { isOperatorDevSandbox } from "../dev-env"
import { resolveOperatorClientIp } from "./client-ip"
import type { Dispatcher } from "../application/dispatcher"
import type { OperatorCommandRegistry } from "../application/registry"
import type { MutationPorts } from "../application/mutation"

/** Minimal injected stack shape (tests) — avoids importing stack-test into production graph. */
export type InjectedOperatorHttpStack = {
  readonly dispatcher: Dispatcher
  readonly registry: OperatorCommandRegistry
  readonly mutationPorts: MutationPorts
  readonly resolveFeatureEnabled?: () => boolean | Promise<boolean>
  readonly featureEnabled?: boolean
  /** Preflight authority resolution (see command-authority.ts); optional for tests. */
  readonly resolveAuthority?: (
    commandId: string,
    scope: { readonly scopeKind: string; readonly scopeRef: string | null },
  ) => string | null
}

export type MountOperatorResult =
  | { readonly mounted: true; readonly fetch: (request: Request) => Promise<Response> }
  | { readonly mounted: false; readonly reason: string }

export type TryCreateOperatorHttpFetchInput = {
  hostname: string
  projectId?: string | null
  /**
   * Actual client socket IP. Production: Bun server.requestIP.
   * Default: process-local resolver (null unless setOperatorRequestIpResolver).
   * Never falls back to inventing 127.0.0.1.
   */
  getClientIp?: (request: Request) => string | null
  /**
   * Project directory for live Config.Service Instance scope.
   * Defaults to process.cwd() when omitted.
   */
  directory?: string
  /** TEST-ONLY: inject memory/test stack (never used by Server.listen production path). */
  testStack?: InjectedOperatorHttpStack
}

/**
 * External TCP mount.
 * Loopback bind → mount fetch that evaluates flag per request.
 * Non-loopback bind → not mounted (404 at server).
 */
export function tryCreateOperatorHttpFetch(input: TryCreateOperatorHttpFetchInput): MountOperatorResult {
  const bind = assertOperatorBind(input.hostname)
  if (!bind.ok) {
    return { mounted: false, reason: bind.reason }
  }

  const password = process.env["OPENCODE_SERVER_PASSWORD"]
  const username = process.env["OPENCODE_SERVER_USERNAME"] ?? "opencode"
  const sandboxToken = process.env["OPENCODE_OPERATOR_SANDBOX_TOKEN"]
  const getClientIp = input.getClientIp ?? resolveOperatorClientIp
  const projectId = input.projectId ?? null
  const directory = input.directory ?? process.cwd()

  if (input.testStack) {
    const stack = input.testStack
    const fetch = createOperatorHttpHandler({
      dispatcher: stack.dispatcher,
      registry: stack.registry,
      serverBind: input.hostname,
      getClientIp,
      getProjectId: () => projectId,
      injectProjectScopeWhenOmitted: false,
      config: stack.mutationPorts.config,
      resolveAuthority: stack.resolveAuthority,
      resolveFeatureEnabled: async () => {
        if (stack.resolveFeatureEnabled) return stack.resolveFeatureEnabled()
        if (typeof stack.featureEnabled === "boolean") return stack.featureEnabled
        return true
      },
      resolveAuth(req) {
        return resolveAuthFromHeaders({
          authorization: req.headers.get("authorization"),
          expectedPassword: password || undefined,
          expectedUsername: username,
          sandboxToken: sandboxToken || undefined,
          sandboxTokenHeader: req.headers.get("x-opencode-operator-token"),
        })
      },
    })
    return { mounted: true, fetch }
  }

  // Production: live stack; flag re-checked every request via Config (R3 / T041)
  let stackPromise: ReturnType<typeof getOrCreateLiveOperatorStack> | undefined
  const ensureStack = () => {
    if (!stackPromise) {
      stackPromise = getOrCreateLiveOperatorStack({
        directory,
        sandboxKeychain: isOperatorDevSandbox(),
      })
    }
    return stackPromise
  }

  void path.join(Global.Path.state, "operator-locks")

  return {
    mounted: true,
    fetch: async (request) => {
      const stack = await ensureStack()
      const enabled = await stack.resolveFeatureEnabled()
      if (!enabled) {
        return new Response(
          JSON.stringify({
            ok: false,
            kind: "operator.admin_result",
            outcome: "unavailable",
            error: {
              code: "unavailable",
              message: "operator_control_plane disabled",
              retryable: false,
            },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        )
      }
      const handler = createOperatorHttpHandler({
        dispatcher: stack.dispatcher,
        registry: stack.registry,
        serverBind: input.hostname,
        getClientIp,
        getProjectId: () => projectId,
        injectProjectScopeWhenOmitted: false,
        config: stack.mutationPorts.config,
        resolveAuthority: stack.resolveAuthority,
        resolveFeatureEnabled: () => stack.resolveFeatureEnabled(),
        resolveAuth(req) {
          return resolveAuthFromHeaders({
            authorization: req.headers.get("authorization"),
            expectedPassword: password || undefined,
            expectedUsername: username,
            sandboxToken: sandboxToken || undefined,
            sandboxTokenHeader: req.headers.get("x-opencode-operator-token"),
          })
        },
      })
      return handler(request)
    },
  }
}

/**
 * Flag helper (env/config/sandbox). Mount decision is loopback-bind only;
 * per-request availability uses resolveFeatureEnabled / Config.
 */
export function isOperatorHttpEnabled(input?: ResolveOperatorFlagInput): boolean {
  return resolveOperatorControlPlaneFlag(input ?? {}).enabled
}

export * as OperatorHttpMount from "./mount"
