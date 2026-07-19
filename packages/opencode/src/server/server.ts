import "./init-projectors"

import { NodeHttpServer } from "@effect/platform-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ConfigProvider, Context, Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import net from "node:net"
import { installOperatorNodeHttpIntercept } from "@/operator/http/client-ip"
import { MDNS } from "./mdns"
import { HttpApiApp } from "./routes/instance/httpapi/server"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"
import { WebSocketTracker } from "./routes/instance/httpapi/websocket-tracker"
import { PublicApi } from "./routes/instance/httpapi/public"
import type { CorsOptions } from "@opencode-ai/server/cors"
import { lazy } from "@/util/lazy"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

type ListenOptions = CorsOptions & {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
}
type ListenerState = {
  scope: Scope.Scope
  server: Context.Service.Shape<typeof HttpServer.HttpServer>
  http: ListenerServer
  websockets: WebSocketTracker.Interface
}
type EffectListener = Omit<Listener, "stop"> & {
  stop: (close?: boolean) => Effect.Effect<void>
}

interface ListenerServer {
  readonly closeAll: Effect.Effect<void>
}

class ListenerServerService extends Context.Service<ListenerServerService, ListenerServer>()(
  "@opencode/ListenerServer",
) {}

export const Default = lazy(() => {
  const handler = HttpApiApp.webHandler().handler
  const app: ServerApp = {
    // Operator V1 (T025): /operator/v1/* served when setOperatorFetch was called from listen()
    // under operator_control_plane flag + loopback bind. Unmounted → falls through to 404 HttpApi.
    fetch: async (request: Request) => {
      const url = new URL(request.url, "http://127.0.0.1")
      if (url.pathname.startsWith("/operator/v1")) {
        const op = getOperatorFetch()
        if (op) return op(request)
        return new Response(JSON.stringify({ ok: false, error: { code: "not_found", message: "operator routes not mounted" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      }
      return handler(request, HttpApiApp.context)
    },
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return { app }
})

/** Process-local operator fetch — set only by listen()/tests via setOperatorFetch. */
let operatorFetch: ((request: Request) => Promise<Response>) | undefined

export function setOperatorFetch(fetch: ((request: Request) => Promise<Response>) | undefined) {
  operatorFetch = fetch
}

export function getOperatorFetch() {
  return operatorFetch
}

export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

export let url: URL | undefined

/**
 * Active operator fetch for Node listen intercept (request-scoped IP via ALS).
 * Set only for the duration of Server.listen; cleared on stop.
 */
let activeOperatorNodeFetch: ((request: Request) => Promise<Response>) | undefined
let clearOperatorNodeIntercept: (() => void) | undefined

export async function listen(opts: ListenOptions): Promise<Listener> {
  // Operator: mount only on loopback bind; flag evaluated per request from Config (T041/R3).
  // Real client IP: Node IncomingMessage.socket.remoteAddress via emit intercept (R2).
  // Production path is NodeHttpServer (not Bun.serve); Bun requestIP adapter remains for Bun hosts.
  const { tryCreateOperatorHttpFetch } = await import("@/operator/http/mount")
  const { setOperatorRequestIpResolver, resolveOperatorClientIp } = await import("@/operator/http/client-ip")
  const mount = tryCreateOperatorHttpFetch({
    hostname: opts.hostname,
    directory: process.cwd(),
    getClientIp: (request) => resolveOperatorClientIp(request),
  })
  activeOperatorNodeFetch = mount.mounted ? mount.fetch : undefined
  if (mount.mounted) {
    setOperatorFetch(mount.fetch)
  } else {
    setOperatorFetch(undefined)
  }

  const listener = await Effect.runPromise(listenEffect(opts))
  return {
    hostname: listener.hostname,
    port: listener.port,
    url: listener.url,
    stop: (close?: boolean) =>
      Effect.runPromiseExit(listener.stop(close)).then(() => {
        clearOperatorNodeIntercept?.()
        clearOperatorNodeIntercept = undefined
        activeOperatorNodeFetch = undefined
        setOperatorFetch(undefined)
        setOperatorRequestIpResolver(null)
        return undefined
      }),
  }
}

const listenEffect: (opts: ListenOptions) => Effect.Effect<EffectListener, unknown> = Effect.fn("Server.listen")(
  function* (opts: ListenOptions) {
    const state = yield* startWithPortFallback(opts)
    const address = yield* tcpAddress(state)
    const listenerUrl = makeURL(opts.hostname, address.port)
    const unpublishMdns = yield* setupMdns(opts, address.port, state.scope)
    url = listenerUrl

    return {
      hostname: opts.hostname,
      port: address.port,
      url: listenerUrl,
      stop: yield* makeStop(state, unpublishMdns, listenerUrl),
    }
  },
)

function listenerLayer(opts: ListenOptions, port: number) {
  return HttpRouter.serve(HttpApiApp.createRoutes(opts), {
    middleware: disposeMiddleware,
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provideMerge(AppNodeBuilder.build(WebSocketTracker.node)),
    Layer.provideMerge(serverLayer({ port, hostname: opts.hostname })),
    // Install a fresh `ConfigProvider` per listener so `Config.string(...)`
    // reads reflect the current `process.env`. Effect's default
    // `ConfigProvider` snapshots `process.env` on first read and caches the
    // result on a module-singleton Reference; without overriding it here,
    // every later `Server.listen()` keeps observing that initial snapshot.
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  )
}

// Probe-bind the wildcard address to detect a foreign process that already
// holds the port. A plain loopback bind spuriously succeeds under SO_REUSEADDR
// even when another process owns `0.0.0.0:<port>`, so the probe must widen to
// `0.0.0.0` to observe the conflict. The probe closes immediately; the real
// listener keeps its configured `opts.hostname` bind.
function isWildcardPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => resolve(false))
    probe.once("listening", () => probe.close(() => resolve(true)))
    probe.listen(port, "0.0.0.0")
  })
}

function startWithPortFallback(opts: ListenOptions) {
  if (opts.port !== 0) return startListener(opts, opts.port)
  // Match the legacy listener port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port. Only prefer 4096 when it is genuinely free
  // at the wildcard level; a foreign `0.0.0.0:4096` occupant must not be
  // shadowed by a spurious loopback bind. The retained `Effect.catch` still
  // covers a loopback-specific occupant and the probe/bind TOCTOU window.
  return Effect.promise(() => isWildcardPortFree(4096)).pipe(
    Effect.flatMap((free) =>
      free ? startListener(opts, 4096).pipe(Effect.catch(() => startListener(opts, 0))) : startListener(opts, 0),
    ),
  )
}

function startListener(opts: ListenOptions, port: number) {
  const scope = Scope.makeUnsafe()
  return Layer.buildWithMemoMap(listenerLayer(opts, port), Layer.makeMemoMapUnsafe(), scope).pipe(
    Effect.provide(HttpApiApp.context),
    Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    Effect.map(
      (ctx): ListenerState => ({
        scope,
        server: Context.get(ctx, HttpServer.HttpServer),
        http: Context.get(ctx, ListenerServerService),
        websockets: Context.get(ctx, WebSocketTracker.Service),
      }),
    ),
  )
}

function tcpAddress(state: ListenerState) {
  return Effect.gen(function* () {
    if (state.server.address._tag === "TcpAddress") return state.server.address
    yield* Scope.close(state.scope, Exit.void).pipe(Effect.ignore)
    return yield* Effect.die(new Error(`Unexpected HttpServer address tag: ${state.server.address._tag}`))
  })
}

function makeURL(hostname: string, port: number) {
  const result = new URL("http://localhost")
  result.hostname = hostname
  result.port = String(port)
  return result
}

function setupMdns(opts: ListenOptions, port: number, scope: Scope.Scope) {
  return Effect.gen(function* () {
    const publish =
      opts.mdns && port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
    if (publish) {
      const unpublish = yield* Effect.cached(Effect.sync(() => MDNS.unpublish()))
      yield* Effect.sync(() => MDNS.publish(port, opts.mdnsDomain))
      yield* Scope.addFinalizer(scope, unpublish)
      return unpublish
    }
    if (opts.mdns) {
      yield* Effect.logWarning("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }
    return Effect.void
  })
}

function makeStop(state: ListenerState, unpublishMdns: Effect.Effect<void>, listenerUrl: URL) {
  return Effect.gen(function* () {
    const forceCloseOnce = yield* Effect.cached(forceClose(state).pipe(Effect.ignore))
    const closeScopeOnce = yield* Effect.cached(
      Scope.close(state.scope, Exit.void).pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            if (url === listenerUrl) url = undefined
          }),
        ),
      ),
    )

    return (close?: boolean) =>
      Effect.gen(function* () {
        yield* unpublishMdns
        if (close) yield* forceCloseOnce
        yield* closeScopeOnce
      })
  })
}

function forceClose(state: ListenerState) {
  return Effect.all([state.http.closeAll, state.websockets.closeAll], { concurrency: "unbounded", discard: true })
}

function serverLayer(opts: { port: number; hostname: string }) {
  const server = createServer()
  // R2: intercept /operator/v1 before Effect HttpRouter so every request sees
  // the real Node socket remoteAddress (request-scoped ALS). Non-operator traffic
  // is unchanged. Intercept is cleared on listener stop.
  if (activeOperatorNodeFetch) {
    clearOperatorNodeIntercept?.()
    clearOperatorNodeIntercept = installOperatorNodeHttpIntercept(server, activeOperatorNodeFetch)
  }
  const serverRef = { closeStarted: false, forceStop: false }
  const close = server.close.bind(server)
  // Keep shutdown owned by NodeHttpServer, but honor listener.stop(true) by
  // force-closing active HTTP sockets when its finalizer calls server.close().
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Node's overloads don't preserve a monkey-patched method assignment.
  server.close = ((callback?: Parameters<typeof server.close>[0]) => {
    serverRef.closeStarted = true
    const result = close(callback)
    if (serverRef.forceStop) server.closeAllConnections()
    return result
  }) as typeof server.close

  return Layer.mergeAll(
    NodeHttpServer.layer(() => server, { port: opts.port, host: opts.hostname, gracefulShutdownTimeout: "1 second" }),
    Layer.succeed(ListenerServerService)(
      ListenerServerService.of({
        closeAll: Effect.sync(() => {
          serverRef.forceStop = true
          if (serverRef.closeStarted) server.closeAllConnections()
        }),
      }),
    ),
  )
}

export * as Server from "./server"
