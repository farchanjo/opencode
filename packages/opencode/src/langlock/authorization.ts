/**
 * Feature 004 / T029 (S14) — `langlock.override` authorization gate.
 *
 * Applies the canonical Feature 007 Permission/Policy gate to a Lang Lock policy
 * mutation (FR5, FR6, Security 1, C2, AC5, AC6). It answers one pure question —
 * "may this principal mutate this policy at this scope, and does the change
 * relax the global hard-policy floor?" — and:
 *   - rejects any session / user / LLM / agent / plugin / MCP / custom-command
 *     actor as a typed `unauthorized` failure (only a trusted operator/system
 *     principal may mutate; `manager-view` is read-only) (FR6, Security 1);
 *   - denies a project override unless the injected native operator policy grants
 *     `langlock.override` for the scope (FR5, AC5);
 *   - never relaxes the global hard-policy floor — a project override that would
 *     disable the lock or change the enforced tag while the global floor is set
 *     is a typed `floor_violation`, never a silent relax (FR5, C2, AC5).
 *
 * Pure and framework-free: it never mutates state, never calls a model, and
 * reuses the `PolicyResolution` domain floor semantics so the gate and the
 * resolver can never diverge. The composition root injects the real Feature 007
 * Permission/Policy check as the `OverridePermissionPort`.
 */
export * as LangLockAuthorization from "./authorization"

import { PolicyResolution } from "@opencode-ai/core/langlock/policy-resolution"
import type { EnforcementMode } from "@opencode-ai/schema/langlock/enums"
import type { LangLockPolicyError, OperatorPrincipal, Scope } from "@opencode-ai/protocol/langlock/commands"

/** The trusted principal kinds permitted to MUTATE a policy; `manager-view` is read-only (Security 1). */
const MUTATING_OPERATOR_KINDS: ReadonlySet<OperatorPrincipal["kind"]> = new Set<OperatorPrincipal["kind"]>([
  "operator",
  "system",
])

/**
 * The injected native operator Permission/Policy gate for `langlock.override`
 * (Feature 007). Content-free: it answers whether the principal is granted a
 * project override at the addressed scope. The composition root binds the real
 * Feature 007 Permission check; unit tests bind a deterministic double.
 */
export interface OverridePermissionPort {
  readonly overrideGranted: (input: {
    readonly principal: OperatorPrincipal
    readonly scope: Scope
    readonly scopeId: string
  }) => boolean
}

/** The global base facts a project override is checked against (FR5, Security 1). */
export interface GlobalPolicyFacts {
  readonly enabled: boolean
  readonly tag: string
  readonly enforcement_mode: EnforcementMode
  readonly policy_version: number
  /** The global hard-policy floor a project override can never relax (FR5). */
  readonly hard_floor: boolean
}

/** The requested project override change (FR5, AC5, AC6). */
export interface OverrideRequest {
  readonly enabled: boolean
  readonly tag: string
  readonly enforcement_mode: EnforcementMode
  readonly policy_version: number
}

/** The inputs to a policy-mutation authorization check. */
export interface AuthorizePolicyMutationInput {
  readonly principal: OperatorPrincipal
  readonly scope: Scope
  readonly scopeId: string
  readonly global: GlobalPolicyFacts
  /** Present only for a project-scope override; a global-scope mutation omits it. */
  readonly override?: OverrideRequest
}

/** The gate outcome: authorized, or denied with the exact typed policy error (FR6, C2). */
export type AuthorizationDecision =
  | { readonly authorized: true }
  | { readonly authorized: false; readonly error: LangLockPolicyError }

/** True for a trusted operator/system principal permitted to mutate a policy (Security 1). */
export function isMutatingOperator(principal: OperatorPrincipal): boolean {
  return MUTATING_OPERATOR_KINDS.has(principal.kind)
}

function unauthorized(reason: string): AuthorizationDecision {
  return { authorized: false, error: { type: "unauthorized", reason } }
}

/**
 * Authorize a Lang Lock policy mutation (FR5, FR6, Security 1, C2, AC5, AC6).
 * Deterministic and total. Order mirrors the resolution statechart: principal
 * trust first, then the `langlock.override` grant for a project scope, then the
 * hard-policy-floor guard. A global-scope mutation requires only a trusted
 * principal; a project override further requires the grant AND floor
 * preservation.
 */
export function authorizePolicyMutation(
  input: AuthorizePolicyMutationInput,
  permission: OverridePermissionPort,
): AuthorizationDecision {
  if (!isMutatingOperator(input.principal)) {
    return unauthorized(`principal kind ${input.principal.kind} may not mutate Lang Lock policy`)
  }

  // A global-scope mutation is the base authority — no override grant required.
  if (input.scope !== "project" || input.override === undefined) {
    return { authorized: true }
  }

  if (!permission.overrideGranted({ principal: input.principal, scope: input.scope, scopeId: input.scopeId })) {
    return unauthorized("langlock.override is not granted for this project scope")
  }

  // Floor guard: reuse the domain resolver so the gate and the resolver agree.
  const outcome = PolicyResolution.resolve({
    global: {
      enabled: input.global.enabled,
      tag: input.global.tag,
      enforcement_mode: input.global.enforcement_mode,
      policy_version: input.global.policy_version,
      hard_floor: input.global.hard_floor,
    },
    override: {
      enabled: input.override.enabled,
      tag: input.override.tag,
      enforcement_mode: input.override.enforcement_mode,
      policy_version: input.override.policy_version,
      override_authorized: true,
    },
  })

  if (outcome.kind === "retained" && outcome.reason === "floor_violation") {
    return {
      authorized: false,
      error: { type: "floor_violation", requestedTag: input.override.tag, floorTag: input.global.tag },
    }
  }

  return { authorized: true }
}
