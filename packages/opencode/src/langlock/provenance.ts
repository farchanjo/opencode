/**
 * Feature 004 / T031 (S19) — Feature 005 provenance attachment seam.
 *
 * Attaches the Feature-005-owned Lang Lock tag / version / provenance to a
 * textual `OutputRef`'s metadata READ from the trusted execution envelope
 * (`ExecutionStamp`) — Lang Lock never recomputes the language and never exports
 * raw content (FR30, C9, AC14). The provenance is derived purely from the
 * start-time stamp the envelope-stamper (T027) captured: the effective tag, the
 * policy/config versions, the origin, and the opaque Feature 005 `output_ref`.
 * Feature 005 owns the output bytes; this seam only reads bounded, content-free
 * fields off the envelope and hands them back for attachment.
 *
 * Pure and framework-free: no detection, no I/O, no model call. A stamp whose
 * `tree.output_ref` is null carries no textual channel, so no provenance is
 * produced (the seam never invents an output reference).
 */
export * as LangLockProvenance from "./provenance"

import type { ExecutionEnvelope } from "@opencode-ai/schema/langlock/execution-envelope"
import type { Origin } from "@opencode-ai/schema/langlock/enums"

/**
 * The content-free provenance attached to a Feature 005 textual `OutputRef`
 * (FR30, C9). Every field is read from the trusted envelope, never recomputed;
 * `source` records that the values came from the envelope, not from a Lang Lock
 * detection pass.
 */
export interface OutputProvenance {
  /** The opaque Feature 005 output reference the provenance attaches to (C9). */
  readonly outputRef: string
  readonly tag: string
  readonly policyVersion: number
  readonly configVersion: number
  readonly origin: Origin
  /** The provenance was read from the trusted execution envelope, not recomputed (FR30). */
  readonly source: "envelope"
}

/**
 * Read the Feature 005 output provenance off a trusted `ExecutionStamp` (FR30,
 * C9, AC14). Returns `null` when the stamp carries no textual channel
 * (`tree.output_ref === null`) — the seam never fabricates an output reference
 * and never recomputes the language. Deterministic, content-free, and total.
 */
export function readProvenanceFromEnvelope(
  stamp: ExecutionEnvelope.ExecutionStamp,
): OutputProvenance | null {
  const outputRef = stamp.tree.output_ref
  if (outputRef === null) return null
  return {
    outputRef: String(outputRef),
    tag: String(stamp.language.tag),
    policyVersion: stamp.language.policy_version,
    configVersion: stamp.language.config_version,
    origin: stamp.provenance.origin,
    source: "envelope",
  }
}
