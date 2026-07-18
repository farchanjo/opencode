/**
 * Feature 004 / T017 (S6) — policy resolution with the hard-policy-floor guard.
 *
 * Framework-free, deterministic, zero I/O. Resolves the global base policy then a
 * project override, applying the hard-policy-floor guard so a project override is
 * `applied` only when it is authorized AND does not relax the global floor; in every
 * other case the global value is `retained` with a typed `unauthorized` or
 * `floor_violation` decision — never a silent relax (FR5, FR24, C2, AC5, AC6).
 *
 * Mirrors the `policy.cue` resolution statechart (plan.md "State machines"):
 *   global_base -> project_requested | resolved(no_override)
 *   project_requested -> authorized | retained(unauthorized)
 *   authorized -> floor_checked
 *   floor_checked -> applied | retained(floor_violation)
 */
export * as PolicyResolution from "./policy-resolution"

import type { EnforcementMode, Origin } from "@opencode-ai/schema/langlock/enums"

/** The resolvable facts of a global base or project policy (content-free, FR5, C2). */
export interface PolicyView {
  readonly enabled: boolean
  readonly tag: string
  readonly enforcement_mode: EnforcementMode
  readonly policy_version: number
  /** The global hard-policy floor a project override can never relax (FR5, Security 1). */
  readonly hard_floor: boolean
}

/** A requested project override plus its authorization state (FR5, Security 1, AC5, AC6). */
export interface ProjectOverride {
  readonly enabled: boolean
  readonly tag: string
  readonly enforcement_mode: EnforcementMode
  readonly policy_version: number
  /** Whether `langlock.override` is authorized for this project (Security 1, AC5, AC6). */
  readonly override_authorized: boolean
}

/** The inputs to a resolution: the global base authority and an optional project override. */
export interface ResolutionRequest {
  readonly global: PolicyView
  readonly override?: ProjectOverride
}

/** The effective resolved language for an execution (content-free). */
export interface ResolvedLanguage {
  readonly enabled: boolean
  readonly tag: string
  readonly enforcement_mode: EnforcementMode
  readonly policy_version: number
  readonly origin: Origin
}

/** Why a project override was not applied and the global value retained (AC5). */
export type RetainReason = "no_override" | "unauthorized" | "floor_violation"

/**
 * The outcome of resolving a policy.
 *   - `applied`: an authorized, floor-preserving project override took effect.
 *   - `retained`: the global value stands — either no override, an unauthorized
 *     override, or an override that would relax the floor (FR5, C2, AC5, AC6).
 */
export type ResolutionOutcome =
  | { readonly kind: "applied"; readonly resolved: ResolvedLanguage }
  | { readonly kind: "retained"; readonly reason: RetainReason; readonly resolved: ResolvedLanguage }

function globalResolved(global: PolicyView, origin: Origin): ResolvedLanguage {
  return {
    enabled: global.enabled,
    tag: global.tag,
    enforcement_mode: global.enforcement_mode,
    policy_version: global.policy_version,
    origin,
  }
}

/**
 * A project override "would relax the floor" when the global hard-policy floor is set
 * and the override either disables the lock or changes the enforced tag (FR5,
 * Security 1). A hard floor pins the global artifact language; only a same-tag,
 * still-enabled override is floor-preserving.
 */
function relaxesFloor(global: PolicyView, override: ProjectOverride): boolean {
  if (!global.hard_floor) return false
  return !override.enabled || override.tag !== global.tag
}

/**
 * Resolve the effective policy for an execution (FR5, FR24, C2, AC5, AC6).
 * Deterministic and total: it returns exactly one `ResolutionOutcome` and never
 * throws. Authorization is checked before the floor, matching the statechart order.
 */
export function resolve(request: ResolutionRequest): ResolutionOutcome {
  const { global, override } = request

  // No project override present: the global base is the effective policy.
  if (override === undefined) {
    return { kind: "retained", reason: "no_override", resolved: globalResolved(global, "global") }
  }

  // Unauthorized override: never honored; the global value is retained (Security 1, AC5).
  if (!override.override_authorized) {
    return { kind: "retained", reason: "unauthorized", resolved: globalResolved(global, "global") }
  }

  // Authorized but would relax the global hard-policy floor: retained, never relaxed (FR5, AC5).
  if (relaxesFloor(global, override)) {
    return { kind: "retained", reason: "floor_violation", resolved: globalResolved(global, "global") }
  }

  // Authorized and floor-preserving: the project override is applied (AC6).
  return {
    kind: "applied",
    resolved: {
      enabled: override.enabled,
      tag: override.tag,
      enforcement_mode: override.enforcement_mode,
      policy_version: override.policy_version,
      origin: "project",
    },
  }
}
