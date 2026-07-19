/**
 * Feature 008 — MCP protocol barrel (T012/T013).
 *
 * Re-exports the shared identifiers, the reconciled closed enums (sourced from
 * `@opencode-ai/schema/mcp/*`), the closed 15-member `mcp.*` event vocabulary
 * (10 durable / 5 live), the operator-plane wire read models, the 30 `mcp.*` operator
 * command/query payloads, the `OperatorPrincipal` shape and the typed error unions from
 * ./commands, and the injected dependency ports (`TransportPort`/`ClockPort`/…/
 * `SecretResolvePort`) plus the inbound operator/runtime port interfaces from ./ports,
 * mirroring
 * doc/arch/sdd/008-add-complete-mcp-client-tools-and-resources-lifecycle-with/contracts/ports.ts
 * reconciled to the CUE authority.
 */

export * from "./commands"
export type {
  AuthPort,
  CatalogPort,
  ClockPort,
  ConfigError,
  ConfigReadPort,
  ContentPort,
  EntropyPort,
  EventPublishPort,
  ExperimentalPort,
  ExtensionPort,
  InteractionPort,
  LoggingPort,
  PermissionCheckInput,
  PermissionDecision,
  PermissionError,
  PermissionReadPort,
  PublishableMcpEvent,
  ResourceAdminPort,
  SecretError,
  SecretHandle,
  SecretResolvePort,
  ServerLifecyclePort,
  SpoolError,
  SpoolInput,
  SpoolPort,
  SpoolReceipt,
  TransportError,
  TransportFrame,
  TransportPort,
  TransportResponse,
} from "./ports"
