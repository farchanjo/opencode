import * as Effect from "effect/Effect"
import { createOperatorClient, type OperatorClientResult } from "@opencode-ai/sdk/operator"
import { Daemon } from "../services/daemon"

/**
 * Feature 001 / T032–T033 — CLI operator dispatch seam.
 *
 * The CLI package holds no management authority of its own: every routing,
 * smart and telemetry surface dispatches a reserved Feature 007 command id
 * through the operator control plane over the running server's loopback HTTP
 * endpoint. The application services (packages/opencode/src/routing/*) are never
 * imported directly — the CLI reaches them exactly like `debug agents` reaches
 * the v2 API, via the daemon transport. Zero model calls happen here.
 */

export type OperatorScopeKind = "global" | "project"

export interface OperatorScope {
  readonly kind: OperatorScopeKind
  readonly ref: string | null
}

/** Build an operator scope from a `--scope` flag; project scope binds the cwd. */
export function scopeFromFlag(kind: OperatorScopeKind, directory: string = process.cwd()): OperatorScope {
  return kind === "project" ? { kind: "project", ref: directory } : { kind: "global", ref: null }
}

/** Extract the Authorization header the daemon transport attaches, in any HeadersInit shape. */
export function authorizationHeader(headers: RequestInit["headers"]): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get("authorization") ?? undefined
  if (Array.isArray(headers)) {
    const found = headers.find(([name]) => name.toLowerCase() === "authorization")
    return found?.[1]
  }
  const record = headers as Record<string, string>
  return record.Authorization ?? record.authorization
}

export interface DispatchInput {
  readonly id: string
  readonly scope?: OperatorScope
  readonly payload?: unknown
  readonly idempotencyKey?: string
}

/** Dispatch a reserved operator command and return the typed envelope. */
export const dispatch = (input: DispatchInput): Effect.Effect<OperatorClientResult, Error, Daemon.Service> =>
  Effect.gen(function* () {
    const daemon = yield* Daemon.Service
    const transport = yield* Effect.mapError(daemon.transport(), (cause) =>
      cause instanceof Error ? cause : new Error("Failed to reach the operator control plane", { cause }),
    )
    const client = createOperatorClient({
      baseUrl: transport.url,
      authorization: authorizationHeader(transport.headers),
    })
    return yield* Effect.tryPromise({
      try: (signal) =>
        client.command(
          { id: input.id, scope: input.scope, payload: input.payload, idempotencyKey: input.idempotencyKey },
          signal,
        ),
      catch: (cause) => new Error(`operator command ${input.id} failed`, { cause }),
    })
  })

export * as Dispatch from "./dispatch"
