/**
 * Feature 018 / G5 (T013, T017) — the second-press forced abort actually
 * interrupts (FR9, FR10).
 *
 * Exercises the operator cancel path end to end through the REAL `Cancel` service
 * wired over the SAME registry-backed `rootInterruptor` the lifecycle stack-wiring
 * builds (`stack-wiring.ts`). Against an in-process registered live run the second
 * Ctrl+C drives the live `SessionRunCoordinator.interrupt` through the narrow
 * registry and the run's fiber is really aborted (disposition `interrupted`);
 * against a run this process does not own it degrades to the honest `unconfirmed`
 * outcome unchanged. The FIRST-press cancel (cancel_requested intents + admission
 * fence) is asserted byte-for-byte unchanged: it emits, fences, and never touches
 * the interrupt edge.
 */
import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionInterruptRegistry } from "@opencode-ai/core/session/interrupt-registry"
import { createCancelService, type CancelTarget, type LifecycleEmitter, type RootInterruptor } from "@/lifecycle/cancel"
import type { LifecycleEmitInput, LifecycleEmitOutput } from "@opencode-ai/protocol/lifecycle/commands"
import { emitEnvelope } from "../lifecycle/fixtures"

/**
 * The EXACT rootInterruptor stack-wiring builds: consult the process-singleton
 * registry by root key and drive the registered coordinator interrupt; an absent
 * entry degrades to `unconfirmed`. The disposition is captured for the assertions.
 */
function registryInterruptor(seen: Array<string>): RootInterruptor {
  return {
    interrupt: (key) =>
      SessionInterruptRegistry.interrupt(key).pipe(
        Effect.tap((outcome) => Effect.sync(() => void seen.push(outcome.disposition))),
        Effect.asVoid,
      ),
  }
}

function harness() {
  const emitted: LifecycleEmitInput[] = []
  const fenced: string[] = []
  const dispositions: string[] = []
  const emitter: LifecycleEmitter = {
    emit: (input) => {
      emitted.push(input)
      return Effect.succeed({ eventId: "evt_c", durable: null } as unknown as LifecycleEmitOutput)
    },
  }
  const fence = (root: string) => void fenced.push(root)
  return { emitter, fence, emitted, fenced, dispositions, coordinator: registryInterruptor(dispositions) }
}

const targets = (): ReadonlyArray<CancelTarget> => [
  { envelope: emitEnvelope({ eventType: "lifecycle.cancel_requested", processId: "proc_1" }), visible: true },
  { envelope: emitEnvelope({ eventType: "lifecycle.cancel_requested", processId: "proc_2" }), visible: false },
]

describe("Feature 018 T013 — second-press forced abort over the narrow interrupt registry (FR9, FR10)", () => {
  test("a second Ctrl+C against an in-process registered live run really interrupts its fiber", async () => {
    SessionInterruptRegistry.reset()
    const h = harness()
    let now = 1000
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence, clock: () => now, escalationWindowMs: 3000 })
    const input = { rootProcessId: "proc_root" as never, rootKey: "ses_root_live", principal: { kind: "operator" as const, id: "op" }, reason: null, targets: targets() }

    // Register a live root run into the registry EXACTLY as execution/local.ts does.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const interrupted = yield* Deferred.make<void>()
          let coordinator: SessionRunCoordinator.Coordinator<string, never>
          coordinator = yield* SessionRunCoordinator.make<string, never>({
            drain: (key) =>
              SessionInterruptRegistry.withRegisteredRun(
                key,
                () => coordinator.interrupt(key),
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                ),
              ),
          })
          const run = yield* coordinator.run("ses_root_live").pipe(Effect.forkChild)
          yield* Deferred.await(started)
          expect(SessionInterruptRegistry.has("ses_root_live")).toBe(true)

          // First press: request cancel; second press within the window: forced abort.
          yield* service.requestRootCancel(input)
          now = 2000
          const out = yield* service.requestRootCancel(input)

          // Operator-facing outcome stays unconfirmed (no remote kill promised)…
          expect(out.outcome).toBe("unconfirmed")
          expect(out.escalated).toBe(true)
          // …but the narrow edge reported a real interrupt, and the fiber aborted.
          expect(h.dispositions).toEqual(["interrupted"])
          yield* Deferred.await(interrupted)
          const exit = yield* Fiber.await(run)
          expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
          // Terminal deregistered the entry (no leak).
          expect(SessionInterruptRegistry.has("ses_root_live")).toBe(false)
        }),
      ),
    )
  })

  test("a second Ctrl+C with no live run in this process degrades to unconfirmed, unchanged", async () => {
    SessionInterruptRegistry.reset()
    const h = harness()
    let now = 1000
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence, clock: () => now, escalationWindowMs: 3000 })
    const input = { rootProcessId: "proc_root" as never, rootKey: "ses_absent", principal: { kind: "operator" as const, id: "op" }, reason: null, targets: targets() }

    await Effect.runPromise(service.requestRootCancel(input))
    now = 2000
    const out = await Effect.runPromise(service.requestRootCancel(input))

    expect(out.outcome).toBe("unconfirmed")
    expect(out.escalated).toBe(true)
    // The narrow edge honestly reported no live run — never a fabricated stop.
    expect(h.dispositions).toEqual(["unconfirmed"])
  })
})

describe("Feature 018 T013 — first-press cancel is UNCHANGED (FR9)", () => {
  test("first Ctrl+C fences the root and emits one cancel_requested per target, touching no interrupt edge", async () => {
    SessionInterruptRegistry.reset()
    const h = harness()
    let now = 1000
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence, clock: () => now, escalationWindowMs: 3000 })

    const out = await Effect.runPromise(
      service.requestRootCancel({ rootProcessId: "proc_root" as never, rootKey: "ses_root", principal: { kind: "operator", id: "op" }, reason: null, targets: targets() }),
    )

    expect(out.outcome).toBe("requested")
    expect(out.requestedCount).toBe(2)
    expect(h.fenced).toEqual(["proc_root"])
    expect(h.emitted).toHaveLength(2)
    expect(h.emitted.every((e) => e.eventType === "lifecycle.cancel_requested")).toBe(true)
    // The first press never consults the interrupt registry.
    expect(h.dispositions).toHaveLength(0)
  })

  test("Ctrl+C on an idle root (no active targets) is a no-op and never interrupts", async () => {
    SessionInterruptRegistry.reset()
    const h = harness()
    const service = createCancelService({ emitter: h.emitter, coordinator: h.coordinator, fence: h.fence })
    const out = await Effect.runPromise(
      service.requestRootCancel({ rootProcessId: "proc_root" as never, rootKey: "ses_root", principal: { kind: "operator", id: "op" }, reason: null, targets: [] }),
    )
    expect(out.outcome).toBe("rejected")
    expect(h.emitted).toHaveLength(0)
    expect(h.dispositions).toHaveLength(0)
  })
})
