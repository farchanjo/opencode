import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Envelope } from "../../src/langlock/envelope"
import { Detection } from "../../src/langlock/detection"
import { Effective } from "../../src/langlock/effective"

// Feature 004 / T038 (S20) — envelope and record redaction (Security 5,
// Observability, C8, AC14). No langlock.* struct exposes a content-bearing field:
// no prompt, message, path, diff, snippet, result, payload, secret, or free-form
// text. The envelope carries only bounded enums, opaque ids, and a redacted
// key/value metadata map; the detection record's detected_tag is nullable and no
// raw confidence score is present.

// Content-bearing field names that MUST NEVER appear on a langlock.* schema.
const FORBIDDEN_FIELDS = new Set([
  "prompt",
  "message",
  "path",
  "file",
  "file_path",
  "diff",
  "snippet",
  "content",
  "text",
  "body",
  "result_text",
  "payload",
  "secret",
  "token",
  "score",
  "raw_score",
  "confidence_score",
])

const structs: ReadonlyArray<{ name: string; fields: Record<string, unknown> }> = [
  { name: "Envelope.EventKind", fields: Envelope.EventKind.fields },
  { name: "Envelope.ActorContext", fields: Envelope.ActorContext.fields },
  { name: "Envelope.Ordering", fields: Envelope.Ordering.fields },
  { name: "Envelope.Delivery", fields: Envelope.Delivery.fields },
  { name: "Envelope.LangLockEnvelope", fields: Envelope.LangLockEnvelope.fields },
  { name: "Detection.DetectorClassification", fields: Detection.DetectorClassification.fields },
  { name: "Detection.DetectorResult", fields: Detection.DetectorResult.fields },
  { name: "Detection.AdvisoryRecord", fields: Detection.AdvisoryRecord.fields },
  { name: "Effective.EffectiveConfig", fields: Effective.EffectiveConfig.fields },
]

describe("langlock.* struct redaction — no content-bearing field (Security 5, AC14)", () => {
  for (const { name, fields } of structs) {
    test(`${name} exposes no content-bearing field`, () => {
      for (const key of Object.keys(fields)) {
        expect(FORBIDDEN_FIELDS.has(key)).toBe(false)
      }
    })
  }
})

describe("Envelope.Delivery — bounded redacted metadata only (Security 5)", () => {
  test("redacted_metadata is a bounded string/string record, not a payload blob", () => {
    const delivery = {
      execution_id: "exec_1",
      timestamp: 1_721_260_800_000,
      redacted_metadata: { origin: "operator" },
    }
    const decoded = Schema.decodeUnknownSync(Envelope.Delivery)(delivery)
    expect(Schema.encodeSync(Envelope.Delivery)(decoded) as unknown).toEqual(delivery)
  })
})

describe("Detection.DetectorResult — content-free advisory outcome (FR21, C5, AC14)", () => {
  test("detected_tag is nullable — null on an unknown/failed detection", () => {
    const result = {
      classification: { path_kind: "prose_markdown", provenance: "heuristic", confidence: "high" },
      policy_version: 1,
      remediation: "flagged",
      detected_tag: null,
    }
    const decoded = Schema.decodeUnknownSync(Detection.DetectorResult)(result)
    expect(decoded.detected_tag).toBeNull()
  })

  test("confidence is a bounded bucket, never a raw numeric score", () => {
    const bad = {
      classification: { path_kind: "prose_markdown", provenance: "heuristic", confidence: 0.97 },
      policy_version: 1,
      remediation: "none",
      detected_tag: "en-US",
    }
    expect(() => Schema.decodeUnknownSync(Detection.DetectorResult)(bad)).toThrow()
  })
})
