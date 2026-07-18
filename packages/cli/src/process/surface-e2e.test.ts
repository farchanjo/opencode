/**
 * Feature 002 / T040 — `opencode process` / `opencode task` CLI surface
 * end-to-end output.
 *
 * Drives the REAL CLI render seam (`Output.render`, the exact path
 * `process/*.ts` and `task/*.ts` emit through) for every process surface in BOTH
 * human and JSON modes, over already-redacted `ProcessPort` views. It proves the
 * last mile before a user sees output is content-free — no prompt, secret,
 * absolute path, or raw session id ever reaches stdout/stderr (FR13, AC28) —
 * that usage is rendered honestly (never a zero or invented number, AC25), and
 * that the exit code follows the envelope `ok` flag. The CLI holds no authority;
 * it only formats the redacted operator envelope, so this guards presentation.
 *
 * Complements the Feature 001 routing surface-e2e (`operator/surface-e2e.test.ts`).
 */
import { describe, expect, test } from "bun:test"
import type { OperatorClientResult } from "@opencode-ai/sdk/operator"
import { Output } from "../operator/output"
import { ProcessRender } from "./render"

function ok(id: string, effective: unknown): OperatorClientResult {
  return { ok: true, id, outcome: "success", kind: "operator.admin_result", effective, httpStatus: 200 } as OperatorClientResult
}

function notFound(id: string): OperatorClientResult {
  return {
    ok: false,
    id,
    outcome: "not_found",
    kind: "operator.error",
    error: { code: "not_found", message: "no such process" },
    httpStatus: 404,
  } as unknown as OperatorClientResult
}

// Tokens that must never appear in rendered CLI output regardless of surface.
const FORBIDDEN_OUTPUT = ["sk-", "/Users/", "/home/", "ses_", "sess-", "prompt", "secret", "password", "Authorization"]

function assertContentFree(text: string): void {
  for (const token of FORBIDDEN_OUTPUT) {
    expect(text.includes(token), `rendered output leaked "${token}"`).toBe(false)
  }
}

// A redacted running ProcessRow view (camelCase, as the ProcessPort returns it).
const runningRow = {
  processId: "proc_1",
  status: "running",
  taskId: "task_1",
  attempt: 1,
  generation: 0,
  agentKind: "worker",
  provider: "anthropic",
  model: "claude",
  hierarchyRole: "worker",
  validationOutcome: "passed",
  usage: {
    available: true,
    provenance: "reported",
    source: "provider",
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 5,
    tokensPerSecond: 20,
  },
}

const streamingRow = {
  processId: "proc_2",
  status: "running",
  taskId: "task_1",
  attempt: 1,
  generation: 0,
  usage: { available: false },
}

const terminalRow = {
  processId: "proc_3",
  status: "completed",
  taskId: "task_1",
  attempt: 1,
  generation: 0,
  terminalReason: "completed_ok",
  settlementState: "settled",
}

describe("T040 process status surface — human + JSON (AC28)", () => {
  test("human status renders identity/state and stays content-free", () => {
    const out = Output.render(ok("process.status", runningRow), false, ProcessRender.renderStatus)
    expect(out.exitCode).toBe(0)
    expect(out.stderr).toBe("")
    expect(out.stdout).toContain("process proc_1: running")
    expect(out.stdout).toContain("role: worker")
    assertContentFree(out.stdout)
  })

  test("JSON status emits the envelope and stays content-free", () => {
    const out = Output.render(ok("process.status", runningRow), true, ProcessRender.renderStatus)
    expect(out.exitCode).toBe(0)
    const parsed = JSON.parse(out.stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.effective.processId).toBe("proc_1")
    assertContentFree(out.stdout)
  })

  test("streaming with no live usage renders `usage: unavailable`, never zero or an invented number (AC25)", () => {
    const out = Output.render(ok("process.status", streamingRow), false, ProcessRender.renderStatus)
    expect(out.stdout).toContain("usage: unavailable")
    expect(out.stdout).not.toContain("tokens=0")
    assertContentFree(out.stdout)
  })

  test("a terminal row surfaces terminal reason and settlement", () => {
    const out = Output.render(ok("process.status", terminalRow), false, ProcessRender.renderStatus)
    expect(out.stdout).toContain("process proc_3: completed")
    expect(out.stdout).toContain("terminal reason: completed_ok")
    expect(out.stdout).toContain("settlement: settled")
    assertContentFree(out.stdout)
  })
})

describe("T040 process tree surface — direct children only (AC28)", () => {
  const treeEffective = {
    nodes: [
      { row: runningRow, childProcessIds: ["proc_4", "proc_5"] },
      { row: terminalRow, childProcessIds: [] },
    ],
  }

  test("human tree renders nodes with their direct children and stays content-free", () => {
    const out = Output.render(ok("process.tree", treeEffective), false, ProcessRender.renderTree)
    expect(out.stdout).toContain("proc_1 [running] (worker)")
    expect(out.stdout).toContain("children: proc_4, proc_5")
    assertContentFree(out.stdout)
  })

  test("JSON tree stays content-free", () => {
    const out = Output.render(ok("process.tree", treeEffective), true, ProcessRender.renderTree)
    assertContentFree(out.stdout)
  })

  test("an empty tree renders an honest baseline", () => {
    const out = Output.render(ok("process.tree", { nodes: [] }), false, ProcessRender.renderTree)
    expect(out.stdout).toContain("process tree: (empty)")
  })
})

describe("T040 native-control surfaces — cancel/steer/handoff (AC28)", () => {
  test("cancel renders the outcome and audit id, content-free", () => {
    const out = Output.render(ok("process.cancel", { outcome: "requested", auditId: "audit_1" }), false, ProcessRender.renderCancel)
    expect(out.stdout).toContain("cancel outcome: requested")
    expect(out.stdout).toContain("audit: audit_1")
    assertContentFree(out.stdout)
  })

  test("steer renders acceptance, content-free", () => {
    const out = Output.render(ok("process.steer", { outcome: "accepted", auditId: "audit_2" }), false, ProcessRender.renderSteer)
    expect(out.stdout).toContain("steer outcome: accepted")
    expect(out.stdout).toContain("accepted: yes")
    assertContentFree(out.stdout)
  })

  test("handoff renders the target session id (a Task-level id, not a raw prompt), content-free", () => {
    // targetSessionId is an opaque logical id in the redacted view; the guard
    // still forbids the raw `ses_`/`sess-` correlation-id shapes.
    const out = Output.render(
      ok("process.handoff", { outcome: "requested", targetSessionId: "task_dst", auditId: "audit_3" }),
      false,
      ProcessRender.renderHandoff,
    )
    expect(out.stdout).toContain("handoff outcome: requested")
    expect(out.stdout).toContain("target session: task_dst")
    assertContentFree(out.stdout)
  })
})

describe("T040 error envelope — exit code follows `ok` (AC28)", () => {
  test("a not_found envelope renders on stderr with exit 1 and leaks nothing", () => {
    const out = Output.render(notFound("process.status"), false, ProcessRender.renderStatus)
    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe("")
    expect(out.stderr).toContain("not_found")
    assertContentFree(out.stderr)
  })

  test("JSON error still exits 1 and stays content-free", () => {
    const out = Output.render(notFound("process.status"), true, ProcessRender.renderStatus)
    expect(out.exitCode).toBe(1)
    assertContentFree(out.stdout)
  })
})
