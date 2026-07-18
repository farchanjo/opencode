/**
 * Feature 003 / T022 (S10) — durable Job Definition & registration persistence.
 *
 * The application-layer persistence adapter that stores `JobDefinition` and
 * `ScheduleRegistration` (durable intent + registration state) in the canonical
 * Feature 007 Config.Service authority through the REUSED `ConfigPort`
 * (`@/operator/application/ports`), never a parallel product store (ADR-0004 C5,
 * C21). It mirrors how the operator stack reaches Config.Service and how
 * `eventv2-adapter.ts` mirrors the lifecycle domain: the durable authority is
 * injected as the committed `ConfigPort` seam, so this module is unit-testable
 * against an in-memory `ConfigPort` and the live composition passes the real
 * Config.Service-backed store.
 *
 * Faithful to the T022 acceptance text and ADR-0004:
 *   - **One durable authority, atomic within it (FR3, FR6, C5).** Every mutation
 *     is an optimistic `compareAndSet` (version/CAS + idempotency) inside
 *     Config.Service. An in-process `Bun.cron` registration is NEVER the durable
 *     authority (FR3); the external registration is a separate idempotent effect
 *     the adapter (T021) applies with compensation, and NO transaction spans
 *     Config.Service and the scheduler (C5, AC23).
 *   - **Secrets are secure references only (FR32, Security 3, C10).** A
 *     `JobDefinition` carries only opaque `Jobs.SecretRef` / `Jobs.PayloadRef`
 *     handles; secret MATERIAL is resolved at execution time through the
 *     Feature 007 SecretPort and NEVER touches this boundary. Before any write
 *     the encoded payload is scanned for plaintext secret fields and rejected on
 *     a hit, so no plaintext ever reaches the durable store (Privacy).
 *   - **Bounded, redacted, decode-checked (FR32).** Payloads are encoded/decoded
 *     through the canonical `@opencode-ai/schema/jobs` schemas, so a corrupt or
 *     tampered document surfaces a typed `decode_failed`, never an untyped read.
 */
export * as JobPersistence from "./persistence"

import { Effect, Schema } from "effect"
import { findPlaintextSecretFields } from "@opencode-ai/core/operator"
import { Definition } from "@opencode-ai/schema/jobs/definition"
import type { Ids } from "@opencode-ai/schema/jobs/ids"
import { Reconciliation } from "@opencode-ai/schema/jobs/reconciliation"
import type { ConfigPort, ConfigVersion } from "@/operator/application/ports"

// =============================================================================
// Result & error shapes
// =============================================================================

/** A durably persisted definition plus its Config.Service CAS token (FR6, C5). */
export interface PersistedDefinition {
  readonly definition: Definition.JobDefinition
  /** Opaque Config.Service CAS version token — the concurrency guard for the next write. */
  readonly version: ConfigVersion
  readonly updatedAtMs: number
}

/** A durably persisted schedule registration (durable intent + state) plus its CAS token (FR6, C5). */
export interface PersistedRegistration {
  readonly registration: Reconciliation.ScheduleRegistration
  readonly version: ConfigVersion
  readonly updatedAtMs: number
}

/**
 * The typed persistence error union. `version_conflict` guards optimistic CAS;
 * `plaintext_secret` guards the never-plaintext invariant (Security 3, C10);
 * `decode_failed` guards a corrupt/tampered durable document; `unavailable`
 * surfaces a Config.Service outage without a false success (AC23).
 */
export type JobPersistenceError =
  | { readonly type: "version_conflict"; readonly currentVersion: ConfigVersion }
  | { readonly type: "plaintext_secret"; readonly fields: readonly string[] }
  | { readonly type: "decode_failed"; readonly reason: string }
  | { readonly type: "unavailable"; readonly reason: string }

export interface JobPersistenceDeps {
  readonly config: ConfigPort
  /** Monotonic millisecond clock stamped onto each write (default `Date.now`). */
  readonly clock?: () => number
  /** Authority-key namespace prefix for the durable job-definition table (default `"jobs"`). */
  readonly authorityPrefix?: string
}

/** The persistence surface consumed by the trigger service (T023) and the operator domain (T027). */
export interface JobPersistence {
  readonly saveDefinition: (
    definition: Definition.JobDefinition,
    expectedVersion: ConfigVersion | null,
  ) => Effect.Effect<PersistedDefinition, JobPersistenceError>
  readonly loadDefinition: (
    jobDefinitionId: Ids.JobDefinitionId,
  ) => Effect.Effect<PersistedDefinition | null, JobPersistenceError>
  readonly listDefinitions: () => Effect.Effect<readonly PersistedDefinition[], JobPersistenceError>
  readonly deleteDefinition: (
    jobDefinitionId: Ids.JobDefinitionId,
    expectedVersion: ConfigVersion | null,
  ) => Effect.Effect<{ readonly deleted: true }, JobPersistenceError>
  readonly saveRegistration: (
    registration: Reconciliation.ScheduleRegistration,
    expectedVersion: ConfigVersion | null,
  ) => Effect.Effect<PersistedRegistration, JobPersistenceError>
  readonly loadRegistration: (
    jobDefinitionId: Ids.JobDefinitionId,
    scheduleId: Ids.ScheduleId,
  ) => Effect.Effect<PersistedRegistration | null, JobPersistenceError>
}

// =============================================================================
// Codecs (canonical schema round-trip, FR32)
// =============================================================================

const decodeDefinition = Schema.decodeUnknownEffect(Definition.JobDefinition)
const encodeDefinition = Schema.encodeEffect(Definition.JobDefinition)
const decodeRegistration = Schema.decodeUnknownEffect(Reconciliation.ScheduleRegistration)
const encodeRegistration = Schema.encodeEffect(Reconciliation.ScheduleRegistration)

const asDecodeFailed = (error: unknown): JobPersistenceError => ({
  type: "decode_failed",
  reason: error instanceof Error ? error.message : String(error),
})

// =============================================================================
// Factory
// =============================================================================

const INDEX_MAX_ATTEMPTS = 3

interface StoredEntry {
  readonly payload: unknown
  readonly version: ConfigVersion
  readonly updatedAtMs: number
}

interface DefinitionIndex {
  readonly ids: readonly string[]
}

const readIndexIds = (payload: unknown): readonly string[] => {
  if (payload === null || typeof payload !== "object") return []
  const ids = (payload as { readonly ids?: unknown }).ids
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
}

export function createJobPersistence(deps: JobPersistenceDeps): JobPersistence {
  const clock = deps.clock ?? Date.now
  const prefix = deps.authorityPrefix ?? "jobs"
  const config = deps.config

  const definitionAuthority = (id: Ids.JobDefinitionId): string => `${prefix}/definitions/${String(id)}`
  const registrationAuthority = (id: Ids.JobDefinitionId, scheduleId: Ids.ScheduleId): string =>
    `${prefix}/registrations/${String(id)}:${String(scheduleId)}`
  const indexAuthority = `${prefix}/index`

  /** Read one authority entry, treating an absent doc or a delete tombstone (`payload === null`) as absent. */
  const readEntry = (authority: string): Effect.Effect<StoredEntry | null, JobPersistenceError> =>
    Effect.gen(function* () {
      const entry = yield* Effect.tryPromise({
        try: () => config.get(authority),
        catch: (cause): JobPersistenceError => ({ type: "unavailable", reason: String(cause) }),
      })
      if (entry === null || entry.payload === null) return null
      return { payload: entry.payload, version: entry.version, updatedAtMs: entry.updatedAtMs }
    })

  /** Optimistic CAS write into Config.Service; maps the `CasResult` union onto the typed error union (FR6, C5). */
  const writeEntry = (
    authority: string,
    expectedVersion: ConfigVersion | null,
    payload: unknown,
    nowMs: number,
  ): Effect.Effect<ConfigVersion, JobPersistenceError> =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => config.compareAndSet({ authority, expectedVersion, payload, nowMs }),
        catch: (cause): JobPersistenceError => ({ type: "unavailable", reason: String(cause) }),
      })
      if (result.ok) return result.version
      if (result.code === "conflict") {
        return yield* Effect.fail<JobPersistenceError>({ type: "version_conflict", currentVersion: result.currentVersion })
      }
      return yield* Effect.fail<JobPersistenceError>({ type: "unavailable", reason: result.reason })
    })

  /**
   * Read-modify-write the definition index under a bounded CAS-retry loop. The
   * index only enables enumeration for `listDefinitions`; it is never a second
   * store of record for the definitions themselves (C5).
   */
  const mutateIndex = (fn: (ids: readonly string[]) => readonly string[]): Effect.Effect<void, JobPersistenceError> =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < INDEX_MAX_ATTEMPTS; attempt++) {
        const entry = yield* readEntry(indexAuthority)
        const current = readIndexIds(entry?.payload ?? null)
        const nextIds = fn(current)
        if (nextIds.length === current.length && nextIds.every((id, i) => id === current[i])) return
        const next: DefinitionIndex = { ids: nextIds }
        const outcome = yield* writeEntry(indexAuthority, entry?.version ?? null, next, clock()).pipe(Effect.result)
        if (outcome._tag === "Success") return
        if (outcome.failure.type !== "version_conflict") return yield* Effect.fail(outcome.failure)
        // Conflict: another writer advanced the index; re-read and retry (bounded).
      }
    })

  const saveDefinition = (
    definition: Definition.JobDefinition,
    expectedVersion: ConfigVersion | null,
  ): Effect.Effect<PersistedDefinition, JobPersistenceError> =>
    Effect.gen(function* () {
      const encoded = yield* encodeDefinition(definition).pipe(Effect.mapError(asDecodeFailed))
      // Never-plaintext invariant: only opaque SecretRef/PayloadRef handles may be
      // persisted; a plaintext secret field aborts the write (Security 3, C10).
      const leaks = findPlaintextSecretFields(encoded)
      if (leaks.length > 0) return yield* Effect.fail<JobPersistenceError>({ type: "plaintext_secret", fields: leaks })

      const nowMs = clock()
      const version = yield* writeEntry(definitionAuthority(definition.id), expectedVersion, encoded, nowMs)
      // A first create joins the enumeration index; an update leaves it untouched.
      if (expectedVersion === null) yield* mutateIndex((ids) => (ids.includes(String(definition.id)) ? ids : [...ids, String(definition.id)]))
      return { definition, version, updatedAtMs: nowMs }
    })

  const loadDefinition = (
    jobDefinitionId: Ids.JobDefinitionId,
  ): Effect.Effect<PersistedDefinition | null, JobPersistenceError> =>
    Effect.gen(function* () {
      const entry = yield* readEntry(definitionAuthority(jobDefinitionId))
      if (entry === null) return null
      const definition = yield* decodeDefinition(entry.payload).pipe(Effect.mapError(asDecodeFailed))
      return { definition, version: entry.version, updatedAtMs: entry.updatedAtMs }
    })

  const listDefinitions = (): Effect.Effect<readonly PersistedDefinition[], JobPersistenceError> =>
    Effect.gen(function* () {
      const indexEntry = yield* readEntry(indexAuthority)
      const ids = readIndexIds(indexEntry?.payload ?? null)
      const out: PersistedDefinition[] = []
      for (const id of ids) {
        const loaded = yield* loadDefinition(id as Ids.JobDefinitionId)
        if (loaded !== null) out.push(loaded)
      }
      return out
    })

  const deleteDefinition = (
    jobDefinitionId: Ids.JobDefinitionId,
    expectedVersion: ConfigVersion | null,
  ): Effect.Effect<{ readonly deleted: true }, JobPersistenceError> =>
    Effect.gen(function* () {
      // Tombstone the document (payload null) under CAS, then drop it from the
      // enumeration index. The compensating external unregister is the adapter's
      // idempotent effect (T021), never a cross-system transaction (C5, AC23).
      yield* writeEntry(definitionAuthority(jobDefinitionId), expectedVersion, null, clock())
      yield* mutateIndex((ids) => ids.filter((id) => id !== String(jobDefinitionId)))
      return { deleted: true }
    })

  const saveRegistration = (
    registration: Reconciliation.ScheduleRegistration,
    expectedVersion: ConfigVersion | null,
  ): Effect.Effect<PersistedRegistration, JobPersistenceError> =>
    Effect.gen(function* () {
      const encoded = yield* encodeRegistration(registration).pipe(Effect.mapError(asDecodeFailed))
      const nowMs = clock()
      const authority = registrationAuthority(registration.job_definition_id, registration.schedule_id)
      const version = yield* writeEntry(authority, expectedVersion, encoded, nowMs)
      return { registration, version, updatedAtMs: nowMs }
    })

  const loadRegistration = (
    jobDefinitionId: Ids.JobDefinitionId,
    scheduleId: Ids.ScheduleId,
  ): Effect.Effect<PersistedRegistration | null, JobPersistenceError> =>
    Effect.gen(function* () {
      const entry = yield* readEntry(registrationAuthority(jobDefinitionId, scheduleId))
      if (entry === null) return null
      const registration = yield* decodeRegistration(entry.payload).pipe(Effect.mapError(asDecodeFailed))
      return { registration, version: entry.version, updatedAtMs: entry.updatedAtMs }
    })

  return {
    saveDefinition,
    loadDefinition,
    listDefinitions,
    deleteDefinition,
    saveRegistration,
    loadRegistration,
  }
}
