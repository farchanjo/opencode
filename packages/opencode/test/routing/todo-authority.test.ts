import { describe, expect, test } from "bun:test"
import { TodoAuthority, type TodoItem } from "@/routing/domain/todo-authority"

function item(overrides?: Partial<TodoItem>): TodoItem {
  return { id: "item_1", content: "do the thing", status: "pending", priority: "medium", required: true, ...overrides }
}

describe("TodoAuthority.initializeTodo / dispatchGate", () => {
  test("initializes with an empty snapshot (item_count 0 is representable)", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [] })
    expect(todo.items).toHaveLength(0)
  })

  test("empty snapshot is blocked at the dispatch gate", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [] })
    const result = TodoAuthority.dispatchGate(todo)
    expect(result.outcome).toBe("blocked")
    expect(result.reason).toContain("empty")
  })

  test("non-empty snapshot passes the dispatch gate", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [item()] })
    expect(TodoAuthority.dispatchGate(todo).outcome).toBe("ok")
  })
})

describe("TodoAuthority.checkSingleInProgress", () => {
  test("zero in_progress while work remains is blocked", () => {
    const todo = TodoAuthority.initializeTodo({
      sessionId: "ses_1",
      ref: "todo_1",
      version: "v1",
      items: [item({ status: "pending" })],
    })
    expect(TodoAuthority.checkSingleInProgress(todo).outcome).toBe("blocked")
  })

  test("exactly one in_progress while work remains is ok", () => {
    const todo = TodoAuthority.initializeTodo({
      sessionId: "ses_1",
      ref: "todo_1",
      version: "v1",
      items: [item({ id: "a", status: "in_progress" }), item({ id: "b", status: "pending" })],
    })
    expect(TodoAuthority.checkSingleInProgress(todo).outcome).toBe("ok")
  })

  test("two in_progress while work remains is blocked", () => {
    const todo = TodoAuthority.initializeTodo({
      sessionId: "ses_1",
      ref: "todo_1",
      version: "v1",
      items: [item({ id: "a", status: "in_progress" }), item({ id: "b", status: "in_progress" })],
    })
    expect(TodoAuthority.checkSingleInProgress(todo).outcome).toBe("blocked")
  })

  test("no remaining work permits zero in_progress items", () => {
    const todo = TodoAuthority.initializeTodo({
      sessionId: "ses_1",
      ref: "todo_1",
      version: "v1",
      items: [item({ status: "completed" })],
    })
    expect(TodoAuthority.checkSingleInProgress(todo).outcome).toBe("ok")
  })
})

describe("TodoAuthority.completionGate", () => {
  const check = { expectedVersion: "v1" as const, validationPerformed: true }

  test("blocks when a required item is not completed", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [item({ status: "pending" })] })
    const result = TodoAuthority.completionGate(todo, check)
    expect(result.outcome).toBe("blocked")
    expect(result.pendingItems).toBe(1)
  })

  test("cancelled required items do not satisfy the completion gate", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [item({ status: "cancelled" })] })
    expect(TodoAuthority.completionGate(todo, check).outcome).toBe("blocked")
  })

  test("optional (non-required) items never block completion", () => {
    const todo = TodoAuthority.initializeTodo({
      sessionId: "ses_1",
      ref: "todo_1",
      version: "v1",
      items: [item({ status: "completed" }), item({ id: "opt", status: "pending", required: false })],
    })
    expect(TodoAuthority.completionGate(todo, check).outcome).toBe("ok")
  })

  test("blocks on version mismatch even when all required items are completed", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v2", items: [item({ status: "completed" })] })
    const result = TodoAuthority.completionGate(todo, check)
    expect(result.outcome).toBe("blocked")
    expect(result.reason).toContain("version mismatch")
  })

  test("blocks when the validation step was not performed", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [item({ status: "completed" })] })
    const result = TodoAuthority.completionGate(todo, { expectedVersion: "v1", validationPerformed: false })
    expect(result.outcome).toBe("blocked")
    expect(result.reason).toContain("validation")
  })

  test("passes when required items are completed, version matches, and validation was performed", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [item({ status: "completed" })] })
    const result = TodoAuthority.completionGate(todo, check)
    expect(result.outcome).toBe("ok")
    expect(result.pendingItems).toBe(0)
  })
})

describe("TodoAuthority.applyCas", () => {
  test("accepts a matching expected version and bumps to the next version", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v1", items: [] })
    const result = TodoAuthority.applyCas(todo, { expectedVersion: "v1", nextVersion: "v2", items: [item()] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.todo.version).toBe("v2")
      expect(result.todo.items).toHaveLength(1)
    }
  })

  test("rejects a stale expected version without mutating", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v2", items: [] })
    const result = TodoAuthority.applyCas(todo, { expectedVersion: "v1", nextVersion: "v3", items: [item()] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.currentVersion).toBe("v2")
  })
})

describe("TodoAuthority.assertOwner", () => {
  test("owning session may mutate its own Todo", () => {
    const todo = TodoAuthority.initializeTodo({ sessionId: "ses_parent", ref: "todo_1", version: "v1", items: [] })
    expect(TodoAuthority.assertOwner(todo, "ses_parent").outcome).toBe("ok")
  })

  test("parent session cannot edit a child session's Todo", () => {
    const childTodo = TodoAuthority.initializeTodo({ sessionId: "ses_child", ref: "todo_2", version: "v1", items: [] })
    const result = TodoAuthority.assertOwner(childTodo, "ses_parent")
    expect(result.outcome).toBe("blocked")
  })
})

describe("TodoAuthority.summarize", () => {
  test("projects a bounded summary (ref, version, counts) without full item content", () => {
    const todo = TodoAuthority.initializeTodo({
      sessionId: "ses_1",
      ref: "todo_1",
      version: "v1",
      items: [item({ id: "a", status: "completed" }), item({ id: "b", status: "in_progress" })],
    })
    const summary = TodoAuthority.summarize(todo)
    expect(summary).toEqual({
      ref: "todo_1",
      version: "v1",
      itemCount: 2,
      statusCounts: { pending: 0, in_progress: 1, completed: 1, cancelled: 0 },
    })
    expect(summary).not.toHaveProperty("items")
  })
})

describe("TodoAuthority.rehydrate", () => {
  test("returns the durable snapshot when refs match", () => {
    const durable = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_1", version: "v3", items: [item()] })
    const result = TodoAuthority.rehydrate("todo_1", durable)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.todo).toEqual(durable)
  })

  test("rejects rehydration when the durable snapshot belongs to a different ref", () => {
    const durable = TodoAuthority.initializeTodo({ sessionId: "ses_1", ref: "todo_other", version: "v3", items: [] })
    const result = TodoAuthority.rehydrate("todo_1", durable)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("ref_mismatch")
  })
})
