/**
 * Feature 002 / T032 — read-only Todo projection (FR58k, C23-C25). The Process
 * Table OBSERVES the Session-owned Todo pointer/version/counts/consistency/
 * outcome and never mutates any Todo; Feature 001 `todo.initialized`/
 * `todo.completion_blocked` are consumed read-only; Feature 002 session-owned
 * `todo.*` events are published at the injected seam and projected; projection is
 * confined to the addressed Session (sibling isolation). In-process fixtures.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createProcessTable } from "@opencode-ai/core/lifecycle/process-table"
import type { TodoEvents } from "@opencode-ai/schema/lifecycle/todo-events"
import { createEventV2Adapter, type TodoEventPublisher } from "@/lifecycle/eventv2-adapter"
import { emitEnvelope, fakeBridge } from "./fixtures"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

async function tableWithRow(sessionId: string, processId: string) {
  const table = createProcessTable()
  const { bridge } = fakeBridge()
  const adapter = createEventV2Adapter({ bridge, table, newEventId: () => `evt_${processId}` })
  await run(
    adapter.emit({
      envelope: emitEnvelope({ eventType: "lifecycle.process_created", sessionId, processId }),
      eventType: "lifecycle.process_created",
      data: {},
    }),
  )
  return { table, adapter }
}

function todoUpdated(sessionId: string): TodoEvents.TodoEvent {
  return {
    type: "todo.updated",
    pointer: { session_id: sessionId, todo_ref: "todo_1", todo_version: "v2" },
    counts: { item_count: 3, completed_count: 1, pending_count: 2 },
  } as unknown as TodoEvents.TodoEvent
}

describe("T032 Todo projection — Feature 001 read-only consumption", () => {
  test("todo.initialized projects ref/version/counts with all items pending", async () => {
    const { table, adapter } = await tableWithRow("ses_1", "proc_1")
    const out = await run(
      adapter.projectTodoInitialized({ session_id: "ses_1" as never, todo_ref: "todo_9", todo_version: "v1", item_count: 4 }),
    )
    expect(out.updated).toBe(1)
    const todo = table.get("proc_1" as never)?.todo
    expect(todo?.todo_ref).toBe("todo_9")
    expect(todo?.item_count).toBe(4)
    expect(todo?.pending_count).toBe(4)
    expect(todo?.completed_count).toBe(0)
    expect(todo?.consistency).toBe("consistent")
  })

  test("todo.completion_blocked merges the blocked consistency + pending onto the existing Todo", async () => {
    const { table, adapter } = await tableWithRow("ses_1", "proc_1")
    await run(adapter.projectTodoInitialized({ session_id: "ses_1" as never, todo_ref: "todo_9", todo_version: "v1", item_count: 4 }))
    await run(adapter.projectTodoCompletionBlocked({ session_id: "ses_1" as never, reason: "pending items remain", pending_items: 2 }))
    const todo = table.get("proc_1" as never)?.todo
    // The pointer is preserved (completion_blocked carries no ref).
    expect(todo?.todo_ref).toBe("todo_9")
    expect(todo?.consistency).toBe("blocked")
    expect(todo?.pending_count).toBe(2)
  })
})

describe("T032 Todo projection — Feature 002 session-owned events", () => {
  test("projectTodoEvent(todo.updated) records counts and a consistent outcome=null", async () => {
    const { table, adapter } = await tableWithRow("ses_1", "proc_1")
    const out = await run(adapter.projectTodoEvent(todoUpdated("ses_1")))
    expect(out.updated).toBe(1)
    const todo = table.get("proc_1" as never)?.todo
    expect(todo?.item_count).toBe(3)
    expect(todo?.completed_count).toBe(1)
    expect(todo?.outcome).toBeNull()
  })

  test("projectTodoEvent(todo.completed) records the completed aggregate outcome", async () => {
    const { table, adapter } = await tableWithRow("ses_1", "proc_1")
    const completed = {
      type: "todo.completed",
      pointer: { session_id: "ses_1", todo_ref: "todo_1", todo_version: "v3" },
      counts: { item_count: 3, completed_count: 3, pending_count: 0 },
    } as unknown as TodoEvents.TodoEvent
    await run(adapter.projectTodoEvent(completed))
    expect(table.get("proc_1" as never)?.todo?.outcome).toBe("completed")
  })

  test("emitTodoEvent publishes through the seam AND projects the event", async () => {
    const { table } = await tableWithRow("ses_1", "proc_1")
    const published: TodoEvents.TodoEvent[] = []
    const publishTodoEvent: TodoEventPublisher = (event) => {
      published.push(event)
      return Effect.succeed(undefined)
    }
    const { bridge } = fakeBridge()
    const adapter = createEventV2Adapter({ bridge, table, publishTodoEvent })
    const out = await run(adapter.emitTodoEvent(todoUpdated("ses_1")))
    expect(published).toHaveLength(1)
    expect(published[0]?.type).toBe("todo.updated")
    expect(out.updated).toBe(1)
    expect(table.get("proc_1" as never)?.todo?.item_count).toBe(3)
  })

  test("emitTodoEvent without a publisher seam fails not_implemented", async () => {
    const { table } = await tableWithRow("ses_1", "proc_1")
    const { bridge } = fakeBridge()
    const adapter = createEventV2Adapter({ bridge, table })
    const exit = await Effect.runPromiseExit(adapter.emitTodoEvent(todoUpdated("ses_1")))
    expect(exit._tag).toBe("Failure")
  })
})

describe("T032 Todo projection — sibling isolation", () => {
  test("a Todo projection touches only the addressed Session's rows", async () => {
    const table = createProcessTable()
    const { bridge } = fakeBridge()
    let n = 0
    const adapter = createEventV2Adapter({ bridge, table, newEventId: () => `evt_${n++}` })
    await run(adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.process_created", sessionId: "ses_a", processId: "proc_a" }), eventType: "lifecycle.process_created", data: {} }))
    await run(adapter.emit({ envelope: emitEnvelope({ eventType: "lifecycle.process_created", sessionId: "ses_b", processId: "proc_b" }), eventType: "lifecycle.process_created", data: {} }))

    const out = await run(adapter.projectTodoEvent(todoUpdated("ses_a")))

    expect(out.updated).toBe(1)
    expect(table.get("proc_a" as never)?.todo?.todo_ref).toBe("todo_1")
    // The sibling Session's row is never touched.
    expect(table.get("proc_b" as never)?.todo).toBeNull()
  })
})
