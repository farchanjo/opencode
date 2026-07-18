/**
 * Distributed process lock for operator Config RMW (B1).
 * Production uses Flock; tests may inject process mutex or shared Flock dir.
 */
export type LockTryResult<T> =
  | { readonly acquired: true; readonly value: T }
  | { readonly acquired: false }

export type LockPort = {
  readonly withLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>
  /**
   * Non-blocking attempt. When another owner holds the key, returns
   * `{ acquired: false }` without waiting for the full timeout budget.
   */
  readonly tryWithLock: <T>(key: string, fn: () => Promise<T>) => Promise<LockTryResult<T>>
}

export type LockPortOptions = {
  /** Explicit lock directory (required for multi-process tests / sandbox). */
  readonly dir: string
  /** Optional timeout ms for blocking withLock. */
  readonly timeoutMs?: number
  /** Optional timeout ms for tryWithLock (default 100ms). */
  readonly tryTimeoutMs?: number
  /**
   * Heartbeat staleness window for Flock. Crash-exit while holding a lock becomes
   * reclaimable after this window (tests should use a short value).
   */
  readonly staleMs?: number
}

/**
 * Create Flock-backed lock port. Cross-process correct when `dir` is shared.
 * Callers MUST supply dir — no silent process-only default for production.
 */
export async function createFlockLockPort(options: LockPortOptions): Promise<LockPort> {
  const { Flock } = await import("@opencode-ai/core/util/flock")
  const dir = options.dir
  const flockKey = (key: string) => `operator:${key}`
  const flockOpts = {
    dir,
    staleMs: options.staleMs,
  }
  return {
    async withLock(key, fn) {
      return Flock.withLock(flockKey(key), fn, {
        ...flockOpts,
        timeoutMs: options.timeoutMs ?? 30_000,
      })
    },
    async tryWithLock(key, fn) {
      try {
        const value = await Flock.withLock(flockKey(key), fn, {
          ...flockOpts,
          timeoutMs: options.tryTimeoutMs ?? 100,
          baseDelayMs: 5,
          maxDelayMs: 25,
        })
        return { acquired: true, value }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("Timed out waiting for lock")) return { acquired: false }
        throw error
      }
    },
  }
}

/** Process-local mutex lock — tests only. Must not be used as production correctness. */
export function createProcessMutexLockPort(): LockPort {
  const chains = new Map<string, Promise<unknown>>()
  const held = new Set<string>()

  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const next = prev.then(() => gate)
    chains.set(key, next)
    await prev.catch(() => undefined)
    held.add(key)
    try {
      return await fn()
    } finally {
      held.delete(key)
      release()
      if (chains.get(key) === next) chains.delete(key)
    }
  }

  return {
    withLock,
    async tryWithLock(key, fn) {
      if (held.has(key)) return { acquired: false }
      return { acquired: true, value: await withLock(key, fn) }
    },
  }
}

export * as OperatorLockPort from "./lock-port"
