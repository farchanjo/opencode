/**
 * Operator principal binding from server auth (T026).
 * Body principal is never used for authority (handler rejects body principal).
 */
import { createHash, timingSafeEqual } from "node:crypto"
import type { OperatorPrincipal, PrincipalKind } from "@opencode-ai/core/operator"
import { parsePrincipal } from "@opencode-ai/core/operator"

export type AuthContext = {
  readonly subject?: string
  readonly authenticated: boolean
  readonly role?: PrincipalKind | "llm" | "subagent" | "mcp" | "plugin" | "tool" | "anonymous"
  /** From Instance/project context only — never request body. */
  readonly projectBinding?: string | null
}

const DENIED_MUTATION_ROLES = new Set(["llm", "subagent", "mcp", "plugin", "tool", "anonymous"])

export type PrincipalBindResult =
  | { readonly ok: true; readonly principal: OperatorPrincipal }
  | { readonly ok: false; readonly code: "unauthorized"; readonly reason: string }

export function bindOperatorPrincipal(input: {
  auth: AuthContext
  mutates: boolean
}): PrincipalBindResult {
  if (!input.auth.authenticated) {
    return { ok: false, code: "unauthorized", reason: "anonymous operator principal denied" }
  }

  const role = input.auth.role ?? "operator"
  if (DENIED_MUTATION_ROLES.has(role)) {
    return { ok: false, code: "unauthorized", reason: `principal role ${role} denied for operator API` }
  }
  if (input.mutates && role === "manager-view") {
    return { ok: false, code: "unauthorized", reason: "manager-view cannot mutate" }
  }
  if (role !== "operator" && role !== "system" && role !== "manager-view") {
    return { ok: false, code: "unauthorized", reason: `unknown principal role ${role}` }
  }

  const subject = input.auth.subject?.trim() || "local"
  const projectBinding = input.auth.projectBinding ?? null

  const parsed = parsePrincipal({
    kind: role,
    subject,
    projectBinding,
  })
  if (!parsed.ok) {
    return { ok: false, code: "unauthorized", reason: parsed.reason }
  }
  return { ok: true, principal: parsed.value }
}

/**
 * R6: constant-time secret compare.
 * Hash both sides to fixed-length digests then timingSafeEqual — no length early-exit leak.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest()
  const right = createHash("sha256").update(b, "utf8").digest()
  return timingSafeEqual(left, right)
}

export * as OperatorAuth from "./principal"
