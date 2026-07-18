/**
 * Operator scope value objects (Feature 007 / T005) — fail-closed project binding.
 */
import { Option, Schema } from "effect"
import type { OperatorPrincipal } from "./principal"

export const ScopeKind = Schema.Literals(["global", "project", "session", "root-tree"]).annotate({
  identifier: "Operator.ScopeKind",
})
export type ScopeKind = typeof ScopeKind.Type

const NonEmptyRef = Schema.String.check(Schema.isPattern(/^\S+$/))

export const OperatorScope = Schema.Struct({
  kind: ScopeKind,
  ref: Schema.NullOr(NonEmptyRef),
}).annotate({ identifier: "Operator.Scope" })
export type OperatorScope = typeof OperatorScope.Type

/**
 * Optional project context for session/root-tree scopes.
 * When principal is project-bound, session/root-tree ops must carry matching projectId.
 */
export type ScopeProjectContext = {
  readonly projectId?: string | null
}

const decodeScope = Schema.decodeUnknownOption(OperatorScope)
const decodeKind = Schema.decodeUnknownOption(ScopeKind)

export type ParseOk<T> = { readonly ok: true; readonly value: T }
export type ParseFail = { readonly ok: false; readonly reason: string }
export type ParseResult<T> = ParseOk<T> | ParseFail

export function parseScope(input: unknown): ParseResult<OperatorScope> {
  const decoded = decodeScope(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid operator scope" }
  }
  const value = decoded.value
  if (value.kind === "global" && value.ref !== null) {
    return { ok: false, reason: "global scope must not carry a ref" }
  }
  if (value.kind !== "global" && (value.ref === null || value.ref === "")) {
    return { ok: false, reason: `scope kind ${value.kind} requires a non-empty ref` }
  }
  return { ok: true, value }
}

export function parseScopeKind(input: unknown): ParseResult<ScopeKind> {
  const decoded = decodeKind(input)
  if (Option.isNone(decoded)) {
    return { ok: false, reason: "invalid scope kind" }
  }
  return { ok: true, value: decoded.value }
}

/**
 * Fail-closed project binding (review fix #9).
 * - Unbound principal: all scopes allowed (subject to descriptor matrix).
 * - Project-bound principal:
 *   - cannot use global scope
 *   - project scope must match binding
 *   - session/root-tree require context.projectId === binding (fail closed if missing)
 */
export function isScopeAllowedForPrincipal(
  principal: OperatorPrincipal,
  scope: OperatorScope,
  context?: ScopeProjectContext,
): boolean {
  if (principal.projectBinding === null) return true

  if (scope.kind === "global") return false

  if (scope.kind === "project") {
    return scope.ref === principal.projectBinding
  }

  // session / root-tree: must be tied to the same project context
  const projectId = context?.projectId
  if (!projectId) return false
  return projectId === principal.projectBinding
}

export * as OperatorScopeModule from "./scope"
