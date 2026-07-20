import { Cause, Effect, Layer } from "effect"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionInterruptRegistry } from "../interrupt-registry"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    // Forward reference: the drain registers the active root run into the narrow
    // interrupt registry with a handle that drives THIS coordinator's interrupt
    // (Feature 018 FR9). The handle is only ever invoked at forced-abort time —
    // long after `make` returns and assigns `coordinator` — so the deferred read
    // is safe and avoids a construction-time cycle.
    let coordinator: SessionRunCoordinator.Coordinator<SessionSchema.ID, SessionRunner.RunError>
    coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        // Register the active root run so the operator second-press forced abort can
        // reach it through the narrow registry; deregister on terminal (FR9, FR10).
        return yield* SessionInterruptRegistry.withRegisteredRun(
          String(sessionID),
          () => coordinator.interrupt(sessionID),
          SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
            Effect.provide(locations.get(session.location)),
            Effect.tapCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
            ),
          ),
        )
      }),
    })

    return SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      wake: coordinator.wake,
    })
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [SessionStore.node, LocationServiceMap.node],
})

export * as SessionExecutionLocal from "./local"
