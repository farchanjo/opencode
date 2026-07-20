/**
 * Feature 017 / T011 (FR6, FR7, FR10) — the OutputSpool PRODUCTION writer,
 * subscribed at the session message-part seam.
 *
 * Feature 005 shipped the full `outputspool/` machinery (`createChannelWriter`,
 * `file-sink-writer.ts:139`) but a grep confirmed NO production caller ever
 * populated the spool, so the operator read an empty `operator-control.db`
 * (`stack-live.ts:413-428`). This module closes GAP A (the headline): it
 * subscribes to the session `message.part.updated` / `message.part.removed`
 * events (published by `session.ts` `updatePart`/`removePart` through the
 * `EventV2Bridge` → `GlobalBus` fan-out, `@/bus/global`) and drives
 * `createChannelWriter` per channel generation, writing to the SAME control-store
 * database + spool root the operator reads. So `output.stat`/`read`/`follow`
 * reflect real session output.
 *
 * It honors the Feature 005 invariants it REUSES (never re-authoring the writer):
 *
 *   - **Producer ownership (C21).** Each streaming part owns its own channel
 *     generation subtree (`groupId = partID`, one channel per part), so a stale
 *     generation never shares a file with a successor.
 *   - **Content-free events (C22).** No content byte is carried on any event; the
 *     writer only consumes the session's own part snapshots and persists bytes to
 *     the private spool tree — content leaves the content plane later ONLY as an
 *     authorized paged `output.read`.
 *   - **Bounded memory.** Each append drains immediately through the Feature 005
 *     bounded per-writer queue (O(queue + page), never O(total output)); the set
 *     of concurrently open writers is capped and the oldest is sealed + evicted.
 *   - **Stale-generation fencing.** `ControlStore.openGeneration` fences a
 *     superseded generation (`accepted:false`); a fenced writer never appends.
 *   - **Seal / abort preserving committed bytes.** A completed part seals; a
 *     removed part aborts — both preserve the committed extent for later reads.
 *
 * FAILS OPEN. A spool write error NEVER breaks the session loop — every ingest is
 * guarded and returns a typed outcome; a throw degrades to `{ kind: "error" }`
 * and the session continues. Zero provider/model calls, tokens, or cost.
 */
export * as SessionSpoolWriter from "./output-spool-writer"

import path from "path"
import { mkdirSync } from "node:fs"
import { rmSync } from "node:fs"
import { GlobalBus } from "@/bus/global"
import { FileSinkWriter } from "@/outputspool/file-sink-writer"
import { SpoolLayout } from "@/outputspool/spool-layout"
import type { ControlStore } from "@/outputspool/control-store"
import type { Channel, DurabilityTier } from "@opencode-ai/schema/outputspool/enums"

/** The default cap on concurrently open channel writers; the oldest is sealed + evicted past it (bounded memory). */
export const DEFAULT_MAX_OPEN_WRITERS = 512

const ENCODER = new TextEncoder()

/** The identity of one channel generation the writer drives (`groupId = partID`, one channel per part, C21). */
export interface ChannelKey {
  readonly groupId: string
  readonly generation: number
  readonly channel: Channel
  readonly outputRef: string
  readonly tier: DurabilityTier
}

/** The typed outcome of one guarded ingest — never a throw into the session loop (FR10, C22). */
export type IngestOutcome =
  | { readonly kind: "appended"; readonly committedBytes: number }
  | { readonly kind: "noop"; readonly committedBytes: number }
  | { readonly kind: "fenced" }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "error"; readonly reason: string }

export interface SessionSpoolWriterDeps {
  /** The real control store — the committed-length authority (same DB the operator reads). */
  readonly store: ControlStore.ControlStore
  /** The managed spool root; channel data files resolve under it (same root the operator reads). */
  readonly spoolRoot: string
  /** Injected clock (tests pin it); defaults to `Date.now`. */
  readonly now?: () => number
  /** Injected fsync surface; defaults to the live `node:fs` port. */
  readonly fsync?: FileSinkWriter.FsyncPort
  /** Injected sink opener (tests avoid disk); defaults to the Bun `FileSink` over the resolved data path. */
  readonly openSink?: (dataPath: string) => FileSinkWriter.ByteSink
  /** Cap on concurrently open writers; the oldest is sealed + evicted past it. */
  readonly maxOpenWriters?: number
}

/** The narrow shape of a session part snapshot the writer consumes (from `message.part.updated`). */
export interface SessionPartSnapshot {
  readonly id?: string
  readonly type?: string
  readonly text?: string
  readonly state?: { readonly status?: string; readonly output?: unknown }
}

export interface SessionSpoolWriter {
  /** Ingest one channel-generation text snapshot; opens/fences the generation, appends the new suffix, records committed. */
  readonly ingest: (key: ChannelKey, text: string) => Promise<IngestOutcome>
  /** Ingest a raw session part snapshot (derives the channel + text, then `ingest`). Fail-open. */
  readonly onPartUpdated: (part: SessionPartSnapshot) => Promise<IngestOutcome>
  /** Seal a channel generation (completed) — preserves committed bytes, then evicts the writer. */
  readonly seal: (outputRef: string) => Promise<void>
  /** Abort a channel generation (removed/cancelled) — preserves committed bytes, then evicts the writer. */
  readonly abort: (outputRef: string) => Promise<void>
  /** Best-effort seal of every open writer; sync (fire-and-forget the async seals). */
  readonly dispose: () => void
}

/** Map a session part type onto the closed OutputSpool channel; unknown/non-textual parts are skipped. */
export const deriveChannel = (partType: string | undefined): Channel | null => {
  switch (partType) {
    case "text":
      return "assistant-text"
    case "reasoning":
      return "reasoning"
    case "tool":
      return "tool-result"
    default:
      return null
  }
}

/** Every writer-driven channel is a durable textual channel (assistant-text/reasoning/tool-result, C2). */
export const channelTier = (_channel: Channel): DurabilityTier => "durable"

/** Extract the current full text of a part snapshot; undefined when the part carries no stable text yet. */
const extractText = (part: SessionPartSnapshot): string | undefined => {
  if (part.type === "text" || part.type === "reasoning") {
    return typeof part.text === "string" ? part.text : undefined
  }
  if (part.type === "tool") {
    // Only a COMPLETED tool with a string output is a stable textual snapshot.
    if (part.state?.status === "completed" && typeof part.state.output === "string") return part.state.output
    return undefined
  }
  return undefined
}

/** A completed part is terminal — its generation seals after the final ingest. */
const isTerminal = (part: SessionPartSnapshot): boolean =>
  part.type === "tool" && part.state?.status === "completed"

/** The channel data file path — MUST match the operator `defaultPageReader` join (backend-live.ts). */
const dataPathFor = (spoolRoot: string, key: ChannelKey): string =>
  path.join(spoolRoot, key.groupId, String(key.generation), key.channel, "data")

interface WriterEntry {
  readonly writer: FileSinkWriter.ChannelWriter
  readonly outputRef: string
}

/** True when a candidate id is a single valid spool path segment (never a traversal token). */
const isValidSegment = (segment: string): boolean => {
  try {
    SpoolLayout.validateSegment(segment)
    return true
  } catch {
    return false
  }
}

export const createSessionSpoolWriter = (deps: SessionSpoolWriterDeps): SessionSpoolWriter => {
  const now = deps.now ?? Date.now
  const fsync = deps.fsync ?? FileSinkWriter.nodeFsyncPort
  const openSink = deps.openSink ?? FileSinkWriter.openBunSink
  const maxOpen = deps.maxOpenWriters ?? DEFAULT_MAX_OPEN_WRITERS

  /** Open channel writers, plus fenced output refs (a stale generation never appends). Insertion-ordered. */
  const open = new Map<string, WriterEntry>()
  const fenced = new Set<string>()

  const evict = async (outputRef: string, mode: "seal" | "abort"): Promise<void> => {
    const entry = open.get(outputRef)
    if (!entry) return
    open.delete(outputRef)
    try {
      const committed = mode === "seal" ? await entry.writer.seal() : await entry.writer.abort()
      if (mode === "seal") deps.store.recordSeal(outputRef, String(committed), now())
      else deps.store.recordAbort(outputRef, now())
    } catch {
      // Fail open: a seal/abort/store error never breaks the session loop.
    }
  }

  /** Seal + evict the oldest open writer to keep the concurrent-writer set bounded. */
  const evictOldest = async (): Promise<void> => {
    const first = open.keys().next()
    if (!first.done) await evict(first.value, "seal")
  }

  const ensureEntry = (key: ChannelKey): WriterEntry | "fenced" | "error" => {
    const existing = open.get(key.outputRef)
    if (existing) return existing
    if (fenced.has(key.outputRef)) return "fenced"
    try {
      const outcome = deps.store.openGeneration({
        output_ref: key.outputRef,
        group_id: key.groupId,
        generation: key.generation,
        channel: key.channel,
        durability_tier: key.tier,
        correlation_id: key.outputRef,
        now: now(),
      })
      if (!outcome.accepted) {
        fenced.add(key.outputRef)
        return "fenced"
      }
    } catch {
      return "error"
    }
    let sink: FileSinkWriter.ByteSink
    try {
      const dataPath = dataPathFor(deps.spoolRoot, key)
      mkdirSync(path.dirname(dataPath), { recursive: true, mode: 0o700 })
      sink = openSink(dataPath)
    } catch {
      return "error"
    }
    const writer = FileSinkWriter.createChannelWriter({ path: dataPathFor(deps.spoolRoot, key), tier: key.tier, sink, fsync })
    const entry: WriterEntry = { writer, outputRef: key.outputRef }
    open.set(key.outputRef, entry)
    return entry
  }

  const ingest = async (key: ChannelKey, text: string): Promise<IngestOutcome> => {
    if (!isValidSegment(key.groupId) || !isValidSegment(key.channel))
      return { kind: "skipped", reason: "invalid segment" }
    try {
      // Bound the concurrent-writer set BEFORE opening a new generation.
      if (!open.has(key.outputRef) && !fenced.has(key.outputRef) && open.size >= maxOpen) await evictOldest()
      const entry = ensureEntry(key)
      if (entry === "fenced") return { kind: "fenced" }
      if (entry === "error") return { kind: "error", reason: "open failed" }

      const full = ENCODER.encode(text)
      const committed = entry.writer.committedBytes()
      if (full.length <= committed) return { kind: "noop", committedBytes: committed }
      const suffix = full.subarray(committed)
      const result = await entry.writer.append(committed, suffix)
      if (result.kind === "accepted") {
        const nextCommitted = entry.writer.committedBytes()
        deps.store.recordCommitted(key.outputRef, nextCommitted, now())
        return { kind: "appended", committedBytes: nextCommitted }
      }
      if (result.kind === "backpressure") return { kind: "skipped", reason: "backpressure" }
      return { kind: "noop", committedBytes: entry.writer.committedBytes() }
    } catch (e) {
      return { kind: "error", reason: String(e) }
    }
  }

  const onPartUpdated = async (part: SessionPartSnapshot): Promise<IngestOutcome> => {
    const partId = part.id
    if (!partId || !isValidSegment(partId)) return { kind: "skipped", reason: "no part id" }
    const channel = deriveChannel(part.type)
    if (!channel) return { kind: "skipped", reason: "non-textual part" }
    const text = extractText(part)
    if (text === undefined) return { kind: "skipped", reason: "no stable text" }
    const key: ChannelKey = {
      groupId: partId,
      generation: 0,
      channel,
      outputRef: partId,
      tier: channelTier(channel),
    }
    const outcome = await ingest(key, text)
    if (isTerminal(part)) await evict(partId, "seal")
    return outcome
  }

  return {
    ingest,
    onPartUpdated,
    seal: (outputRef) => evict(outputRef, "seal"),
    abort: (outputRef) => evict(outputRef, "abort"),
    dispose: () => {
      for (const outputRef of [...open.keys()]) void evict(outputRef, "seal")
    },
  }
}

/**
 * Subscribe a production spool writer to the session message-part seam through
 * the `GlobalBus` fan-out (`@/bus/global`), the process-wide mirror of the
 * `EventV2Bridge` stream `session.ts` publishes `message.part.updated` /
 * `message.part.removed` onto. The listener is GUARDED — a throw is swallowed so
 * a spool write never affects the session loop (FR6, FR10). Returns an
 * unsubscribe that also seals every open writer.
 */
export const subscribeSessionSpoolWriter = (deps: SessionSpoolWriterDeps): (() => void) => {
  const writer = createSessionSpoolWriter(deps)
  const handler = (event: { readonly payload?: { readonly type?: string; readonly properties?: unknown } }): void => {
    try {
      const payload = event.payload
      if (!payload || typeof payload !== "object") return
      const props = payload.properties as Record<string, unknown> | undefined
      if (payload.type === "message.part.updated") {
        const part = props?.part as SessionPartSnapshot | undefined
        if (part) void writer.onPartUpdated(part)
      } else if (payload.type === "message.part.removed") {
        const partID = props?.partID
        if (typeof partID === "string") void writer.abort(partID)
      }
    } catch {
      // Fail open: never let a bus listener throw affect the session.
    }
  }
  GlobalBus.on("event", handler as never)
  return () => {
    GlobalBus.off("event", handler as never)
    writer.dispose()
  }
}

/** Best-effort recursive removal of a channel subtree (used by the admin purge edge). Never throws. */
export const removeChannelData = (spoolRoot: string, groupId: string, generation: number, channel: string): void => {
  try {
    if (!isValidSegment(groupId) || !isValidSegment(channel)) return
    rmSync(path.join(spoolRoot, groupId, String(generation), channel), { recursive: true, force: true })
  } catch {
    // Best-effort — the control-store delete is the authority; a lingering file is swept later.
  }
}
