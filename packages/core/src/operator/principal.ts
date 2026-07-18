/**
 * Operator principal value objects (Feature 007 / T005).
 * Closed set: operator | system | manager-view. LLM/tool/MCP/plugin are never principals.
 */
import { Option, Schema } from "effect"

export const PrincipalKind = Schema.Literals(["operator", "system", "manager-view"]).annotate({
  identifier: "Operator.PrincipalKind",
})
export type PrincipalKind = typeof PrincipalKind.Type

/** Local identity subject; non-empty, no whitespace-only. */
export const PrincipalSubject = Schema.String.check(Schema.isPattern(/^\S.*\S$|^\S$/)).annotate({
  identifier: "Operator.PrincipalSubject",
})
export type PrincipalSubject = typeof PrincipalSubject.Type

export const OperatorPrincipal = Schema.Struct({
  kind: PrincipalKind,
  subject: PrincipalSubject,
  /** Project id when bound; null when unbound (global operator). Fail-closed cross-project. */
  projectBinding: Schema.NullOr(Schema.String.check(Schema.isPattern(/^\S+$/))),
}).annotate({ identifier: "Operator.Principal" })
export type OperatorPrincipal = typeof OperatorPrincipal.Type

const decodePrincipal = Schema.decodeUnknownOption(OperatorPrincipal)
const decodeKind = Schema.decodeUnknownOption(PrincipalKind)

export type ParseOk<T> = { readonly ok: true; readonly value: T }
export type ParseFail = { readonly ok: false; readonly reason: string }
export type ParseResult<T> = ParseOk<T> | ParseFail

export function parsePrincipal(input: unknown): ParseResult<OperatorPrincipal> {
  const decoded = decodePrincipal(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid operator principal" }
  }
  return { ok: true, value: decoded.value }
}

export function parsePrincipalKind(input: unknown): ParseResult<PrincipalKind> {
  const decoded = decodeKind(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid principal kind" }
  }
  return { ok: true, value: decoded.value }
}

/** True when principal may mutate config (operator, system). manager-view is read-only. */
export function canMutate(principal: OperatorPrincipal): boolean {
  return principal.kind === "operator" || principal.kind === "system"
}

/** True when principal is the optional read-only manager view. */
export function isManagerView(principal: OperatorPrincipal): boolean {
  return principal.kind === "manager-view"
}

export function isOperatorPrincipal(principal: OperatorPrincipal): boolean {
  return principal.kind === "operator"
}

export function isSystemPrincipal(principal: OperatorPrincipal): boolean {
  return principal.kind === "system"
}

export * as OperatorPrincipalModule from "./principal"
