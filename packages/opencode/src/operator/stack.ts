/**
 * Operator stack production surface (R4/R7).
 * Live stack only — test/memory stacks live in `./stack-test` and must not be
 * imported by production composition (server, CLI live path, stack-live).
 */
export {
  createLiveOperatorStack,
  getOrCreateLiveOperatorStack,
  clearLiveOperatorStackCache,
  type LiveOperatorStack,
  type CreateLiveOperatorStackInput,
} from "./stack-live"

export * as OperatorStackModule from "./stack"
