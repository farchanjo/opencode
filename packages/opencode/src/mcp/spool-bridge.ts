/**
 * Feature 008 / T028 (S18) — the OutputSpool content bridge for every `tools/call`
 * and `resources/read`.
 *
 * Routes every call/read result through a Feature 005 OutputGroup, delivering a
 * BOUNDED preview + OutputRef only (never a filesystem path). Base64/data-URL
 * content is decoded and spooled under the Feature 008 MIME allowlist + size caps
 * (full data URLs never enter model context). The spill is HONEST: the SDK parses
 * the final result in RAM, so this is a post-parse spill (`ramSpillApplied: true`)
 * — zero-RAM is never promised (FR33, FR34, FR35, FR36, FR37, C16, C17). Pure over
 * the injected Feature 005 `SpoolPort`; the size/MIME/decompression caps live in
 * that port so this bridge never itself buffers an unbounded body.
 */
export * as McpSpoolBridge from "./spool-bridge"

import { Effect } from "effect"
import type {
  ContentKind,
  ContentProvenance,
  McpContentEnvelope,
  OutputRef,
  ServerId,
} from "@opencode-ai/protocol/mcp/commands"
import type { SpoolError, SpoolPort } from "@opencode-ai/protocol/mcp/ports"

export interface SpoolBridgeDeps {
  readonly spool: SpoolPort
  /** Untrusted by default; the operator trust profile may elevate provenance upstream (C6, C26). */
  readonly provenance?: ContentProvenance
}

/** A decoded content descriptor extracted from an SDK result item; never carries the body forward. */
export interface DecodedContent {
  readonly kind: ContentKind
  readonly mimeType?: string
  readonly byteLength: number
}

const DATA_URL = /^data:([^;,]+)?(;base64)?,(.*)$/s

/**
 * Extract a content descriptor (kind + mime + byteLength) from a raw SDK content
 * item. A data URL or base64 blob is measured, never inlined; the decoded byte
 * length is what the size cap gates. Pure and content-free at the boundary (C16).
 */
export function describeContent(item: {
  readonly type?: string
  readonly text?: string
  readonly data?: string
  readonly mimeType?: string
  readonly uri?: string
}): DecodedContent {
  const kind = normalizeKind(item.type)
  if (typeof item.data === "string") {
    const match = DATA_URL.exec(item.data)
    const base64 = match ? match[3] : item.data
    return { kind, mimeType: match?.[1] ?? item.mimeType, byteLength: base64Bytes(base64) }
  }
  if (typeof item.text === "string") return { kind, mimeType: item.mimeType ?? "text/plain", byteLength: utf8Bytes(item.text) }
  return { kind, mimeType: item.mimeType, byteLength: 0 }
}

function normalizeKind(type: string | undefined): ContentKind {
  switch (type) {
    case "image": return "image"
    case "audio": return "audio"
    case "resource": return "resource"
    case "resource_link": return "resource_link"
    default: return "text"
  }
}

/** Decoded byte length of a base64 payload without materializing it into model context. */
function base64Bytes(base64: string): number {
  const clean = base64.replace(/=+$/, "")
  return Math.floor((clean.length * 3) / 4)
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

export interface SpoolBridge {
  /**
   * Spool one decoded content descriptor into a Feature 005 OutputGroup and return
   * a bounded content envelope (preview bytes + OutputRef, never a path). The MIME
   * allowlist + size caps + decompression-bomb limit are enforced by the injected
   * `SpoolPort` and surface as typed `SpoolError`s (C16, C17, C24).
   */
  readonly spoolContent: (
    serverId: ServerId,
    content: DecodedContent,
  ) => Effect.Effect<McpContentEnvelope, SpoolError>
}

/** Build the spool bridge over the injected Feature 005 SpoolPort (C16). */
export const createSpoolBridge = (deps: SpoolBridgeDeps): SpoolBridge => ({
  spoolContent: (serverId, content) =>
    deps.spool
      .spool({ serverId, mimeType: content.mimeType, byteLength: content.byteLength })
      .pipe(
        Effect.map(
          (receipt): McpContentEnvelope => ({
            kind: content.kind,
            outputRef: receipt.outputRef as OutputRef,
            previewBytes: receipt.previewBytes,
            mimeType: content.mimeType,
            provenance: deps.provenance ?? receipt.provenance,
            ramSpillApplied: true, // honest post-parse spill; zero-RAM never promised (C16)
          }),
        ),
      ),
})
