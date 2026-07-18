import { describe, expect, test } from "bun:test"
import { renderCancel, renderHandoff, renderRow, renderSteer, renderTree } from "./render"

describe("process renderers", () => {
  test("row renders status, identity, and usage", () => {
    const out = renderRow({
      processId: "proc-1",
      taskId: "task-1",
      status: "running",
      attempt: 1,
      generation: 0,
      agentKind: "worker",
      provider: "anthropic",
      model: "claude-sonnet-5",
      hierarchyRole: "worker",
      usage: { available: true, provenance: "estimated", source: "local-estimate", inputTokens: 10, outputTokens: 20, tokensPerSecond: 5 },
    })
    expect(out).toContain("process proc-1: running")
    expect(out).toContain("task: task-1  attempt: 1  gen: 0")
    expect(out).toContain("agent: worker  model: anthropic/claude-sonnet-5")
    expect(out).toContain("role: worker")
    expect(out).toContain("usage: estimated/local-estimate tokens=30 (5.0 tok/s)")
  })

  test("row wraps a { row } envelope and reports unavailable usage honestly", () => {
    const out = renderRow({ row: { processId: "proc-2", status: "waiting", usage: { available: false } } })
    expect(out).toContain("process proc-2: waiting")
    expect(out).toContain("usage: unavailable")
  })

  test("tree renders nodes with direct children only", () => {
    const out = renderTree({
      nodes: [
        { row: { processId: "root", status: "running" }, childProcessIds: ["child-1"] },
        { row: { processId: "child-1", status: "queued" }, childProcessIds: [] },
      ],
    })
    expect(out).toContain("root [running]")
    expect(out).toContain("children: child-1")
    expect(out).toContain("child-1 [queued]")
  })

  test("tree renders an honest empty baseline", () => {
    expect(renderTree({ nodes: [] })).toBe("process tree: (empty)")
  })

  test("cancel renders outcome and audit id", () => {
    const out = renderCancel({ outcome: "accepted", auditId: "audit-1" })
    expect(out).toContain("cancel outcome: accepted")
    expect(out).toContain("audit: audit-1")
  })

  test("steer renders acceptance", () => {
    const out = renderSteer({ outcome: "accepted", auditId: "audit-2" })
    expect(out).toContain("steer outcome: accepted")
    expect(out).toContain("accepted: yes")
  })

  test("handoff renders target session", () => {
    const out = renderHandoff({ outcome: "requested", targetSessionId: "sess-2" })
    expect(out).toContain("handoff outcome: requested")
    expect(out).toContain("target session: sess-2")
  })

  test("no renderer ever leaks a prompt, secret, or absolute path (redacted rows only)", () => {
    const dangerous = {
      row: {
        processId: "proc-1",
        status: "running",
        error: "bounded redacted reason",
        usage: { available: true, provenance: "reported", source: "provider", inputTokens: 1, outputTokens: 1 },
      },
      nodes: [{ row: { processId: "proc-1", status: "running" }, childProcessIds: [] }],
      outcome: "accepted",
      accepted: true,
      auditId: "audit-1",
      targetSessionId: "sess-2",
    }
    const outputs = [renderRow(dangerous), renderTree(dangerous), renderCancel(dangerous), renderSteer(dangerous), renderHandoff(dangerous)]
    for (const out of outputs) {
      for (const token of ["sk-", "/Users/", "prompt", "secret"]) {
        expect(out.includes(token), `rendered output leaked "${token}"`).toBe(false)
      }
    }
  })
})
