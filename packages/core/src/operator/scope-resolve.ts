/**
 * Descriptor-aware operator scope resolution (Feature 007 / T035 residual).
 * Shared by slash, RPC, HTTP, CLI, palette — never arbitrary body scope.
 * Missing required context → structured error; never invents ref "local".
 */
import type { OperatorScope, ScopeKind } from "./scope"
import type { DescriptorDraft } from "./descriptor"
import { getReservedEntry } from "./catalog"

export type OperatorScopeContext = {
  readonly projectId?: string | null
  readonly sessionId?: string | null
  readonly rootTreeRef?: string | null
  /**
   * Explicit operator-selected authority scope (Feature 034). When present it OVERRIDES
   * the ambient-project preference: the scope resolves to EXACTLY this kind (provided the
   * descriptor allows it), so an operator can request `global` even while a project is
   * bound to the working directory. Absent (the default) → the resolver keeps its
   * project-preferred behavior, byte-for-byte back-compatible.
   */
  readonly requestedKind?: ScopeKind | null
}

export type ScopeResolveInput = {
  readonly ctx: OperatorScopeContext
  readonly scopesAllowed: readonly ScopeKind[]
  readonly override?: OperatorScope
}

export type ScopeResolveOk = {
  readonly ok: true
  readonly scope: OperatorScope
}

export type ScopeResolveFail = {
  readonly ok: false
  readonly code: "forbidden_scope" | "invalid_argument"
  readonly message: string
  readonly details?: Readonly<Record<string, string | number | boolean | null>>
}

export type ScopeResolveResult = ScopeResolveOk | ScopeResolveFail

/**
 * Resolve scope from runtime context + descriptor.scopesAllowed.
 * - Session only when descriptor allows and sessionId present
 * - Project when allowed and projectId present
 * - root-tree when allowed and ref present
 * - global when allowed and unbound
 * Never invents "local" refs; missing required context → forbidden_scope.
 */
export function resolveOperatorScope(input: ScopeResolveInput): ScopeResolveResult {
  if (input.override) {
    if (input.override.ref === "local") {
      return {
        ok: false,
        code: "invalid_argument",
        message: "scope ref must not be invented placeholder",
        details: { reason: "forbidden_local_ref" },
      }
    }
    return { ok: true, scope: input.override }
  }

  const allowed = input.scopesAllowed
  if (allowed.length === 0) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "descriptor has no allowed scopes",
    }
  }

  const projectId = input.ctx.projectId ?? null
  const sessionId = input.ctx.sessionId ?? null
  const rootTreeRef = input.ctx.rootTreeRef ?? null

  // Feature 034 — an EXPLICIT requested kind overrides the ambient-project preference:
  // resolve to EXACTLY the requested kind when the descriptor allows it, else forbid.
  const requestedKind = input.ctx.requestedKind ?? null
  if (requestedKind) {
    return resolveExplicitScope(requestedKind, allowed, { projectId, sessionId, rootTreeRef })
  }

  const sessionOnly =
    allowed.includes("session") && !allowed.includes("project") && !allowed.includes("global") && !allowed.includes("root-tree")
  if (sessionOnly) {
    if (!sessionId) {
      return {
        ok: false,
        code: "forbidden_scope",
        message: "session scope required; sessionId missing",
        details: { required: "session" },
      }
    }
    return { ok: true, scope: { kind: "session", ref: sessionId } }
  }

  // Prefer project when allowed and bound
  if (projectId && allowed.includes("project")) {
    return { ok: true, scope: { kind: "project", ref: projectId } }
  }

  if (sessionId && allowed.includes("session")) {
    return { ok: true, scope: { kind: "session", ref: sessionId } }
  }

  if (rootTreeRef && allowed.includes("root-tree")) {
    return { ok: true, scope: { kind: "root-tree", ref: rootTreeRef } }
  }

  if (allowed.includes("global")) {
    return { ok: true, scope: { kind: "global", ref: null } }
  }

  // Required context missing for remaining allowed kinds
  if (allowed.includes("project") && !projectId) {
    return {
      ok: false,
      code: "forbidden_scope",
      message: "project scope required; projectId missing",
      details: { required: "project" },
    }
  }
  if (allowed.includes("session") && !sessionId) {
    return {
      ok: false,
      code: "forbidden_scope",
      message: "session scope required; sessionId missing",
      details: { required: "session" },
    }
  }
  if (allowed.includes("root-tree") && !rootTreeRef) {
    return {
      ok: false,
      code: "forbidden_scope",
      message: "root-tree scope required; rootTreeRef missing",
      details: { required: "root-tree" },
    }
  }

  return {
    ok: false,
    code: "forbidden_scope",
    message: "no allowed scope can be resolved from runtime context",
    details: { allowed: allowed.join(",") },
  }
}

/**
 * Resolve an EXPLICIT operator-requested scope kind (Feature 034). The requested kind
 * must be in the descriptor's `scopesAllowed` (else `forbidden_scope`), and the ref
 * required by the kind must be present (else `forbidden_scope`, mirroring the ambient
 * path's missing-context errors). `global` never carries a ref; the other kinds resolve
 * their bound ref. This intentionally OVERRIDES the project preference — that is the
 * whole point of the selector.
 */
function resolveExplicitScope(
  requestedKind: ScopeKind,
  allowed: readonly ScopeKind[],
  refs: { readonly projectId: string | null; readonly sessionId: string | null; readonly rootTreeRef: string | null },
): ScopeResolveResult {
  if (!allowed.includes(requestedKind)) {
    return {
      ok: false,
      code: "forbidden_scope",
      message: `requested ${requestedKind} scope is not allowed for this command`,
      details: { requested: requestedKind, allowed: allowed.join(",") },
    }
  }
  switch (requestedKind) {
    case "global":
      return { ok: true, scope: { kind: "global", ref: null } }
    case "project":
      if (!refs.projectId) {
        return { ok: false, code: "forbidden_scope", message: "project scope required; projectId missing", details: { required: "project" } }
      }
      return { ok: true, scope: { kind: "project", ref: refs.projectId } }
    case "session":
      if (!refs.sessionId) {
        return { ok: false, code: "forbidden_scope", message: "session scope required; sessionId missing", details: { required: "session" } }
      }
      return { ok: true, scope: { kind: "session", ref: refs.sessionId } }
    case "root-tree":
      if (!refs.rootTreeRef) {
        return { ok: false, code: "forbidden_scope", message: "root-tree scope required; rootTreeRef missing", details: { required: "root-tree" } }
      }
      return { ok: true, scope: { kind: "root-tree", ref: refs.rootTreeRef } }
  }
}

/** Resolve from reserved catalog entry id. */
export function resolveScopeForCommandId(
  commandId: string,
  ctx: OperatorScopeContext,
): ScopeResolveResult {
  const entry = getReservedEntry(commandId)
  const scopesAllowed = entry?.scopesAllowed ?? (["project", "global"] as const)
  return resolveOperatorScope({ ctx, scopesAllowed: scopesAllowed as readonly ScopeKind[] })
}

/** Resolve from descriptor draft. */
export function resolveScopeForDescriptor(
  descriptor: Pick<DescriptorDraft, "scopesAllowed">,
  ctx: OperatorScopeContext,
): ScopeResolveResult {
  return resolveOperatorScope({
    ctx,
    scopesAllowed: descriptor.scopesAllowed as readonly ScopeKind[],
  })
}

/**
 * @deprecated Use resolveOperatorScope Result API. Throws never; returns global only if allowed.
 * Prefer resolveOperatorScope for error handling.
 */
export function resolveOperatorScopeOrThrow(input: ScopeResolveInput): OperatorScope {
  const result = resolveOperatorScope(input)
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`)
  }
  return result.scope
}

export * as OperatorScopeResolve from "./scope-resolve"
