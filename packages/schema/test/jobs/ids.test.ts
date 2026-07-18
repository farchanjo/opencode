import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Correlation } from "../../src/jobs/correlation"
import { Ids } from "../../src/jobs/ids"

// Feature 003 / T032 — packages/schema/src/jobs/ids.ts and correlation.ts
// mirror doc/arch/schemas/jobs/ids.cue and correlation.cue one-to-one (FR1,
// FR12, C1, C6, C16). process_id is the Feature 002 Task Process id, never an
// OS PID.

describe("Ids.JobDefinitionId / ScheduleId / OccurrenceId", () => {
  test("accepts an alphanumeric id within the length bound and round-trips through encode", () => {
    for (const [schema, value] of [
      [Ids.JobDefinitionId, "jdf_abc-123"],
      [Ids.ScheduleId, "sch_abc-123"],
      [Ids.OccurrenceId, "occ_abc-123"],
    ] as const) {
      const decoded = Schema.decodeUnknownSync(schema)(value)
      expect(decoded).toBe(schema.make(value))
      expect(Schema.encodeSync(schema)(decoded)).toBe(value)
    }
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Ids.JobDefinitionId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.ScheduleId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.OccurrenceId)("")).toThrow()
  })

  test("rejects an id with characters outside the pattern", () => {
    expect(() => Schema.decodeUnknownSync(Ids.JobDefinitionId)("jdf/abc:123")).toThrow()
  })

  test("rejects an id longer than 128 characters", () => {
    expect(() => Schema.decodeUnknownSync(Ids.JobDefinitionId)("a".repeat(129))).toThrow()
  })
})

describe("Ids.ProcessId / RootProcessId", () => {
  test("accepts an alphanumeric id — the Feature 002 Task Process id, never an OS PID (C16)", () => {
    expect(Schema.decodeUnknownSync(Ids.ProcessId)("prc_abc-123")).toBe(Ids.ProcessId.make("prc_abc-123"))
    expect(Schema.decodeUnknownSync(Ids.RootProcessId)("prc_root-1")).toBe(Ids.RootProcessId.make("prc_root-1"))
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Ids.ProcessId)("")).toThrow()
  })
})

describe("Ids.SessionId / ParentSessionId / RootSessionId", () => {
  test("accepts an alphanumeric id within the length bound", () => {
    expect(Schema.decodeUnknownSync(Ids.SessionId)("ses_abc-123")).toBe(Ids.SessionId.make("ses_abc-123"))
    expect(Schema.decodeUnknownSync(Ids.ParentSessionId)("ses_parent-1")).toBe(
      Ids.ParentSessionId.make("ses_parent-1"),
    )
    expect(Schema.decodeUnknownSync(Ids.RootSessionId)("ses_root-1")).toBe(Ids.RootSessionId.make("ses_root-1"))
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Ids.SessionId)("")).toThrow()
  })
})

describe("Ids.NotificationId", () => {
  test("accepts a valid ntf_ prefixed id and round-trips", () => {
    const decoded = Schema.decodeUnknownSync(Ids.NotificationId)("ntf_abc-123")
    expect(decoded).toBe(Ids.NotificationId.make("ntf_abc-123"))
    expect(Schema.encodeSync(Ids.NotificationId)(decoded)).toBe("ntf_abc-123")
  })

  test("rejects an id without the ntf_ prefix", () => {
    expect(() => Schema.decodeUnknownSync(Ids.NotificationId)("abc-123")).toThrow()
  })

  test("rejects an id longer than 120 characters after the prefix", () => {
    expect(() => Schema.decodeUnknownSync(Ids.NotificationId)("ntf_" + "a".repeat(121))).toThrow()
  })
})

describe("Ids.EventId", () => {
  test("accepts a valid evt_ prefixed id and round-trips", () => {
    const decoded = Schema.decodeUnknownSync(Ids.EventId)("evt_abc-123")
    expect(decoded).toBe(Ids.EventId.make("evt_abc-123"))
    expect(Schema.encodeSync(Ids.EventId)(decoded)).toBe("evt_abc-123")
  })

  test("rejects an id without the evt_ prefix", () => {
    expect(() => Schema.decodeUnknownSync(Ids.EventId)("abc-123")).toThrow()
  })
})

describe("Correlation.CorrelationId / CausationId", () => {
  test("accepts an alphanumeric id and round-trips", () => {
    const decoded = Schema.decodeUnknownSync(Correlation.CorrelationId)("corr_1")
    expect(Schema.encodeSync(Correlation.CorrelationId)(decoded)).toBe("corr_1")
    expect(Schema.decodeUnknownSync(Correlation.CausationId)("caus_1")).toBe(Correlation.CausationId.make("caus_1"))
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Correlation.CorrelationId)("")).toThrow()
  })
})

describe("Correlation.DecisionId — Feature 001 routing parity (ULID, C11)", () => {
  test("accepts a valid 26-character Crockford-base32 ULID", () => {
    const decoded = Schema.decodeUnknownSync(Correlation.DecisionId)("01ARZ3NDEKTSV4RRFFQ69G5FAV")
    expect(Schema.encodeSync(Correlation.DecisionId)(decoded)).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV")
  })

  test("rejects a non-ULID string", () => {
    expect(() => Schema.decodeUnknownSync(Correlation.DecisionId)("not-a-ulid")).toThrow()
  })
})

describe("Correlation.TurnId", () => {
  test("accepts an alphanumeric id", () => {
    expect(Schema.decodeUnknownSync(Correlation.TurnId)("trn_1")).toBe(Correlation.TurnId.make("trn_1"))
  })
})

describe("Correlation opaque secure-reference ValueObjects (Security 3, C10)", () => {
  test("Principal / SecretRef / PayloadRef / OutputRef / ProjectRef / TodoRef accept a non-empty opaque handle", () => {
    for (const schema of [
      Correlation.Principal,
      Correlation.SecretRef,
      Correlation.PayloadRef,
      Correlation.OutputRef,
      Correlation.ProjectRef,
      Correlation.TodoRef,
    ]) {
      const decoded = Schema.decodeUnknownSync(schema)("opaque-handle-1")
      expect(Schema.encodeSync(schema)(decoded)).toBe("opaque-handle-1")
    }
  })

  test("rejects an empty opaque handle on every reference ValueObject", () => {
    for (const schema of [
      Correlation.Principal,
      Correlation.SecretRef,
      Correlation.PayloadRef,
      Correlation.OutputRef,
      Correlation.ProjectRef,
      Correlation.TodoRef,
    ]) {
      expect(() => Schema.decodeUnknownSync(schema)("")).toThrow()
    }
  })

  test("SecretRef never accepts a structured/raw secret value — opaque string only", () => {
    expect(() => Schema.decodeUnknownSync(Correlation.SecretRef)({ raw: "sk-live-abc" } as unknown as string)).toThrow()
  })
})
