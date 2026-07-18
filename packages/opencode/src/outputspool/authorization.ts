/**
 * Feature 005 / T032 (S20) — per-action authorization over Feature 007
 * principals and PermissionV2 scopes.
 *
 * Authorization is RE-EVALUATED per action; a raw OutputRef is never a saved
 * permission resource (FR47, FR48, C7). Metadata authorization is enforced
 * before any content page is returned, so an unauthorized sibling read is denied
 * without a content leak (FR43, AC15). Following the interim posture (C7,
 * plan.md "Authorization"): the consume plane (`stat`/`read`/`follow`) is
 * authorized by the owning session/tree principal; the admin plane
 * (`release`/`delete`/`purge`/`export`/`share`/`retention.set`/`quota.set`) is
 * deny-by-default and requires an operator principal plus an explicit scope. The
 * decision is a pure, deterministic function so the same input always yields the
 * same allow/deny — no ambient state, no cached grant.
 *
 * The scope-relationship resolver is injected so the real Feature 007
 * PermissionV2 `self|child|tree|session|project|operator-global` graph binds at
 * the composition root; the default resolver is conservative (only exact
 * self/session/tree/project ownership grants, nothing wider), never a fabricated
 * allow.
 */
export * as Authorization from "./authorization"

/** The two authorization planes (plan.md "Operator command surface", C7). */
export type Plane = "consume" | "admin"

/** The PermissionV2 action scopes re-evaluated per action (FR43, C7). */
export type ActionScope = "self" | "child" | "tree" | "session" | "project" | "operator-global"

/** The acting principal; only an operator principal may authorize an admin action (C7). */
export interface Principal {
  readonly kind: "operator" | "manager-view" | "system" | "runtime"
  readonly id: string
  /** The session/tree/project the principal owns or is scoped to (opaque handles). */
  readonly sessionId?: string
  readonly treeId?: string
  readonly projectId?: string
  /** Whether the principal carries an operator-global grant (Feature 007). */
  readonly operatorGlobal?: boolean
}

/** The metadata subject of an authorization decision — the group's ownership, never its bytes (C18). */
export interface Subject {
  readonly output_ref: string
  readonly owning_session_id: string
  readonly owning_tree_id: string
  readonly project_id: string
  readonly channel: string
}

export interface AuthzRequest {
  readonly plane: Plane
  readonly principal: Principal
  readonly subject: Subject
  /** The explicit scope an admin action carries (required for admin, C7). */
  readonly requested_scope?: ActionScope
}

export type AuthzDecision =
  | { readonly allowed: true; readonly scope: ActionScope }
  | { readonly allowed: false; readonly reason: string }

const deny = (reason: string): AuthzDecision => ({ allowed: false, reason })

/**
 * Resolve whether `principal` stands in `scope` relationship to `subject`. The
 * default is conservative — only exact ownership grants (self via session, tree,
 * project) or an explicit operator-global grant; every other relationship denies
 * until the real PermissionV2 graph is bound (FR47, C7, AC15).
 */
export type ScopeResolver = (scope: ActionScope, principal: Principal, subject: Subject) => boolean

export const conservativeResolver: ScopeResolver = (scope, principal, subject) => {
  switch (scope) {
    case "operator-global":
      return principal.operatorGlobal === true
    case "project":
      return !!principal.projectId && principal.projectId === subject.project_id
    case "tree":
      return !!principal.treeId && principal.treeId === subject.owning_tree_id
    case "session":
    case "self":
      return !!principal.sessionId && principal.sessionId === subject.owning_session_id
    case "child":
      // A child relationship is not fabricated without the real hierarchy graph.
      return false
  }
}

/** The consume-plane scopes tried in order; the first the principal satisfies grants (C7). */
const CONSUME_SCOPES: readonly ActionScope[] = ["session", "tree", "project", "operator-global"]

const authorizeConsume = (req: AuthzRequest, resolve: ScopeResolver): AuthzDecision => {
  for (const scope of CONSUME_SCOPES) if (resolve(scope, req.principal, req.subject)) return { allowed: true, scope }
  return deny("no owning session/tree/project scope grants consume access")
}

const authorizeAdmin = (req: AuthzRequest, resolve: ScopeResolver): AuthzDecision => {
  if (req.principal.kind !== "operator") return deny("admin plane requires an operator principal")
  if (req.requested_scope === undefined) return deny("admin action requires an explicit scope")
  if (!resolve(req.requested_scope, req.principal, req.subject))
    return deny(`operator principal lacks the requested ${req.requested_scope} scope`)
  return { allowed: true, scope: req.requested_scope }
}

/**
 * Authorize one action. Pure and deterministic: the consume plane is authorized
 * by the owning session/tree/project principal; the admin plane is
 * deny-by-default and requires an operator principal plus an explicit satisfied
 * scope (FR42, FR43, FR47, C7, AC15).
 */
export const authorize = (req: AuthzRequest, resolve: ScopeResolver = conservativeResolver): AuthzDecision =>
  req.plane === "consume" ? authorizeConsume(req, resolve) : authorizeAdmin(req, resolve)
