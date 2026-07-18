import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Envelope } from "../../src/jobs/envelope"

// Feature 003 / T032 — packages/schema/src/jobs/envelope.ts mirrors
// doc/arch/schemas/jobs/envelope.cue and envelope-parts.cue one-to-one
// (FR12, C6, C16). JobEnvelope is the common carrier on every job.* event;
// process_id is null before the Task Process associates (C16); redacted
// metadata excludes prompts/results/payloads/paths/secrets (FR32).

const baseEnvelope = {
  event_id: "evt_abc123",
  kind: {
    event_type: "job.trigger_due",
    schema_version: 1,
    event_class: "live",
    source: "scheduler",
    actor_kind: "runtime",
    visibility: "session",
  },
  occurrence: {
    job_definition_id: "jdf_1",
    schedule_id: "sch_1",
    occurrence_id: "occ_1",
    process_id: null,
    attempt: 1,
    generation: 0,
  },
  tree: { root_session_id: "ses_root", session_id: null },
  ordering: { sequence: 0, correlation_id: "corr_1", causation_id: null },
  delivery: { visibility: "session", timestamp: 1_721_260_800_000, redacted_metadata: { origin: "scheduler" } },
}

describe("Envelope.JobEnvelope", () => {
  test("round-trips an envelope before the Task Process associates (process_id null, C16)", () => {
    const decoded = Schema.decodeUnknownSync(Envelope.JobEnvelope)(baseEnvelope)
    expect(Schema.encodeSync(Envelope.JobEnvelope)(decoded) as unknown).toEqual(baseEnvelope)
  })

  test("round-trips an envelope once the occurrence is associated with a Task Process and a session", () => {
    const associated = {
      ...baseEnvelope,
      occurrence: { ...baseEnvelope.occurrence, process_id: "prc_1" },
      tree: { root_session_id: "ses_root", session_id: "ses_1" },
    }
    const decoded = Schema.decodeUnknownSync(Envelope.JobEnvelope)(associated)
    expect(Schema.encodeSync(Envelope.JobEnvelope)(decoded) as unknown).toEqual(associated)
  })

  test("rejects an event_id without the evt_ prefix", () => {
    expect(() => Schema.decodeUnknownSync(Envelope.JobEnvelope)({ ...baseEnvelope, event_id: "abc123" })).toThrow()
  })

  test("rejects an out-of-vocabulary event_type", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.JobEnvelope)({
        ...baseEnvelope,
        kind: { ...baseEnvelope.kind, event_type: "job.paused" },
      }),
    ).toThrow()
  })

  test("rejects an out-of-vocabulary visibility", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.JobEnvelope)({
        ...baseEnvelope,
        delivery: { ...baseEnvelope.delivery, visibility: "public" },
      }),
    ).toThrow()
  })

  test("rejects an attempt below one", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.JobEnvelope)({
        ...baseEnvelope,
        occurrence: { ...baseEnvelope.occurrence, attempt: 0 },
      }),
    ).toThrow()
  })

  test("rejects a missing required occurrence sub-object", () => {
    const { occurrence: _occurrence, ...incomplete } = baseEnvelope
    expect(() => Schema.decodeUnknownSync(Envelope.JobEnvelope)(incomplete)).toThrow()
  })

  test("rejects redacted_metadata carrying a non-string value (bounded record, FR32)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Envelope.JobEnvelope)({
        ...baseEnvelope,
        delivery: { ...baseEnvelope.delivery, redacted_metadata: { origin: 42 } },
      }),
    ).toThrow()
  })
})
