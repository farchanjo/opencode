import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { TodoTable } from "@opencode-ai/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionTodo } from "@opencode-ai/schema/session-todo"
import type { Ids } from "@opencode-ai/schema/routing/ids"
import { TodoAuthority } from "@/routing/domain/todo-authority"
import { createHash } from "node:crypto"

export const Info = SessionTodo.Info
export type Info = SessionTodo.Info

export const Event = SessionTodo.Event

/**
 * Feature 001 / T030 — raised by `assertOwnership` when a caller (typically a
 * parent Session in the hierarchy dispatcher) attempts to act on a Todo
 * aggregate it does not own. Mirrors `TodoAuthority.assertOwner`
 * (hierarchy-flow.md threat "Parent editing child Todo").
 */
export class TodoOwnershipError extends Schema.TaggedErrorClass<TodoOwnershipError>()("Todo.OwnershipError", {
  sessionID: SessionID,
  actingSessionID: SessionID,
  reason: Schema.String,
}) {}

/**
 * Feature 001 / T030 — raised by `dispatchSummary` when the session-owned
 * Todo snapshot is empty (`TodoAuthority.dispatchGate`): at least one bounded
 * item is required before a goal-bearing Session dispatches.
 */
export class TodoDispatchBlockedError extends Schema.TaggedErrorClass<TodoDispatchBlockedError>()(
  "Todo.DispatchBlocked",
  {
    sessionID: SessionID,
    reason: Schema.String,
  },
) {}

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>

  /**
   * Feature 001 / T030 — the durable session-owned `TodoAuthority.TodoAggregate`
   * for a Session, rehydrated from the persisted rows (exactly one aggregate
   * per Session; hierarchy-flow.md "Todo Lifecycle (per Session)"). `ref` is
   * deterministic from `sessionID`; `version` is a deterministic content hash
   * of the current items, so it changes iff the persisted content changes
   * (CAS semantics for `TodoAuthority.completionGate`/`applyCas`) without
   * requiring a schema/table change to the legacy `todo` table.
   */
  readonly snapshot: (sessionID: SessionID) => Effect.Effect<TodoAuthority.TodoAggregate>

  /**
   * Feature 001 / T030 — bounded, read-only projection for dispatch envelopes:
   * `TodoRef` + `TodoVersion` + item/status counts only, NEVER the full Todo
   * content (`TodoAuthority.summarize`). Enforces the non-empty snapshot gate
   * before dispatch (`TodoAuthority.dispatchGate`) first.
   */
  readonly dispatchSummary: (sessionID: SessionID) => Effect.Effect<TodoAuthority.TodoSummary, TodoDispatchBlockedError>

  /**
   * Feature 001 / T030 — parent-cannot-edit-child invariant
   * (`TodoAuthority.assertOwner`): only the owning Session may mutate its own
   * Todo aggregate. The hierarchy dispatcher MUST call this before any
   * cross-session Todo interaction and MUST NOT bypass it.
   */
  readonly assertOwnership: (input: {
    readonly sessionID: SessionID
    readonly actingSessionID: SessionID
  }) => Effect.Effect<void, TodoOwnershipError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionTodo") {}

// =============================================================================
// Feature 001 / T030 — TodoAuthority aggregate helpers (pure, no I/O)
// =============================================================================

function todoRef(sessionID: SessionID): Ids.TodoRef {
  return `todo_${sessionID}`
}

function todoStatus(raw: string): TodoAuthority.TodoStatus {
  return (TodoAuthority.TODO_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as TodoAuthority.TodoStatus)
    : "pending"
}

function todoPriority(raw: string): TodoAuthority.TodoPriority {
  return (TodoAuthority.TODO_PRIORITIES as ReadonlyArray<string>).includes(raw)
    ? (raw as TodoAuthority.TodoPriority)
    : "medium"
}

// Deterministic content-hash version: identical content -> identical version,
// any persisted change -> a new version. Substitutes for a CAS version column
// the legacy `todo` table does not have (out of Feature 001 scope to add).
function todoVersion(items: ReadonlyArray<TodoAuthority.TodoItem>): Ids.TodoVersion {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 16)
}

// KNOWN GAP (report to spec corpus): the legacy `SessionTodo.Info` schema
// (packages/schema/src/session-todo.ts, out of Feature 001 scope) has no
// `required` field yet. Every session-owned item is conservatively treated as
// required (gates `TodoAuthority.completionGate`) until that schema gains an
// explicit optional-item flag.
function toAggregate(sessionID: SessionID, infos: ReadonlyArray<Info>): TodoAuthority.TodoAggregate {
  const items: TodoAuthority.TodoItem[] = infos.map((info, index) => ({
    id: `${sessionID}:${index}`,
    content: info.content,
    status: todoStatus(info.status),
    priority: todoPriority(info.priority),
    required: true,
  }))
  return TodoAuthority.initializeTodo({
    sessionId: sessionID,
    ref: todoRef(sessionID),
    version: todoVersion(items),
    items,
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) {
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (input.todos.length === 0) return
            yield* tx
              .insert(TodoTable)
              .values(
                input.todos.map((todo, position) => ({
                  session_id: input.sessionID,
                  content: todo.content,
                  status: todo.status,
                  priority: todo.priority,
                  position,
                })),
              )
              .run()
          }),
        )
        .pipe(Effect.orDie)
      yield* events.publish(Event.Updated, input)
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      const rows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({
        content: row.content,
        status: row.status,
        priority: row.priority,
      }))
    })

    const snapshot = Effect.fn("Todo.snapshot")(function* (sessionID: SessionID) {
      const infos = yield* get(sessionID)
      return toAggregate(sessionID, infos)
    })

    const dispatchSummary = Effect.fn("Todo.dispatchSummary")(function* (sessionID: SessionID) {
      const aggregate = yield* snapshot(sessionID)
      const gate = TodoAuthority.dispatchGate(aggregate)
      if (gate.outcome === "blocked") {
        return yield* Effect.fail(
          new TodoDispatchBlockedError({ sessionID, reason: gate.reason ?? "todo snapshot is empty" }),
        )
      }
      return TodoAuthority.summarize(aggregate)
    })

    const assertOwnership = Effect.fn("Todo.assertOwnership")(function* (input: {
      sessionID: SessionID
      actingSessionID: SessionID
    }) {
      const probe: TodoAuthority.TodoAggregate = {
        sessionId: input.sessionID,
        ref: todoRef(input.sessionID),
        version: todoVersion([]),
        items: [],
      }
      const result = TodoAuthority.assertOwner(probe, input.actingSessionID)
      if (result.outcome === "blocked") {
        return yield* Effect.fail(
          new TodoOwnershipError({
            sessionID: input.sessionID,
            actingSessionID: input.actingSessionID,
            reason: result.reason ?? "only the owning session may mutate its Todo aggregate",
          }),
        )
      }
    })

    return Service.of({ update, get, snapshot, dispatchSummary, assertOwnership })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Database.node] })

export * as Todo from "./todo"
