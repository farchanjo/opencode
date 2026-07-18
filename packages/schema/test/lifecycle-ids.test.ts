import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Ids } from "../src/lifecycle/ids"

describe("Ids.TaskId / ProcessId / ParentProcessId / RootProcessId", () => {
  test("accepts an alphanumeric id within the length bound", () => {
    expect(Schema.decodeUnknownSync(Ids.TaskId)("tsk_abc-123")).toBe(Ids.TaskId.make("tsk_abc-123"))
    expect(Schema.decodeUnknownSync(Ids.ProcessId)("prc_abc-123")).toBe(Ids.ProcessId.make("prc_abc-123"))
    expect(Schema.decodeUnknownSync(Ids.ParentProcessId)("prc_parent-1")).toBe(
      Ids.ParentProcessId.make("prc_parent-1"),
    )
    expect(Schema.decodeUnknownSync(Ids.RootProcessId)("prc_root-1")).toBe(Ids.RootProcessId.make("prc_root-1"))
  })

  test("round-trips through encode", () => {
    const decoded = Schema.decodeUnknownSync(Ids.TaskId)("tsk_abc-123")
    expect(Schema.encodeSync(Ids.TaskId)(decoded)).toBe("tsk_abc-123")
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Ids.TaskId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.ProcessId)("")).toThrow()
  })

  test("rejects an id with characters outside the pattern", () => {
    expect(() => Schema.decodeUnknownSync(Ids.TaskId)("tsk/abc:123")).toThrow()
  })

  test("rejects an id longer than 128 characters", () => {
    expect(() => Schema.decodeUnknownSync(Ids.TaskId)("a".repeat(129))).toThrow()
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

describe("Ids.RuntimeInstanceId / LeaseId", () => {
  test("accepts an alphanumeric id within the length bound", () => {
    expect(Schema.decodeUnknownSync(Ids.RuntimeInstanceId)("rti_abc-123")).toBe(
      Ids.RuntimeInstanceId.make("rti_abc-123"),
    )
    expect(Schema.decodeUnknownSync(Ids.LeaseId)("lea_abc-123")).toBe(Ids.LeaseId.make("lea_abc-123"))
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Ids.RuntimeInstanceId)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(Ids.LeaseId)("")).toThrow()
  })
})

describe("Ids.EventId", () => {
  test("accepts a valid evt_ prefixed id", () => {
    expect(Schema.decodeUnknownSync(Ids.EventId)("evt_abc-123")).toBe(Ids.EventId.make("evt_abc-123"))
  })

  test("round-trips through encode", () => {
    const decoded = Schema.decodeUnknownSync(Ids.EventId)("evt_abc-123")
    expect(Schema.encodeSync(Ids.EventId)(decoded)).toBe("evt_abc-123")
  })

  test("rejects an id without the evt_ prefix", () => {
    expect(() => Schema.decodeUnknownSync(Ids.EventId)("abc-123")).toThrow()
  })

  test("rejects an empty id", () => {
    expect(() => Schema.decodeUnknownSync(Ids.EventId)("")).toThrow()
  })

  test("rejects an id longer than 120 characters after the prefix", () => {
    expect(() => Schema.decodeUnknownSync(Ids.EventId)("evt_" + "a".repeat(121))).toThrow()
  })
})
