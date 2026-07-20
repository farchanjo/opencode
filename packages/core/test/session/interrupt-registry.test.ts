/**
 * Feature 018 / G5 (T012, T017) — the narrow interrupt registry (FR9, FR10).
 *
 * Pins the process-singleton edge the operator second-press forced abort consults:
 * register/deregister lifecycle, token-guarded double-register, an absent key
 * degrading to the honest `unconfirmed` disposition (never a throw, never a
 * fabricated stop), and — through a REAL `SessionRunCoordinator` composed exactly
 * as the execution layer composes it (`withRegisteredRun`) — that interrupting a
 * live registered run actually aborts its fiber and deregisters on terminal.
 */
import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionInterruptRegistry } from "@opencode-ai/core/session/interrupt-registry"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

describe("SessionInterruptRegistry — register/deregister lifecycle (FR9)", () => {
  it.effect("register exposes the key; the returned deregister removes it", () =>
    Effect.gen(function* () {
      SessionInterruptRegistry.reset()
      let calls = 0
      const deregister = SessionInterruptRegistry.register("root_a", () => Effect.sync(() => void calls++))
      expect(SessionInterruptRegistry.has("root_a")).toBe(true)
      expect(SessionInterruptRegistry.size()).toBe(1)
      deregister()
      expect(SessionInterruptRegistry.has("root_a")).toBe(false)
      expect(calls).toBe(0)
    }),
  )

  it.effect("a double-register keeps the newest handle; a stale deregister never evicts it", () =>
    Effect.gen(function* () {
      SessionInterruptRegistry.reset()
      const hit: string[] = []
      const deregisterOld = SessionInterruptRegistry.register("root_a", () => Effect.sync(() => void hit.push("old")))
      const deregisterNew = SessionInterruptRegistry.register("root_a", () => Effect.sync(() => void hit.push("new")))

      // The stale deregister for the replaced entry must NOT remove the fresh one.
      deregisterOld()
      expect(SessionInterruptRegistry.has("root_a")).toBe(true)

      const outcome = yield* SessionInterruptRegistry.interrupt("root_a")
      expect(outcome.disposition).toBe("interrupted")
      expect(hit).toEqual(["new"]) // only the newest handle ran

      deregisterNew()
      expect(SessionInterruptRegistry.has("root_a")).toBe(false)
    }),
  )

  it.effect("an absent key degrades to the honest unconfirmed disposition, never a throw", () =>
    Effect.gen(function* () {
      SessionInterruptRegistry.reset()
      const outcome = yield* SessionInterruptRegistry.interrupt("root_missing")
      expect(outcome).toMatchObject({ rootKey: "root_missing", disposition: "unconfirmed" })
      expect(outcome.reason).toBe("no_active_run_registered")
    }),
  )

  it.effect("interrupt runs the registered handle and reports interrupted", () =>
    Effect.gen(function* () {
      SessionInterruptRegistry.reset()
      let ran = false
      SessionInterruptRegistry.register("root_a", () => Effect.sync(() => void (ran = true)))
      const outcome = yield* SessionInterruptRegistry.interrupt("root_a")
      expect(outcome.disposition).toBe("interrupted")
      expect(ran).toBe(true)
    }),
  )
})

describe("SessionInterruptRegistry — interrupt of a live run over a real coordinator (FR9, FR10)", () => {
  it.effect("aborts the registered run's fiber and deregisters on terminal", () =>
    Effect.scoped(
      Effect.gen(function* () {
        SessionInterruptRegistry.reset()
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()

        // Compose the coordinator EXACTLY as execution/local.ts does: the drain
        // registers the active root run with a handle that drives this same
        // coordinator's interrupt, and deregisters on terminal via withRegisteredRun.
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

        const run = yield* coordinator.run("root_live").pipe(Effect.forkChild)
        yield* Deferred.await(started)
        expect(SessionInterruptRegistry.has("root_live")).toBe(true)

        // The operator second-press forced abort consults the registry by root key.
        const outcome = yield* SessionInterruptRegistry.interrupt("root_live")
        expect(outcome.disposition).toBe("interrupted")

        // The live run's fiber was really interrupted (its cleanup fired)…
        yield* Deferred.await(interrupted)
        const exit = yield* Fiber.await(run)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBeTrue()
        // …and the terminal deregistered the entry (no leak).
        expect(SessionInterruptRegistry.has("root_live")).toBe(false)
        expect(Array.from(yield* coordinator.active)).toEqual([])
      }),
    ),
  )

  it.effect("an absent live run leaves the coordinator untouched and reports unconfirmed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        SessionInterruptRegistry.reset()
        // No run registered for this key — the forced abort must not fabricate a stop.
        const outcome = yield* SessionInterruptRegistry.interrupt("root_never_ran")
        expect(outcome.disposition).toBe("unconfirmed")
      }),
    ),
  )
})
