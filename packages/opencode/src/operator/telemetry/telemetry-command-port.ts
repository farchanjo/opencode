/**
 * Feature 013 / T005 — the `telemetry.*` inbound command adapter.
 *
 * Bridges the reserved Feature 007 `telemetry.status|show|on|off|configure|test`
 * operator command ids to the typed `TelemetryDomainPort` through the Feature 007
 * dispatcher's `DomainInvoke` seam, exactly like `langlock-command-port.ts`.
 * Feature 007 remains the SOLE registration authority: this adapter registers NO
 * command ids — it only supplies the `telemetry` domain `invoke`, replacing the
 * `not_implemented` stub. Reserved-id collisions are rejected by the Feature 007
 * reserved-name guard, unchanged here (FR11).
 *
 * Every command is parsed and dispatched LOCALLY: `status`/`show` project the
 * redacted, content-free effective summary; `on`/`off`/`configure` carry an
 * operator principal + `expectedVersion`/CAS and return a Feature 007 audit id;
 * `test` runs the bounded, test-signal-only reachability probe. This adapter is the
 * single uniform operator access-audit point — it holds the Feature 007 principal
 * for every command — and emits exactly one bounded, secret-free audit event per
 * dispatch. No plaintext secret is ever carried: `configure` takes an export header
 * as a `SecretRef` only (FR6, Security).
 */
export * as TelemetryCommandPort from "./telemetry-command-port"

import { Effect } from "effect"
import { INITIAL_CONFIG_VERSION } from "@/operator/application/ports/config-port"
import type { OperatorPrincipal as OperatorPrincipalCore, CommandRequest } from "@opencode-ai/core/operator"
import type {
  ConfigVersion,
  OperatorPrincipal as TelemetryOperatorPrincipal,
  TelemetryConfigureInput,
  TelemetryDomainError,
  Transport,
} from "@opencode-ai/protocol/telemetry/commands"
import type { HandlerContext, HandlerResult, FailureHandlerResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { DomainInvoke } from "@/operator/application/ports/domain-ports"
import type { TelemetryAuditEvent, TelemetryAuditSink, TelemetryBackend } from "./telemetry-port"

export interface TelemetryDomainPorts {
  readonly telemetry: { readonly invoke: DomainInvoke }
}

export interface TelemetryCommandDeps {
  readonly backend: TelemetryBackend
  readonly audit: TelemetryAuditSink
}

const TRANSPORTS: ReadonlySet<Transport> = new Set<Transport>(["http/protobuf", "grpc"])

// =============================================================================
// Payload helpers
// =============================================================================

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function firstString(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function fail(code: FailureHandlerResult["code"], message: string, details?: FailureHandlerResult["details"]): FailureHandlerResult {
  return { kind: "failure", code, message, details }
}

/** Map the Feature 007 operator principal onto the telemetry operator principal (FR7, FR11). */
function toTelemetryOperator(principal: OperatorPrincipalCore): TelemetryOperatorPrincipal {
  return { kind: principal.kind, id: principal.subject }
}

/** Resolve the opaque CAS `expectedVersion` from the payload or envelope `version`; defaults to the initial token. */
function resolveExpectedVersion(record: Record<string, unknown>, request: CommandRequest): ConfigVersion {
  const fromPayload = firstString(record, ["expectedVersion", "expected_version", "version"])
  if (fromPayload !== undefined) return fromPayload
  if (request.version !== undefined) return request.version
  return INITIAL_CONFIG_VERSION
}

// =============================================================================
// Error mapping
// =============================================================================

/** Map the closed `TelemetryDomainError` union onto the bounded operator audit outcome. */
function auditOutcome(error: TelemetryDomainError): TelemetryAuditEvent["outcome"] {
  switch (error.type) {
    case "unauthorized":
      return "unauthorized"
    case "version_conflict":
      return "conflict"
    case "invalid_argument":
      return "invalid"
    default:
      return "rejected"
  }
}

/** Map the closed `TelemetryDomainError` union onto an operator failure code + bounded, secret-free envelope. */
function telemetryErrorToFailure(error: TelemetryDomainError): FailureHandlerResult {
  switch (error.type) {
    case "unauthorized":
      return fail("unauthorized", error.reason)
    case "invalid_argument":
      return fail("invalid_argument", error.reason, { field: error.field })
    case "version_conflict":
      return fail("invalid_argument", `version conflict: expected ${error.expectedVersion}, actual ${error.actualVersion}`, {
        field: "expectedVersion",
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      })
    case "unavailable":
      return fail("unavailable", error.reason)
  }
}

// =============================================================================
// telemetry.* domain invoke
// =============================================================================

function telemetryInvoke(deps: TelemetryCommandDeps): DomainInvoke {
  const { backend } = deps

  /** Run a read/probe effect, emit exactly one audit event, and shape the result. */
  const run = <A>(
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<A, TelemetryDomainError>,
    onSuccess: (value: A) => HandlerResult,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (value): Effect.Effect<HandlerResult> =>
            deps.audit.record({ commandId, principalId, target, outcome: "ok" }).pipe(Effect.as(onSuccess(value))),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(telemetryErrorToFailure(error))),
        }),
      ),
    )

  /**
   * Validate a mutation and hand back the `mutation_plan` the dispatcher commits via
   * `mutateAuthority` (which emits the Feature 007 audit correlation on success).
   * Only a rejection is audited here — a successful plan is audited by the commit,
   * so no write is ever persisted while the caller is told it failed.
   */
  const runPlan = (
    commandId: string,
    principalId: string,
    target: string,
    effect: Effect.Effect<OperatorMutationPlan, TelemetryDomainError>,
  ): Promise<HandlerResult> =>
    Effect.runPromise(
      effect.pipe(
        Effect.matchEffect({
          onSuccess: (plan): Effect.Effect<HandlerResult> => Effect.succeed({ kind: "mutation_plan", ...plan }),
          onFailure: (error): Effect.Effect<HandlerResult> =>
            deps.audit
              .record({ commandId, principalId, target, outcome: auditOutcome(error) })
              .pipe(Effect.as(telemetryErrorToFailure(error))),
        }),
      ),
    )

  const query = (value: unknown): HandlerResult => ({ kind: "query", effective: value })

  return (ctx: HandlerContext): Promise<HandlerResult> => {
    const id = String(ctx.descriptor.id)
    const payload = asRecord(ctx.request.payload)
    const principal = toTelemetryOperator(ctx.request.principal)
    const principalId = principal.id
    const target = ctx.request.scope.ref ?? "global:telemetry"
    const toggle = { expectedVersion: resolveExpectedVersion(payload, ctx.request), principal }

    switch (id) {
      case "telemetry.status":
      case "telemetry.show":
        return run(id, principalId, target, backend.resolve(), (summary) => query(summary))

      case "telemetry.on":
        return runPlan(id, principalId, target, backend.planOn(toggle))

      case "telemetry.off":
        return runPlan(id, principalId, target, backend.planOff(toggle))

      case "telemetry.configure": {
        const input = parseConfigureInput(payload, ctx.request, principal)
        if (input.kind === "failure") return Promise.resolve(input)
        return runPlan(id, principalId, target, backend.planConfigure(input.value))
      }

      case "telemetry.test":
        return run(id, principalId, target, backend.test(), (out) => query(out))

      default:
        return Promise.resolve(fail("not_implemented", `telemetry command ${id} is not implemented`))
    }
  }
}

/** Parse and validate the `telemetry.configure` payload; the header is a `SecretRef` only (FR6, Security). */
function parseConfigureInput(
  payload: Record<string, unknown>,
  request: CommandRequest,
  principal: TelemetryOperatorPrincipal,
): { kind: "value"; value: TelemetryConfigureInput } | FailureHandlerResult {
  const transport = firstString(payload, ["transport"])
  if (transport === undefined || !TRANSPORTS.has(transport as Transport)) {
    return fail("invalid_argument", "telemetry.configure requires a transport of http/protobuf or grpc", { field: "transport" })
  }
  const endpoint = firstString(payload, ["endpoint"])
  if (endpoint === undefined) return fail("invalid_argument", "telemetry.configure requires an endpoint", { field: "endpoint" })
  const headerSecret = firstString(payload, ["headerSecret", "header_secret"])
  return {
    kind: "value",
    value: {
      transport: transport as Transport,
      endpoint,
      headerSecret,
      expectedVersion: resolveExpectedVersion(payload, request),
      principal,
    },
  }
}

/**
 * Build the `telemetry` DomainPort override. Wire it into the Feature 007
 * dispatcher via `wireDomainPorts(createTelemetryDomainPorts({ backend, audit }))`
 * at the composition root — it replaces the `not_implemented` stub without touching
 * the registry.
 */
export function createTelemetryDomainPorts(deps: TelemetryCommandDeps): TelemetryDomainPorts {
  return {
    telemetry: { invoke: telemetryInvoke(deps) },
  }
}
