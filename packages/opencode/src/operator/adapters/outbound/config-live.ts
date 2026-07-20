/**
 * Live Config.Service → ConfigServiceLike bridge (fourth-review).
 * Calls actual Config.Service get/update/getGlobal/updateGlobal via Effect runner.
 * Does not invent a second config store.
 */
import type { Effect } from "effect"
import type { ConfigServiceLike } from "./config-service"

/** Minimal Config.Service surface (Effect-based). */
export type ConfigServiceEffect = {
  readonly get: () => Effect.Effect<Record<string, unknown>>
  readonly getGlobal: () => Effect.Effect<Record<string, unknown>>
  readonly update: (
    config: Record<string, unknown>,
    options?: { readonly replace?: boolean },
  ) => Effect.Effect<void>
  readonly updateGlobal: (config: Record<string, unknown>) => Effect.Effect<{ changed: boolean }>
}

export type EffectRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>

/**
 * Wrap a live Config.Service (or compatible) into ConfigServiceLike for durable operator store.
 */
export function createConfigServiceLikeFromConfig(
  config: ConfigServiceEffect,
  run: EffectRunner,
): ConfigServiceLike {
  return {
    get: () => run(config.get()),
    getGlobal: () => run(config.getGlobal()),
    update: (patch, options) => run(config.update(patch, options)),
    updateGlobal: (patch) => run(config.updateGlobal(patch)),
  }
}

/**
 * Build ConfigServiceLike by resolving Config.Service from a use helper.
 * Live composition provides: (fn) => AppRuntime.runPromise(Config.Service.use(fn))
 */
export function createLiveConfigServiceLike(input: {
  readonly useConfig: <A>(fn: (svc: ConfigServiceEffect) => Effect.Effect<A>) => Promise<A>
}): ConfigServiceLike {
  return {
    get: () => input.useConfig((svc) => svc.get()),
    getGlobal: () => input.useConfig((svc) => svc.getGlobal()),
    update: (patch, options) => input.useConfig((svc) => svc.update(patch, options)),
    updateGlobal: (patch) => input.useConfig((svc) => svc.updateGlobal(patch)),
  }
}

export * as ConfigLiveAdapter from "./config-live"
