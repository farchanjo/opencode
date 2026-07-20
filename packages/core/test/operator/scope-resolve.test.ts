import { describe, expect, test } from "bun:test"
import {
  resolveOperatorScope,
  resolveScopeForCommandId,
} from "../../src/operator/scope-resolve"

describe("resolveOperatorScope", () => {
  test("session-only descriptor uses session when present", () => {
    const scope = resolveScopeForCommandId("process.cancel", {
      projectId: "p1",
      sessionId: "s1",
    })
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.scope).toEqual({ kind: "session", ref: "s1" })
  })

  test("session-only missing sessionId → forbidden_scope (never local)", () => {
    const scope = resolveScopeForCommandId("process.cancel", {
      projectId: "p1",
    })
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.code).toBe("forbidden_scope")
    expect(scope.message).not.toContain("local")
  })

  test("project+global prefers project when projectId set", () => {
    const scope = resolveScopeForCommandId("langlock.status", {
      projectId: "p1",
      sessionId: "s1",
    })
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.scope).toEqual({ kind: "project", ref: "p1" })
  })

  test("project required missing projectId → forbidden_scope", () => {
    const scope = resolveOperatorScope({
      ctx: {},
      scopesAllowed: ["project"],
    })
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.code).toBe("forbidden_scope")
  })

  test("root-tree when allowed and ref present without project", () => {
    const scope = resolveOperatorScope({
      ctx: { rootTreeRef: "rt1" },
      scopesAllowed: ["root-tree", "global"],
    })
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.scope).toEqual({ kind: "root-tree", ref: "rt1" })
  })

  test("global when unbound and allowed", () => {
    const scope = resolveOperatorScope({
      ctx: {},
      scopesAllowed: ["global", "project"],
    })
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.scope).toEqual({ kind: "global", ref: null })
  })
})

describe("resolveOperatorScope — explicit requestedKind (Feature 034)", () => {
  test("requestedKind:global wins over a bound projectId when global allowed", () => {
    const scope = resolveScopeForCommandId("pools.set", {
      projectId: "p1",
      requestedKind: "global",
    })
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    // Without the explicit request this would resolve to { project, p1 }.
    expect(scope.scope).toEqual({ kind: "global", ref: null })
  })

  test("requestedKind:global on a project-only command → forbidden_scope", () => {
    const scope = resolveOperatorScope({
      ctx: { projectId: "p1", requestedKind: "global" },
      scopesAllowed: ["project"],
    })
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.code).toBe("forbidden_scope")
    expect(scope.details?.requested).toBe("global")
  })

  test("requestedKind:project resolves to the bound projectId", () => {
    const scope = resolveScopeForCommandId("pools.set", {
      projectId: "p1",
      requestedKind: "project",
    })
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.scope).toEqual({ kind: "project", ref: "p1" })
  })

  test("requestedKind:project without a projectId → forbidden_scope", () => {
    const scope = resolveOperatorScope({
      ctx: { requestedKind: "project" },
      scopesAllowed: ["global", "project"],
    })
    expect(scope.ok).toBe(false)
    if (scope.ok) return
    expect(scope.code).toBe("forbidden_scope")
    expect(scope.details?.required).toBe("project")
  })

  test("absent requestedKind is unchanged — project preferred when bound", () => {
    const scope = resolveScopeForCommandId("pools.set", { projectId: "p1" })
    expect(scope.ok).toBe(true)
    if (!scope.ok) return
    expect(scope.scope).toEqual({ kind: "project", ref: "p1" })
  })
})
