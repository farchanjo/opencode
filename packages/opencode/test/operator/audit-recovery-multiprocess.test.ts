/**
 * T024 multi-process recovery proofs (sandbox only):
 * 1) Atomic Config authority+pending audit commit, forced post-commit process exit,
 *    second process restarts and reconciles to real EventV2 SQLite — pending acked once.
 * 2) Concurrent maintenance Flock: one owner; losers skip without double work.
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
import { operatorAuditAggregateID } from "@opencode-ai/core/operator"
import {
  createDurableOperatorStore,
  createFileConfigService,
} from "@/operator/adapters/outbound/config-service"
import { createLiveEventV2AuditPort } from "@/operator/adapters/outbound/event-v2-live"
import {
  createFlockLockPort,
  reconcileOperatorAuditOutbox,
  startOperatorAuditMaintenance,
} from "@/operator/application"

const packageRoot = path.resolve(import.meta.dir, "../..")
const configServicePath = path.resolve(
  import.meta.dir,
  "../../src/operator/adapters/outbound/config-service.ts",
)
const lockPortPath = path.resolve(import.meta.dir, "../../src/operator/application/ports/lock-port.ts")
const eventLivePath = path.resolve(import.meta.dir, "../../src/operator/adapters/outbound/event-v2-live.ts")
const reconcilePath = path.resolve(import.meta.dir, "../../src/operator/application/audit-reconcile.ts")

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

async function readStdout(proc: ReturnType<typeof Bun.spawn>) {
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

describe("T024 multi-process Flock recovery + maintenance", () => {
  test(
    "post-commit crash leaves intent; restart reconciles once to real EventV2 SQLite",
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-t024-recover-"))
      const lockDir = path.join(directory, "locks")
      const configFile = path.join(directory, "config.json")
      const databasePath = path.join(directory, "events.sqlite")
      await fs.mkdir(lockDir, { recursive: true })
      await Bun.write(configFile, "{}")

      try {
        const crashWorker = `
          import { createFileConfigService, createDurableOperatorStore } from ${JSON.stringify(configServicePath)};
          import { createFlockLockPort } from ${JSON.stringify(lockPortPath)};
          const configFile = process.env.CFG;
          const lockDir = process.env.LOCK;
          // Short staleMs: process.exit while holding the document lock must be reclaimable.
          const lock = await createFlockLockPort({ dir: lockDir, staleMs: 400 });
          const store = createDurableOperatorStore({
            config: createFileConfigService(configFile),
            lock,
            projectKey: "p1",
            afterWrite: () => {
              // Simulate process death after Config commit (authority + pending intent durable).
              process.exit(42);
            },
          });
          await store.config.compareAndSet({
            authority: "langlock",
            expectedVersion: null,
            payload: { enabled: true },
            nowMs: 1_700_000_000_000,
            auditIntent: {
              record: {
                source: "cli",
                actorRef: "operator:crash",
                scope: { kind: "project", ref: "p1" },
                commandId: "langlock.set",
                beforeVersion: null,
                outcome: "success",
                createdAtMs: 1_700_000_000_000,
              },
              projectKey: "p1",
            },
          });
          process.exit(1);
        `

        const crashed = Bun.spawn(["bun", "-e", crashWorker], {
          cwd: packageRoot,
          env: { ...process.env, CFG: configFile, LOCK: lockDir },
          stdout: "pipe",
          stderr: "pipe",
        })
        const crashResult = await readStdout(crashed)
        expect(crashResult.code).toBe(42)
        // Wait past crash-holder Flock stale window so the document lock can be reclaimed.
        await Bun.sleep(500)

        // Authority + pending intent must both be durable after crash.
        const lock = await createFlockLockPort({ dir: lockDir, staleMs: 400 })
        const store = createDurableOperatorStore({
          config: createFileConfigService(configFile),
          lock,
          projectKey: "p1",
        })
        expect((await store.config.get("langlock"))?.payload).toEqual({ enabled: true })
        const pending = await store.outbox.listPending()
        expect(pending.length).toBe(1)
        const eventId = pending[0]!.id

        // Second process: restart + reconcile to real EventV2 SQLite (parent must not hold DB).
        const reconcileWorker = `
          import { Effect } from "effect";
          import { EventV2 } from "@opencode-ai/core/event";
          import { Database } from "@opencode-ai/core/database/database";
          import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder";
          import { LayerNode } from "@opencode-ai/core/effect/layer-node";
          import { createFileConfigService, createDurableOperatorStore } from ${JSON.stringify(configServicePath)};
          import { createFlockLockPort } from ${JSON.stringify(lockPortPath)};
          import { createLiveEventV2AuditPort } from ${JSON.stringify(eventLivePath)};
          import { reconcileOperatorAuditOutbox } from ${JSON.stringify(reconcilePath)};
          const configFile = process.env.CFG;
          const lockDir = process.env.LOCK;
          const databasePath = process.env.DB;
          const layer = AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), [
            [Database.node, Database.layerFromPath(databasePath)],
          ]);
          const result = await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const eventsSvc = yield* EventV2.Service;
                const events = createLiveEventV2AuditPort({
                  events: eventsSvc,
                  run: Effect.runPromise,
                  projectKey: "p1",
                });
                const lock = yield* Effect.promise(() =>
                  createFlockLockPort({ dir: lockDir, staleMs: 400 }),
                );
                const store = createDurableOperatorStore({
                  config: createFileConfigService(configFile),
                  lock,
                  projectKey: "p1",
                });
                const first = yield* Effect.promise(() =>
                  reconcileOperatorAuditOutbox({ outbox: store.outbox, events, ownerId: "restart" }),
                );
                const second = yield* Effect.promise(() =>
                  reconcileOperatorAuditOutbox({ outbox: store.outbox, events, ownerId: "restart" }),
                );
                const pending = yield* Effect.promise(() => store.outbox.listPending());
                return { first, second, pending: pending.length };
              }).pipe(Effect.provide(layer)),
            ),
          );
          process.stdout.write(JSON.stringify(result));
        `
        const restarted = Bun.spawn(["bun", "-e", reconcileWorker], {
          cwd: packageRoot,
          env: {
            ...process.env,
            CFG: configFile,
            LOCK: lockDir,
            DB: databasePath,
          },
          stdout: "pipe",
          stderr: "pipe",
        })
        const restartResult = await readStdout(restarted)
        expect(restartResult.code, restartResult.stderr).toBe(0)
        const body = JSON.parse(restartResult.stdout) as {
          first: { delivered: number; attempted: number }
          second: { delivered: number; attempted: number }
          pending: number
        }
        expect(body.first.delivered).toBe(1)
        expect(body.second.delivered).toBe(0)
        expect(body.second.attempted).toBe(0)
        expect(body.pending).toBe(0)

        // Parent re-reads file config after child exit — pending acked.
        const storeAfter = createDurableOperatorStore({
          config: createFileConfigService(configFile),
          lock,
          projectKey: "p1",
        })
        expect((await storeAfter.outbox.listPending()).length).toBe(0)

        // Third process reopens SQLite and proves single durable audit event.
        const reopenWorker = `
          import { Effect } from "effect";
          import { EventV2 } from "@opencode-ai/core/event";
          import { Database } from "@opencode-ai/core/database/database";
          import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder";
          import { LayerNode } from "@opencode-ai/core/effect/layer-node";
          import { operatorAuditAggregateID } from "@opencode-ai/core/operator";
          const databasePath = process.env.DB;
          const eventId = process.env.EVENT_ID;
          const layer = AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), [
            [Database.node, Database.layerFromPath(databasePath)],
          ]);
          const result = await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const events = yield* EventV2.Service;
                const page = yield* events.readDurablePage({
                  aggregateID: operatorAuditAggregateID("p1"),
                  limit: 20,
                });
                return { count: page.events.filter((e) => e.id === eventId).length };
              }).pipe(Effect.provide(layer)),
            ),
          );
          process.stdout.write(JSON.stringify(result));
        `
        const reopened = Bun.spawn(["bun", "-e", reopenWorker], {
          cwd: packageRoot,
          env: { ...process.env, DB: databasePath, EVENT_ID: eventId },
          stdout: "pipe",
          stderr: "pipe",
        })
        const reopenResult = await readStdout(reopened)
        expect(reopenResult.code, reopenResult.stderr).toBe(0)
        expect(JSON.parse(reopenResult.stdout).count).toBe(1)
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
    30_000,
  )

  test(
    "concurrent maintenance Flock: one owner, contenders skip; later single owner delivers once",
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-t024-maint-"))
      const lockDir = path.join(directory, "locks")
      const configFile = path.join(directory, "config.json")
      const databasePath = path.join(directory, "events.sqlite")
      await fs.mkdir(lockDir, { recursive: true })
      await Bun.write(configFile, "{}")

      try {
        const lock = await createFlockLockPort({ dir: lockDir, staleMs: 400 })
        const store = createDurableOperatorStore({
          config: createFileConfigService(configFile),
          lock,
          projectKey: "p1",
        })
        const cas = await store.config.compareAndSet({
          authority: "langlock",
          expectedVersion: null,
          payload: { concurrent: true },
          nowMs: 1_700_000_100_000,
          auditIntent: {
            record: {
              source: "cli",
              actorRef: "operator:concurrent",
              scope: { kind: "project", ref: "p1" },
              commandId: "langlock.set",
              beforeVersion: null,
              outcome: "success",
              createdAtMs: 1_700_000_100_000,
            },
            projectKey: "p1",
          },
        })
        expect(cas.ok).toBe(true)
        expect((await store.outbox.listPending()).length).toBe(1)

        // Contenders only touch Flock (no shared SQLite open) to prove single-run skip.
        const contenderWorker = `
          import { createFlockLockPort } from ${JSON.stringify(lockPortPath)};
          import { startOperatorAuditMaintenance } from ${JSON.stringify(reconcilePath)};
          const lock = await createFlockLockPort({
            dir: process.env.LOCK,
            tryTimeoutMs: 80,
            staleMs: 400,
          });
          let prunes = 0;
          const events = {
            appendAudit: async () => ({ ok: true, auditId: "should-not-run" }),
            listAudits: async () => [],
            pruneAudits: async () => {
              prunes += 1;
              return 0;
            },
          };
          const handle = startOperatorAuditMaintenance({
            events,
            lock,
            projectKey: "p1",
            intervalMs: 60_000,
            pruneIntervalMs: 1,
            runOnStart: false,
            ownerId: process.env.OWNER,
          });
          // Wait for holder to acquire.
          await Bun.sleep(80);
          const once = await handle.runOnce();
          handle.dispose();
          process.stdout.write(JSON.stringify({ once, prunes, owner: process.env.OWNER }));
        `

        const holdWorker = `
          import { createFlockLockPort } from ${JSON.stringify(lockPortPath)};
          const lock = await createFlockLockPort({ dir: process.env.LOCK, staleMs: 400 });
          await lock.withLock("audit-maintenance:p1", async () => {
            process.stdout.write(JSON.stringify({ held: true }));
            await Bun.sleep(600);
          });
        `

        const holder = Bun.spawn(["bun", "-e", holdWorker], {
          cwd: packageRoot,
          env: { ...process.env, LOCK: lockDir },
          stdout: "pipe",
          stderr: "pipe",
        })
        await Bun.sleep(80)

        const a = Bun.spawn(["bun", "-e", contenderWorker], {
          cwd: packageRoot,
          env: { ...process.env, LOCK: lockDir, OWNER: "A" },
          stdout: "pipe",
          stderr: "pipe",
        })
        const b = Bun.spawn(["bun", "-e", contenderWorker], {
          cwd: packageRoot,
          env: { ...process.env, LOCK: lockDir, OWNER: "B" },
          stdout: "pipe",
          stderr: "pipe",
        })

        const [holdOut, aOut, bOut] = await Promise.all([readStdout(holder), readStdout(a), readStdout(b)])
        expect(holdOut.code, holdOut.stderr).toBe(0)
        expect(aOut.code, aOut.stderr).toBe(0)
        expect(bOut.code, bOut.stderr).toBe(0)

        const ra = JSON.parse(aOut.stdout) as {
          once: { skipped: boolean; reason?: string }
          prunes: number
        }
        const rb = JSON.parse(bOut.stdout) as {
          once: { skipped: boolean; reason?: string }
          prunes: number
        }
        expect(ra.once.skipped).toBe(true)
        expect(rb.once.skipped).toBe(true)
        expect(ra.once.reason).toBe("lock_held")
        expect(rb.once.reason).toBe("lock_held")
        expect(ra.prunes).toBe(0)
        expect(rb.prunes).toBe(0)

        // After contenders skip, single owner under Flock delivers the durable pending intent once.
        expect((await store.outbox.listPending()).length).toBe(1)
        await withEvents(databasePath, (events) =>
          Effect.gen(function* () {
            const port = createLiveEventV2AuditPort({
              events: events as never,
              run: Effect.runPromise,
              projectKey: "p1",
            })
            // Clock near the audit createdAtMs so daily prune does not delete the fresh event.
            const nowMs = () => 1_700_000_100_000 + 60_000
            const handle = startOperatorAuditMaintenance({
              outbox: store.outbox,
              events: port,
              lock,
              projectKey: "p1",
              intervalMs: 60_000,
              pruneIntervalMs: 86_400_000,
              runOnStart: false,
              ownerId: "parent-maint",
              nowMs,
            })
            const first = yield* Effect.promise(() => handle.runOnce())
            const second = yield* Effect.promise(() => handle.runOnce())
            handle.dispose()
            expect(first.skipped).toBe(false)
            expect(first.reconcile?.delivered).toBe(1)
            expect(second.reconcile?.delivered ?? 0).toBe(0)
            expect((yield* Effect.promise(() => store.outbox.listPending())).length).toBe(0)

            const page = yield* events.readDurablePage({
              aggregateID: operatorAuditAggregateID("p1"),
              limit: 20,
            })
            expect(page.events.map((event) => event.type)).toContain("operator.audit")
            expect(page.events).toHaveLength(1)
          }),
        )
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
