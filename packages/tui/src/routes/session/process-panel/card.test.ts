import { describe, expect, test } from "bun:test"
import type { Row } from "@opencode-ai/schema/lifecycle/process-row"
import { deriveCardView, type ProcessCardInput } from "./card"

function row(overrides: Record<string, unknown> = {}): Row.ProcessRow {
  return {
    id: "proc_1",
    identity: { task_id: "task_1", attempt: 1, generation: 1, lease_id: null },
    lineage: {
      relations: {
        parent_process_id: null,
        root_process_id: "root_1",
        session_id: "sess_1",
        parent_session_id: "root_sess_1",
        root_session_id: "root_sess_1",
      },
      ownership: { runtime_instance_id: "rt_1", scope: "session", actor_kind: "runtime" },
      graph: { dependencies: [], children: [], pending_inputs: [], pending_steers: [] },
    },
    status: {
      state: "running",
      reason: null,
      settlement: null,
      created_at: 1000,
      updated_at: 1000,
      terminal_at: null,
    },
    profile: {
      classification: {
        agent_name: "build",
        agent_kind: "worker",
        task_class: "code",
        profile: "direct_worker",
        task_effort: "medium",
        reasoning_effort: "medium",
      },
      model: { provider: "anthropic", model: "claude-sonnet-5", variant: null },
    },
    accounting: {
      usage: { usage: { available: false }, ttft_ms: null, stream_ms: null, total_ms: null },
      outcome: { cancel_outcome: null, exit_reason: null, error_reason: null },
      telemetry: { trace_id: null, span_id: null, output_ref: null },
    },
    hierarchy: null,
    ...overrides,
  } as unknown as Row.ProcessRow
}

describe("process-panel card projection", () => {
  test("renders identity, status and model without inventing usage", () => {
    const view = deriveCardView({ row: row(), activity: null })
    expect(view.processId).toBe("proc_1")
    expect(view.taskId).toBe("task_1")
    expect(view.statusText).toBe("running")
    expect(view.isTerminal).toBe(false)
    expect(view.modelLabel).toBe("anthropic/claude-sonnet-5")
    expect(view.usageText).toBe("streaming/generating · tokens unavailable")
    expect(view.activityText).toBe("activity unavailable")
  })

  test("never shows zero or fabricated usage; reports real tokens with provenance", () => {
    const input: ProcessCardInput = {
      row: row({
        accounting: {
          usage: {
            usage: {
              available: true,
              tokens: { input: 10, output: 20 },
              provenance: { provenance: "reported", source: "provider" },
              tokens_per_second: 5,
            },
            ttft_ms: null,
            stream_ms: null,
            total_ms: null,
          },
          outcome: { cancel_outcome: null, exit_reason: null, error_reason: null },
          telemetry: { trace_id: null, span_id: null, output_ref: null },
        },
      }),
      activity: null,
    }
    const view = deriveCardView(input)
    expect(view.usageText).toBe("reported/provider · 30 tokens · 5.0 tok/s")
  })

  test("terminal states are flagged; hierarchy role/validation surface when present", () => {
    const view = deriveCardView({
      row: row({
        status: { state: "completed", reason: "completed_ok", settlement: "settled", created_at: 1, updated_at: 2, terminal_at: 2 },
        hierarchy: { role: "worker", delegation_depth: 1, route_path: [], fanout: { requested: 1, granted: 1 }, validation_outcome: "passed" },
      }),
      activity: null,
    })
    expect(view.isTerminal).toBe(true)
    expect(view.hierarchyRole).toBe("worker")
    expect(view.validationOutcome).toBe("passed")
  })

  test("activity is allowlisted and bounded, never a raw path/prompt", () => {
    const view = deriveCardView({ row: row(), activity: { kind: "edit", detail: "src/index.ts" } })
    expect(view.activityText).toBe("Edit src/index.ts")
  })

  test("child count reflects the process graph without flattening", () => {
    const view = deriveCardView({
      row: row({ lineage: { relations: row().lineage.relations, ownership: row().lineage.ownership, graph: { dependencies: [], children: ["proc_2", "proc_3"], pending_inputs: [], pending_steers: [] } } }),
      activity: null,
    })
    expect(view.childCount).toBe(2)
  })
})
