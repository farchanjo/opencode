/**
 * Principal capability rules (Feature 007 / T005) — fail-closed scopes.
 */
import { canMutate, type OperatorPrincipal } from "./principal"
import {
  isScopeAllowedForPrincipal,
  type OperatorScope,
  type ScopeKind,
  type ScopeProjectContext,
} from "./scope"
import type { OperatorCommandDescriptor } from "./descriptor"

export type CapabilityDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: "unauthorized" | "forbidden_scope"; readonly reason: string }

/**
 * Authorize principal against descriptor mutation flag and scope matrix.
 */
export function authorizeCommand(input: {
  principal: OperatorPrincipal
  scope: OperatorScope
  descriptor: OperatorCommandDescriptor
  /** Required for project-bound principals on session/root-tree scopes. */
  projectContext?: ScopeProjectContext
}): CapabilityDecision {
  const { principal, scope, descriptor } = input

  if (descriptor.mutates && !canMutate(principal)) {
    return {
      allowed: false,
      code: "unauthorized",
      reason: `principal kind ${principal.kind} cannot execute mutations`,
    }
  }

  if (!descriptor.scopesAllowed.includes(scope.kind as ScopeKind)) {
    return {
      allowed: false,
      code: "forbidden_scope",
      reason: `scope ${scope.kind} not allowed for ${descriptor.id}`,
    }
  }

  if (!isScopeAllowedForPrincipal(principal, scope, input.projectContext)) {
    return {
      allowed: false,
      code: "forbidden_scope",
      reason:
        principal.projectBinding === null
          ? "scope not allowed for principal"
          : "project-bound principal cannot target global/other project/unscoped session",
    }
  }

  return { allowed: true }
}

export * as OperatorCapability from "./capability"
