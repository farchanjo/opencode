/**
 * T024 real EventV2/SQLite proof. This intentionally does not use the memory
 * EventPort: the database file is reopened to prove bounded history and prune
 * behavior across a restart.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { Session } from "@opencode-ai/schema/session"
import { createLiveEventV2AuditPort } from "@/operator/adapters/outbound/event-v2-live"
import { operatorAuditAggregateID, stableAuditEventId, type AuditRecord } from "@opencode-ai/core/operator"

const dayMs = 86_400_000

function record(createdAtMs: number, afterVersion: string): AuditRecord {
  return {
    source: "cli",
    actorRef: "operator:test",
    scope: { kind: "project", ref: "p1" },
    commandId: "langlock.set",
    beforeVersion: null,
    afterVersion,
    outcome: "success",
    createdAtMs,
  }
}

async function withEvents<A>(databasePath: string, use: (events: EventV2.Interface) => Effect.Effect<A>) {
  const layer = AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), [
    [Database.node, Database.layerFromPath(databasePath)],
  ])
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* EventV2.Service
        return yield* use(events)
      }).pipe(Effect.provide(layer)),
    ),
  )
}

describe("T024 real SQLite EventV2 audit retention", () => {
  test("bounded list, restart, bounded prune, and isolation", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-t024-sqlite-"))
    const databasePath = path.join(directory, "events.sqlite")
    const now = 2_000_000_000_000
    const aggregate = operatorAuditAggregateID("p1")

    try {
      await withEvents(databasePath, (events) =>
        Effect.gen(function* () {
          const port = createLiveEventV2AuditPort({
            events: events as never,
            run: Effect.runPromise,
            projectKey: "p1",
          })
          const old = record(now - 91 * dayMs, "old")
          expect((yield* Effect.promise(() => port.appendAudit(old, { projectKey: "p1" }))).ok).toBe(true)
          expect((yield* Effect.promise(() => port.appendAudit(old, { projectKey: "p1" }))).ok).toBe(true)
          expect(
            (yield* Effect.promise(() =>
              port.appendAudit({ ...old, afterVersion: "different" }, { eventId: stableAuditEventId(old), projectKey: "p1" }),
            ))).toEqual(expect.objectContaining({ ok: false }))
          expect((yield* Effect.promise(() => port.appendAudit(record(now - 89 * dayMs, "keep"), { projectKey: "p1" }))).ok).toBe(true)

          yield* events.publish(SessionV1.Event.MessageRemoved, {
            sessionID: Session.ID.make("ses_other_project"),
            messageID: SessionV1.MessageID.ascending("msg_other_type"),
          })

          const bounded = yield* Effect.promise(() => port.listAuditsResult?.({ limit: 1 }) ?? Promise.reject(new Error("missing result")))
          expect(bounded.ok).toBe(true)
          if (bounded.ok) expect(bounded.audits).toHaveLength(1)

        }),
      )

      await withEvents(databasePath, (events) =>
        Effect.gen(function* () {
          const p2 = {
            ...record(now - 91 * dayMs, "other-project"),
            scope: { kind: "project" as const, ref: "p2" },
          }
          const port = createLiveEventV2AuditPort({ events: events as never, run: Effect.runPromise, projectKey: "p2" })
          expect((yield* Effect.promise(() => port.appendAudit(p2, { projectKey: "p2" }))).ok).toBe(true)
        }),
      )

      await withEvents(databasePath, (events) =>
        Effect.gen(function* () {
          const port = createLiveEventV2AuditPort({ events: events as never, run: Effect.runPromise, projectKey: "p1" })
          expect(yield* Effect.promise(() => port.pruneAudits(now - 90 * dayMs))).toBe(1)
        }),
      )

      await withEvents(databasePath, (events) =>
        Effect.gen(function* () {
          const p1 = createLiveEventV2AuditPort({ events: events as never, run: Effect.runPromise, projectKey: "p1" })
          const p2 = createLiveEventV2AuditPort({ events: events as never, run: Effect.runPromise, projectKey: "p2" })
          const p1Audits = yield* Effect.promise(() => p1.listAudits({ limit: 10 }))
          const p2Audits = yield* Effect.promise(() => p2.listAudits({ limit: 10 }))
          expect(p1Audits.map((audit) => audit.afterVersion)).toEqual(["keep"])
          expect(p2Audits.map((audit) => audit.afterVersion)).toEqual(["other-project"])

          const page = yield* events.readDurablePage({ aggregateID: aggregate, limit: 20 })
          const otherPage = yield* events.readDurablePage({ aggregateID: "ses_other_project", limit: 20 })
          expect(page.events.some((event) => event.type === "operator.audit")).toBe(true)
          expect(otherPage.events.some((event) => event.type === "message.removed")).toBe(true)
        }),
      )
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
