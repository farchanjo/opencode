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
import type { ControlStore } from "@/outputspool/control-store"
import type { OperatorMutationPlan } from "@/operator/application/handler"
import type { OutputSpoolBackend } from "./outputspool-port"

/** Resolves the config authority a scope/scopeId maps to (mirrors LangLockPersistence.authorityFor). */
export type OutputPolicyAuthorityFor = (scope: "global" | "project", scopeId: string) => string

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
  const reader =
    deps.store !== undefined
      ? readerMethods(deps.store, deps.pageReader ?? defaultPageReader(deps.spoolRoot ?? ""))
      : {}
  return {
    ...gapBackend,
    ...reader,
    ...policyMethods(deps),
    ...deps.override,
  }
}
