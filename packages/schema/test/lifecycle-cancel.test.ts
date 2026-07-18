import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Cancel } from "../src/lifecycle/cancel"

const validScope = { root_session_id: "rs1", root_process_id: "rp1", press: "first" }

const validRecord = {
  scope: validScope,
  outcome: "requested",
  fenced_descendants: true,
  reason: "operator ctrl+c",
}

describe("Cancel.RootCancelScope", () => {
  test("accepts the first and second press and rejects any other", () => {
    for (const press of ["first", "second"] as const) {
      expect(Schema.decodeUnknownSync(Cancel.RootCancelScope)({ ...validScope, press }).press).toBe(press)
    }
    expect(() => Schema.decodeUnknownSync(Cancel.RootCancelScope)({ ...validScope, press: "third" })).toThrow()
  })
})

describe("Cancel.CancelRequestRecord", () => {
  test("round-trips a valid record", () => {
    expect(Schema.decodeUnknownSync(Cancel.CancelRequestRecord)(validRecord) as unknown).toEqual(validRecord)
  })

  test("accepts every CancelOutcome member and rejects an outsider", () => {
    for (const outcome of ["requested", "accepted", "rejected", "unknown", "unconfirmed"] as const) {
      expect(Schema.decodeUnknownSync(Cancel.CancelRequestRecord)({ ...validRecord, outcome }).outcome).toBe(outcome)
    }
    expect(() => Schema.decodeUnknownSync(Cancel.CancelRequestRecord)({ ...validRecord, outcome: "killed" })).toThrow()
  })
})
