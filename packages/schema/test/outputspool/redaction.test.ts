import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Envelope } from "../../src/outputspool/envelope"
import { Preview } from "../../src/outputspool/preview"
import { Stat } from "../../src/outputspool/stat"
import { Page } from "../../src/outputspool/page"

// Feature 005 / T041 (S27) — envelope, preview and stat redaction (Security 5,
// Observability, C8, C22, AC18). No output.* struct exposes a content-bearing
// field: no prompt, message, path, diff, snippet, result, payload, secret, or
// free-form content. The envelope carries only bounded enums, opaque ids, and a
// redacted key/value metadata map; the preview carries a SecretRef list and no
// raw secret; stat carries no path and no content.

// Content-bearing field names that MUST NEVER appear on an output.* schema.
const FORBIDDEN_FIELDS = new Set([
  "prompt",
  "message",
  "path",
  "file",
  "file_path",
  "filepath",
  "dir",
  "directory",
  "diff",
  "snippet",
  "content",
  "body",
  "result_text",
  "payload",
  "secret",
  "secret_value",
  "token",
  "reasoning",
])

const structs: ReadonlyArray<{ name: string; fields: Record<string, unknown> }> = [
  { name: "Envelope.EventKind", fields: Envelope.EventKind.fields },
  { name: "Envelope.EventSubject", fields: Envelope.EventSubject.fields },
  { name: "Envelope.Ordering", fields: Envelope.Ordering.fields },
  { name: "Envelope.Delivery", fields: Envelope.Delivery.fields },
  { name: "Envelope.OutputEnvelope", fields: Envelope.OutputEnvelope.fields },
  { name: "Preview.BoundedPreview", fields: Preview.BoundedPreview.fields },
  { name: "Stat.StatProvenance", fields: Stat.StatProvenance.fields },
  { name: "Stat.OutputStat", fields: Stat.OutputStat.fields },
  { name: "Page.ReadPage", fields: Page.ReadPage.fields },
  { name: "Page.ReadRequest", fields: Page.ReadRequest.fields },
]

describe("output.* struct redaction — no content-bearing field (Security 5, C22, AC18)", () => {
  for (const { name, fields } of structs) {
    test(`${name} exposes no content-bearing field`, () => {
      for (const key of Object.keys(fields)) {
        expect(FORBIDDEN_FIELDS.has(key)).toBe(false)
      }
    })
  }
})

describe("Envelope.Delivery — bounded redacted metadata only (Security 5, C22)", () => {
  test("redacted_metadata is a bounded string/string record, not a payload blob", () => {
    const delivery = {
      visibility: "session",
      timestamp: 1_721_260_800_000,
      redacted_metadata: { origin: "runtime" },
    }
    const decoded = Schema.decodeUnknownSync(Envelope.Delivery)(delivery)
    expect(Schema.encodeSync(Envelope.Delivery)(decoded) as unknown).toEqual(delivery)
  })

  test("actor_kind admits only runtime/operator — never an LLM actor (FR41, C22)", () => {
    for (const actor of ["runtime", "operator"] as const) {
      const kind = {
        event_type: "output.channel_sealed",
        schema_version: 1,
        event_class: "durable",
        source: "writer",
        actor_kind: actor,
        visibility: "session",
      }
      expect(Schema.decodeUnknownSync(Envelope.EventKind)(kind).actor_kind).toBe(actor)
    }
    const bad = {
      event_type: "output.channel_sealed",
      schema_version: 1,
      event_class: "durable",
      source: "writer",
      actor_kind: "assistant",
      visibility: "session",
    }
    expect(() => Schema.decodeUnknownSync(Envelope.EventKind)(bad)).toThrow()
  })
})

describe("Preview.BoundedPreview — SecretRef list, never raw secret (FR5, C22)", () => {
  test("carries a secrets list and a bounded head, no inline plaintext secret field", () => {
    const preview = {
      content_type: "text/plain",
      byte_cap: 4096,
      line_cap: 64,
      head: "bounded head slice",
      secrets: ["secret_ref_1"],
    }
    const decoded = Schema.decodeUnknownSync(Preview.BoundedPreview)(preview)
    expect(decoded.secrets).toHaveLength(1)
    expect(Object.keys(Preview.BoundedPreview.fields)).not.toContain("secret")
  })
})
