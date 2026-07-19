/**
 * Pure edit-modal pre-fill descriptor (Feature 015 T011, FR9, FR10). Maps an
 * editable Configure verb to the read command whose effective payload carries its
 * current value, plus a TOTAL extraction of that value into the string an edit
 * field seeds with. No I/O, no solid-js — the modal supplies the runtime port and
 * dispatches the read; this module only says which read to issue and how to pull
 * the current value out of its already-redacted effective.
 *
 * An honest absence (no descriptor, or a read that carries no effective) yields
 * `undefined`, which the modal renders as an empty field with a placeholder — never
 * a fabricated default (FR10). A secret-bearing field is never pre-filled from a
 * resolved value; its reference stays a `SecretRef` the operator re-enters (FR15).
 */
import { isRecord } from "../projection"

/** The read + extraction that seeds one editable verb's field from its current value (FR9). */
export type OperatorEditPrefill = {
  /** Canonical read command id issued (silently) to fetch the current value. */
  readonly readId: string
  /** Total extraction of the current value string from the read's effective payload. */
  readonly extract: (effective: unknown) => string | undefined
}

/** Extract a top-level string field from an effective record, or `undefined` when absent. */
function stringField(effective: unknown, key: string): string | undefined {
  if (isRecord(effective) && typeof effective[key] === "string") return effective[key]
  return undefined
}

/** Extract a top-level nested object and re-serialise it as compact JSON, or `undefined` when absent. */
function jsonField(effective: unknown, key: string): string | undefined {
  if (isRecord(effective) && isRecord(effective[key])) return JSON.stringify(effective[key])
  return undefined
}

/**
 * Pre-fill descriptors keyed by canonical Configure verb id (FR9). Only verbs
 * whose current value has a well-defined, redacted read projection are listed; a
 * verb absent here opens with an empty field + placeholder (honest absence, FR10),
 * and every secret-bearing verb (`semantic.provider.rotate-secret`, credential
 * fields) is intentionally omitted so no resolved secret is ever seeded (FR15).
 */
const EDIT_PREFILL: Readonly<Record<string, OperatorEditPrefill>> = {
  // langlock.set — the current artifact-language tag from the redacted policy summary.
  "langlock.set": { readId: "langlock.status", extract: (eff) => stringField(eff, "tag") },
  // output policy setters — the current retention/quota objects re-serialised as JSON.
  "output.retention.set": { readId: "output.stat", extract: (eff) => jsonField(eff, "retention") },
  "output.quota.set": { readId: "output.stat", extract: (eff) => jsonField(eff, "quota") },
}

/** Resolve the pre-fill descriptor for an editable verb, or `undefined` for an honest empty field (FR10). */
export function resolveOperatorEditPrefill(id: string): OperatorEditPrefill | undefined {
  return EDIT_PREFILL[id]
}
