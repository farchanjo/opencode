import { describe, expect, test } from "bun:test"
import {
  canMutate,
  isManagerView,
  isScopeAllowedForPrincipal,
  parsePrincipal,
  parsePrincipalKind,
  parseScope,
  parseScopeKind,
} from "../../src/operator"

describe("operator principal (T005)", () => {
  test("accepts operator, system, manager-view", () => {
    for (const kind of ["operator", "system", "manager-view"] as const) {
      const r = parsePrincipal({ kind, subject: "local", projectBinding: null })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.kind).toBe(kind)
    }
  })

  test("rejects invalid principal kinds (llm/tool/plugin)", () => {
    for (const kind of ["llm", "tool", "mcp", "plugin", "admin", ""]) {
      expect(parsePrincipal({ kind, subject: "local", projectBinding: null }).ok).toBe(false)
      expect(parsePrincipalKind(kind).ok).toBe(false)
    }
  })

  test("rejects empty/whitespace subject", () => {
    expect(parsePrincipal({ kind: "operator", subject: "", projectBinding: null }).ok).toBe(false)
    expect(parsePrincipal({ kind: "operator", subject: "  ", projectBinding: null }).ok).toBe(false)
  })

  test("manager-view cannot mutate; operator and system can", () => {
    const mv = parsePrincipal({ kind: "manager-view", subject: "viewer", projectBinding: null })
    const op = parsePrincipal({ kind: "operator", subject: "local", projectBinding: null })
    const sys = parsePrincipal({ kind: "system", subject: "jobs", projectBinding: null })
    expect(mv.ok && canMutate(mv.value)).toBe(false)
    expect(mv.ok && isManagerView(mv.value)).toBe(true)
    expect(op.ok && canMutate(op.value)).toBe(true)
    expect(sys.ok && canMutate(sys.value)).toBe(true)
  })
})

describe("operator scope (T005)", () => {
  test("accepts global/project/session/root-tree", () => {
    expect(parseScope({ kind: "global", ref: null }).ok).toBe(true)
    expect(parseScope({ kind: "project", ref: "proj_1" }).ok).toBe(true)
    expect(parseScope({ kind: "session", ref: "ses_1" }).ok).toBe(true)
    expect(parseScope({ kind: "root-tree", ref: "tree_1" }).ok).toBe(true)
  })

  test("rejects invalid scope kind", () => {
    expect(parseScopeKind("workspace").ok).toBe(false)
    expect(parseScope({ kind: "workspace", ref: "x" }).ok).toBe(false)
  })

  test("global must not carry ref; non-global requires ref", () => {
    expect(parseScope({ kind: "global", ref: "oops" }).ok).toBe(false)
    expect(parseScope({ kind: "project", ref: null }).ok).toBe(false)
    expect(parseScope({ kind: "session", ref: "" }).ok).toBe(false)
  })

  test("project-bound principal fails closed across projects and global", () => {
    const principal = parsePrincipal({ kind: "operator", subject: "local", projectBinding: "proj_a" })
    expect(principal.ok).toBe(true)
    if (!principal.ok) return
    expect(isScopeAllowedForPrincipal(principal.value, { kind: "project", ref: "proj_a" })).toBe(true)
    expect(isScopeAllowedForPrincipal(principal.value, { kind: "project", ref: "proj_b" })).toBe(false)
    expect(isScopeAllowedForPrincipal(principal.value, { kind: "global", ref: null })).toBe(false)
    expect(isScopeAllowedForPrincipal(principal.value, { kind: "session", ref: "s1" })).toBe(false)
    expect(
      isScopeAllowedForPrincipal(principal.value, { kind: "session", ref: "s1" }, { projectId: "proj_a" }),
    ).toBe(true)
  })
})
