/**
 * Domain port interfaces (T038) — invoke returns HandlerResult.
 */
import type { HandlerContext, HandlerResult } from "../handler"

export type DomainInvoke = (ctx: HandlerContext) => HandlerResult | Promise<HandlerResult>

export type TelemetryPort = { readonly invoke: DomainInvoke }
export type SmartPort = { readonly invoke: DomainInvoke }
export type RoutingPort = { readonly invoke: DomainInvoke }
export type BudgetPort = { readonly invoke: DomainInvoke }
export type PoolsPort = { readonly invoke: DomainInvoke }
export type ProcessPort = { readonly invoke: DomainInvoke }
export type TaskPort = { readonly invoke: DomainInvoke }
export type JobsPort = { readonly invoke: DomainInvoke }
export type LangLockPort = { readonly invoke: DomainInvoke }
export type OutputPort = { readonly invoke: DomainInvoke }
export type SemanticPort = { readonly invoke: DomainInvoke }
export type McpAdminPort = { readonly invoke: DomainInvoke }

export type DomainPorts = {
  readonly telemetry: TelemetryPort
  readonly smart: SmartPort
  readonly routing: RoutingPort
  readonly budget: BudgetPort
  readonly pools: PoolsPort
  readonly process: ProcessPort
  readonly task: TaskPort
  readonly jobs: JobsPort
  readonly langlock: LangLockPort
  readonly output: OutputPort
  readonly semantic: SemanticPort
  readonly mcp: McpAdminPort
}

export const DOMAIN_PORT_NAMES = [
  "telemetry",
  "smart",
  "routing",
  "budget",
  "pools",
  "process",
  "task",
  "jobs",
  "langlock",
  "output",
  "semantic",
  "mcp",
] as const

export type DomainPortName = (typeof DOMAIN_PORT_NAMES)[number]

export * as OperatorDomainPorts from "./domain-ports"
