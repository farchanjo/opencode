/**
 * Feature 001 / T025 — Typed routing domain errors.
 *
 * The closed set of routing errors mirrored 1:1 from the RoutingError tagged
 * union in
 * doc/arch/sdd/001-define-one-cohesive-smart-agent-routing-and-opentelemetry/contracts/ports.ts
 * and the wire mirror packages/protocol/src/routing/index.ts. This is the
 * domain-facing constructor/guard surface so evaluator, decision store,
 * dispatcher and (later) the application service raise and match the SAME
 * error shapes the inbound ports expose — no ad-hoc string errors, no drift
 * between the domain and the protocol union.
 *
 * Pure, deterministic, zero framework deps: plain discriminated union +
 * constructors + guards + an exhaustive `match`. No Effect runtime, no I/O.
 * The five variants and their fields are authoritative; adding one here MUST
 * be mirrored in ports.ts and protocol/routing/index.ts.
 */
export * as RoutingErrors from "./errors"

// =============================================================================
// The closed tagged union (mirrors contracts/ports.ts RoutingError)
// =============================================================================

export interface NoAuthorizedCandidate {
  readonly type: "no_authorized_candidate"
  readonly reason: string
}

export interface CatalogMismatch {
  readonly type: "catalog_mismatch"
  readonly decisionId: string
  readonly catalogVersion: string
}

export interface Unavailable {
  readonly type: "unavailable"
  readonly reason: string
}

export interface InvalidArgument {
  readonly type: "invalid_argument"
  readonly field: string
  readonly reason: string
}

export interface NotImplemented {
  readonly type: "not_implemented"
}

export type RoutingError = NoAuthorizedCandidate | CatalogMismatch | Unavailable | InvalidArgument | NotImplemented

/** The five discriminant tags, in the port-contract order. */
export const ROUTING_ERROR_TYPES = [
  "no_authorized_candidate",
  "catalog_mismatch",
  "unavailable",
  "invalid_argument",
  "not_implemented",
] as const

export type RoutingErrorType = (typeof ROUTING_ERROR_TYPES)[number]

// =============================================================================
// Constructors — the only sanctioned way to mint a domain routing error
// =============================================================================

export function noAuthorizedCandidate(reason: string): NoAuthorizedCandidate {
  return { type: "no_authorized_candidate", reason }
}

export function catalogMismatch(decisionId: string, catalogVersion: string): CatalogMismatch {
  return { type: "catalog_mismatch", decisionId, catalogVersion }
}

export function unavailable(reason: string): Unavailable {
  return { type: "unavailable", reason }
}

export function invalidArgument(field: string, reason: string): InvalidArgument {
  return { type: "invalid_argument", field, reason }
}

export function notImplemented(): NotImplemented {
  return { type: "not_implemented" }
}

// =============================================================================
// Guards
// =============================================================================

const TYPE_SET: ReadonlySet<string> = new Set(ROUTING_ERROR_TYPES)

/** Structural guard: true when `value` is one of the five routing-error variants. */
export function isRoutingError(value: unknown): value is RoutingError {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string" &&
    TYPE_SET.has((value as { type: string }).type)
  )
}

export function is<T extends RoutingErrorType>(
  value: unknown,
  type: T,
): value is Extract<RoutingError, { type: T }> {
  return isRoutingError(value) && value.type === type
}

// =============================================================================
// Exhaustive match
// =============================================================================

export interface RoutingErrorMatcher<R> {
  readonly no_authorized_candidate: (error: NoAuthorizedCandidate) => R
  readonly catalog_mismatch: (error: CatalogMismatch) => R
  readonly unavailable: (error: Unavailable) => R
  readonly invalid_argument: (error: InvalidArgument) => R
  readonly not_implemented: (error: NotImplemented) => R
}

/** Exhaustive, total match over the routing-error union — compiler enforces every arm. */
export function match<R>(error: RoutingError, matcher: RoutingErrorMatcher<R>): R {
  switch (error.type) {
    case "no_authorized_candidate":
      return matcher.no_authorized_candidate(error)
    case "catalog_mismatch":
      return matcher.catalog_mismatch(error)
    case "unavailable":
      return matcher.unavailable(error)
    case "invalid_argument":
      return matcher.invalid_argument(error)
    case "not_implemented":
      return matcher.not_implemented(error)
  }
}

/** Stable, redaction-safe one-line summary — never embeds prompts, secrets or payloads. */
export function describe(error: RoutingError): string {
  return match(error, {
    no_authorized_candidate: (e) => `no_authorized_candidate: ${e.reason}`,
    catalog_mismatch: (e) => `catalog_mismatch: decision=${e.decisionId} catalog=${e.catalogVersion}`,
    unavailable: (e) => `unavailable: ${e.reason}`,
    invalid_argument: (e) => `invalid_argument: ${e.field}: ${e.reason}`,
    not_implemented: () => "not_implemented",
  })
}
