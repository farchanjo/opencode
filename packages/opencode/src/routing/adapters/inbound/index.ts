/**
 * Feature 001 / T028 — Routing inbound adapters barrel.
 *
 * The inbound side of the routing module: adapters that register the routing
 * command handlers with the Feature 007 dispatcher. Feature 007 stays the sole
 * management authority; these adapters only supply the domain `invoke`.
 */
export { createRoutingDomainPort, type RoutingDomainPort } from "./routing-command-port"
export * as RoutingInbound from "."
