import { fallback, isRecord, yesNo } from "../operator/output"

/**
 * Feature 005 / T038 (S26) — human renderers for the `opencode output`
 * command surface (`stat`/`read`/`follow`/`release`/`delete`/`purge`/
 * `export`/`share`/`retention set`/`quota set`). Pure string builders over
 * the redacted `SpoolReaderPort`/`RetentionPort`/`AdminPort` response views
 * (`@opencode-ai/protocol/outputspool/commands`). No renderer ever touches
 * process streams so they stay unit-testable, and no renderer ever makes a
 * model call or prints a filesystem path — a page only ever carries bytes,
 * offsets and cursors (FR12, FR41, C18, C22).
 */

/** Bounded preview cap for decoded page text (mirrors compat-boundary's max_preview_bytes, C22). */
export const MAX_PREVIEW_BYTES = 4096

/**
 * Decode a `ReadPage.bytes` wire value into bounded UTF-8 text.
 *
 * The operator JSON transport carries the page payload verbatim; depending on
 * the serialization hop a `Uint8Array` may arrive as a real typed array, a
 * plain numeric array, a numeric-keyed record (the default
 * `JSON.stringify(Uint8Array)` shape), or already-decoded text. This decoder
 * tolerates all four so the CLI renders content instead of erroring on a
 * wire-shape mismatch; it never assumes a filesystem path is present because
 * none exists on `ReadPage` (FR12, C18).
 */
export function decodeBoundedText(bytes: unknown): { text: string; truncated: boolean } {
  const buffer = toByteArray(bytes)
  if (buffer === undefined) return { text: typeof bytes === "string" ? bytes : "", truncated: false }
  const bounded = buffer.length > MAX_PREVIEW_BYTES ? buffer.subarray(0, MAX_PREVIEW_BYTES) : buffer
  return { text: new TextDecoder().decode(bounded), truncated: buffer.length > MAX_PREVIEW_BYTES }
}

function toByteArray(bytes: unknown): Uint8Array | undefined {
  if (bytes instanceof Uint8Array) return bytes
  if (Array.isArray(bytes)) return Uint8Array.from(bytes.map((value) => Number(value) || 0))
  if (isRecord(bytes)) {
    const values = Object.keys(bytes)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => Number(bytes[key]) || 0)
    return values.length > 0 ? Uint8Array.from(values) : undefined
  }
  return undefined
}

/** Render a single `OutputStat`-shaped payload (`output.stat`). */
export function renderStat(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`output ${String(effective.outputRef ?? "-")}: ${String(effective.channel ?? "-")}`]
  lines.push(`state: ${String(effective.state ?? "-")}  durability: ${String(effective.fsyncTier ?? "-")}`)
  lines.push(`committed bytes: ${String(effective.committedBytes ?? "-")}`)
  if (effective.languageTag) lines.push(`language: ${String(effective.languageTag)}`)
  lines.push(`updated: ${String(effective.updatedAt ?? "-")}`)
  return lines.join("\n")
}

function pageLines(page: unknown): string[] {
  if (!isRecord(page)) return [fallback(page)]
  const { text, truncated } = decodeBoundedText(page.bytes)
  const lines = text.length ? [text] : ["(empty page)"]
  if (truncated) lines.push(`... (truncated to ${MAX_PREVIEW_BYTES} bytes)`)
  lines.push(
    `next offset: ${String(page.nextOffset ?? "-")}  committed: ${String(page.committedBytes ?? "-")}  caught up: ${yesNo(page.caughtUp)}  eof: ${yesNo(page.eof)}`,
  )
  return lines
}

/** Render a single `ReadPage`-shaped payload (`output.read`). */
export function renderPage(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  return pageLines(effective.page).join("\n")
}

/** Render a `{ page, cursor }`-shaped payload (`output.follow`); the cursor resumes on reconnect. */
export function renderFollowFrame(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = pageLines(effective.page)
  lines.push(`cursor: ${String(effective.cursor ?? "-")}`)
  return lines.join("\n")
}

/** Shared renderer for `release`/`delete`/`purge` (`{ outputRef, auditId }`). */
export function renderRefAudit(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`output: ${String(effective.outputRef ?? "-")}`]
  if (effective.remainingEdgeCount !== undefined) lines.push(`remaining edges: ${String(effective.remainingEdgeCount)}`)
  if (effective.auditId) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

/** Render an `ExportOutput`-shaped payload (`output.export`); the preview is bounded and content-free. */
export function renderExport(effective: unknown): string {
  if (!isRecord(effective) || !isRecord(effective.preview)) return fallback(effective)
  const preview = effective.preview
  const lines = [`output: ${String(preview.outputRef ?? "-")}`]
  lines.push(String(preview.headSlice ?? ""))
  if (preview.truncated === true) lines.push("... (truncated)")
  if (Array.isArray(preview.secretRefs) && preview.secretRefs.length > 0) lines.push(`secret refs: ${preview.secretRefs.length}`)
  if (effective.auditId) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

/** Render a `ShareOutput`-shaped payload (`output.share`). */
export function renderShare(effective: unknown): string {
  if (!isRecord(effective)) return fallback(effective)
  const lines = [`share ref: ${String(effective.shareRef ?? "-")}`]
  if (effective.auditId) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

/** Render a `SetRetentionOutput`-shaped payload (`output.retention.set`). */
export function renderRetention(effective: unknown): string {
  if (!isRecord(effective) || !isRecord(effective.retention)) return fallback(effective)
  const retention = effective.retention
  const lines = [`ttl seconds: ${String(retention.ttlSeconds ?? "-")}`]
  lines.push(`live lease: ${yesNo(retention.hasLiveLease)}  active reader/writer: ${yesNo(retention.hasActiveReaderOrWriter)}`)
  const edges = Array.isArray(retention.referenceEdgeKinds) ? retention.referenceEdgeKinds : []
  lines.push(`reference edges: ${edges.length ? edges.join(", ") : "(none)"}`)
  lines.push(`legal hold: ${yesNo(retention.legalHold)}`)
  if (effective.auditId) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

/** Render a `SetQuotaOutput`-shaped payload (`output.quota.set`). */
export function renderQuota(effective: unknown): string {
  if (!isRecord(effective) || !isRecord(effective.quota)) return fallback(effective)
  const quota = effective.quota
  const lines = [`quota scope: ${String(quota.scope ?? "-")} (${String(quota.scopeId ?? "-")})`]
  lines.push(`max bytes: ${String(quota.maxBytes ?? "-")}  max queue depth bytes: ${String(quota.maxQueueDepthBytes ?? "-")}`)
  if (effective.auditId) lines.push(`audit id: ${String(effective.auditId)}`)
  return lines.join("\n")
}

export * as OutputRender from "./render"
