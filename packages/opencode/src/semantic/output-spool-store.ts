/**
 * Feature 050 / T013 — the `OutputSpoolStore` chunk-body façade, REUSING the
 * Feature 005 `OutputSpool` subsystem rather than authoring a second storage
 * engine (`contracts/ports.ts` `OutputSpoolStore`).
 *
 * Writes go through `SessionSpoolWriter.ingest`/`.seal`
 * (`session/output-spool-writer.ts`) — the SAME production writer the session
 * message-part seam drives — under a DEDICATED `semantic-chunk` channel/group
 * namespace so a chunk entry never collides with a session part's own
 * subtree. Reads go through the operator `OutputSpoolBackend.stat`/`.read`
 * path (`operator/outputspool/backend-live.ts`), the SAME control-store +
 * page-reader mechanism the `output.*` command surface already uses.
 *
 * `outputRef` is the chunk's own `identity.content_hash` — a stable,
 * content-addressed key, so a distinct edit (distinct sanitized bytes) always
 * resolves to a distinct spool entry. `generation` is derived deterministically
 * from that SAME hash (never a persisted counter this module would have to
 * own), so two calls describing the SAME content always agree on where it
 * lives, and a changed body always lands in a fresh generation subtree —
 * `supersede` never mutates sealed bytes in place.
 *
 * **Deviation note (documented, not a silent gap):** `supersede` seals the
 * prior generation through the SAME narrow `writer.seal` seam `put` uses;
 * Feature 005's actual byte-reclaim path (`planDelete`/`planPurge`, the
 * `OutputSpoolBackend` admin edge) requires an authorized `OperatorPrincipal`
 * and a config-CAS-committed plan, which is composition-root wiring outside
 * this feature's slice (T023). Sealing here stops the entry from accepting
 * further writes and marks it inactive for reconcile's purposes; the actual
 * on-disk bytes are reclaimed later by Feature 005's existing retention
 * sweeper on its own schedule — never a second, competing reclaim mechanism.
 */
export * as OutputSpoolStore from "./output-spool-store"

import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { OperatorPrincipal, SpoolReaderError } from "@opencode-ai/protocol/outputspool/commands"
import type { ChannelKey } from "@/session/output-spool-writer"
import { SessionSpoolWriter } from "@/session/output-spool-writer"
import type { OutputSpoolBackend } from "@/operator/outputspool/outputspool-port"

/** The system principal every internal semantic-index spool call authenticates as (never an end-user identity). */
const SYSTEM_PRINCIPAL: OperatorPrincipal = { kind: "system", id: "semantic-index" }

/** The dedicated channel/group namespace so a chunk entry never collides with a session part's own subtree. */
const CHUNK_CHANNEL = "artifact" as const
const GROUP_PREFIX = "semantic-chunk"

export interface OutputSpoolPutInput {
  readonly parentSkillId: string
  readonly chunkIndex: number
  readonly contentHash: string
  /** The ALREADY-SANITIZED chunk body bytes (post `Projection.scrubText`); never raw file content. */
  readonly sanitizedBody: string
}

export interface OutputSpoolPutResult {
  readonly outputRef: string
  readonly offset: number
  readonly limit: number
  readonly byteLength: number
}

export interface OutputSpoolResolveResult {
  readonly body: string
  readonly contentHash: string
}

export type OutputSpoolStoreError =
  | { readonly type: "spool_unavailable"; readonly reason: string }
  | { readonly type: "not_found"; readonly reason?: string }

export interface OutputSpoolStore {
  readonly put: (input: OutputSpoolPutInput) => Effect.Effect<OutputSpoolPutResult, OutputSpoolStoreError>
  readonly resolve: (ref: string) => Effect.Effect<OutputSpoolResolveResult, OutputSpoolStoreError>
  readonly supersede: (priorRef: string) => Effect.Effect<void, OutputSpoolStoreError>
}

export interface OutputSpoolStoreDeps {
  /** The Feature 005 production writer — only `ingest`/`seal` are needed here. */
  readonly writer: Pick<ReturnType<typeof SessionSpoolWriter.createSessionSpoolWriter>, "ingest" | "seal">
  /** The operator `OutputSpoolBackend` — only the content-free `stat`/`read` reads are needed here. */
  readonly reader: Pick<OutputSpoolBackend, "stat" | "read">
}

/** Sanitize a raw skill id into a valid spool path segment (`^[A-Za-z0-9_.-]{1,128}$`); never a traversal token. */
const sanitizeSegment = (raw: string): string => {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, "_")
  return (cleaned.length > 0 ? cleaned : "skill").slice(0, 100)
}

/** A deterministic, content-addressed generation number — no persisted counter to own (FR8). */
const generationFor = (contentHash: string): number => {
  const digest = createHash("sha256").update(contentHash).digest("hex")
  return parseInt(digest.slice(0, 8), 16)
}

const channelKeyFor = (input: OutputSpoolPutInput): ChannelKey => ({
  groupId: `${GROUP_PREFIX}-${sanitizeSegment(input.parentSkillId)}-c${input.chunkIndex}`,
  generation: generationFor(input.contentHash),
  channel: CHUNK_CHANNEL,
  outputRef: input.contentHash,
  tier: "durable",
})

const spoolUnavailable = (reason: string): OutputSpoolStoreError => ({ type: "spool_unavailable", reason })

/**
 * Build the chunk-body store over the injected Feature 005 writer + operator
 * reader. Pure composition — no new storage engine (T013).
 */
export const createOutputSpoolStore = (deps: OutputSpoolStoreDeps): OutputSpoolStore => {
  const put = (input: OutputSpoolPutInput): Effect.Effect<OutputSpoolPutResult, OutputSpoolStoreError> =>
    Effect.gen(function* () {
      const key = channelKeyFor(input)
      const outcome = yield* Effect.tryPromise({
        try: () => deps.writer.ingest(key, input.sanitizedBody),
        catch: (e) => spoolUnavailable(String(e)),
      })
      if (outcome.kind === "error") return yield* Effect.fail(spoolUnavailable(outcome.reason))
      if (outcome.kind === "fenced") return yield* Effect.fail(spoolUnavailable("chunk generation fenced (stale)"))
      if (outcome.kind === "skipped") return yield* Effect.fail(spoolUnavailable(outcome.reason))
      yield* Effect.tryPromise({ try: () => deps.writer.seal(key.outputRef), catch: (e) => spoolUnavailable(String(e)) })
      return {
        outputRef: key.outputRef,
        offset: 0,
        limit: outcome.committedBytes,
        byteLength: outcome.committedBytes,
      }
    })

  const resolve = (ref: string): Effect.Effect<OutputSpoolResolveResult, OutputSpoolStoreError> =>
    Effect.gen(function* () {
      const stat = yield* deps.reader.stat({ outputRef: ref, principal: SYSTEM_PRINCIPAL }).pipe(
        Effect.mapError((e: SpoolReaderError): OutputSpoolStoreError =>
          e.type === "not_found" ? { type: "not_found" } : spoolUnavailable(readerErrorReason(e)),
        ),
      )
      if (stat.stat.committedBytes === 0) return { body: "", contentHash: ref }
      const read = yield* deps.reader
        .read({ outputRef: ref, offset: 0, limit: stat.stat.committedBytes, principal: SYSTEM_PRINCIPAL })
        .pipe(
          Effect.mapError((e: SpoolReaderError): OutputSpoolStoreError =>
            e.type === "not_found" ? { type: "not_found" } : spoolUnavailable(readerErrorReason(e)),
          ),
        )
      return { body: Buffer.from(read.page.bytes).toString("utf8"), contentHash: ref }
    })

  const supersede = (priorRef: string): Effect.Effect<void, OutputSpoolStoreError> =>
    Effect.tryPromise({ try: () => deps.writer.seal(priorRef), catch: (e) => spoolUnavailable(String(e)) })

  return { put, resolve, supersede }
}

const readerErrorReason = (e: SpoolReaderError): string => (e.type === "unavailable" ? e.reason : e.type)
