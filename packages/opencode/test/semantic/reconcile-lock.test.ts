import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Cause, Effect, Exit } from "effect"
import { ReconcileLock } from "@/semantic/reconcile-lock"

// Feature 050 / T016 — the per-profile ReconcileLock: a second `acquire` while
// held fails `{type:"held", holder, acquiredAt}`; `release` is idempotent; a
// held-then-released lock allows the next `acquire` to succeed (FR10, AC7).

const withTempRoot = async (fn: (lockRoot: string) => Promise<void>): Promise<void> => {
  const lockRoot = mkdtempSync(path.join(tmpdir(), "reconcile-lock-test-"))
  try {
    await fn(lockRoot)
  } finally {
    rmSync(lockRoot, { recursive: true, force: true })
  }
}

const runExit = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect)

describe("ReconcileLock.acquire — mutual exclusion (FR10, AC7)", () => {
  test("a second acquire for the same profile while held fails {type:'held'} with the current holder", async () => {
    await withTempRoot(async (lockRoot) => {
      const lock = ReconcileLock.createReconcileLock({ lockRoot })

      const first = await Effect.runPromise(lock.acquire({ profileId: "profile-a", holder: "reconcile-1" }))
      expect(first.holder).toBe("reconcile-1")

      const exit = await runExit(lock.acquire({ profileId: "profile-a", holder: "rebuild-1" }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toEqual({ type: "held", holder: "reconcile-1", acquiredAt: first.acquiredAt })
      }
    })
  })

  test("distinct profiles never contend with each other", async () => {
    await withTempRoot(async (lockRoot) => {
      const lock = ReconcileLock.createReconcileLock({ lockRoot })
      const a = await Effect.runPromise(lock.acquire({ profileId: "profile-a", holder: "reconcile-a" }))
      const b = await Effect.runPromise(lock.acquire({ profileId: "profile-b", holder: "reconcile-b" }))
      expect(a.holder).toBe("reconcile-a")
      expect(b.holder).toBe("reconcile-b")
    })
  })
})

describe("ReconcileLock — release is idempotent and unblocks the next acquire (FR10)", () => {
  test("release then acquire again succeeds for a new holder", async () => {
    await withTempRoot(async (lockRoot) => {
      const lock = ReconcileLock.createReconcileLock({ lockRoot })
      const first = await Effect.runPromise(lock.acquire({ profileId: "profile-a", holder: "reconcile-1" }))
      await Effect.runPromise(first.release())

      const second = await Effect.runPromise(lock.acquire({ profileId: "profile-a", holder: "rebuild-1" }))
      expect(second.holder).toBe("rebuild-1")
    })
  })

  test("calling release twice never throws", async () => {
    await withTempRoot(async (lockRoot) => {
      const lock = ReconcileLock.createReconcileLock({ lockRoot })
      const handle = await Effect.runPromise(lock.acquire({ profileId: "profile-a", holder: "reconcile-1" }))
      await Effect.runPromise(handle.release())
      await Effect.runPromise(handle.release())
    })
  })

  test("a stale handle's release never clobbers a newer holder's lock (token-guarded)", async () => {
    await withTempRoot(async (lockRoot) => {
      const lock = ReconcileLock.createReconcileLock({ lockRoot })
      const first = await Effect.runPromise(lock.acquire({ profileId: "profile-a", holder: "reconcile-1" }))
      await Effect.runPromise(first.release())
      const second = await Effect.runPromise(lock.acquire({ profileId: "profile-a", holder: "rebuild-1" }))

      // A late/duplicate release of the FIRST (already-released) handle must not remove the SECOND holder's lock.
      await Effect.runPromise(first.release())

      const exit = await runExit(lock.acquire({ profileId: "profile-a", holder: "reconcile-2" }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect((Cause.squash(exit.cause) as { holder: string }).holder).toBe(second.holder)
      }
    })
  })
})
