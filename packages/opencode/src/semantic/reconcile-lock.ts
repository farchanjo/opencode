/**
 * Feature 050 / T015 — the per-profile `ReconcileLock`, serializing an
 * incremental reconcile against a blue/green rebuild so an in-flight
 * alias-swap can never orphan a concurrent reconcile's upserts (FR10).
 *
 * CAS-guarded the same way `registry-backend.ts` guards the binding document
 * (`readDoc`/`guardedPlan`): a single atomic exclusive-create write (`wx`) is
 * the CAS primitive — either this call wins and creates the lock file, or it
 * already exists and the caller is told exactly who holds it. A single
 * attempt only, never a blocking retry loop: whichever caller acquires first
 * wins; the other fails fast with `{type:"held", holder, acquiredAt}` so it
 * can decide for itself (reconcile: skip this run, retried next trigger;
 * rebuild: fail the operator command with a clear reason) — never a silent
 * block (`data-model.md` `#ReconcileLock`, `contracts/ports.ts` `ReconcileLock`).
 *
 * **Evaluated-and-rejected alternative:** `core/util/effect-flock.ts`
 * (`EffectFlock`) already implements a POSIX mkdir-based file lock, but its
 * PUBLIC contract bakes in a bounded retry-then-timeout policy (up to 5
 * minutes) with no fast, introspectable "already held" failure — exactly the
 * opposite of what FR10/AC7's "whichever calls first wins, the other fails
 * immediately" semantics need, and its timing constants are intentionally not
 * caller-configurable. Reusing it here would mean forking its internals
 * (defeating the point of reuse) or accepting a multi-minute test/operator
 * stall on lock contention. This module instead reuses `EffectFlock`'s
 * underlying TECHNIQUE — atomic mkdir/exclusive-create as the CAS primitive,
 * a token written into the lock file so a stale handle's `release` can never
 * clobber a newer holder's lock — as a purpose-built, single-attempt
 * primitive over one lock file per profile.
 */
export * as ReconcileLock from "./reconcile-lock"

import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"

export type ReconcileLockError =
  | { readonly type: "held"; readonly holder: string; readonly acquiredAt: string }
  | { readonly type: "unavailable"; readonly reason: string }

export interface ReconcileLockHandle {
  readonly holder: string
  readonly acquiredAt: string
  readonly release: () => Effect.Effect<void>
}

export interface ReconcileLock {
  readonly acquire: (input: {
    readonly profileId: string
    readonly holder: string
  }) => Effect.Effect<ReconcileLockHandle, ReconcileLockError>
}

export interface ReconcileLockDeps {
  /** The shared root every profile's lock file is created under (e.g. the profile's config dir). */
  readonly lockRoot: string
}

interface LockMeta {
  readonly holder: string
  readonly acquiredAt: string
  readonly token: string
}

const LOCK_FILE_SUFFIX = ".semantic-index.lock"

/** A profileId is hashed (not sanitized) so it never needs to double as a filesystem-safe segment. */
const digestOf = (profileId: string): string => createHash("sha256").update(profileId).digest("hex").slice(0, 32)

/** One lock file per `profileId`, keyed by a content hash so an arbitrary profileId is always a safe filename. */
const lockPathFor = (lockRoot: string, profileId: string): string =>
  path.join(lockRoot, `${digestOf(profileId)}${LOCK_FILE_SUFFIX}`)

const readMeta = (lockPath: string): LockMeta | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockMeta>
    if (typeof parsed.holder === "string" && typeof parsed.acquiredAt === "string" && typeof parsed.token === "string") {
      return { holder: parsed.holder, acquiredAt: parsed.acquiredAt, token: parsed.token }
    }
    return undefined
  } catch {
    return undefined
  }
}

const isErrnoException = (e: unknown): e is NodeJS.ErrnoException => e instanceof Error && "code" in e

/**
 * Build the per-profile reconcile/rebuild lock over one shared lock-file root.
 * `acquire` is a single atomic attempt; `release` is idempotent and
 * token-guarded so a stale handle can never clobber a newer holder's lock.
 */
export const createReconcileLock = (deps: ReconcileLockDeps): ReconcileLock => {
  const acquire = (input: { readonly profileId: string; readonly holder: string }) =>
    Effect.try({
      try: (): LockMeta => {
        const lockPath = lockPathFor(deps.lockRoot, input.profileId)
        mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 })
        const meta: LockMeta = { holder: input.holder, acquiredAt: new Date().toISOString(), token: randomUUID() }
        writeFileSync(lockPath, JSON.stringify(meta), { flag: "wx", mode: 0o600 })
        return meta
      },
      catch: (cause): ReconcileLockError => {
        if (isErrnoException(cause) && cause.code === "EEXIST") {
          const existing = readMeta(lockPathFor(deps.lockRoot, input.profileId))
          return existing
            ? { type: "held", holder: existing.holder, acquiredAt: existing.acquiredAt }
            : { type: "held", holder: "unknown", acquiredAt: new Date(0).toISOString() }
        }
        return { type: "unavailable", reason: String(cause) }
      },
    }).pipe(
      Effect.map(
        (meta): ReconcileLockHandle => ({
          holder: meta.holder,
          acquiredAt: meta.acquiredAt,
          release: (): Effect.Effect<void> =>
            Effect.sync(() => {
              const lockPath = lockPathFor(deps.lockRoot, input.profileId)
              const current = readMeta(lockPath)
              // Idempotent + token-guarded: a stale/already-released handle never clobbers a newer holder.
              if (current && current.token !== meta.token) return
              try {
                rmSync(lockPath, { force: true })
              } catch {
                // release is idempotent — a missing lock file is not an error
              }
            }),
        }),
      ),
    )

  return { acquire }
}
