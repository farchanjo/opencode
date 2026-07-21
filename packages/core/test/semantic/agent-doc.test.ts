import { describe, expect, test } from "bun:test"
import { AgentDocBuilder } from "@opencode-ai/core/semantic/agent-doc"

// Feature 050 / T003 — the pure `Agent.Info -> AgentDoc` builder: field mapping
// correctness, empty-`TagSet` defaults, `permission_ref` hash derivation, the
// hidden -> visibility:"project" + available:false mapping (never a widened
// "shared" visibility), and that `content_hash` never incorporates `content`
// (agents carry no `content` field at all, so this is verified via stability).

const baseAgent = (overrides: Partial<AgentDocBuilder.AgentInfoLike> = {}): AgentDocBuilder.AgentInfoLike => ({
  id: "agent-1",
  description: "a backend agent for billing",
  mode: "subagent",
  hidden: false,
  color: "primary",
  permissions: [{ action: "read", resources: ["*"] }],
  ...overrides,
})

const context = { projectId: "proj-1" }

describe("AgentDocBuilder.build — field mapping (FR7)", () => {
  test("maps direct fields and honest empty TagSet/[] defaults", () => {
    const doc = AgentDocBuilder.build(baseAgent(), context)
    expect(doc.id as string).toBe("agent-1")
    expect(doc.classification.mode).toBe("subagent")
    expect(doc.classification.description).toBe("a backend agent for billing")
    expect(doc.taxonomy.domains).toEqual([])
    expect(doc.taxonomy.capabilities).toEqual([])
    expect(doc.taxonomy.tools).toEqual([])
    expect(doc.languages).toEqual([])
    expect(doc.scope.project_id as string).toBe("proj-1")
    expect(doc.scope.scope).toBe("project")
    expect(doc.identity.version).toBe(1)
    expect(doc.identity.source).toBe("agent")
  })

  test("mode -> role: primary -> architect; subagent/all -> worker (conservative default)", () => {
    expect(AgentDocBuilder.build(baseAgent({ mode: "primary" }), context).classification.role).toBe("architect")
    expect(AgentDocBuilder.build(baseAgent({ mode: "subagent" }), context).classification.role).toBe("worker")
    expect(AgentDocBuilder.build(baseAgent({ mode: "all" }), context).classification.role).toBe("worker")
  })

  test("hidden -> visibility stays 'project' + available:false, never a widened 'shared'", () => {
    const visible = AgentDocBuilder.build(baseAgent({ hidden: false }), context)
    expect(visible.scope.visibility).toBe("project")
    expect(visible.availability.enabled).toBe(true)
    expect(visible.availability.available).toBe(true)

    const hidden = AgentDocBuilder.build(baseAgent({ hidden: true }), context)
    expect(hidden.scope.visibility).toBe("project")
    expect(hidden.availability.enabled).toBe(false)
    expect(hidden.availability.available).toBe(false)
  })

  test("description is scrubbed of path/secret-shaped substrings (ranking signal only)", () => {
    const doc = AgentDocBuilder.build(baseAgent({ description: "see /Users/me/secret/key.pem" }), context)
    expect(doc.classification.description).toContain("[path]")
  })
})

describe("AgentDocBuilder.build — permission_ref hash derivation", () => {
  test("permission_ref is a stable hash over permissions, independent of content_hash", () => {
    const a = AgentDocBuilder.build(baseAgent(), context)
    const b = AgentDocBuilder.build(baseAgent(), context)
    expect(a.scope.permission_ref).toBe(b.scope.permission_ref)
    expect(a.scope.permission_ref).not.toBe(a.identity.content_hash)
  })

  test("a permissions-only change moves permission_ref without necessarily matching an unrelated hash", () => {
    const withDefaultPerms = AgentDocBuilder.build(baseAgent(), context)
    const withOtherPerms = AgentDocBuilder.build(
      baseAgent({ permissions: [{ action: "write", resources: ["*"] }] }),
      context,
    )
    expect(withOtherPerms.scope.permission_ref).not.toBe(withDefaultPerms.scope.permission_ref)
    // A ruleset-only change also moves content_hash (permissions is one of its inputs).
    expect(withOtherPerms.identity.content_hash).not.toBe(withDefaultPerms.identity.content_hash)
  })
})

describe("AgentDocBuilder.build — content_hash stability and change detection", () => {
  test("identical input yields the identical content_hash (deterministic, pure)", () => {
    const a = AgentDocBuilder.build(baseAgent(), context)
    const b = AgentDocBuilder.build(baseAgent(), context)
    expect(a.identity.content_hash).toBe(b.identity.content_hash)
  })

  test("a description edit changes content_hash", () => {
    const original = AgentDocBuilder.build(baseAgent(), context)
    const edited = AgentDocBuilder.build(baseAgent({ description: "a different description" }), context)
    expect(edited.identity.content_hash).not.toBe(original.identity.content_hash)
  })

  test("steps is never part of the input, so it can never influence content_hash", () => {
    // Agent.Info.steps is a runtime budget knob, not identity — AgentInfoLike deliberately omits it.
    const a = AgentDocBuilder.build(baseAgent(), context)
    const b = AgentDocBuilder.build(baseAgent(), context)
    expect(a.identity.content_hash).toBe(b.identity.content_hash)
  })
})
