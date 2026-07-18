export * as TodoEvents from "./todo-events"

import { Schema } from "effect"
import { CorrelationIds } from "./correlation-ids"
import { Ids } from "./ids"
import { Values } from "./values"

// Feature 002 session-owned Todo lifecycle events (FR58m, C23-C25). These are
// DISTINCT from the Feature 001 todo.initialized / todo.completion_blocked
// events, which Feature 002 consumes read-only. There is no CUE mirror: the
// vocabulary is fixed by tasks.md T011 and follows the flat Feature 001 todo
// event shape (routing/events.ts TodoInitializedEvent) rather than the
// 26-member LifecycleEvent envelope union. Every member carries a Todo pointer
// and bounded counts only: no objective/item/handoff text, path, or payload
// (FR58m; text is governed by Feature 004 Lang Lock and projected elsewhere).

// TodoPointer references a Session-owned Todo aggregate at a pinned revision.
export const TodoPointer = Schema.Struct({
  session_id: Ids.SessionId,
  todo_ref: CorrelationIds.TodoRef,
  todo_version: CorrelationIds.TodoVersion,
}).annotate({ identifier: "LifecycleTodo.TodoPointer" })
export type TodoPointer = Schema.Schema.Type<typeof TodoPointer>

// TodoCounts carries bounded item/completed/pending counts only (C23). Unknown
// values are never invented; a count is a non-negative bounded integer.
export const TodoCounts = Schema.Struct({
  item_count: Values.ItemCount,
  completed_count: Values.ItemCount,
  pending_count: Values.ItemCount,
}).annotate({ identifier: "LifecycleTodo.TodoCounts" })
export type TodoCounts = Schema.Schema.Type<typeof TodoCounts>

// todo.updated — the Session's Todo set changed; counts are reprojected.
export const TodoUpdatedEvent = Schema.Struct({
  type: Schema.Literal("todo.updated"),
  pointer: TodoPointer,
  counts: TodoCounts,
}).annotate({ identifier: "LifecycleTodo.TodoUpdatedEvent" })
export type TodoUpdatedEvent = Schema.Schema.Type<typeof TodoUpdatedEvent>

// todo.completed — the Session's Todo set reached a completed outcome.
export const TodoCompletedEvent = Schema.Struct({
  type: Schema.Literal("todo.completed"),
  pointer: TodoPointer,
  counts: TodoCounts,
}).annotate({ identifier: "LifecycleTodo.TodoCompletedEvent" })
export type TodoCompletedEvent = Schema.Schema.Type<typeof TodoCompletedEvent>

// todo.failed — the Session's Todo set reached a failed outcome.
export const TodoFailedEvent = Schema.Struct({
  type: Schema.Literal("todo.failed"),
  pointer: TodoPointer,
  counts: TodoCounts,
}).annotate({ identifier: "LifecycleTodo.TodoFailedEvent" })
export type TodoFailedEvent = Schema.Schema.Type<typeof TodoFailedEvent>

// todo.cancelled — the Session's Todo set was cancelled.
export const TodoCancelledEvent = Schema.Struct({
  type: Schema.Literal("todo.cancelled"),
  pointer: TodoPointer,
  counts: TodoCounts,
}).annotate({ identifier: "LifecycleTodo.TodoCancelledEvent" })
export type TodoCancelledEvent = Schema.Schema.Type<typeof TodoCancelledEvent>

// todo.stale — a Todo revision was detected stale and needs rehydration (C24).
export const TodoStaleEvent = Schema.Struct({
  type: Schema.Literal("todo.stale"),
  pointer: TodoPointer,
  counts: TodoCounts,
}).annotate({ identifier: "LifecycleTodo.TodoStaleEvent" })
export type TodoStaleEvent = Schema.Schema.Type<typeof TodoStaleEvent>

// todo.rehydrated — a Todo was restored after a restart/reconnect (C24).
export const TodoRehydratedEvent = Schema.Struct({
  type: Schema.Literal("todo.rehydrated"),
  pointer: TodoPointer,
  counts: TodoCounts,
}).annotate({ identifier: "LifecycleTodo.TodoRehydratedEvent" })
export type TodoRehydratedEvent = Schema.Schema.Type<typeof TodoRehydratedEvent>

// todo.handoff_attached — a Todo was attached across a single-owner handoff (C25).
export const TodoHandoffAttachedEvent = Schema.Struct({
  type: Schema.Literal("todo.handoff_attached"),
  pointer: TodoPointer,
  counts: TodoCounts,
}).annotate({ identifier: "LifecycleTodo.TodoHandoffAttachedEvent" })
export type TodoHandoffAttachedEvent = Schema.Schema.Type<typeof TodoHandoffAttachedEvent>

// TodoEvent is the closed tagged union of the seven session-owned Todo events.
export const TodoEvent = Schema.Union([
  TodoUpdatedEvent,
  TodoCompletedEvent,
  TodoFailedEvent,
  TodoCancelledEvent,
  TodoStaleEvent,
  TodoRehydratedEvent,
  TodoHandoffAttachedEvent,
])
  .annotate({ identifier: "LifecycleTodo.TodoEvent" })
  .pipe(Schema.toTaggedUnion("type"))
export type TodoEvent = Schema.Schema.Type<typeof TodoEvent>
