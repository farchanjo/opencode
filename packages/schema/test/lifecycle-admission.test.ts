import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Admission } from "../src/lifecycle/admission"

const validBucket = {
  scope: "session",
  bucket: { capacity: 8, available: 8, refill_per_second: 8 },
  fenced: false,
}

const validSignals = {
  cpu_saturation: 0.5,
  mem_saturation: 0.2,
  provider_saturation: 0.9,
  sqlite_saturation: 0.1,
  event_queue_saturation: 0,
  otel_queue_saturation: 1,
}

const validResult = {
  scope: "child",
  decision: "partial",
  fanout: { requested: 6, granted: 3 },
  reason: "capacity ceiling",
}

describe("Admission.AdmissionBucket", () => {
  test("round-trips a valid bucket", () => {
    const decoded = Schema.decodeUnknownSync(Admission.AdmissionBucket)(validBucket)
    expect(decoded as unknown).toEqual(validBucket)
    expect(Schema.encodeSync(Admission.AdmissionBucket)(decoded) as unknown).toEqual(validBucket)
  })

  test("rejects a zero capacity (hard ceiling is strictly positive)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Admission.AdmissionBucket)({
        ...validBucket,
        bucket: { ...validBucket.bucket, capacity: 0 },
      }),
    ).toThrow()
  })

  test("accepts a zero available fill (non-negative, not strictly positive)", () => {
    const decoded = Schema.decodeUnknownSync(Admission.AdmissionBucket)({
      ...validBucket,
      bucket: { ...validBucket.bucket, available: 0 },
    })
    expect(decoded.bucket.available).toBe(0)
  })

  test("rejects a scope outside the closed AdmissionScope union", () => {
    expect(() => Schema.decodeUnknownSync(Admission.AdmissionBucket)({ ...validBucket, scope: "workspace" })).toThrow()
  })
})

describe("Admission.CapacitySignals", () => {
  test("round-trips saturation across the closed [0,1] interval", () => {
    expect(Schema.decodeUnknownSync(Admission.CapacitySignals)(validSignals) as unknown).toEqual(validSignals)
  })

  test("rejects a saturation above 1.0", () => {
    expect(() =>
      Schema.decodeUnknownSync(Admission.CapacitySignals)({ ...validSignals, cpu_saturation: 1.5 }),
    ).toThrow()
  })
})

describe("Admission.AdmissionResult", () => {
  test("round-trips a valid result", () => {
    expect(Schema.decodeUnknownSync(Admission.AdmissionResult)(validResult) as unknown).toEqual(validResult)
  })

  test("accepts every AdmissionDecision member and rejects an outsider", () => {
    for (const decision of ["granted", "partial", "queued", "rejected"] as const) {
      expect(Schema.decodeUnknownSync(Admission.AdmissionResult)({ ...validResult, decision }).decision).toBe(decision)
    }
    expect(() => Schema.decodeUnknownSync(Admission.AdmissionResult)({ ...validResult, decision: "deferred" })).toThrow()
  })
})
