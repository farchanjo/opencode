import { describe, expect, test } from "bun:test"
import type { Row } from "@opencode-ai/schema/lifecycle/process-row"
import { deriveDirectChildCards, EMPTY_PROCESS_PANEL_SIGNAL, MAX_VISIBLE_CARDS, type ProcessPanelSignal } from "./state"
import type { ProcessCardInput } from "./card"

function cardInput(processId: string, parentSessionId: string | null): ProcessCardInput {
  return {
    row: {
      id: processId,
      identity: { task_id: `task_${processId}`, attempt: 1, generation: 1, lease_id: null },
      lineage: {
        relations: {
          parent_process_id: null,
          root_process_id: "root_1",
          session_id: processId,
          parent_session_id: parentSessionId,
          root_session_id: "root_sess_1",
        },
        ownership: { runtime_instance_id: "rt_1", scope: "session", actor_kind: "runtime" },
        graph: { dependencies: [], children: [], pending_inputs: [], pending_steers: [] },
      },
      status: { state: "running", reason: null, settlement: null, created_at: 1, updated_at: 1, terminal_at: null },
      profile: {
        classification: {
          agent_name: processId,
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
    } as unknown as Row.ProcessRow,
    activity: null,
  }
}

describe("process-panel direct-child projection (FR52, FR58a, C22)", () => {
  test("the empty baseline renders no cards", () => {
    expect(deriveDirectChildCards(EMPTY_PROCESS_PANEL_SIGNAL)).toEqual([])
  })

  test("no current session id renders nothing even with cards present", () => {
    const signal: ProcessPanelSignal = { currentSessionId: "", cards: [cardInput("proc_1", "sess_root")] }
    expect(deriveDirectChildCards(signal)).toEqual([])
  })

  test("only direct children of the current session are shown; grandchildren never flatten in", () => {
    const signal: ProcessPanelSignal = {
      currentSessionId: "sess_root",
      cards: [
        cardInput("proc_direct", "sess_root"),
        cardInput("proc_grandchild", "proc_direct"),
        cardInput("proc_sibling_root", "sess_other"),
      ],
    }
    const views = deriveDirectChildCards(signal)
    expect(views.map((v) => v.processId)).toEqual(["proc_direct"])
  })

  test("the visible row count is bounded (C22)", () => {
    const cards = Array.from({ length: MAX_VISIBLE_CARDS + 20 }, (_, i) => cardInput(`proc_${i}`, "sess_root"))
    const signal: ProcessPanelSignal = { currentSessionId: "sess_root", cards }
    expect(deriveDirectChildCards(signal).length).toBe(MAX_VISIBLE_CARDS)
  })
})
