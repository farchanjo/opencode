/**
 * Server mount entry points (T025).
 * HttpApi group deferred; live path is Server.listen → tryCreateOperatorHttpFetch → setOperatorFetch.
 */
import type { OperatorHttpDeps } from "./handler"
import { createOperatorHttpHandler } from "./handler"

export function createOperatorFetch(deps: OperatorHttpDeps): (request: Request) => Promise<Response> {
  return createOperatorHttpHandler(deps)
}

export * as OperatorServerRoute from "./server-route"
