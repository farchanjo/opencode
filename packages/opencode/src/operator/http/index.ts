/**
 * Operator HTTP production surface (R4/R7).
 * Test bootstrap lives in `./bootstrap` — not re-exported here.
 */
export { createOperatorHttpHandler, resolveAuthFromHeaders } from "./handler"
export {
  isLoopbackHost,
  assertOperatorBind,
  assertOperatorRequestAccess,
  assertLoopbackRequest,
  assertOriginPolicy,
} from "./loopback"
export { createOperatorFetch } from "./server-route"
export { tryCreateOperatorHttpFetch, isOperatorHttpEnabled, type InjectedOperatorHttpStack } from "./mount"
export {
  setOperatorRequestIpResolver,
  resolveOperatorClientIp,
  runWithOperatorClientIp,
  normalizeNodeRemoteAddress,
  bunRequestIpResolver,
  installOperatorNodeHttpIntercept,
  serveOperatorFromNode,
} from "./client-ip"

export * as OperatorHttp from "."
