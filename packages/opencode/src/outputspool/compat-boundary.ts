/**
 * Feature 005 / T033 (S21) — the native streaming sink and the bounded
 * plugin/MCP/legacy compatibility boundary.
 *
 * Native tools and processes stream their output straight into an OutputSpool
 * channel from the first observable chunk, so process-local memory stays bounded
 * (FR7, FR35). A non-streaming plugin/MCP/legacy source that only yields a whole
 * value crosses the bounded compatibility boundary: it is spilled to the spool
 * BEFORE full LLM-facing materialization when the source allows, materialization
 * is capped at explicit size/time/memory limits, and the channel is marked
 * truncated/degraded past the caps — the result NEVER embeds a public filesystem
 * path (FR36, FR37, C11, AC13). This replaces the `tool-output-store.ts`
 * path-in-preview: a consumer receives a bounded preview and an OutputRef only.
 *
 * The channel sink and the preview builder are injected so the boundary is
 * deterministic under test; the live stack binds the `ChannelWriter`
 * (`file-sink-writer.ts`) and the Feature 007 SecretRef redactor.
 */
export * as CompatBoundary from "./compat-boundary"

/** Explicit materialization caps for a plugin/MCP/legacy source (provisional plan constants, C11, AC13). */
export interface AdapterCaps {
  readonly max_bytes: number
  readonly max_ms: number
  readonly max_preview_bytes: number
}

export const DEFAULT_ADAPTER_CAPS: AdapterCaps = {
  max_bytes: 8 * 1024 * 1024,
  max_ms: 30_000,
  max_preview_bytes: 4 * 1024,
}

/** The bounded, path-free result every boundary crossing returns (FR12, C18, C22). */
export interface CompatResult {
  readonly output_ref: string
  readonly committed_bytes: number
  /** Bounded redacted head slice; never a path, never full content (FR4, C8, C22). */
  readonly preview: string
  readonly truncated: boolean
  /** True when a cap forced the channel to degrade (FR36, C11, AC13). */
  readonly degraded: boolean
}

/** The injected channel sink: append bytes and seal, returning the committed length. */
export interface ChannelSink {
  readonly output_ref: string
  readonly append: (chunk: Uint8Array) => Promise<void> | void
  readonly seal: () => Promise<number> | number
}

/** A native streaming source yielding chunks (a tool/process stream). */
export interface StreamSource {
  readonly chunks: AsyncIterable<Uint8Array>
}

/** A non-streaming legacy source that only produces a whole value (plugin/MCP/legacy). */
export interface WholeSource {
  readonly value: () => Uint8Array | Promise<Uint8Array>
}

const boundedPreview = (bytes: Uint8Array, cap: number): { text: string; truncated: boolean } => {
  const slice = bytes.subarray(0, Math.max(0, cap))
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(slice), truncated: bytes.length > cap }
}

/**
 * Stream a native source into the channel sink from the first chunk. Bounded
 * memory: chunks are appended and released, never accumulated (FR7, FR35, AC1).
 */
export const streamInto = async (sink: ChannelSink, source: StreamSource, caps: AdapterCaps = DEFAULT_ADAPTER_CAPS): Promise<CompatResult> => {
  let head: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  let degraded = false
  let total = 0
  for await (const chunk of source.chunks) {
    total += chunk.length
    if (total > caps.max_bytes) degraded = true
    if (head.length < caps.max_preview_bytes) head = concatCapped(head, chunk, caps.max_preview_bytes)
    await sink.append(chunk)
  }
  const committed = await sink.seal()
  const preview = boundedPreview(head, caps.max_preview_bytes)
  return { output_ref: sink.output_ref, committed_bytes: committed, preview: preview.text, truncated: preview.truncated || total > head.length, degraded }
}

const concatCapped = (head: Uint8Array, tail: Uint8Array, cap: number): Uint8Array => {
  const room = cap - head.length
  if (room <= 0) return head
  const take = tail.subarray(0, room)
  const out = new Uint8Array(head.length + take.length)
  out.set(head, 0)
  out.set(take, head.length)
  return out
}

/**
 * Cross the bounded compatibility boundary for a whole-value legacy source:
 * spill to the spool under caps, mark degraded when over a cap, and return a
 * bounded preview plus OutputRef — never a path (FR36, FR37, C11, AC13).
 */
export const spillWhole = async (sink: ChannelSink, source: WholeSource, caps: AdapterCaps = DEFAULT_ADAPTER_CAPS): Promise<CompatResult> => {
  const started = Date.now()
  const value = await source.value()
  const overBytes = value.length > caps.max_bytes
  const overTime = Date.now() - started > caps.max_ms
  const spill = overBytes ? value.subarray(0, caps.max_bytes) : value
  await sink.append(spill)
  const committed = await sink.seal()
  const preview = boundedPreview(value, caps.max_preview_bytes)
  return { output_ref: sink.output_ref, committed_bytes: committed, preview: preview.text, truncated: preview.truncated, degraded: overBytes || overTime }
}
