/**
 * Feature 005 / T032 (S20) — per-action authorization.
 * Asserts authorized consume, unauthorized sibling deny, admin deny-by-default,
 * and per-action re-evaluation (FR42, FR43, FR47, C7, AC15).
 */
import { describe, expect, test } from "bun:test"
import { Authorization } from "@/outputspool/authorization"

const subject: Authorization.Subject = {
  output_ref: "ref",
  owning_session_id: "sess-1",
  owning_tree_id: "tree-1",
  project_id: "proj-1",
  channel: "stdout",
}

describe("authorization", () => {
  test("owning session principal is authorized to consume", () => {
    const decision = Authorization.authorize({
      plane: "consume",
      principal: { kind: "runtime", id: "p", sessionId: "sess-1" },
      subject,
    })
    expect(decision.allowed).toBe(true)
  })

  test("an unauthorized sibling session is denied without content", () => {
    const decision = Authorization.authorize({
      plane: "consume",
      principal: { kind: "runtime", id: "sibling", sessionId: "sess-2" },
      subject,
    })
    expect(decision.allowed).toBe(false)
  })

  test("admin plane is deny-by-default without an operator principal", () => {
    const decision = Authorization.authorize({
      plane: "admin",
      principal: { kind: "runtime", id: "p", projectId: "proj-1" },
      subject,
      requested_scope: "project",
    })
    expect(decision.allowed).toBe(false)
  })

  test("admin plane requires an explicit scope", () => {
    const decision = Authorization.authorize({
      plane: "admin",
      principal: { kind: "operator", id: "op", projectId: "proj-1" },
      subject,
    })
    expect(decision.allowed).toBe(false)
  })

  test("operator with the requested project scope is authorized", () => {
    const decision = Authorization.authorize({
      plane: "admin",
      principal: { kind: "operator", id: "op", projectId: "proj-1" },
      subject,
      requested_scope: "project",
    })
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.scope).toBe("project")
  })

  test("a raw ref is never a saved grant — the same call re-evaluates deterministically", () => {
    const req: Authorization.AuthzRequest = {
      plane: "consume",
      principal: { kind: "runtime", id: "p", sessionId: "sess-2" },
      subject,
    }
    expect(Authorization.authorize(req).allowed).toBe(false)
    expect(Authorization.authorize(req).allowed).toBe(false)
  })
})
