/**
 * Feature 043 / Phase 2b — shared `RoutingSessionState` Effect service.
 *
 * Feature 037 / 042 created a fresh `RoutingSessionStateStore` per `SessionPrompt`
 * layer build (a local `createRoutingSessionStateStore()`), used by the spawn seam
 * and `tool/task.ts`. Phase 2b must record real consumption at the `processor.ts`
 * response loop and read that same running total back at the fan-out admission
 * seam — so the store has to be ONE instance shared across the processor, the
 * prompt layer, and the spawn resolver. This thin service promotes the store to a
 * memoized layer node: every service that depends on it in the layer graph
 * (SessionProcessor + SessionPrompt) resolves the SAME store, so consumption
 * recorded by the processor is visible to the spawn seam and the accounting.
 *
 * The underlying store stays the plain, framework-free, in-memory keyed store
 * (`routing-state.ts`); this module only wraps it as a shared Effect service.
 */
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { createRoutingSessionStateStore, type RoutingSessionStateStore } from "./routing-state"

export type Interface = RoutingSessionStateStore

export class Service extends Context.Service<Service, Interface>()("@opencode/RoutingSessionStore") {}

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(createRoutingSessionStateStore())),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [],
})

export * as RoutingSessionStore from "./routing-session-store"
