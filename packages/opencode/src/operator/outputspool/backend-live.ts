/**
 * Feature 005 / T037 (S24), completed under Feature 014 / T007 (FR6, FR14) — live
 * `OutputSpoolBackend` composition for the operator stack.
 *
 * Turns the committed Feature 005 application adapters into the un-audited
 * `OutputSpoolBackend` seam that the `output` command adapter consumes, following
 * the `createLiveLangLockBackend` precedent. It is HONEST about what the operator
 * `AppRuntime` reaches:
 *
 *   - **Real control-store reads (FR6).** When a real `ControlStore`
 *     (`outputspool/control-store.ts`) is injected, `stat`/`read` project the live
 *     committed-length authority: `stat` from the channel-generation record,
 *     `read` by reading exactly the requested byte window through `page-reader.ts`
 *     `readPage` bounded to the committed length. Every store/file access is
 *     guarded so a store outage or a missing record degrades to a typed
 *     `unavailable`/`not_found` — never a fabricated page (FR14).
 *
 *   - **Config-backed policy mutations (FR6).** `retention.set`/`quota.set` persist
 *     bounded POLICY, which is genuinely config-backed. They VALIDATE at plan time
 *     and return an `OperatorMutationPlan` (authority + pure transform) so the
 *     Feature 007 `mutateAuthority` pipeline owns the single committed CAS write
 *     through the config round-trip seam — the backend never self-commits, so a
 *     rejected mutation leaves no persisted policy write.
 *
 *   - **Deny-by-default across projects (Privacy 3, FR44, C17).** `export` and
 *     `share` are cross-project deny-by-default: without an in-project operator
 *     grant they return `cross_project_denied` — never a fabricated success and
 *     never a raw path.
 *
 *   - **Honest capability gaps (FR14).** `follow` needs the cursor-codec seam and
 *     `release`/`delete`/`purge` act on the control store (SQLite), a substrate the
 *     Feature 007 config-CAS `mutateAuthority` pipeline cannot atomically own
 *     without either fabricating success (a config bump while the store is
 *     unchanged) or adding a new dispatch path (FR13). They therefore stay typed
 *     `unavailable` capability gaps by design, mirroring the FR10 lifecycle-cancel
 *     boundary — never forced through a fragile or fabricated path.
 *
 * Every method returns the port's typed error on failure, so a caller always sees
 * an honest capability gap and never a false success. Zero provider/model calls,
 * tokens, or cost (FR41, AC13).
 */
export * as OutputSpoolBackendLive from "./backend-live"

import path from "path"
import { Effect } from "effect"
import type {
  AdminError,
  AdminReleaseInput,
  DeleteInput,
  FollowInput,
  FollowOutput,
  PurgeInput,
  ReadInput,
  ReadOutput,
  ReadPage,
  SetQuotaInput,
  SetRetentionInput,
  SpoolReaderError,
  StatInput,
  StatOutput,
} from "@opencode-ai/protocol/outputspool/commands"
import type { GroupState } from "@opencode-ai/schema/outputspool/enums"
import type { Paging } from "@opencode-ai/core/outputspool/paging"
import { PageReader } from "@/outputspool/page-reader"
import { SessionSpoolWriter } from "@/session/output-spool-writer"
import type { ControlStore } from "@/outputspool/control-store"
import type { OperatorMutationEffectResult, OperatorMutationPlan } from "@/operator/application/handler"
import type { OutputSpoolBackend } from "./outputspool-port"

/** Resolves the config authority a scope/scopeId maps to (mirrors LangLockPersistence.authorityFor). */
export type OutputPolicyAuthorityFor = (scope: "global" | "project", scopeId: string) => string

/** The default page size a follower streams per `output.follow` step (bounded, C3). */
const FOLLOW_PAGE_SIZE = 64 * 1024

/** The store-scoped authority the admin edge records `release`/`delete`/`purge` outcomes under (never a config CAS version, FR9). */
export const OUTPUT_ADMIN_AUTHORITY = "global:output-admin" as const

/** An opaque follow cursor over a committed generation: `{ outputRef, offset }`, base64url(JSON) (C14). */
interface FollowCursor {
  readonly outputRef: string
  readonly offset: number
}

const encodeFollowCursor = (cursor: FollowCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url")

const decodeFollowCursor = (raw: string): FollowCursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>
    const outputRef = parsed.outputRef
    const offset = parsed.offset
    if (typeof outputRef !== "string" || outputRef.length === 0) return null
    if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) return null
    return { outputRef, offset }
  } catch {
    return null
  }
}

/** Reads one bounded UTF-8-safe page for a channel generation record; the live default binds `readPage` over the spool root. */
export type ChannelPageReader = (
  record: ControlStore.GenerationRecord,
  offset: number,
  limit: number,
) => Promise<Paging.PageResult>

export interface LiveOutputSpoolBackendDeps {
  /**
   * A real per-method implementation the composition root injects as the live spool
   * store is bound; any method left unset falls back to the honest gap (reads) or
   * deny-by-default (export/share). Applied last, so it overrides the real methods
   * built from `store`/authorities below. Never fabricated.
   */
  readonly override?: Partial<OutputSpoolBackend>
  /** The real control store (committed-length authority); enables `stat`/`read`. */
  readonly store?: ControlStore.ControlStore
  /** The managed spool root the live default page reader resolves channel files under. */
  readonly spoolRoot?: string
  /** Injected page reader (tests bind an in-memory file); defaults to `readPage` over `spoolRoot`. */
  readonly pageReader?: ChannelPageReader
  /** Resolves the config authority `retention.set` commits under; when set, enables the policy plan. */
  readonly retentionAuthorityFor?: OutputPolicyAuthorityFor
  /** Resolves the config authority `quota.set` commits under; when set, enables the policy plan. */
  readonly quotaAuthorityFor?: OutputPolicyAuthorityFor
  /**
   * Feature 017 / T013 (FR8) — when true (and a store is bound), `output.follow` binds its
   * cursor-codec seam: a follower streams committed pages from the populated store under the
   * Feature 005 backpressure/`eof` semantics, never blocking the writer. Unset keeps the gap.
   */
  readonly enableFollow?: boolean
  /**
   * Feature 017 / T014 (FR9) — when set (and a store is bound), `release`/`delete`/`purge`
   * commit through this STORE-SCOPED authority via the `mutation_plan` contract; the live store
   * op runs at plan-build time and `apply` records the control-store generation (never a
   * fabricated config CAS version). Unset keeps the typed capability gap.
   */
  readonly adminAuthority?: string
  readonly now?: () => number
}

const readerUnavailable = (reason: string): SpoolReaderError => ({ type: "unavailable", reason })
const readerNotFound = (outputRef: string): SpoolReaderError => ({ type: "not_found", outputRef })
const adminUnavailable = (reason: string): AdminError => ({ type: "unavailable", reason })
const CROSS_PROJECT_DENIED: AdminError = { type: "cross_project_denied" }

const NOT_BOUND = "outputspool control store is not bound to the operator runtime in this wave"
const CONTROL_STORE_ONLY =
  "output.{release,delete,purge} mutate the control store, which cannot be atomically committed through the config-CAS authority; typed capability gap (FR14)"
const FOLLOW_GAP = "output.follow requires the cursor-codec seam, not bound to the operator runtime in this wave"

/** GroupState values that arm `eof` — a terminal channel has no further append (protocol C20). */
const TERMINAL_STATES: ReadonlySet<GroupState> = new Set<GroupState>([
  "sealed",
  "aborted",
  "corrupt",
  "expired",
  "unknown",
])

/**
 * The honest default backend: reads and non-share/export admin ops are typed
 * capability gaps; export and share are cross-project deny-by-default; policy
 * mutations are unavailable until the authority resolvers are bound (FR44, C17,
 * AC13, AC15).
 */
const gapBackend: OutputSpoolBackend = {
  stat: () => Effect.fail(readerUnavailable(NOT_BOUND)),
  read: () => Effect.fail(readerUnavailable(NOT_BOUND)),
  follow: () => Effect.fail(readerUnavailable(FOLLOW_GAP)),
  export: () => Effect.fail(CROSS_PROJECT_DENIED),
  share: () => Effect.fail(CROSS_PROJECT_DENIED),
  release: () => Effect.fail(adminUnavailable(CONTROL_STORE_ONLY)),
  delete: () => Effect.fail(adminUnavailable(CONTROL_STORE_ONLY)),
  purge: () => Effect.fail(adminUnavailable(CONTROL_STORE_ONLY)),
  planSetRetention: () => Effect.fail(adminUnavailable(NOT_BOUND)),
  planSetQuota: () => Effect.fail(adminUnavailable(NOT_BOUND)),
  planRelease: () => Effect.fail(adminUnavailable(CONTROL_STORE_ONLY)),
  planDelete: () => Effect.fail(adminUnavailable(CONTROL_STORE_ONLY)),
  planPurge: () => Effect.fail(adminUnavailable(CONTROL_STORE_ONLY)),
}

/** Project a channel-generation record onto the content-free `stat` read model (FR18). */
const toStat = (record: ControlStore.GenerationRecord): StatOutput => ({
  stat: {
    outputRef: record.output_ref,
    channel: record.channel as StatOutput["stat"]["channel"],
    state: record.state,
    committedBytes: record.committed_bytes,
    fsyncTier: record.durability_tier,
    updatedAt: new Date(record.updated_at).toISOString(),
  },
})

/** Map the framework-free page result onto the wire `ReadPage` (never a path, C18). */
const toReadPage = (page: Paging.PageResult): ReadPage => ({
  bytes: page.bytes,
  nextOffset: page.next_offset,
  committedBytes: page.committed_bytes,
  caughtUp: page.caught_up,
  eof: page.eof,
})

/** The live default page reader: resolve the channel data file under the spool root and read one bounded window. */
const defaultPageReader = (spoolRoot: string): ChannelPageReader => (record, offset, limit) =>
  PageReader.readPage({
    path: path.join(spoolRoot, record.group_id, String(record.generation), record.channel, "data"),
    offset,
    limit,
    committedBytes: record.committed_bytes,
    sealed: TERMINAL_STATES.has(record.state),
  })

/** Read a record from the control store, degrading a store outage/absent record to a typed reader error. */
const getRecord = (
  store: ControlStore.ControlStore,
  outputRef: string,
): Effect.Effect<ControlStore.GenerationRecord, SpoolReaderError> =>
  Effect.try({ try: () => store.get(outputRef), catch: (e) => readerUnavailable(String(e)) }).pipe(
    Effect.flatMap((record) => (record ? Effect.succeed(record) : Effect.fail(readerNotFound(outputRef)))),
  )

/** Build the real reader methods over the injected control store + page reader (FR6, FR14). */
const readerMethods = (
  store: ControlStore.ControlStore,
  pageReader: ChannelPageReader,
): Pick<OutputSpoolBackend, "stat" | "read"> => ({
  stat: (input: StatInput) => getRecord(store, input.outputRef).pipe(Effect.map(toStat)),
  read: (input: ReadInput): Effect.Effect<ReadOutput, SpoolReaderError> =>
    getRecord(store, input.outputRef).pipe(
      Effect.flatMap((record) =>
        Effect.tryPromise({
          try: () => pageReader(record, input.offset, input.limit),
          catch: (e) => readerUnavailable(String(e)),
        }),
      ),
      Effect.map((page) => ({ page: toReadPage(page) })),
    ),
})

/**
 * Feature 017 / T013 (FR8) — the live `output.follow` cursor codec over the populated
 * store. Decodes the opaque `{ outputRef, offset }` cursor, reads exactly one bounded page
 * through `page-reader.ts` (an independent read-only handle, so a slow follower never blocks
 * the writer), and re-encodes the cursor at the page's `next_offset`. `caught_up`/`eof` follow
 * the Feature 005 backpressure/`eof` semantics. An invalid cursor degrades to a typed error.
 */
const followMethod = (
  store: ControlStore.ControlStore,
  pageReader: ChannelPageReader,
): Pick<OutputSpoolBackend, "follow"> => ({
  follow: (input: FollowInput): Effect.Effect<FollowOutput, SpoolReaderError> => {
    const cursor = decodeFollowCursor(input.cursor)
    if (!cursor) return Effect.fail<SpoolReaderError>({ type: "invalid_cursor", cursor: input.cursor })
    return getRecord(store, cursor.outputRef).pipe(
      Effect.flatMap((record) =>
        Effect.tryPromise({
          try: () => pageReader(record, cursor.offset, FOLLOW_PAGE_SIZE),
          catch: (e) => readerUnavailable(String(e)),
        }),
      ),
      Effect.map((page) => ({
        page: toReadPage(page),
        cursor: encodeFollowCursor({ outputRef: cursor.outputRef, offset: page.next_offset }),
      })),
    )
  },
})

/**
 * Feature 017 / T014 (FR9, ADR-0017 superseding decision) — the store-scoped admin edge. Only
 * the NON-destructive record read happens at plan-build time (so a not_found/store-outage fails
 * BEFORE any op). The irreversible control-store op is DEFERRED into the plan's `effect`, which
 * `mutateAuthority` runs exactly once AFTER contract + idempotency-claim + CAS precondition pass —
 * so a rejected mutation or an idempotent replay never destroys data. `apply` then records the
 * admin outcome (the real control-store `generation`, NEVER a fabricated config CAS version) under
 * the store-scoped authority, and the dispatcher emits the Feature 007 audit correlation.
 */
const adminMethods = (
  deps: LiveOutputSpoolBackendDeps,
  store: ControlStore.ControlStore,
  authority: string,
): Pick<OutputSpoolBackend, "planRelease" | "planDelete" | "planPurge"> => {
  const now = deps.now ?? Date.now
  const spoolRoot = deps.spoolRoot ?? ""

  /** Read the record; a store outage/absent record fails BEFORE any op (typed, no write). */
  const require = (outputRef: string): Effect.Effect<ControlStore.GenerationRecord, AdminError> =>
    Effect.try({ try: () => store.get(outputRef), catch: (e) => adminUnavailable(String(e)) }).pipe(
      Effect.flatMap((record) => (record ? Effect.succeed(record) : Effect.fail<AdminError>({ type: "not_found", outputRef }))),
    )

  /**
   * Read the record (non-destructive; not_found/outage fails here with no op), then return a plan
   * whose `effect` DEFERS the irreversible control-store op to `mutateAuthority` (run only after all
   * checks pass), and whose `apply` records the settled generation under the store-scoped authority.
   */
  const runAdmin = (
    outputRef: string,
    action: "release" | "delete" | "purge",
    op: (record: ControlStore.GenerationRecord) => void,
  ): Effect.Effect<OperatorMutationPlan, AdminError> =>
    require(outputRef).pipe(
      Effect.map((record) => ({
        authority,
        // Deferred: the destructive op runs inside mutateAuthority's effect phase, never at plan build.
        effect: async (): Promise<OperatorMutationEffectResult> => {
          try {
            op(record)
            return { ok: true }
          } catch (e) {
            return { ok: false, code: "unavailable", message: String(e) }
          }
        },
        apply: (current: unknown) => {
          const map = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {}
          // The settled version is the control-store generation, never a fabricated config CAS version (FR9).
          map[outputRef] = { action, generation: record.generation, committedBytes: record.committed_bytes, updatedAtMs: now() }
          return map
        },
      })),
    )

  return {
    // release drops the reference edges so retention can reclaim; committed bytes are preserved.
    planRelease: (input: AdminReleaseInput) =>
      runAdmin(input.outputRef, "release", (record) => {
        for (const edge of store.listEdges(record.output_ref)) store.removeEdge(record.output_ref, edge.kind, edge.holder_ref)
      }),
    // delete removes the control record (and its edges); the data file is swept by retention.
    planDelete: (input: DeleteInput) => runAdmin(input.outputRef, "delete", (record) => store.deleteGeneration(record.output_ref)),
    // purge removes the control record AND the on-disk channel bytes (the hard delete).
    planPurge: (input: PurgeInput) =>
      runAdmin(input.outputRef, "purge", (record) => {
        SessionSpoolWriter.removeChannelData(spoolRoot, record.group_id, record.generation, record.channel)
        store.deleteGeneration(record.output_ref)
      }),
  }
}

/** Build the config-backed policy plan methods (FR6, FR5); each apply is a pure transform of the persisted policy. */
const policyMethods = (
  deps: LiveOutputSpoolBackendDeps,
): Partial<Pick<OutputSpoolBackend, "planSetRetention" | "planSetQuota">> => {
  const now = deps.now ?? Date.now
  const retentionAuthorityFor = deps.retentionAuthorityFor
  const quotaAuthorityFor = deps.quotaAuthorityFor
  return {
    ...(retentionAuthorityFor
      ? {
          planSetRetention: (input: SetRetentionInput): Effect.Effect<OperatorMutationPlan, AdminError> =>
            Effect.succeed({
              authority: retentionAuthorityFor(input.scope, input.scopeId),
              apply: () => ({ retention: input.retention, updatedAtMs: now() }),
            }),
        }
      : {}),
    ...(quotaAuthorityFor
      ? {
          planSetQuota: (input: SetQuotaInput): Effect.Effect<OperatorMutationPlan, AdminError> =>
            Effect.succeed({
              authority: quotaAuthorityFor(input.scope, input.scopeId),
              apply: () => ({ quota: input.quota, updatedAtMs: now() }),
            }),
        }
      : {}),
  }
}

/**
 * Build the live backend: the honest default overlaid with the real control-store
 * reader methods (when a store is injected), the config-backed policy plans (when
 * the authority resolvers are injected), and finally any explicit per-method
 * override. `release`/`delete`/`purge`/`follow`/`export`/`share` stay the honest
 * gap/deny defaults (FR6, FR14).
 */
export const createLiveOutputSpoolBackend = (deps: LiveOutputSpoolBackendDeps = {}): OutputSpoolBackend => {
  const pageReader = deps.pageReader ?? defaultPageReader(deps.spoolRoot ?? "")
  const reader = deps.store !== undefined ? readerMethods(deps.store, pageReader) : {}
  // Feature 017 / T013 — bind the live follow cursor codec when the store is populated + enabled.
  const follow = deps.store !== undefined && deps.enableFollow ? followMethod(deps.store, pageReader) : {}
  // Feature 017 / T014 — bind the store-scoped admin edge when the store + admin authority are bound.
  const admin = deps.store !== undefined && deps.adminAuthority ? adminMethods(deps, deps.store, deps.adminAuthority) : {}
  return {
    ...gapBackend,
    ...reader,
    ...follow,
    ...admin,
    ...policyMethods(deps),
    ...deps.override,
  }
}
