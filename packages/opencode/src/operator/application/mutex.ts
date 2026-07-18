/**
 * Process-local async mutex for CAS serialization (Feature 007 review fix).
 * Not a distributed lock; pairs with Config.Service authority for single-process atomicity.
 * Production composition may also wrap with EffectFlock when available.
 */
export type Mutex = {
  readonly runExclusive: <T>(fn: () => Promise<T>) => Promise<T>
}

export function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    runExclusive(fn) {
      const run = tail.then(fn, fn)
      tail = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
}

export * as OperatorMutex from "./mutex"
