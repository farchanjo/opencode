/**
 * Feature 001 / T030 — the session-owned Todo aggregate wired onto the
 * legacy persisted `Todo.Service` (packages/opencode/src/session/todo.ts):
 * durable snapshot rehydration, the non-empty dispatch gate, the read-only
 * dispatch-envelope projection, and the parent-cannot-edit-child ownership
 * invariant. Exercises the real Effect layer (Database + EventV2Bridge +
 * Session), not a fixture double, per the operator sandbox test style.
 */
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session as SessionNs } from "@/session/session"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Todo, TodoDispatchBlockedError, TodoOwnershipError } from "@/session/todo"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
      Todo.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

const newSession = Effect.fn("SessionTodoTest.newSession")(function* () {
  const session = yield* SessionNs.Service
  return yield* session.create({})
})

describe("T030 session-owned Todo aggregate — snapshot + dispatch gate", () => {
  it.instance("an unwritten session snapshots to an empty aggregate with a stable, deterministic ref", () =>
    Effect.gen(function* () {
      const info = yield* newSession()
      const todo = yield* Todo.Service

      const first = yield* todo.snapshot(info.id)
      expect(first.items).toHaveLength(0)
      expect(first.sessionId).toBe(info.id)
      expect(first.ref).toBe(`todo_${info.id}`)

      const second = yield* todo.snapshot(info.id)
      expect(second.ref).toBe(first.ref)
      expect(second.version).toBe(first.version)
    }),
  )

  it.instance("dispatchSummary blocks on an empty snapshot (non-empty gate before dispatch)", () =>
    Effect.gen(function* () {
      const info = yield* newSession()
      const todo = yield* Todo.Service

      const exit = yield* todo.dispatchSummary(info.id).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause)
        expect(failure).toBeInstanceOf(TodoDispatchBlockedError)
        if (failure instanceof TodoDispatchBlockedError) {
          expect(failure.sessionID).toBe(info.id)
          expect(failure.reason).toContain("empty")
        }
      }
    }),
  )

  it.instance("snapshot reflects persisted items and dispatchSummary is a bounded, read-only projection", () =>
    Effect.gen(function* () {
      const info = yield* newSession()
      const todo = yield* Todo.Service

      yield* todo.update({
        sessionID: info.id,
        todos: [
          { content: "write the plan", status: "pending", priority: "high" },
          { content: "implement it", status: "in_progress", priority: "medium" },
        ],
      })

      const aggregate = yield* todo.snapshot(info.id)
      expect(aggregate.items).toHaveLength(2)
      expect(aggregate.items[0].content).toBe("write the plan")
      expect(aggregate.items[0].status).toBe("pending")
      expect(aggregate.items[0].priority).toBe("high")
      // KNOWN GAP (session/todo.ts): the legacy schema has no `required` flag
      // yet, so every session-owned item is conservatively required.
      expect(aggregate.items.every((item) => item.required)).toBe(true)

      const summary = yield* todo.dispatchSummary(info.id)
      expect(summary.ref).toBe(aggregate.ref)
      expect(summary.version).toBe(aggregate.version)
      expect(summary.itemCount).toBe(2)
      expect(summary.statusCounts.pending).toBe(1)
      expect(summary.statusCounts.in_progress).toBe(1)
      expect(summary.statusCounts.completed).toBe(0)
      // The projection never carries item content — only counts.
      expect(summary as unknown as { items?: unknown }).not.toHaveProperty("items")
    }),
  )

  it.instance("version is a durable content hash: stable across reads, changes when content changes", () =>
    Effect.gen(function* () {
      const info = yield* newSession()
      const todo = yield* Todo.Service

      yield* todo.update({
        sessionID: info.id,
        todos: [{ content: "step one", status: "pending", priority: "medium" }],
      })
      const before = yield* todo.snapshot(info.id)
      const beforeAgain = yield* todo.snapshot(info.id)
      expect(beforeAgain.version).toBe(before.version)

      yield* todo.update({
        sessionID: info.id,
        todos: [{ content: "step one", status: "completed", priority: "medium" }],
      })
      const after = yield* todo.snapshot(info.id)
      expect(after.version).not.toBe(before.version)
    }),
  )

  it.instance("unknown status/priority values fall back to conservative defaults", () =>
    Effect.gen(function* () {
      const info = yield* newSession()
      const todo = yield* Todo.Service

      yield* todo.update({
        sessionID: info.id,
        todos: [{ content: "weird row", status: "not_a_real_status", priority: "urgent" }],
      })
      const aggregate = yield* todo.snapshot(info.id)
      expect(aggregate.items[0].status).toBe("pending")
      expect(aggregate.items[0].priority).toBe("medium")
    }),
  )
})

describe("T030 parent-cannot-edit-child ownership invariant", () => {
  it.instance("assertOwnership passes when the acting session owns the Todo", () =>
    Effect.gen(function* () {
      const info = yield* newSession()
      const todo = yield* Todo.Service
      yield* todo.assertOwnership({ sessionID: info.id, actingSessionID: info.id })
    }),
  )

  it.instance("assertOwnership blocks a different acting session (a parent may never edit a child's Todo)", () =>
    Effect.gen(function* () {
      const child = yield* newSession()
      const parent = yield* newSession()
      const todo = yield* Todo.Service

      const exit = yield* todo.assertOwnership({ sessionID: child.id, actingSessionID: parent.id }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause)
        expect(failure).toBeInstanceOf(TodoOwnershipError)
        if (failure instanceof TodoOwnershipError) {
          expect(failure.sessionID).toBe(child.id)
          expect(failure.actingSessionID).toBe(parent.id)
        }
      }
    }),
  )
})
