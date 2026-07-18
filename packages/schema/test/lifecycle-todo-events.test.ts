import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TodoEvents } from "../src/lifecycle/todo-events"

const pointer = { session_id: "s1", todo_ref: "todo_1", todo_version: "v3" }
const counts = { item_count: 5, completed_count: 2, pending_count: 3 }

const members = [
  "todo.updated",
  "todo.completed",
  "todo.failed",
  "todo.cancelled",
  "todo.stale",
  "todo.rehydrated",
  "todo.handoff_attached",
] as const

describe("TodoEvents.TodoEvent", () => {
  test("round-trips every session-owned Todo member", () => {
    for (const type of members) {
      const value = { type, pointer, counts }
      expect(Schema.decodeUnknownSync(TodoEvents.TodoEvent)(value) as unknown).toEqual(value)
    }
  })

  test("rejects a type outside the seven-member union", () => {
    expect(() =>
      Schema.decodeUnknownSync(TodoEvents.TodoEvent)({ type: "todo.initialized", pointer, counts }),
    ).toThrow()
  })

  test("rejects a negative count (counts are non-negative)", () => {
    expect(() =>
      Schema.decodeUnknownSync(TodoEvents.TodoEvent)({
        type: "todo.updated",
        pointer,
        counts: { ...counts, pending_count: -1 },
      }),
    ).toThrow()
  })
})

describe("TodoEvents.TodoCounts", () => {
  test("round-trips bounded item/completed/pending counts", () => {
    expect(Schema.decodeUnknownSync(TodoEvents.TodoCounts)(counts) as unknown).toEqual(counts)
  })
})

describe("TodoEvents.TodoPointer", () => {
  test("rejects an empty todo_ref (references a Todo aggregate)", () => {
    expect(() =>
      Schema.decodeUnknownSync(TodoEvents.TodoPointer)({ ...pointer, todo_ref: "" }),
    ).toThrow()
  })
})
